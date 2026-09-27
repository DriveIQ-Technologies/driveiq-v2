/**
 * Saved / watched flights.
 *
 * Persist enough of the AirportFlight payload to detect delay/cancel changes
 * on the next poll and notify locally. Keyed by flight id.
 */

import type { AirportFlight } from './aerodatabox';
import { getJSON, setJSON } from './storage';
import { incrementUsageCounter } from './usageCounters';
import { isWatchActive } from '@/utils/watchedFlights';

const STORAGE_KEY = 'driveiq.savedFlights.v1';

export interface SavedFlight extends AirportFlight {
  /** Airport hub id (lhr / lgw / …). */
  airportId: string;
  /** When the user tapped Save. */
  savedAt: number;
}

export type SavedFlightMap = Record<string, SavedFlight>;

/** Only flights that are still happening, with finished ones cleared out. */
export async function loadSavedFlights(): Promise<SavedFlightMap> {
  const map = await getJSON<SavedFlightMap>(STORAGE_KEY, {});
  const now = Date.now();
  const live: SavedFlightMap = {};
  for (const [id, f] of Object.entries(map)) {
    if (f && isWatchActive(f, now)) live[id] = f;
  }
  if (Object.keys(live).length !== Object.keys(map).length) {
    await setJSON(STORAGE_KEY, live);
    // Keep the server in step so it stops alerting on finished flights too.
    void syncFlightsProfile(live);
  }
  return live;
}

/**
 * Watch `flight` and nothing else. Used when a free user is at their limit, so
 * the limit is a choice — swap to this flight — rather than a dead end.
 */
export async function replaceWatchedFlights(
  airportId: string,
  flight: AirportFlight,
): Promise<SavedFlightMap> {
  const map: SavedFlightMap = {
    [flight.id]: { ...flight, airportId, savedAt: Date.now() },
  };
  await setJSON(STORAGE_KEY, map);
  void incrementUsageCounter('flightsTracked');
  void syncFlightsProfile(map);
  return map;
}

export async function saveFlight(
  airportId: string,
  flight: AirportFlight,
): Promise<SavedFlightMap> {
  const map = await loadSavedFlights();
  const isNew = !(flight.id in map);
  map[flight.id] = { ...flight, airportId, savedAt: Date.now() };
  await setJSON(STORAGE_KEY, map);
  if (isNew) {
    void incrementUsageCounter('flightsTracked');
  }
  void syncFlightsProfile(map);
  return map;
}

export async function unsaveFlight(id: string): Promise<SavedFlightMap> {
  const map = await loadSavedFlights();
  delete map[id];
  await setJSON(STORAGE_KEY, map);
  void syncFlightsProfile(map);
  return map;
}

async function syncFlightsProfile(map: SavedFlightMap): Promise<void> {
  try {
    const { syncUserProfileFromLocal } = await import('./userSync');
    const { loadPrefs, loadLineSubscriptions } = await import('./notifications');
    const prefs = await loadPrefs();
    const lineSubs = await loadLineSubscriptions();
    await syncUserProfileFromLocal(prefs, lineSubs, Object.values(map));
  } catch (e) {
  }
}

export async function isFlightSaved(id: string): Promise<boolean> {
  const map = await loadSavedFlights();
  return id in map;
}
