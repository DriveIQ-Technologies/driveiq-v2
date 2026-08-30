import { describe, expect, it } from 'vitest';

import { normalisePublishedEvent } from './eventNormalise.js';

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
}

describe('normalisePublishedEvent', () => {
  it('keeps Prom 55 published start and end', () => {
    const next = normalisePublishedEvent({
      id: 'featured-proms-2026-2026-08-29-1930',
      source: 'featured',
      category: 'other',
      title: 'BBC Proms: Stravinsky and Prokofiev with the Oslo Philharmonic',
      subCategory: 'Music',
      venue: 'Royal Albert Hall',
      latitude: 51.5009,
      longitude: -0.1774,
      startsAt: '2026-08-29T19:30:00+01:00',
      endsAt: '2026-08-29T21:45:00+01:00',
    });
    expect(hhmm(next.realStartAt ?? next.startsAt)).toBe('19:30');
    expect(hhmm(next.doorsAt ?? '')).toBe('19:00');
    expect(hhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('22:00');
  });

  it('keeps Prom 56 published start instead of +30', () => {
    const next = normalisePublishedEvent({
      id: 'featured-proms-2026-2026-08-30-1900',
      source: 'featured',
      category: 'other',
      title: "BBC Proms: Berlioz's 'The Damnation of Faust'",
      subCategory: 'Music',
      venue: 'Royal Albert Hall',
      latitude: 51.5009,
      longitude: -0.1774,
      startsAt: '2026-08-30T19:00:00+01:00',
      endsAt: '2026-08-30T21:30:00+01:00',
    });
    expect(hhmm(next.realStartAt ?? next.startsAt)).toBe('19:00');
    expect(hhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('21:45');
  });

  it('uses O2 doors 18:00 when Ticketmaster lists 18:30', () => {
    const next = normalisePublishedEvent({
      id: 'tm-rocky',
      source: 'ticketmaster',
      category: 'other',
      title: "A$AP Rocky - Don't Be Dumb World Tour",
      subCategory: 'Hip-Hop/Rap',
      venue: 'The O2',
      latitude: 51.503,
      longitude: 0.0032,
      startsAt: '2026-08-30T18:30:00+01:00',
      endsAt: '2026-08-30T22:45:00+01:00',
    });
    expect(hhmm(next.realStartAt ?? next.startsAt)).toBe('18:30');
    expect(hhmm(next.doorsAt ?? '')).toBe('18:00');
    expect(hhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('23:00');
  });
});
