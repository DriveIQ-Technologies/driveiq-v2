import { describe, expect, it } from 'vitest';

import { normalizeFids } from './airports.js';

/** The shape the feed returns when asked for a movement (withLeg=false). */
const MOVEMENT_SHAPE = {
  arrivals: [
    {
      number: 'BA 363',
      status: 'Arrived',
      airline: { name: 'British Airways' },
      movement: {
        airport: { name: 'Nice', iata: 'NCE' },
        scheduledTime: { utc: '2026-09-23 20:10Z', local: '2026-09-23 21:10+01:00' },
        terminal: '5',
      },
    },
  ],
  departures: [],
};

/**
 * The shape returned when withLeg=true — no `movement`, legs instead. The
 * server was requesting this while the parser only read `movement`, so every
 * flight rendered as "To Unknown" at "--:--" with the airline truncated.
 */
const LEG_SHAPE = {
  arrivals: [
    {
      number: 'BA 363',
      status: 'Arrived',
      airline: { name: 'British Airways' },
      departure: {
        airport: { name: 'Nice', iata: 'NCE' },
        scheduledTime: { utc: '2026-09-23 20:10Z', local: '2026-09-23 21:10+01:00' },
      },
      arrival: { airport: { name: 'London Heathrow', iata: 'LHR' } },
    },
  ],
  departures: [],
};

describe('normalizeFids', () => {
  it('parses the movement shape', () => {
    const [f] = normalizeFids(MOVEMENT_SHAPE);
    expect(f.counterpart).toBe('Nice');
    expect(f.counterpartIata).toBe('NCE');
    expect(f.airline).toBe('British Airways');
    expect(f.scheduledMs).toBeGreaterThan(0);
    expect(f.effectiveMs).toBeGreaterThan(0);
    expect(f.terminal).toBe('5');
  });

  it('also parses the leg shape instead of degrading every field', () => {
    const [f] = normalizeFids(LEG_SHAPE);
    // An arrival's counterpart is where it came FROM, not Heathrow.
    expect(f.counterpart).toBe('Nice');
    expect(f.counterpartIata).toBe('NCE');
    expect(f.scheduledMs).toBeGreaterThan(0);
  });

  it('never silently produces a board of placeholders', () => {
    const [f] = normalizeFids(LEG_SHAPE);
    expect(f.counterpart).not.toBe('Unknown');
    expect(f.effectiveMs).not.toBe(0);
    // A real time means the id is stable rather than index-based.
    expect(f.id).not.toMatch(/-0$/);
  });

  it('still copes when a flight genuinely has neither', () => {
    const [f] = normalizeFids({ arrivals: [{ number: 'XX 1' }], departures: [] });
    expect(f.counterpart).toBe('Unknown');
    expect(f.effectiveMs).toBe(0);
  });
});

import { looksLikeParsedBoard } from './airports.js';

describe('looksLikeParsedBoard', () => {
  const good = normalizeFids(MOVEMENT_SHAPE);
  const broken = normalizeFids({
    arrivals: Array.from({ length: 10 }, (_, i) => ({ number: `XX ${i}`, departure: {} })),
    departures: [],
  });

  it('accepts a correctly parsed board', () => {
    expect(looksLikeParsedBoard(good)).toBe(true);
  });

  it('rejects a board that is mostly placeholders — the bug that shipped', () => {
    expect(looksLikeParsedBoard(broken)).toBe(false);
  });

  it('tolerates a few genuinely incomplete flights', () => {
    expect(looksLikeParsedBoard([...good, ...good, ...good, broken[0]])).toBe(true);
  });

  it('treats an empty board as fine (a quiet night, not a parse failure)', () => {
    expect(looksLikeParsedBoard([])).toBe(true);
  });
});
