import { describe, expect, it } from 'vitest';

import { typicalDurationMin, typicalFinishAt } from './eventDurations.js';
import { normalisePublishedEvent, type PublishedEvent } from './eventNormalise.js';

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
}

describe('typicalDurationMin — sport', () => {
  it('ends football about 1h55 after kick-off, not 2h30', () => {
    // At +2h30 the "crowds leaving" alert (end - 25 min) fired after the final whistle.
    expect(typicalDurationMin({ kind: 'sports', subCategory: 'Football' })).toBe(115);
  });

  it('ends rugby about 1h45 after kick-off', () => {
    expect(typicalDurationMin({ kind: 'sports', subCategory: 'Rugby' })).toBe(105);
  });

  it('does not mistake a rugby "Test Match" for Test cricket', () => {
    expect(
      typicalDurationMin({
        kind: 'sports',
        subCategory: 'Rugby',
        description: 'International Test Match',
      }),
    ).toBe(105);
  });

  it('tells the Hundred, T20 and a full day of cricket apart', () => {
    expect(
      typicalDurationMin({ kind: 'sports', subCategory: 'Cricket T20', description: 'The Hundred' }),
    ).toBe(150);
    expect(
      typicalDurationMin({ kind: 'sports', subCategory: 'Cricket T20', description: 'Vitality Blast' }),
    ).toBe(200);
    // Previously fell through to the 2h30 default.
    expect(
      typicalDurationMin({ kind: 'sports', subCategory: 'Cricket', description: 'County Championship' }),
    ).toBe(420);
  });

  it('gives a fight card its full evening', () => {
    expect(typicalDurationMin({ kind: 'sports', subCategory: 'Boxing' })).toBe(240);
  });
});

describe('typicalDurationMin — arts', () => {
  it('gives comedy two hours, not three', () => {
    expect(typicalDurationMin({ kind: 'theatre', subCategory: 'Comedy' })).toBe(120);
  });

  it('gives a West End show its real length', () => {
    expect(typicalDurationMin({ kind: 'theatre', subCategory: 'Musical' })).toBe(160);
  });

  it('gives opera and children’s shows their own lengths', () => {
    expect(typicalDurationMin({ kind: 'theatre', subCategory: 'Opera' })).toBe(195);
    expect(typicalDurationMin({ kind: 'theatre', subCategory: "Children's Theatre" })).toBe(90);
  });
});

describe('typicalFinishAt — music', () => {
  it('ends an evening gig at the curfew even when the listing is doors', () => {
    // Doors 19:00: +3h said 22:00, but the headliner finishes near the 23:00 curfew.
    const end = typicalFinishAt('2026-10-02T19:00:00+01:00', { kind: 'music', subCategory: 'Rock' });
    expect(hhmm(end)).toBe('22:45');
  });

  it('runs a late show past the curfew rather than ending before it starts', () => {
    const end = typicalFinishAt('2026-10-02T21:30:00+01:00', { kind: 'music', subCategory: 'Rock' });
    expect(hhmm(end)).toBe('00:00');
  });

  it('empties a club night in the small hours', () => {
    const end = typicalFinishAt('2026-10-02T22:00:00+01:00', {
      kind: 'music',
      subCategory: 'Dance/Electronic',
    });
    expect(hhmm(end)).toBe('03:00');
  });

  it('keeps a classical concert to about two hours', () => {
    const end = typicalFinishAt('2026-10-02T19:30:00+01:00', {
      kind: 'music',
      subCategory: 'Classical',
    });
    expect(hhmm(end)).toBe('21:30');
  });
});

function tmEvent(over: Partial<PublishedEvent>): PublishedEvent {
  return {
    id: 'tm-x',
    source: 'ticketmaster',
    category: 'other',
    title: 'Some show',
    venue: 'Some Venue',
    latitude: 51.5,
    longitude: -0.12,
    startsAt: '2026-10-02T19:30:00+01:00',
    endsAt: '2026-10-02T22:30:00+01:00',
    ...over,
  };
}

describe('normalisePublishedEvent — estimated ends are not published ends', () => {
  it('replaces an estimated comedy end with a realistic one', () => {
    const next = normalisePublishedEvent(
      tmEvent({ subCategory: 'Comedy', endIsEstimated: true }),
    );
    expect(hhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('21:30');
  });

  it('catches the old +3h fallback on events imported before the flag existed', () => {
    // No flag, exactly start + 3h from Ticketmaster: the old made-up value.
    const next = normalisePublishedEvent(tmEvent({ subCategory: 'Comedy' }));
    expect(hhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('21:30');
  });

  it('does not extend an estimated orchestral end as if it were published', () => {
    // Used to become start + 3h + 15 min crowd-out for a two-hour concert.
    const next = normalisePublishedEvent(
      tmEvent({
        title: 'London Symphony Orchestra: Mahler',
        subCategory: 'Classical',
        venue: 'Barbican Hall',
        endIsEstimated: true,
      }),
    );
    expect(hhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('21:30');
  });

  it('still trusts an end the source really published', () => {
    const next = normalisePublishedEvent(
      tmEvent({ subCategory: 'Comedy', endsAt: '2026-10-02T21:10:00+01:00', endIsEstimated: false }),
    );
    expect(hhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('21:10');
  });

  it('finishes a football match about 1h55 after kick-off', () => {
    const next = normalisePublishedEvent({
      id: 'espn-1',
      source: 'espn',
      category: 'sports',
      title: 'Arsenal vs Chelsea',
      subCategory: 'Football',
      venue: 'Emirates Stadium',
      latitude: 51.555,
      longitude: -0.108,
      startsAt: '2026-10-03T15:00:00+01:00',
      endsAt: '2026-10-03T17:30:00+01:00', // the old kick-off + 2h30
    });
    expect(hhmm(next.estimatedFinishAt ?? next.endsAt)).toBe('16:55');
  });
});
