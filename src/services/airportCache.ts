/**
 * Read server-side airport FIDS cache written by Cloud Functions.
 */
import { db, fsApi } from './firebase';
import type { AirportFlight } from './aerodatabox';
import { AIRPORT_ICAO } from './aerodatabox';

const CACHE_MAX_AGE_MS = 6 * 60 * 1000;

export interface AirportCacheDoc {
  airportId: string;
  icao: string;
  flights: AirportFlight[];
  updatedAtMs?: number;
}

export async function readAirportCache(
  airportId: string,
): Promise<AirportCacheDoc | null> {
  const icao = AIRPORT_ICAO[airportId];
  if (!icao || !db || !fsApi) return null;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, 'airportCache', icao));
    if (!snap.exists()) return null;
    const data = snap.data() as AirportCacheDoc;
    const age = Date.now() - Number(data.updatedAtMs ?? 0);
    if (!Number.isFinite(age) || age > CACHE_MAX_AGE_MS) return null;
    if (!Array.isArray(data.flights)) return null;
    // Cache docs written before `effectiveMs` existed do not carry it, and the
    // board filters on that field — without this backfill every row from an
    // older doc would compare as undefined and vanish from the board. Cheap,
    // and it can be dropped once no pre-existing docs remain.
    const flights = (data.flights as AirportFlight[]).map((f) =>
      Number.isFinite(f?.effectiveMs)
        ? f
        : { ...f, effectiveMs: Number(f?.revisedMs ?? f?.scheduledMs ?? 0) || 0 },
    );
    return {
      airportId: String(data.airportId ?? airportId),
      icao,
      flights,
      updatedAtMs: data.updatedAtMs,
    };
  } catch (e) {
    return null;
  }
}
