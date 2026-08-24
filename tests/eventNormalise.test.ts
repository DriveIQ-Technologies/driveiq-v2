import { describe, expect, it } from 'vitest';

import { normaliseEventLocal } from '@/services/eventNormalise';
import type { AppEvent } from '@/types/event';

function event(partial: Partial<AppEvent>): AppEvent {
  return {
    id: 't1',
    source: 'ticketmaster',
    category: 'other',
    title: 'Show',
    startsAt: '2026-08-22T13:00:00Z',
    endsAt: '2026-08-22T16:00:00Z',
    venue: 'Victoria Park',
    latitude: 51.5366,
    longitude: -0.0388,
    ...partial,
  };
}

describe('normaliseEventLocal — the screenshots the client marked', () => {
  it('does not put a family show at Wembley Stadium with 90k turnout', () => {
    const next = normaliseEventLocal(
      event({
        title: 'Dinosaur World Live!',
        subCategory: 'Family',
        venue: 'Wembley Stadium',
        latitude: 51.556,
        longitude: -0.2796,
        startsAt: '2026-08-22T09:30:00Z',
        endsAt: '2026-08-22T11:30:00Z',
      }),
    );
    expect(next.venue).toBe('Troubadour Wembley Park Theatre');
    expect(next.turnoutMax ?? 0).toBeLessThan(10000);
  });

  it('finishes an afternoon festival after 22:00, not three hours after gates', () => {
    const next = normaliseEventLocal(
      event({
        title: 'All Points East - Lorde',
        subCategory: 'Rock',
        venue: 'Victoria Park',
        startsAt: '2026-08-22T13:00:00Z', // 14:00 London
        endsAt: '2026-08-22T16:00:00Z',
      }),
    );
    const finish = new Date(next.estimatedFinishAt ?? next.endsAt).toLocaleTimeString(
      'en-GB',
      { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' },
    );
    expect(finish >= '22:00').toBe(true);
  });

  it('finishes a National Bowl headline show in the late evening', () => {
    const next = normaliseEventLocal(
      event({
        title: 'The Prodigy',
        subCategory: 'Dance/Electronic',
        venue: 'The National Bowl',
        latitude: 52.0148,
        longitude: -0.7562,
        startsAt: '2026-08-22T13:30:00Z',
        endsAt: '2026-08-22T16:30:00Z',
      }),
    );
    const finish = new Date(next.estimatedFinishAt ?? next.endsAt).toLocaleTimeString(
      'en-GB',
      { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' },
    );
    expect(finish >= '22:30').toBe(true);
  });
});
