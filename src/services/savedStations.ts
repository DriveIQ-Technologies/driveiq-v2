/**
 * Saved stations + notify prefs.
 *
 * Looking at hubs is free. Save / notify is the paid line (free: 1 saved station).
 * Data is persisted locally now so it survives reloads. Account-required gating
 * (task 09) can wrap these calls later without changing the storage shape.
 */

import { track } from '@/services/analytics';
import { resetSheetPointers } from '@/components/ui/SheetOverlay';
import {
  ensurePermission,
  loadLineSubscriptions,
  saveLineSubscriptions,
} from '@/services/notifications';
import { hasProAccess } from '@/services/subscription';
import { getJSON, setJSON } from '@/services/storage';
import type { MajorStation } from '@/services/stations';

const SAVED_STATIONS_KEY = 'driveiq.savedStations.v1';
const FREE_SAVED_STATION_LIMIT = 1;

export interface SavedStation {
  stationId: string;
  notify: boolean;
  savedAt: number;
}

export type SavedStationMap = Record<string, SavedStation>;

export async function loadSavedStations(): Promise<SavedStationMap> {
  return getJSON<SavedStationMap>(SAVED_STATIONS_KEY, {});
}

async function persistSavedStations(next: SavedStationMap): Promise<void> {
  await setJSON(SAVED_STATIONS_KEY, next);
}

async function applyStationNotificationLines(
  station: MajorStation,
  enabled: boolean,
): Promise<void> {
  const subs = await loadLineSubscriptions();
  const next = { ...subs };
  for (const line of station.lines) {
    if (enabled) next[line.lineId] = true;
    else delete next[line.lineId];
  }
  await saveLineSubscriptions(next);
}

export type SaveStationResult = 'saved' | 'unsaved' | 'blocked-limit';

export async function toggleSaveStation(
  station: MajorStation,
): Promise<{ result: SaveStationResult; map: SavedStationMap }> {
  const map = await loadSavedStations();
  const existing = map[station.id];
  if (existing) {
    const next = { ...map };
    delete next[station.id];
    await persistSavedStations(next);
    if (existing.notify) {
      await applyStationNotificationLines(station, false);
    }
    track('station_unsaved', { station_id: station.id });
    return { result: 'unsaved', map: next };
  }

  const isPremium = await hasProAccess();
  const savedCount = Object.keys(map).length;
  if (!isPremium && savedCount >= FREE_SAVED_STATION_LIMIT) {
    track('station_save_blocked_limit', {
      tier: 'free',
      current_saved_count: savedCount,
      attempted_station_id: station.id,
    });
    return { result: 'blocked-limit', map };
  }

  const next: SavedStationMap = {
    ...map,
    [station.id]: {
      stationId: station.id,
      notify: false,
      savedAt: Date.now(),
    },
  };
  await persistSavedStations(next);
  track('station_saved', {
    station_id: station.id,
    tier: isPremium ? 'premium' : 'free',
  });
  return { result: 'saved', map: next };
}

/**
 * Ensure a station is in the saved map. Used by notify so one tap can both
 * save and turn alerts on. Returns blocked-limit if free quota is full.
 */
async function ensureStationSaved(
  station: MajorStation,
  map: SavedStationMap,
): Promise<{ result: 'ok' | 'blocked-limit'; map: SavedStationMap }> {
  if (map[station.id]) return { result: 'ok', map };

  const isPremium = await hasProAccess();
  const savedCount = Object.keys(map).length;
  if (!isPremium && savedCount >= FREE_SAVED_STATION_LIMIT) {
    track('station_save_blocked_limit', {
      tier: 'free',
      current_saved_count: savedCount,
      attempted_station_id: station.id,
      source: 'notify',
    });
    return { result: 'blocked-limit', map };
  }

  const next: SavedStationMap = {
    ...map,
    [station.id]: {
      stationId: station.id,
      notify: false,
      savedAt: Date.now(),
    },
  };
  await persistSavedStations(next);
  track('station_saved', {
    station_id: station.id,
    tier: isPremium ? 'premium' : 'free',
    source: 'notify',
  });
  return { result: 'ok', map: next };
}

export type NotifyStationResult =
  | 'updated'
  | 'blocked-limit'
  | 'permission-denied';

/**
 * Turn station alerts on/off. Enabling also saves the station (if needed)
 * and asks for notification permission. Everything is written to local
 * storage immediately.
 */
export async function setStationNotify(
  station: MajorStation,
  enabled: boolean,
): Promise<{ result: NotifyStationResult; map: SavedStationMap }> {
  let map = await loadSavedStations();

  if (enabled) {
    const ensured = await ensureStationSaved(station, map);
    if (ensured.result === 'blocked-limit') {
      return { result: 'blocked-limit', map: ensured.map };
    }
    map = ensured.map;

    const granted = await ensurePermission();
    resetSheetPointers();
    if (!granted) {
      track('station_notify_permission_denied', { station_id: station.id });
      return { result: 'permission-denied', map };
    }
  }

  const existing = map[station.id];
  if (!existing) {
    // Turning off when nothing is saved — nothing to persist.
    return { result: 'updated', map };
  }

  const next: SavedStationMap = {
    ...map,
    [station.id]: {
      ...existing,
      notify: enabled,
    },
  };
  await persistSavedStations(next);
  await applyStationNotificationLines(station, enabled);
  track('station_notify_toggled', { station_id: station.id, enabled });
  return { result: 'updated', map: next };
}
