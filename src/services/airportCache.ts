/**
 * Read server-side airport FIDS caches written by Cloud Functions.
 *
 * The app never calls AeroDataBox itself. One server poll serves every user, so
 * API usage stays flat no matter how many people open the board — and the key
 * stays on the server instead of shipping inside the app binary.
 *
 * Two docs per airport:
 *   airportCache/{icao}     near-term board, refreshed every 10–15 min
 *   airportCacheDay/{icao}  full 24h board for Premium, refreshed hourly
 */
import { db, fsApi } from './firebase';
import type { AirportFlight } from './aerodatabox';
import { AIRPORT_ICAO } from './aerodatabox';

/**
 * Past this the data is no longer worth showing at all. Deliberately generous:
 * polling stops overnight (01:00–05:00), and last night's board with an age
 * label beats an empty screen. Rejecting here used to push the app into a
 * direct API call — it no longer does, so this is purely a usefulness limit.
 */
const HARD_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Older than this and the UI should say so. Covers the slowest poll + slack. */
export const STALE_AFTER_MS = 20 * 60 * 1000;

export interface AirportCacheDoc {
  airportId: string;
  icao: string;
  flights: AirportFlight[];
  updatedAtMs?: number;
  /** How old the cache was when read. */
  ageMs: number;
  /** True when the UI should show a "last updated" caveat. */
  stale: boolean;
}

/**
 * Cache docs written before `effectiveMs` existed do not carry it, and the
 * board filters on that field — without this backfill every row from an older
 * doc would compare as undefined and vanish. Cheap, and it can be dropped once
 * no pre-existing docs remain.
 */
function withEffectiveMs(flights: AirportFlight[]): AirportFlight[] {
  return flights.map((f) =>
    Number.isFinite(f?.effectiveMs)
      ? f
      : { ...f, effectiveMs: Number(f?.revisedMs ?? f?.scheduledMs ?? 0) || 0 },
  );
}

async function readCacheDoc(
  collection: 'airportCache' | 'airportCacheDay',
  airportId: string,
): Promise<AirportCacheDoc | null> {
  const icao = AIRPORT_ICAO[airportId];
  if (!icao || !db || !fsApi) return null;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, collection, icao));
    if (!snap.exists()) return null;
    const data = snap.data() as Omit<AirportCacheDoc, 'ageMs' | 'stale'>;
    if (!Array.isArray(data.flights)) return null;

    const updatedAtMs = Number(data.updatedAtMs ?? 0);
    const ageMs = Date.now() - updatedAtMs;
    if (!Number.isFinite(ageMs) || ageMs > HARD_MAX_AGE_MS) return null;

    return {
      airportId: String(data.airportId ?? airportId),
      icao,
      flights: withEffectiveMs(data.flights as AirportFlight[]),
      updatedAtMs,
      ageMs,
      stale: ageMs > STALE_AFTER_MS,
    };
  } catch (e) {
    return null;
  }
}

/** Near-term board (next few hours). Used by the free board. */
export async function readAirportCache(
  airportId: string,
): Promise<AirportCacheDoc | null> {
  return readCacheDoc('airportCache', airportId);
}

/**
 * Full all-day board (36h from local midnight). Premium only.
 *
 * Stored as one document per 12h window: Heathrow's board exceeds Firestore's
 * 1 MiB per-document limit in a single doc, so the write failed and LHR had no
 * all-day board while quieter airports worked. Windows are read in parallel and
 * merged; a missing window is skipped rather than failing the board.
 */
export async function readAirportDayCache(
  airportId: string,
): Promise<AirportCacheDoc | null> {
  const icao = AIRPORT_ICAO[airportId];
  if (!icao || !db || !fsApi) return null;

  const WINDOWS = 3;
  const reads = Array.from({ length: WINDOWS }, (_, i) =>
    readRawDoc(`airportCacheDay`, `${icao}-${i}`),
  );
  const parts = (await Promise.all(reads)).filter(Boolean) as RawCache[];

  if (parts.length === 0) {
    // Nothing chunked yet (first run after deploy) — fall back to the old
    // single-document layout so the board is never blank in between.
    return readCacheDoc('airportCacheDay', airportId);
  }

  const byId = new Map<string, AirportFlight>();
  for (const part of parts) for (const f of part.flights) byId.set(f.id, f);

  const flights = Array.from(byId.values()).sort(
    (a, b) => a.effectiveMs - b.effectiveMs,
  );
  // Age of the STALEST window: the board is only as fresh as its oldest part.
  const updatedAtMs = Math.min(...parts.map((p) => p.updatedAtMs));
  const ageMs = Date.now() - updatedAtMs;

  return {
    airportId,
    icao,
    flights: withEffectiveMs(flights),
    updatedAtMs,
    ageMs,
    stale: ageMs > STALE_AFTER_MS,
  };
}

interface RawCache {
  flights: AirportFlight[];
  updatedAtMs: number;
}

/** One cache document, or null when missing, unreadable or too old. */
async function readRawDoc(collection: string, docId: string): Promise<RawCache | null> {
  if (!db || !fsApi) return null;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, collection, docId));
    if (!snap.exists()) return null;
    const data = snap.data() as { flights?: AirportFlight[]; updatedAtMs?: number };
    if (!Array.isArray(data.flights)) return null;
    const updatedAtMs = Number(data.updatedAtMs ?? 0);
    const ageMs = Date.now() - updatedAtMs;
    if (!Number.isFinite(ageMs) || ageMs > HARD_MAX_AGE_MS) return null;
    return { flights: data.flights, updatedAtMs };
  } catch (e) {
    return null;
  }
}
