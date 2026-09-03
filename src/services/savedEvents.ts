import type { AppEvent } from '@/types/event';
import { getJSON, setJSON } from './storage';
import { incrementUsageCounter } from './usageCounters';

/**
 * Saved / followed events.
 *
 * We persist the FULL event payload (not just the id) so reminders and
 * calendar export keep working even after the event drops out of the live
 * API window. Keyed by event id.
 */

const STORAGE_KEY = 'driveiq.savedEvents.v1';

export type SavedEventMap = Record<string, AppEvent>;

export async function loadSavedEvents(): Promise<SavedEventMap> {
  return getJSON<SavedEventMap>(STORAGE_KEY, {});
}

export async function saveEvent(event: AppEvent): Promise<SavedEventMap> {
  const map = await loadSavedEvents();
  const isNew = !(event.id in map);
  map[event.id] = event;
  await setJSON(STORAGE_KEY, map);
  if (isNew) {
    void incrementUsageCounter('eventsSaved');
  }
  return map;
}

export async function unsaveEvent(id: string): Promise<SavedEventMap> {
  const map = await loadSavedEvents();
  delete map[id];
  await setJSON(STORAGE_KEY, map);
  return map;
}

export async function isEventSaved(id: string): Promise<boolean> {
  const map = await loadSavedEvents();
  return id in map;
}
