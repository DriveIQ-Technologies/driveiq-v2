import { describe, expect, it } from 'vitest';

import type { PublishedEvent } from './eventNormalise.js';
import { dedupeSportsEvents } from './sportsDedupe.js';

const STAMFORD = { latitude: 51.4817, longitude: -0.191 };
const TOTTENHAM = { latitude: 51.6043, longitude: -0.0665 };

function ev(over: Partial<PublishedEvent>): PublishedEvent {
  return {
    id: over.id ?? Math.random().toString(36),
    source: 'ticketmaster',
    category: 'sports',
    title: 'Match',
    startsAt: '2026-09-27T15:30:00Z',
    endsAt: '2026-09-27T17:25:00Z',
    venue: 'Stamford Bridge',
    ...STAMFORD,
    ...over,
  };
}

describe('dedupeSportsEvents', () => {
  it('keeps the league-feed listing when Ticketmaster has the same fixture', () => {
    // Seen live: ESPN "Chelsea vs Arsenal" and Ticketmaster
    // "CHELSEA WOMEN V ARSENAL WOMEN" at Stamford Bridge, same kick-off.
    const out = dedupeSportsEvents([
      ev({ id: 'tm-1', title: 'CHELSEA WOMEN V ARSENAL WOMEN', url: 'https://tm/x' }),
      ev({ id: 'espn-1', source: 'espn', title: 'Chelsea vs Arsenal', venue: 'Stamford Bridge' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('espn-1');
    // The ticket link survives from the listing that lost.
    expect(out[0].url).toBe('https://tm/x');
  });

  it('matches across slightly different stadium coordinates', () => {
    const out = dedupeSportsEvents([
      ev({ id: 'espn-1', source: 'espn' }),
      ev({ id: 'tm-1', latitude: STAMFORD.latitude + 0.002, longitude: STAMFORD.longitude - 0.002 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('drops the hospitality copy of a game Ticketmaster lists twice', () => {
    // Seen live: "Indianapolis Colts v Washington Commanders" and the same
    // game "- Premium" at Tottenham Hotspur Stadium.
    const out = dedupeSportsEvents([
      ev({ id: 'a', title: 'Indianapolis Colts vs. Washington Commanders - Premium', ...TOTTENHAM }),
      ev({ id: 'b', title: 'Indianapolis Colts v Washington Commanders', ...TOTTENHAM }),
    ]);
    expect(out.map((e) => e.id)).toEqual(['b']);
  });

  it('keeps separate sessions at the same venue on the same day', () => {
    // Laver Cup: Session One 11:30 and Session Two 17:30 at the O2.
    const out = dedupeSportsEvents([
      ev({ id: 's1', title: 'Laver Cup - Session One', startsAt: '2026-09-25T10:30:00Z' }),
      ev({ id: 's2', title: 'Laver Cup - Session Two', startsAt: '2026-09-25T16:30:00Z' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps a double-header as two fixtures', () => {
    const out = dedupeSportsEvents([
      ev({ id: 'w', title: 'Women', startsAt: '2026-09-26T11:00:00Z' }),
      ev({ id: 'm', title: 'Men', startsAt: '2026-09-26T14:00:00Z' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('never merges non-sports events, even at the same place and time', () => {
    // Royal Albert Hall runs its main hall and side rooms simultaneously.
    const out = dedupeSportsEvents([
      ev({ id: 'c1', category: 'other', title: 'Concert A' }),
      ev({ id: 'c2', category: 'other', title: 'Concert B' }),
    ]);
    expect(out).toHaveLength(2);
  });
});
