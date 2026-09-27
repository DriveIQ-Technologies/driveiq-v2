import { describe, expect, it } from 'vitest';

import {
  isWatchActive,
  UNTIMED_WATCH_EXPIRES_AFTER_MS,
  WATCH_EXPIRES_AFTER_MS,
} from '@/utils/watchedFlights';

const now = Date.parse('2026-09-24T01:36:00+01:00');
const HOUR = 60 * 60 * 1000;

describe('watched flight expiry', () => {
  it('keeps an upcoming flight', () => {
    expect(isWatchActive({ effectiveMs: now + 3 * HOUR }, now)).toBe(true);
  });

  it('keeps a flight for a while after it lands, while delays still matter', () => {
    expect(isWatchActive({ effectiveMs: now - 2 * HOUR }, now)).toBe(true);
  });

  it('drops a flight that landed long ago — the one that kept free users stuck', () => {
    expect(isWatchActive({ effectiveMs: now - WATCH_EXPIRES_AFTER_MS - 1 }, now)).toBe(false);
    // Watched last week while on Premium: must not still count today.
    expect(isWatchActive({ effectiveMs: now - 7 * 24 * HOUR }, now)).toBe(false);
  });

  it('uses the revised time, so a delayed flight is not dropped early', () => {
    const f = { scheduledMs: now - 8 * HOUR, effectiveMs: now - 1 * HOUR };
    expect(isWatchActive(f, now)).toBe(true);
  });

  it('falls back to the scheduled time when there is no revised one', () => {
    expect(isWatchActive({ effectiveMs: 0, scheduledMs: now - 1 * HOUR }, now)).toBe(true);
    expect(isWatchActive({ effectiveMs: 0, scheduledMs: now - 9 * HOUR }, now)).toBe(false);
  });

  it('expires an untimed flight a day after it was watched', () => {
    expect(isWatchActive({ savedAt: now - 2 * HOUR }, now)).toBe(true);
    expect(isWatchActive({ savedAt: now - UNTIMED_WATCH_EXPIRES_AFTER_MS - 1 }, now)).toBe(false);
  });
});
