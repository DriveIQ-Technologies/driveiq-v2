import { describe, expect, it } from 'vitest';

import { dedupeEvents, identityKey, teamPair } from '@/services/eventDedupe';
import type { AppEvent } from '@/types/event';

function event(partial: Partial<AppEvent> & Pick<AppEvent, 'id' | 'source'>): AppEvent {
  return {
    category: 'sports',
    title: 'Arsenal vs Chelsea',
    startsAt: '2026-08-22T14:00:00Z',
    endsAt: '2026-08-22T16:00:00Z',
    venue: 'Emirates Stadium',
    latitude: 51.5549,
    longitude: -0.1084,
    subCategory: 'Football',
    ...partial,
  } as AppEvent;
}

describe('teamPair', () => {
  it('splits the common provider separators', () => {
    expect(teamPair('Arsenal vs Chelsea')).toEqual(['arsenal', 'chelsea']);
    expect(teamPair('Arsenal v Chelsea')).toEqual(['arsenal', 'chelsea']);
    expect(teamPair('Chelsea @ Arsenal')).toEqual(['arsenal', 'chelsea']);
  });

  it('is order independent so home/away naming cannot duplicate a fixture', () => {
    expect(teamPair('Chelsea vs Arsenal')).toEqual(teamPair('Arsenal vs Chelsea'));
  });

  it('ignores club-name noise', () => {
    expect(teamPair('Arsenal FC vs Chelsea FC')).toEqual(['arsenal', 'chelsea']);
    expect(teamPair('AFC Wimbledon v Barnet')).toEqual(['barnet', 'wimbledon']);
  });

  it('returns null when a title is not a fixture', () => {
    expect(teamPair('BBC Proms: Prom 42')).toBeNull();
    expect(teamPair('Coldplay')).toBeNull();
  });
});

describe('dedupeEvents — the reported duplicate-fixture bug', () => {
  it('keeps one record when four providers report the same match', () => {
    const res = dedupeEvents([
      event({ id: 'espn-1', source: 'espn' }),
      event({ id: 'fd-1', source: 'football-data' }),
      event({ id: 'tsdb-1', source: 'thesportsdb' }),
      event({ id: 'fotmob-1', source: 'fotmob' }),
    ]);
    expect(res.events).toHaveLength(1);
    expect(res.removed).toBe(3);
  });

  it('prefers the official fixture list for football', () => {
    const res = dedupeEvents([
      event({ id: 'tsdb-1', source: 'thesportsdb' }),
      event({ id: 'fd-1', source: 'football-data' }),
    ]);
    expect(res.events[0].source).toBe('football-data');
  });

  it('collapses records that disagree about the venue name', () => {
    const res = dedupeEvents([
      event({ id: 'espn-1', source: 'espn', venue: 'Emirates Stadium' }),
      event({ id: 'tsdb-1', source: 'thesportsdb', venue: 'The Emirates' }),
    ]);
    expect(res.events).toHaveLength(1);
  });

  it('collapses records that disagree about kick-off time on the same day', () => {
    const res = dedupeEvents([
      event({ id: 'espn-1', source: 'espn', startsAt: '2026-08-22T14:00:00Z' }),
      event({ id: 'tsdb-1', source: 'thesportsdb', startsAt: '2026-08-22T11:00:00Z' }),
    ]);
    expect(res.events).toHaveLength(1);
  });

  it('keeps a real kick-off over a synthesised placeholder time', () => {
    // TheSportsDB fills 12:00 London when it has no clock time; ESPN has 17:30.
    const res = dedupeEvents([
      event({
        id: 'tsdb-1',
        source: 'thesportsdb',
        startsAt: '2026-08-22T11:00:00Z', // 12:00 London
      }),
      event({
        id: 'fotmob-1',
        source: 'fotmob',
        startsAt: '2026-08-22T16:30:00Z', // 17:30 London
      }),
    ]);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].startsAt).toBe('2026-08-22T16:30:00Z');
  });

  it('does not merge men and women fixtures played the same day', () => {
    const res = dedupeEvents([
      event({ id: 'fd-1', source: 'football-data', title: 'Arsenal vs Chelsea' }),
      event({
        id: 'fd-2',
        source: 'football-data',
        title: 'Arsenal Women vs Chelsea Women',
        startsAt: '2026-08-22T11:00:00Z',
      }),
    ]);
    expect(res.events).toHaveLength(2);
  });

  it('does not merge the same fixture on different days', () => {
    const res = dedupeEvents([
      event({ id: 'fd-1', source: 'football-data' }),
      event({
        id: 'fd-2',
        source: 'football-data',
        startsAt: '2026-08-29T14:00:00Z',
        endsAt: '2026-08-29T16:00:00Z',
      }),
    ]);
    expect(res.events).toHaveLength(2);
  });

  it('collapses West Ham / Tottenham naming variants from different feeds', () => {
    const res = dedupeEvents([
      event({
        id: 'espn-1',
        source: 'espn',
        title: 'West Ham United vs Tottenham Hotspur',
        venue: 'London Stadium',
      }),
      event({
        id: 'fd-1',
        source: 'football-data',
        title: 'West Ham vs Spurs',
        venue: 'London Stadium',
      }),
    ]);
    expect(res.events).toHaveLength(1);
  });

  it('collapses a live score title against the scheduled listing', () => {
    const res = dedupeEvents([
      event({ id: 'espn-1', source: 'espn', title: 'Arsenal 2-1 Chelsea' }),
      event({ id: 'fd-1', source: 'football-data', title: 'Arsenal vs Chelsea' }),
    ]);
    expect(res.events).toHaveLength(1);
  });

  it('snaps the surviving pin to the curated ground', () => {
    const res = dedupeEvents([
      event({
        id: 'tm-1',
        source: 'ticketmaster',
        title: 'Arsenal vs Chelsea',
        venue: 'Emirates Stadium',
        latitude: 51.5,
        longitude: -0.1,
      }),
      event({
        id: 'fd-1',
        source: 'football-data',
        title: 'Arsenal vs Chelsea',
        venue: 'Emirates Stadium',
        latitude: 51.5549,
        longitude: -0.1084,
      }),
    ]);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].latitude).toBe(51.5549);
    expect(res.events[0].longitude).toBe(-0.1084);
  });

  it('fills gaps in the winner from the records it replaces', () => {
    const res = dedupeEvents([
      event({ id: 'fd-1', source: 'football-data' }),
      event({
        id: 'tm-1',
        source: 'ticketmaster',
        url: 'https://tickets.example/arsenal',
        description: 'Premier League fixture',
      }),
    ]);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].source).toBe('football-data');
    expect(res.events[0].url).toBe('https://tickets.example/arsenal');
    expect(res.events[0].description).toBe('Premier League fixture');
  });
});

describe('dedupeEvents — non-sport events', () => {
  const show = (partial: Partial<AppEvent> & Pick<AppEvent, 'id' | 'source'>) =>
    event({
      category: 'other',
      title: 'Les Misérables',
      venue: 'Sondheim Theatre',
      subCategory: 'Theatre',
      ...partial,
    });

  it('collapses the same performance reported twice', () => {
    const res = dedupeEvents([
      show({ id: 'tm-1', source: 'ticketmaster' }),
      show({ id: 'venuesite-1', source: 'venue-site' }),
    ]);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].source).toBe('venue-site');
  });

  it('keeps a matinee and an evening performance apart', () => {
    const res = dedupeEvents([
      show({ id: 'tm-1', source: 'ticketmaster', startsAt: '2026-08-22T13:30:00Z' }),
      show({ id: 'tm-2', source: 'ticketmaster', startsAt: '2026-08-22T18:30:00Z' }),
    ]);
    expect(res.events).toHaveLength(2);
  });

  it('collapses a curated featured entry against the venue feed', () => {
    const res = dedupeEvents([
      show({
        id: 'featured-proms-1',
        source: 'featured',
        title: 'BBC Proms: Prom 42',
        venue: 'Royal Albert Hall',
      }),
      show({
        id: 'venuesite-proms-1',
        source: 'venue-site',
        title: 'BBC Proms: Prom 42',
        venue: 'Royal Albert Hall',
      }),
    ]);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].source).toBe('featured');
  });
});

describe('identityKey', () => {
  it('is stable across providers for one fixture', () => {
    const a = identityKey(event({ id: 'espn-1', source: 'espn' }));
    const b = identityKey(
      event({ id: 'fd-1', source: 'football-data', venue: 'The Emirates' }),
    );
    expect(a).toBe(b);
  });

  it('uses the London calendar day, not UTC', () => {
    // 23:30 London on 22 Aug during BST is 22:30Z the same day.
    const key = identityKey(event({ id: 'x', source: 'espn', startsAt: '2026-08-22T22:30:00Z' }));
    expect(key).toContain('2026-08-22');
  });
});
