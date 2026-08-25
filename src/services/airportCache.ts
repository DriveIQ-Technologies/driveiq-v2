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
    return {
      airportId: String(data.airportId ?? airportId),
      icao,
      flights: data.flights as AirportFlight[],
      updatedAtMs: data.updatedAtMs,
    };
  } catch (e) {
    console.warn('[airportCache] read failed', e);
    return null;
  }
}
