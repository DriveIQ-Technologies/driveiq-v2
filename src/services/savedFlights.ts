/**
 * Saved / watched flights.
 *
 * Persist enough of the AirportFlight payload to detect delay/cancel changes
 * on the next poll and notify locally. Keyed by flight id.
 */

import type { AirportFlight } from './aerodatabox';
import { getJSON, setJSON } from './storage';
import { incrementUsageCounter } from './usageCounters';

const STORAGE_KEY = 'driveiq.savedFlights.v1';

export interface SavedFlight extends AirportFlight {
  /** Airport hub id (lhr / lgw / …). */
  airportId: string;
  /** When the user tapped Save. */
  savedAt: number;
}

export type SavedFlightMap = Record<string, SavedFlight>;

export async function loadSavedFlights(): Promise<SavedFlightMap> {
  return getJSON<SavedFlightMap>(STORAGE_KEY, {});
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
    console.warn('[flights] profile sync skipped', e);
  }
}

export async function isFlightSaved(id: string): Promise<boolean> {
  const map = await loadSavedFlights();
  return id in map;
}
