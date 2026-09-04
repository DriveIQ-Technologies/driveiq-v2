export const FREE_SAVED_STATION_LIMIT = 1;
export const FREE_STATION_LOCK_MS = 7 * 24 * 60 * 60 * 1000;

export interface SavedStation {
  stationId: string;
  notify: boolean;
  savedAt: number;
}

export type SavedStationMap = Record<string, SavedStation>;

export interface FreeStationSlot {
  stationId: string;
  lockedUntil: number;
}

export function isSlotActive(slot: FreeStationSlot | null, now = Date.now()): boolean {
  return Boolean(slot && slot.lockedUntil > now);
}

export function freeStationSaveGate(opts: {
  stationId: string;
  map: SavedStationMap;
  slot: FreeStationSlot | null;
  now?: number;
}): 'ok' | 'blocked-limit' | 'blocked-cooldown' {
  const now = opts.now ?? Date.now();
  if (opts.map[opts.stationId]) return 'ok';
  const otherSaved = Object.keys(opts.map).filter((id) => id !== opts.stationId);
  if (otherSaved.length >= FREE_SAVED_STATION_LIMIT) return 'blocked-limit';
  if (isSlotActive(opts.slot, now) && opts.slot!.stationId !== opts.stationId) {
    return 'blocked-cooldown';
  }
  return 'ok';
}

export function slotAfterFreeSave(
  stationId: string,
  current: FreeStationSlot | null,
  now = Date.now(),
): FreeStationSlot {
  if (isSlotActive(current, now) && current!.stationId === stationId) {
    return current!;
  }
  return { stationId, lockedUntil: now + FREE_STATION_LOCK_MS };
}

export function mergeFreeStationSlots(
  local: FreeStationSlot | null,
  remote: FreeStationSlot | null,
  now = Date.now(),
): FreeStationSlot | null {
  const a = isSlotActive(local, now) ? local : null;
  const b = isSlotActive(remote, now) ? remote : null;
  if (a && b) return b.lockedUntil >= a.lockedUntil ? b : a;
  return a ?? b ?? (local && local.lockedUntil >= (remote?.lockedUntil ?? 0) ? local : remote);
}

export function formatStationLockUntil(lockedUntil: number): string {
  return new Date(lockedUntil).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  });
}
