/**
 * Saved stations + notify prefs.
 *
 * Looking at hubs is free. Save / notify is the paid line (free: 1 saved station).
 * That one hub is locked for 7 days so a free account cannot rotate every day.
 */

import { track } from '@/services/analytics';
import { resetSheetPointers } from '@/components/ui/SheetOverlay';
import { incrementUsageCounter } from '@/services/usageCounters';
import {
  ensurePermission,
  loadLineSubscriptions,
  saveLineSubscriptions,
} from '@/services/notifications';
import { hasProAccess } from '@/services/subscription';
import { getJSON, setJSON } from '@/services/storage';
import type { MajorStation } from '@/services/stations';
import {
  formatStationLockUntil,
  freeStationSaveGate,
  FREE_SAVED_STATION_LIMIT,
  FREE_STATION_LOCK_MS,
  isSlotActive,
  mergeFreeStationSlots,
  slotAfterFreeSave,
  type FreeStationSlot,
  type SavedStation,
  type SavedStationMap,
} from '@/utils/freeStationSlot';

export {
  formatStationLockUntil,
  freeStationSaveGate,
  FREE_SAVED_STATION_LIMIT,
  FREE_STATION_LOCK_MS,
  isSlotActive,
  mergeFreeStationSlots,
  slotAfterFreeSave,
};
export type { FreeStationSlot, SavedStation, SavedStationMap };

const SAVED_STATIONS_KEY = 'driveiq.savedStations.v1';
const FREE_SLOT_KEY = 'driveiq.freeStationSlot.v1';

export async function loadSavedStations(): Promise<SavedStationMap> {
  return getJSON<SavedStationMap>(SAVED_STATIONS_KEY, {});
}

async function persistSavedStations(next: SavedStationMap): Promise<void> {
  await setJSON(SAVED_STATIONS_KEY, next);
}

async function loadLocalSlot(): Promise<FreeStationSlot | null> {
  const raw = await getJSON<FreeStationSlot | null>(FREE_SLOT_KEY, null);
  if (!raw || typeof raw.stationId !== 'string' || !Number.isFinite(raw.lockedUntil)) {
    return null;
  }
  return raw;
}

async function loadRemoteSlot(): Promise<FreeStationSlot | null> {
  try {
    const { auth, db, fsApi } = await import('@/services/firebase');
    const uid = auth?.currentUser?.uid;
    if (!uid || !db || !fsApi) return null;
    const snap = await fsApi.getDoc(fsApi.doc(db, 'users', uid));
    const raw = snap.data()?.freeStationSlot as FreeStationSlot | undefined;
    if (!raw || typeof raw.stationId !== 'string' || !Number.isFinite(Number(raw.lockedUntil))) {
      return null;
    }
    return { stationId: raw.stationId, lockedUntil: Number(raw.lockedUntil) };
  } catch {
    return null;
  }
}

export async function loadFreeStationSlot(): Promise<FreeStationSlot | null> {
  const now = Date.now();
  const [local, remote, map] = await Promise.all([
    loadLocalSlot(),
    loadRemoteSlot(),
    loadSavedStations(),
  ]);
  let merged = mergeFreeStationSlots(local, remote, now);

  // Anyone who already has a free hub saved, but no lock yet, starts the 7-day
  // window now — otherwise they could unsave and rotate the same day.
  const savedIds = Object.keys(map);
  if (!isSlotActive(merged, now) && savedIds.length === 1) {
    merged = { stationId: savedIds[0], lockedUntil: now + FREE_STATION_LOCK_MS };
    await persistFreeSlot(merged);
    return merged;
  }

  if (merged && JSON.stringify(merged) !== JSON.stringify(local)) {
    await setJSON(FREE_SLOT_KEY, merged);
  }
  return merged;
}

async function persistFreeSlot(slot: FreeStationSlot): Promise<void> {
  await setJSON(FREE_SLOT_KEY, slot);
  try {
    const { syncUserProfile } = await import('@/services/userSync');
    await syncUserProfile({ freeStationSlot: slot });
  } catch {
    /* offline is fine — local lock still holds */
  }
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

export type SaveStationResult = 'saved' | 'unsaved' | 'blocked-limit' | 'blocked-cooldown';

export async function toggleSaveStation(
  station: MajorStation,
): Promise<{ result: SaveStationResult; map: SavedStationMap; slot: FreeStationSlot | null }> {
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
    return { result: 'unsaved', map: next, slot: await loadLocalSlot() };
  }

  const isPremium = await hasProAccess();
  const slot = isPremium ? null : await loadFreeStationSlot();
  if (!isPremium) {
    const gate = freeStationSaveGate({ stationId: station.id, map, slot });
    if (gate !== 'ok') {
      track('station_save_blocked_limit', {
        tier: 'free',
        reason: gate,
        current_saved_count: Object.keys(map).length,
        attempted_station_id: station.id,
        locked_station_id: slot?.stationId,
      });
      if (gate === 'blocked-limit') {
        track('second_station_save_attempted', { station_id: station.id });
      }
      return { result: gate, map, slot };
    }
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
  const nextSlot = isPremium ? slot : slotAfterFreeSave(station.id, slot);
  if (!isPremium && nextSlot) await persistFreeSlot(nextSlot);
  void incrementUsageCounter('stationsWatched');
  track('station_saved', {
    station_id: station.id,
    tier: isPremium ? 'premium' : 'free',
  });
  return { result: 'saved', map: next, slot: nextSlot };
}

async function ensureStationSaved(
  station: MajorStation,
  map: SavedStationMap,
  slot: FreeStationSlot | null,
  isPremium: boolean,
): Promise<{ result: 'ok' | 'blocked-limit' | 'blocked-cooldown'; map: SavedStationMap; slot: FreeStationSlot | null }> {
  if (map[station.id]) return { result: 'ok', map, slot };

  if (!isPremium) {
    const gate = freeStationSaveGate({ stationId: station.id, map, slot });
    if (gate !== 'ok') {
      track('station_save_blocked_limit', {
        tier: 'free',
        reason: gate,
        current_saved_count: Object.keys(map).length,
        attempted_station_id: station.id,
        source: 'notify',
      });
      return { result: gate, map, slot };
    }
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
  const nextSlot = isPremium ? slot : slotAfterFreeSave(station.id, slot);
  if (!isPremium && nextSlot) await persistFreeSlot(nextSlot);
  void incrementUsageCounter('stationsWatched');
  track('station_saved', {
    station_id: station.id,
    tier: isPremium ? 'premium' : 'free',
    source: 'notify',
  });
  return { result: 'ok', map: next, slot: nextSlot };
}

export type NotifyStationResult =
  | 'updated'
  | 'blocked-limit'
  | 'blocked-cooldown'
  | 'permission-denied';

export async function setStationNotify(
  station: MajorStation,
  enabled: boolean,
): Promise<{ result: NotifyStationResult; map: SavedStationMap; slot: FreeStationSlot | null }> {
  let map = await loadSavedStations();
  const isPremium = await hasProAccess();
  let slot = isPremium ? null : await loadFreeStationSlot();

  if (enabled) {
    const ensured = await ensureStationSaved(station, map, slot, isPremium);
    if (ensured.result === 'blocked-limit' || ensured.result === 'blocked-cooldown') {
      return { result: ensured.result, map: ensured.map, slot: ensured.slot };
    }
    map = ensured.map;
    slot = ensured.slot;

    const granted = await ensurePermission();
    resetSheetPointers();
    if (!granted) {
      track('station_notify_permission_denied', { station_id: station.id });
      return { result: 'permission-denied', map, slot };
    }
  }

  const existing = map[station.id];
  if (!existing) {
    return { result: 'updated', map, slot };
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
  return { result: 'updated', map: next, slot };
}
