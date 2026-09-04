import { describe, expect, it } from 'vitest';

import {
  FREE_STATION_LOCK_MS,
  freeStationSaveGate,
  isSlotActive,
  mergeFreeStationSlots,
  slotAfterFreeSave,
  type FreeStationSlot,
  type SavedStationMap,
} from '@/utils/freeStationSlot';

const now = Date.parse('2026-09-03T12:00:00+01:00');
const eustonSlot: FreeStationSlot = {
  stationId: 'euston',
  lockedUntil: now + FREE_STATION_LOCK_MS,
};
const empty: SavedStationMap = {};
const eustonSaved: SavedStationMap = {
  euston: { stationId: 'euston', notify: true, savedAt: now },
};

describe('free station 7-day lock', () => {
  it('lets a free account pick the first hub', () => {
    expect(
      freeStationSaveGate({ stationId: 'euston', map: empty, slot: null, now }),
    ).toBe('ok');
  });

  it('blocks a second hub while another is still saved', () => {
    expect(
      freeStationSaveGate({
        stationId: 'paddington',
        map: eustonSaved,
        slot: eustonSlot,
        now,
      }),
    ).toBe('blocked-limit');
  });

  it('blocks switching after unsaving — the slot still holds the first hub', () => {
    expect(
      freeStationSaveGate({
        stationId: 'paddington',
        map: empty,
        slot: eustonSlot,
        now,
      }),
    ).toBe('blocked-cooldown');
  });

  it('allows re-saving the same hub during the lock', () => {
    expect(
      freeStationSaveGate({
        stationId: 'euston',
        map: empty,
        slot: eustonSlot,
        now,
      }),
    ).toBe('ok');
  });

  it('allows a new hub after the lock expires', () => {
    const expired: FreeStationSlot = {
      stationId: 'euston',
      lockedUntil: now - 1,
    };
    expect(isSlotActive(expired, now)).toBe(false);
    expect(
      freeStationSaveGate({
        stationId: 'paddington',
        map: empty,
        slot: expired,
        now,
      }),
    ).toBe('ok');
  });

  it('keeps the original lock when re-saving the same hub', () => {
    expect(slotAfterFreeSave('euston', eustonSlot, now)).toEqual(eustonSlot);
  });

  it('starts a new 7-day lock when picking a hub after expiry', () => {
    const expired: FreeStationSlot = {
      stationId: 'euston',
      lockedUntil: now - 1,
    };
    expect(slotAfterFreeSave('paddington', expired, now)).toEqual({
      stationId: 'paddington',
      lockedUntil: now + FREE_STATION_LOCK_MS,
    });
  });

  it('prefers the later of two active locks so a reinstall cannot reset the window', () => {
    const earlier: FreeStationSlot = {
      stationId: 'euston',
      lockedUntil: now + 2 * 24 * 60 * 60 * 1000,
    };
    const later: FreeStationSlot = {
      stationId: 'euston',
      lockedUntil: now + 6 * 24 * 60 * 60 * 1000,
    };
    expect(mergeFreeStationSlots(earlier, later, now)).toEqual(later);
    expect(mergeFreeStationSlots(later, earlier, now)).toEqual(later);
  });

  it('takes the remaining active lock when the other side has expired', () => {
    const expired: FreeStationSlot = {
      stationId: 'paddington',
      lockedUntil: now - 1,
    };
    expect(mergeFreeStationSlots(expired, eustonSlot, now)).toEqual(eustonSlot);
    expect(mergeFreeStationSlots(eustonSlot, expired, now)).toEqual(eustonSlot);
  });
});
