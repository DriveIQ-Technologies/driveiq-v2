import { describe, expect, it } from 'vitest';

import { isPlausibleLondonEvent } from '@/services/eventSanity';
import type { AppEvent } from '@/types/event';

function cricket(partial: Partial<AppEvent>): AppEvent {
  return {
    id: 'c1',
    source: 'espn',
    category: 'sports',
    title: 'Surrey vs Nottinghamshire',
    startsAt: '2026-08-23T10:00:00Z',
    endsAt: '2026-08-23T18:00:00Z',
    venue: 'The Oval',
    latitude: 51.4839,
    longitude: -0.115,
    subCategory: 'Cricket',
    ...partial,
  };
}

describe('isPlausibleLondonEvent — Oval screenshot', () => {
  it('keeps a real Oval county fixture', () => {
    expect(isPlausibleLondonEvent(cricket({}))).toBe(true);
  });

  it('drops overnight Australia/NZ scoreboard rows pinned on The Oval', () => {
    expect(
      isPlausibleLondonEvent(
        cricket({
          title: 'ACT 86 vs NZ-A 88/2 (10.5/20 ov, target 87)',
          startsAt: '2026-08-23T00:30:00Z',
          subCategory: 'Cricket T20',
        }),
      ),
    ).toBe(false);
    expect(
      isPlausibleLondonEvent(
        cricket({
          title: 'SA-A vs BAN-A',
          startsAt: '2026-08-23T07:30:00Z',
        }),
      ),
    ).toBe(false);
  });

  it('drops titles that are live scores', () => {
    expect(
      isPlausibleLondonEvent(
        cricket({
          title: 'HH-A 153/7 vs BHP 155/7 (19.4/20 ov, target 154)',
          startsAt: '2026-08-23T07:30:00Z',
        }),
      ),
    ).toBe(false);
  });
});
