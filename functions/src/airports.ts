/**
 * Server-side airport FIDS cache (AeroDataBox via RapidAPI).
 * LHR/LGW every 5 min; STN/LTN/LCY every 15 min (caller decides).
 */
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { enqueueCopy } from './copyQueue.js';

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
interface AdbFlight {
  number?: string;
  status?: string;
  airline?: { name?: string };
  isCargo?: boolean;
  movement?: {
    airport?: { name?: string; shortName?: string; iata?: string };
    scheduledTime?: AdbTime;
    revisedTime?: AdbTime;
    terminal?: string;
  };
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
  const m = f.movement ?? {};
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
  return out.sort((a, b) => a.scheduledMs - b.scheduledMs);
}

const p2 = (n: number) => String(n).padStart(2, '0');

function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(
    d.getHours(),
  )}:${p2(d.getMinutes())}`;
}

async function fetchWindow(
  apiKey: string,
  icao: string,
  from: Date,
  to: Date,
): Promise<CachedFlight[]> {
  const url =
    `https://${HOST}/flights/airports/icao/${icao}/${formatLocal(from)}/${formatLocal(to)}` +
    '?withLeg=true&direction=Both&withCancelled=true&withCodeshared=true&withCargo=false';
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': HOST,
    },
  });
  if (!res.ok) {
    logger.warn('airport.http', { icao, status: res.status });
    return [];
  }
  const raw = (await res.json()) as AdbFidsResponse;
  return normalizeFids(raw);
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
  const flights = await fetchWindow(apiKey, icao, from, to);

  const prevSnap = await db.doc(`airportCache/${icao}`).get();
  const prevFlights = (prevSnap.data()?.flights ?? []) as CachedFlight[];
  const prevById = new Map(prevFlights.map((f) => [f.id, f]));

  for (const f of flights) {
    const before = prevById.get(f.id);
    if (!before) continue;
    const becameCancelled = !before.cancelled && f.cancelled;
    const becameDelayed = !before.delayed && f.delayed;
    const delayWorse =
      before.delayed &&
      f.delayed &&
      (f.delayMinutes ?? 0) >= (before.delayMinutes ?? 0) + 15;
    if (becameCancelled || becameDelayed || delayWorse) {
      const raw = [
        f.flightNumber,
        f.direction,
        f.counterpart,
        f.status,
        f.cancelled ? 'cancelled' : '',
        f.delayed ? `delayed ${f.delayMinutes ?? ''}m` : '',
        airportId.toUpperCase(),
      ]
        .filter(Boolean)
        .join(' · ');
      await enqueueCopy(db, `flight-${f.id}`, {
        kind: 'flight',
        rawRecord: raw,
        collection: 'flight',
      });
    }
  }

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
