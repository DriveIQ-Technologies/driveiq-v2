import { describe, expect, it } from 'vitest';

import { lineBaseline, lineEscalated, RAIL_BASELINE } from './dispatch.js';

describe('lineEscalated', () => {
  it('alerts when a line goes from good to severe or closed', () => {
    expect(lineEscalated('good', 'severe')).toBe(true);
    expect(lineEscalated('minor', 'closed')).toBe(true);
    expect(lineEscalated(undefined, 'severe')).toBe(true);
  });

  it('does not alert on no change or on improvement', () => {
    expect(lineEscalated('severe', 'severe')).toBe(false);
    expect(lineEscalated('severe', 'minor')).toBe(false);
    expect(lineEscalated('closed', 'severe')).toBe(false);
  });
});

describe('lineBaseline', () => {
  // Every user's state recorded National Rail as 'closed' from TfL's permanent
  // "Special Service" — so a real "severe" read as an improvement and South
  // Western's disruption never alerted.
  const prev = { 'south-western-railway': 'closed', central: 'good' };

  it('ignores the stale TfL-era baseline for National Rail, once', () => {
    const before = lineBaseline({ id: 'south-western-railway', source: 'nsi' }, prev, undefined);
    expect(before).toBeUndefined();
    expect(lineEscalated(before, 'severe')).toBe(true);
  });

  it('trusts the baseline after the reset has been recorded', () => {
    const before = lineBaseline({ id: 'south-western-railway', source: 'nsi' }, prev, RAIL_BASELINE);
    expect(before).toBe('closed');
  });

  it('never resets TfL lines, which were always reported properly', () => {
    expect(lineBaseline({ id: 'central' }, prev, undefined)).toBe('good');
  });
});
