/**
 * Server-side airport FIDS cache (AeroDataBox via RapidAPI).
 * LHR/LGW every 5 min; STN/LTN/LCY every 15 min (caller decides).
 */
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';

const HOST = 'aerodatabox.p.rapidapi.com';

export const AIRPORT_IDS: Record<string, string> = {
  lhr: 'EGLL',
  lgw: 'EGKK',
  stn: 'EGSS',
  lcy: 'EGLC',
  ltn: 'EGGW',
};

export interface CachedFlight {
  id: string;
  direction: 'arrival' | 'departure';
  flightNumber: string;
  airline: string;
  counterpart: string;
  counterpartIata?: string;
  scheduledLocal?: string;
  revisedLocal?: string;
  scheduledMs: number;
  /** Revised (expected) time as ms epoch, when the feed has one. */
  revisedMs?: number;
  /**
   * Revised time when present, else scheduled. The board sorts and windows on
   * this so a delayed flight stays in the right place — see the same field in
   * src/services/aerodatabox.ts.
   */
  effectiveMs: number;
  status: string;
  cancelled: boolean;
  delayed: boolean;
  delayMinutes?: number;
  terminal?: string;
}

interface AdbTime {
  utc?: string;
  local?: string;
}
/** One end of a leg: where the aircraft came from, or where it is going. */
interface AdbMovement {
  airport?: { name?: string; shortName?: string; iata?: string };
  scheduledTime?: AdbTime;
  revisedTime?: AdbTime;
  terminal?: string;
}

interface AdbFlight {
  number?: string;
  status?: string;
  airline?: { name?: string };
  isCargo?: boolean;
  movement?: AdbMovement;
  /** Present when the feed returns legs instead of a movement. */
  departure?: AdbMovement;
  arrival?: AdbMovement;
}
interface AdbFidsResponse {
  departures?: AdbFlight[];
  arrivals?: AdbFlight[];
}

function parseAdbUtc(s?: string): number {
  if (!s) return NaN;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return new Date(iso).getTime();
}

function normalizeOne(f: AdbFlight, direction: 'arrival' | 'departure', index: number): CachedFlight {
  // `movement` is the other end of the leg. If the response ever comes back in
  // the withLeg=true shape instead, take the opposite end explicitly rather
  // than degrading every field to a placeholder.
  const counterpartLeg = direction === 'arrival' ? f.departure : f.arrival;
  const m = f.movement ?? counterpartLeg ?? {};
  const schedMs = parseAdbUtc(m.scheduledTime?.utc);
  const revMs = parseAdbUtc(m.revisedTime?.utc);
  const cancelled = /cancel/i.test(f.status ?? '');
  let delayMinutes: number | undefined;
  if (Number.isFinite(schedMs) && Number.isFinite(revMs)) {
    delayMinutes = Math.round((revMs - schedMs) / 60000);
  }
  const delayed =
    !cancelled &&
    ((delayMinutes != null && delayMinutes >= 15) || /delay/i.test(f.status ?? ''));
  const airport = m.airport ?? {};
  const flightNumber = (f.number ?? '').trim() || 'Flight';
  return {
    id: `adb-${direction}-${flightNumber}-${m.scheduledTime?.utc ?? index}`,
    direction,
    flightNumber,
    airline: (f.airline?.name ?? '').trim(),
    counterpart: airport.name ?? airport.shortName ?? airport.iata ?? 'Unknown',
    counterpartIata: airport.iata,
    scheduledLocal: m.scheduledTime?.local,
    revisedLocal: m.revisedTime?.local,
    scheduledMs: Number.isFinite(schedMs) ? schedMs : 0,
    revisedMs: Number.isFinite(revMs) ? revMs : undefined,
    effectiveMs: Number.isFinite(revMs)
      ? revMs
      : Number.isFinite(schedMs)
        ? schedMs
        : 0,
    status: (f.status ?? '').trim() || 'Scheduled',
    cancelled,
    delayed,
    delayMinutes,
    terminal: m.terminal?.trim() || undefined,
  };
}

export function normalizeFids(raw: AdbFidsResponse): CachedFlight[] {
  const out: CachedFlight[] = [];
  (raw.arrivals ?? []).forEach((f, i) => {
    if (f.isCargo) return;
    out.push(normalizeOne(f, 'arrival', i));
  });
  (raw.departures ?? []).forEach((f, i) => {
    if (f.isCargo) return;
    out.push(normalizeOne(f, 'departure', i));
  });
  return out.sort((a, b) => a.effectiveMs - b.effectiveMs);
}

const p2 = (n: number) => String(n).padStart(2, '0');

function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(
    d.getHours(),
  )}:${p2(d.getMinutes())}`;
}

/**
 * Does this look like a board we parsed correctly?
 *
 * The response shape once changed underneath the parser and every flight came
 * out as "Unknown" at "--:--" — and that board was published to every user
 * exactly as happily as a good one. Some flights legitimately lack a
 * counterpart or a time, but not most of them. If most do, the parse is wrong:
 * keep the previous board and log it loudly rather than ship garbage.
 */
export function looksLikeParsedBoard(flights: CachedFlight[]): boolean {
  if (flights.length === 0) return true;
  const broken = flights.filter(
    (f) => f.counterpart === 'Unknown' || !(f.effectiveMs > 0),
  ).length;
  return broken / flights.length <= 0.5;
}

/** One AeroDataBox FIDS request. Logged as one credit for the admin dashboard. */
async function noteFlightCall(
  db: Firestore,
  row: { icao: string; purpose: string; ok: boolean; status: number },
): Promise<void> {
  try {
    if (typeof db.collection !== 'function') return;
    await db.collection('flightApiLog').add({
      createdAt: new Date().toISOString(),
      provider: 'aerodatabox',
      credits: 1,
      ...row,
    });
  } catch (e) {
    logger.warn('flightapi.log_fail', { error: e instanceof Error ? e.message : 'error' });
  }
}

/**
 * One FIDS window. Returns null when the REQUEST failed, which is not the same
 * as an airport genuinely having no flights — callers must not treat a failure
 * as an empty board, or a bad key / exhausted quota silently wipes the cache.
 */
async function fetchWindow(
  db: Firestore,
  apiKey: string,
  icao: string,
  from: Date,
  to: Date,
  purpose: string,
): Promise<CachedFlight[] | null> {
  // withLeg MUST be false. With withLeg=true AeroDataBox returns departure/
  // arrival objects and omits `movement`, which is the only thing normalizeOne
  // reads — every flight then parsed as "Unknown" at "--:--". The app always
  // requested withLeg=false, which is why its own fetches looked correct while
  // this cache was quietly useless. Codeshares off for the same reason: they
  // duplicate a flight under each marketing airline.
  const url =
    `https://${HOST}/flights/airports/icao/${icao}/${formatLocal(from)}/${formatLocal(to)}` +
    '?direction=Both&withLeg=false&withCancelled=true&withCodeshared=false' +
    '&withCargo=false&withPrivate=false&withLocation=false';
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': HOST,
    },
  });
  if (!res.ok) {
    logger.warn('airport.http', { icao, status: res.status });
    await noteFlightCall(db, { icao, purpose, ok: false, status: res.status });
    return null;
  }
  const raw = (await res.json()) as AdbFidsResponse;
  const flights = normalizeFids(raw);
  if (!looksLikeParsedBoard(flights)) {
    // Treated like a failed request: callers keep the last good board.
    logger.error('airport.parse_suspect', {
      icao,
      flights: flights.length,
      sampleKeys: Object.keys(raw.arrivals?.[0] ?? raw.departures?.[0] ?? {}),
    });
    await noteFlightCall(db, { icao, purpose, ok: false, status: res.status });
    return null;
  }
  await noteFlightCall(db, { icao, purpose, ok: true, status: res.status });
  return flights;
}

export async function ingestAirport(
  db: Firestore,
  apiKey: string,
  airportId: string,
  now: Date = new Date(),
): Promise<number> {
  const icao = AIRPORT_IDS[airportId];
  if (!icao) return 0;

  const from = new Date(now.getTime() - 60 * 60 * 1000);
  const to = new Date(now.getTime() + 10 * 60 * 60 * 1000);
  const fetched = await fetchWindow(db, apiKey, icao, from, to, 'board');
  if (fetched === null) {
    // Request failed (bad key, exhausted quota, upstream outage). Leave the
    // last good board in place — the app has no fallback of its own, so
    // writing an empty array here would blank the board for every user.
    logger.warn('ingest.airport_fetch_failed_keeping_cache', { airportId, icao });
    return 0;
  }
  const flights = fetched;

  // No AI copy for flight changes. Every delay at every airport was sent to
  // the model (~80 an hour at peak), yet the line was only ever read as the
  // push body for the few flights someone had saved. The dispatcher's own
  // wording ("BA 544 is now delayed by 25m.") says the same thing for free.

  await db.doc(`airportCache/${icao}`).set(
    {
      airportId,
      icao,
      flights,
      flightCount: flights.length,
      updatedAt: new Date().toISOString(),
      updatedAtMs: Date.now(),
    },
    { merge: true },
  );
  logger.info('ingest.airport', { airportId, count: flights.length });
  return flights.length;
}

export async function ingestAirports(
  db: Firestore,
  apiKey: string | undefined,
  opts: { major: boolean; regional: boolean },
): Promise<void> {
  if (!apiKey?.trim()) {
    logger.warn('ingest.airports_no_key');
    return;
  }
  const now = new Date();
  const tasks: Promise<number>[] = [];
  if (opts.major) {
    tasks.push(ingestAirport(db, apiKey, 'lhr', now));
    tasks.push(ingestAirport(db, apiKey, 'lgw', now));
  }
  if (opts.regional) {
    tasks.push(ingestAirport(db, apiKey, 'stn', now));
    tasks.push(ingestAirport(db, apiKey, 'ltn', now));
    tasks.push(ingestAirport(db, apiKey, 'lcy', now));
  }
  await Promise.all(tasks);
}

/**
 * How far past local midnight the "all day" board reaches.
 *
 * 36h, not 24h: a board bounded to the calendar day goes empty at the end of
 * the evening. At 22:00 a driver could see nothing beyond 23:59, even though
 * airports keep running into the early hours — exactly the flights worth
 * driving for. 36 hours from midnight always covers tonight's small hours and
 * tomorrow morning, and still divides into three clean 12h requests (the most
 * AeroDataBox allows per call).
 */
const DAY_BOARD_HOURS = 36;
/** AeroDataBox caps one request at 12 hours. */
const WINDOW_HOURS = 12;

/**
 * Full-day board cached server-side: local midnight through the next 36 hours.
 *
 * Premium's all-day board used to call AeroDataBox directly from every device,
 * bypassing the cache entirely — two calls per open, per user, uncapped. That
 * scales linearly with users and was the main quota risk. Polling it here once
 * costs the same whether one person or ten thousand read it.
 *
 * AeroDataBox caps a window at 12 hours, so a day is two calls. This runs far
 * less often than the near-term poll: the tail of the day is schedule data that
 * barely moves, while `ingestAirport` keeps the next few hours fresh.
 */
export async function ingestAirportDay(
  db: Firestore,
  apiKey: string,
  airportId: string,
  now: Date = new Date(),
): Promise<number> {
  const icao = AIRPORT_IDS[airportId];
  if (!icao) return 0;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  let written = 0;
  let total = 0;

  // One document per 12h window rather than one for the whole board.
  // Heathrow over 36 hours is ~2,500 flights, which exceeds Firestore's 1 MiB
  // per-document limit — the write failed outright and LHR had no all-day
  // board at all while quieter airports were fine. Per-window docs also mean a
  // single failed window no longer costs us the entire day.
  for (let i = 0; i * WINDOW_HOURS < DAY_BOARD_HOURS; i += 1) {
    const from = new Date(start.getTime() + i * WINDOW_HOURS * 3600_000);
    const to = new Date(
      start.getTime() +
        Math.min((i + 1) * WINDOW_HOURS, DAY_BOARD_HOURS) * 3600_000,
    );

    const chunk = await fetchWindow(db, apiKey, icao, from, to, 'day');
    if (chunk === null) {
      // Leave the previous copy of this window in place.
      logger.warn('ingest.airport_day_window_failed_keeping_cache', {
        airportId,
        icao,
        window: i,
      });
      continue;
    }

    const flights = chunk.slice().sort((a, b) => a.effectiveMs - b.effectiveMs);
    await db.doc(`airportCacheDay/${icao}-${i}`).set(
      {
        airportId,
        icao,
        window: i,
        fromMs: from.getTime(),
        toMs: to.getTime(),
        flights,
        flightCount: flights.length,
        updatedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
      },
      { merge: true },
    );
    written += 1;
    total += flights.length;
  }

  if (written === 0) {
    logger.warn('ingest.airport_day_all_windows_failed', { airportId, icao });
    return 0;
  }
  logger.info('ingest.airport_day', { airportId, windows: written, count: total });
  return total;
}

/** Full-day refresh for every airport the app can show. */
export async function ingestAirportDays(
  db: Firestore,
  apiKey: string | undefined,
): Promise<void> {
  if (!apiKey?.trim()) {
    logger.warn('ingest.airport_days_no_key');
    return;
  }
  const now = new Date();
  // Sequential: five airports x two windows in parallel would spike the
  // per-second rate limit for no real gain on an hourly job.
  for (const airportId of Object.keys(AIRPORT_IDS)) {
    try {
      await ingestAirportDay(db, apiKey, airportId, now);
    } catch (e) {
      logger.warn('ingest.airport_day_fail', {
        airportId,
        error: e instanceof Error ? e.message : 'error',
      });
    }
  }
}
