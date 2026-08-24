import { describe, expect, it } from 'vitest';

import type { AppEvent } from '@/types/event';
import {
  freeEventHorizonEnd,
  isEventBeyondFreeHorizon,
  isPremiumDayFilter,
  splitEventsByPremium,
} from '@/utils/premiumHorizon';

const event = (startsAt: string): AppEvent =>
  ({
    id: 'e1',
    title: 'Test',
    startsAt,
    endsAt: startsAt,
    latitude: 51.5,
    longitude: -0.1,
    venue: 'Venue',
    category: 'other',
    source: 'ticketmaster',
  }) as AppEvent;

describe('premiumHorizon', () => {
  const now = new Date('2026-08-25T12:00:00+01:00');

  it('free horizon ends tomorrow night London', () => {
    const end = freeEventHorizonEnd(now);
    expect(end.toISOString()).toContain('2026-08-26');
  });

  it('flags events after tomorrow', () => {
    expect(isEventBeyondFreeHorizon('2026-08-27T19:00:00+01:00', now)).toBe(true);
    expect(isEventBeyondFreeHorizon('2026-08-26T19:00:00+01:00', now)).toBe(false);
  });

  it('marks premium day filters', () => {
    expect(isPremiumDayFilter('today')).toBe(false);
    expect(isPremiumDayFilter('day:2')).toBe(true);
    expect(isPremiumDayFilter('all')).toBe(true);
  });

  it('splits open vs locked for free tier', () => {
    const list = [
      event('2026-08-25T20:00:00+01:00'),
      event('2026-08-30T20:00:00+01:00'),
    ];
    const { open, locked } = splitEventsByPremium(list, false, now);
    expect(open).toHaveLength(1);
    expect(locked).toHaveLength(1);
  });
});
