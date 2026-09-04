import { describe, expect, it } from 'vitest';
import { inLondon, isReportCategory, reportPushCopy } from './communityReports.js';

describe('community report helpers', () => {
  it('accepts central London and rejects far away', () => {
    expect(inLondon(51.5074, -0.1278)).toBe(true);
    expect(inLondon(53.48, -2.24)).toBe(false);
  });

  it('builds a place-specific push title', () => {
    const copy = reportPushCopy({
      category: 'police',
      placeLabel: 'Stratford',
    });
    expect(copy.title).toBe('Report of police at Stratford');
    expect(copy.body).toContain('Tap to open');
  });

  it('falls back when there is no place', () => {
    const copy = reportPushCopy({ category: 'accident' });
    expect(copy.title).toContain('check the map');
  });

  it('rejects unknown categories', () => {
    expect(isReportCategory('police')).toBe(true);
    expect(isReportCategory('ice-cream')).toBe(false);
  });
});
