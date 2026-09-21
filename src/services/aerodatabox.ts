/**
 * AeroDataBox (via RapidAPI) — airport arrivals / departures boards.
 *
 * Powers the airport flight pins (LHR / LGW / LTN / STN / LCY). One call per
 * airport returns both directions for a time window (max 12h per AeroDataBox).
 *
 * Docs: https://rapidapi.com/aedbx-aedbx/api/aerodatabox
 * Endpoint: /flights/airports/icao/{icao}/{fromLocal}/{toLocal}
 *
 * The app does NOT call this API. Cloud Functions poll it and write the boards
 * to Firestore; `fetchAirportFlights` here reads that cache. The brittle
 * parsing lives in the pure `normalizeFids` function so it stays unit-testable
 * without a network or API key (see scripts/test-aerodatabox.ts).
 */


/** Airport id (matches AIRPORTS in airports.ts) → ICAO code AeroDataBox uses. */
export const AIRPORT_ICAO: Record<string, string> = {
  lhr: 'EGLL',
  lgw: 'EGKK',
  stn: 'EGSS',
  lcy: 'EGLC',
  ltn: 'EGGW',
};

export type FlightDirection = 'arrival' | 'departure';

/** Normalised flight row used by the UI. */
export interface AirportFlight {
  id: string;
  direction: FlightDirection;
  /** e.g. "BA 831". */
  flightNumber: string;
  /** e.g. "British Airways". */
  airline: string;
  /** Origin (arrivals) or destination (departures) airport name. */
  counterpart: string;
  counterpartIata?: string;
  /** Raw local time strings from AeroDataBox (kept for display). */
  scheduledLocal?: string;
  revisedLocal?: string;
  /** Scheduled time as ms epoch (from the UTC field). Display + "sched" label. */
  scheduledMs: number;
  /** Revised (expected) time as ms epoch, when the feed has one. */
  revisedMs?: number;
  /**
   * When this flight actually expects to move: revised if the feed has one,
   * otherwise scheduled. This is what the board must sort and filter on — a
   * flight scheduled 20:00 but revised to 23:00 belongs at 23:00, and a
   * flight whose scheduled time has passed is still upcoming if its revised
   * time has not. Sorting or windowing on `scheduledMs` alone put delayed
   * flights in the wrong place and dropped some off the board entirely.
   */
  effectiveMs: number;
  status: string;
  cancelled: boolean;
  delayed: boolean;
  /** Positive = minutes late; only set when a revised time is present. */
  delayMinutes?: number;
  terminal?: string;
}

// ── Raw AeroDataBox shapes (only the fields we read) ────────────────────────
interface AdbTime {
  utc?: string;
  local?: string;
}
interface AdbAirportRef {
  icao?: string;
  iata?: string;
  name?: string;
  shortName?: string;
}
interface AdbMovement {
  airport?: AdbAirportRef;
  scheduledTime?: AdbTime;
  revisedTime?: AdbTime;
  terminal?: string;
}
interface AdbFlight {
  number?: string;
  status?: string;
  airline?: { name?: string };
  movement?: AdbMovement;
  isCargo?: boolean;
}
export interface AdbFidsResponse {
  departures?: AdbFlight[];
  arrivals?: AdbFlight[];
}

/** AeroDataBox UTC times look like "2026-06-26 07:05Z" — make them ISO-parseable. */
function parseAdbUtc(s?: string): number {
  if (!s) return NaN;
  // "2026-06-26 07:05Z" → "2026-06-26T07:05Z"
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return new Date(iso).getTime();
}

const isCancelledStatus = (status?: string): boolean =>
  /cancel/i.test(status ?? '');

/** Threshold (minutes) at which a flight is flagged as delayed. */
const DELAY_THRESHOLD_MIN = 15;

function normalizeOne(
  f: AdbFlight,
  direction: FlightDirection,
  index: number,
): AirportFlight {
  const m = f.movement ?? {};
  const schedMs = parseAdbUtc(m.scheduledTime?.utc);
  const revMs = parseAdbUtc(m.revisedTime?.utc);
  const cancelled = isCancelledStatus(f.status);

  let delayMinutes: number | undefined;
  if (Number.isFinite(schedMs) && Number.isFinite(revMs)) {
    delayMinutes = Math.round((revMs - schedMs) / 60000);
  }
  const delayed =
    !cancelled &&
    ((delayMinutes != null && delayMinutes >= DELAY_THRESHOLD_MIN) ||
      /delay/i.test(f.status ?? ''));

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

/**
 * Pure transform: AeroDataBox FIDS payload → sorted, normalised flight rows.
 * No network, no env — safe to unit-test. Cargo flights are dropped.
 */
export function normalizeFids(raw: AdbFidsResponse): AirportFlight[] {
  const out: AirportFlight[] = [];
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

/** Pad a number to 2 digits. */
const p2 = (n: number) => String(n).padStart(2, '0');


export interface AirportFlightsResult {
  flights: AirportFlight[];
  /**
   * 'no-cache' — the server has not written a board for this airport yet, or
   * the last one is too old to show. There is no client-side fallback by
   * design: see the note on fetchAirportFlights.
   */
  error?: 'no-cache';
  /** Age of the cache that produced these flights, for a staleness caption. */
  ageMs?: number;
  stale?: boolean;
}

/**
 * Arrivals + departures for one airport, read from the server-side cache.
 *
 * This never calls AeroDataBox. It used to: the free board read the cache, but
 * Premium's `fullDay` board bypassed it and made two live calls on every open,
 * per device. That scaled linearly with users and was the bulk of the quota
 * risk — and it required shipping the RapidAPI key inside the app, where it can
 * be extracted. Cloud Functions now poll once and every user reads the result,
 * so API usage is flat at any number of users and the key stays server-side.
 *
 * `fullDay: true` (Premium) reads the 24h doc and overlays the near-term doc on
 * top, so the hours that actually change stay as fresh as the frequent poll.
 */
export async function fetchAirportFlights(
  airportId: string,
  _now: Date = new Date(),
  opts: { fullDay?: boolean } = {},
): Promise<AirportFlightsResult> {
  const { readAirportCache, readAirportDayCache } = await import('./airportCache');

  if (!opts.fullDay) {
    const cached = await readAirportCache(airportId);
    if (!cached || cached.flights.length === 0) return { flights: [], error: 'no-cache' };
    return { flights: cached.flights, ageMs: cached.ageMs, stale: cached.stale };
  }

  const [day, near] = await Promise.all([
    readAirportDayCache(airportId),
    readAirportCache(airportId),
  ]);

  // Neither doc: nothing to show.
  if (!day?.flights.length && !near?.flights.length) {
    return { flights: [], error: 'no-cache' };
  }

  // Day doc is the base; the fresher near-term rows win on id so delays and
  // cancellations in the next few hours are not held back by the hourly poll.
  const byId = new Map<string, AirportFlight>();
  for (const f of day?.flights ?? []) byId.set(f.id, f);
  for (const f of near?.flights ?? []) byId.set(f.id, f);

  const flights = Array.from(byId.values()).sort(
    (a, b) => a.effectiveMs - b.effectiveMs,
  );
  // Report the age of the near-term data: it is what drives the live columns.
  const ageMs = near?.ageMs ?? day?.ageMs;
  return { flights, ageMs, stale: near?.stale ?? day?.stale ?? false };
}
