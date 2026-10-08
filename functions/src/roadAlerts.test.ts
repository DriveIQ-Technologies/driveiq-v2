import { describe, expect, it } from 'vitest';

import { collapseRoadBursts } from './dispatch.js';

const road = (title: string, id: string) => ({
  title,
  body: 'Tap the map.',
  data: { kind: 'road-accident', incidentId: id },
});

describe('collapseRoadBursts', () => {
  it('leaves a single road alert as it is', () => {
    const one = [road('Serious delays on the M25', 'a')];
    expect(collapseRoadBursts(one)).toEqual(one);
  });

  it('folds several road alerts from one poll into a single notification', () => {
    const out = collapseRoadBursts([
      road('Serious delays on the M25', 'a'),
      road('Serious delays on the M4', 'b'),
      road('Serious delays on the A406', 'c'),
      { title: 'Jubilee line is down. Take a look', body: 'Part closure.', data: { kind: 'line-closure', lineId: 'jubilee' } },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('Serious delays on the M25 and 2 other routes');
    expect(out[0].data.incidentId).toBe('a');
    expect(out[1].data.kind).toBe('line-closure');
  });
});
