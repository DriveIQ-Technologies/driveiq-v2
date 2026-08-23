import { describe, expect, it } from 'vitest';

import { londonDayBounds, londonYmd, parseLondonTime, ukOffset } from '@/utils/ukTime';

describe('ukOffset — BST vs GMT', () => {
  it('is +01:00 through British Summer Time', () => {
    expect(ukOffset('2026-06-15')).toBe('+01:00');
    expect(ukOffset('2026-08-22')).toBe('+01:00');
  });

  it('is +00:00 in winter', () => {
    expect(ukOffset('2026-01-15')).toBe('+00:00');
    expect(ukOffset('2026-12-25')).toBe('+00:00');
  });

  it('switches on the last Sunday in March', () => {
    // BST 2026 starts Sunday 29 March.
    expect(ukOffset('2026-03-28')).toBe('+00:00');
    expect(ukOffset('2026-03-29')).toBe('+01:00');
  });

  it('switches back on the last Sunday in October', () => {
    // BST 2026 ends Sunday 25 October.
    expect(ukOffset('2026-10-24')).toBe('+01:00');
    expect(ukOffset('2026-10-25')).toBe('+00:00');
  });
});

describe('parseLondonTime', () => {
  it('reads a summer wall-clock time as BST', () => {
    expect(new Date(parseLondonTime('2026-08-22', '15:00')).toISOString()).toBe(
      '2026-08-22T14:00:00.000Z',
    );
  });

  it('reads a winter wall-clock time as GMT', () => {
    expect(new Date(parseLondonTime('2026-12-22', '15:00')).toISOString()).toBe(
      '2026-12-22T15:00:00.000Z',
    );
  });
});

describe('londonYmd', () => {
  it('uses the London day even when UTC has already rolled over', () => {
    // 00:30Z on 23 Aug is still 01:30 on 23 Aug in London.
    expect(londonYmd(new Date('2026-08-23T00:30:00Z'))).toBe('2026-08-23');
    // 23:30Z on 22 Aug is 00:30 on 23 Aug in London.
    expect(londonYmd(new Date('2026-08-22T23:30:00Z'))).toBe('2026-08-23');
  });
});

describe('londonDayBounds', () => {
  it('spans London midnight to London midnight in summer', () => {
    const { start, end } = londonDayBounds('2026-08-22');
    expect(start.toISOString()).toBe('2026-08-21T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-22T22:59:59.999Z');
  });

  it('spans UTC midnight to UTC midnight in winter', () => {
    const { start } = londonDayBounds('2026-12-22');
    expect(start.toISOString()).toBe('2026-12-22T00:00:00.000Z');
  });
});
