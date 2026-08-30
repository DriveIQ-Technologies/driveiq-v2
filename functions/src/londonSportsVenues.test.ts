import { describe, expect, it } from 'vitest';

import { findSportsPlace, resolveSportsPlace } from './londonSportsVenues.js';
import { normalisePublishedEvent } from './eventNormalise.js';

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
}

describe('findSportsPlace', () => {
  it('pins Premier League home grounds', () => {
    expect(findSportsPlace('Emirates Stadium')?.venue).toBe('Emirates Stadium');
    expect(findSportsPlace('Arsenal Women')?.venue).toBe('Emirates Stadium');
    expect(findSportsPlace('Tottenham Hotspur Stadium')?.venue).toBe('Tottenham Hotspur Stadium');
    expect(findSportsPlace('The Den')?.venue).toBe('The Den');
  });

  it('does not pin tennis at AFC Wimbledon', () => {
    expect(findSportsPlace('The Championships, Wimbledon')?.venue).toBe(
      'All England Lawn Tennis Club',
    );
    expect(findSportsPlace('AFC Wimbledon')?.venue).toBe('Plough Lane');
  });

  it('does not pin Wembley Arena at the stadium', () => {
    expect(findSportsPlace('OVO Arena Wembley')?.venue).toBe('OVO Arena Wembley');
    expect(findSportsPlace('Wembley Stadium')?.venue).toBe('Wembley Stadium');
  });

  it('pins rugby at Twickenham, StoneX and The Stoop', () => {
    expect(findSportsPlace('Twickenham Stadium')?.latitude).toBe(51.4561);
    expect(findSportsPlace('Saracens')?.venue).toBe('StoneX Stadium');
    expect(findSportsPlace('The Stoop')?.latitude).toBe(51.4538);
  });

  it('ignores away venues even when the home club is London', () => {
    expect(resolveSportsPlace('Anfield', 'Arsenal')).toBeNull();
    expect(resolveSportsPlace(null, 'Arsenal')?.venue).toBe('Emirates Stadium');
  });
});

describe('normalisePublishedEvent sports', () => {
  it('uses listed kick-off and 90 min doors at Emirates', () => {
    const next = normalisePublishedEvent({
      id: 'fotmob-arsenal-home',
      source: 'fotmob',
      category: 'sports',
      title: 'Arsenal vs Chelsea',
      subCategory: 'Football',
      venue: 'Emirates Stadium',
      latitude: 51.5549,
      longitude: -0.1084,
      startsAt: '2026-08-30T16:00:00+01:00',
      endsAt: '2026-08-30T18:30:00+01:00',
    });
    expect(hhmm(next.realStartAt ?? next.startsAt)).toBe('16:00');
    expect(hhmm(next.doorsAt ?? '')).toBe('14:30');
  });
});
