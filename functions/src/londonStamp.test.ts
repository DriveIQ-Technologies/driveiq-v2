import { describe, expect, it } from 'vitest';

import { londonStamp, londonStampOr } from './londonTime.js';

describe('londonStamp', () => {
  it('converts a UTC instant to British Summer Time', () => {
    // 18:30Z in September is 19:30 in London (BST, UTC+1).
    expect(londonStamp('2026-09-16T18:30:00.000Z')).toContain('19:30');
  });

  it('converts a UTC instant to GMT in winter', () => {
    // 18:30Z in January is 18:30 in London (GMT, UTC+0).
    expect(londonStamp('2026-01-16T18:30:00.000Z')).toContain('18:30');
  });

  it('keeps the calendar day correct across the London midnight boundary', () => {
    // 23:30Z on 16 Sep is 00:30 on 17 Sep in London.
    const out = londonStamp('2026-09-16T23:30:00.000Z');
    expect(out).toContain('00:30');
    expect(out).toContain('17 Sep');
  });

  it('returns empty for missing or unparseable input', () => {
    expect(londonStamp(undefined)).toBe('');
    expect(londonStamp('')).toBe('');
    expect(londonStamp('not-a-date')).toBe('');
  });

  it('falls back when asked', () => {
    expect(londonStampOr(undefined)).toBe('n/a');
    expect(londonStampOr('nope', 'unknown')).toBe('unknown');
  });
});
