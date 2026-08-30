import { describe, expect, it } from 'vitest';

import { normaliseEventLocal } from '@/services/eventNormalise';
import type { AppEvent } from '@/types/event';
import { formatLondonHhmm } from '@/utils/dateFilters';

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

describe('normaliseEventLocal — official listings vs Ticketmaster doors heuristic', () => {
  it('keeps Prom 55 start and published end, instead of +30 min / 22:30', () => {
    const next = normaliseEventLocal(
      event({
        source: 'featured',
        title: 'BBC Proms: Stravinsky and Prokofiev with the Oslo Philharmonic',
        subCategory: 'Music',
        venue: 'Royal Albert Hall',
        latitude: 51.5009,
        longitude: -0.1774,
        startsAt: '2026-08-29T19:30:00+01:00',
        endsAt: '2026-08-29T21:45:00+01:00',
      }),
    );
    expect(formatLondonHhmm(next.realStartAt ?? next.startsAt)).toBe('19:30');
    expect(formatLondonHhmm(next.doorsAt ?? '')).toBe('19:00');
    expect(formatLondonHhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('22:00');
  });

  it('keeps Prom 56 start and published end, instead of shifting the whole card +30', () => {
    const next = normaliseEventLocal(
      event({
        source: 'featured',
        title: "BBC Proms: Berlioz's 'The Damnation of Faust'",
        subCategory: 'Music',
        venue: 'Royal Albert Hall',
        latitude: 51.5009,
        longitude: -0.1774,
        startsAt: '2026-08-30T19:00:00+01:00',
        endsAt: '2026-08-30T21:30:00+01:00',
      }),
    );
    expect(formatLondonHhmm(next.realStartAt ?? next.startsAt)).toBe('19:00');
    expect(formatLondonHhmm(next.doorsAt ?? '')).toBe('18:30');
    expect(formatLondonHhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('21:45');
  });

  it('uses O2 doors at 18:00 when Ticketmaster lists 18:30, and keeps a 23:00 out', () => {
    const next = normaliseEventLocal(
      event({
        title: "A$AP Rocky - Don't Be Dumb World Tour",
        subCategory: 'Hip-Hop/Rap',
        venue: 'The O2',
        latitude: 51.503,
        longitude: 0.0032,
        startsAt: '2026-08-30T18:30:00+01:00',
        endsAt: '2026-08-30T22:45:00+01:00',
      }),
    );
    expect(formatLondonHhmm(next.realStartAt ?? next.startsAt)).toBe('18:30');
    expect(formatLondonHhmm(next.doorsAt ?? '')).toBe('18:00');
    expect(formatLondonHhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('23:00');
  });
});
