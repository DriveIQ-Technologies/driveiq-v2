import { describe, expect, it } from 'vitest';

import {
  cardLimitForQuestion,
  dedupeEvents,
  eventMatchesPlaceHints,
  eventMatchesQuestionName,
  placeHintsFromQuestion,
} from '@/components/ai/eventPresentation';
import type { AppEvent } from '@/types/event';

const event = (partial: Partial<AppEvent> & Pick<AppEvent, 'id' | 'title' | 'venue'>): AppEvent =>
  ({
    startsAt: '2026-09-04T19:00:00+01:00',
    endsAt: '2026-09-04T22:00:00+01:00',
    latitude: 51.5,
    longitude: -0.1,
    category: 'sports',
    source: 'espn',
    ...partial,
  }) as AppEvent;

describe('AI event filtering helpers', () => {
  it('extracts venue hints from indirect venue questions', () => {
    const hints = placeHintsFromQuestion(
      'Whats better to go to, wembley event or the tottenham hotspur one or the o2 one?',
    );
    expect(hints).toEqual(expect.arrayContaining(['wembley', 'tottenham', 'o2']));
  });

  it('matches only the named venues', () => {
    const hints = ['wembley', 'tottenham', 'o2'];
    expect(
      eventMatchesPlaceHints(
        event({ id: '1', title: 'England', venue: 'Wembley Stadium' }),
        hints,
      ),
    ).toBe(true);
    expect(
      eventMatchesPlaceHints(
        event({ id: '2', title: 'Ascot Raceday', venue: 'Ascot Racecourse' }),
        hints,
      ),
    ).toBe(false);
  });

  it('dedupes the same show listed twice on one day', () => {
    const a = event({
      id: 'a',
      title: 'Ascot — Food & Wine Friday Raceday',
      venue: 'Ascot Racecourse',
      source: 'featured',
      turnoutMax: 70000,
    });
    const b = event({
      id: 'b',
      title: 'Ascot - Food & Wine Friday Raceday',
      venue: 'Ascot Racecourse',
      source: 'ticketmaster',
      turnoutMax: 70000,
    });
    const out = dedupeEvents([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('a');
  });

  it('extracts Brentford / Gtech as a place hint', () => {
    expect(placeHintsFromQuestion('What time is Brentford tonight?')).toEqual(
      expect.arrayContaining(['brentford']),
    );
    expect(
      eventMatchesPlaceHints(
        event({ id: 'b', title: 'Brentford vs Chelsea', venue: 'Gtech Community Stadium' }),
        ['brentford'],
      ),
    ).toBe(true);
  });

  it('matches a named club in the question even without the word event', () => {
    const brentford = event({
      id: 'b',
      title: 'Brentford vs Fulham',
      venue: 'Gtech Community Stadium',
    });
    expect(eventMatchesQuestionName(brentford, 'what’s on at Brentford')).toBe(true);
    expect(eventMatchesQuestionName(brentford, 'biggest events tonight')).toBe(false);
  });
});
