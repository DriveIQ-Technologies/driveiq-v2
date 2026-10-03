import { describe, expect, it } from 'vitest';

import {
  ageLabel,
  countBy,
  estimateCostUsd,
  feedHealth,
  lastDays,
  parseAdminEmails,
  subscriptionPlan,
  waitlistStatus,
} from './metrics';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const daysFromNow = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe('estimateCostUsd', () => {
  it('prices Haiku and Sonnet answers per million tokens', () => {
    expect(estimateCostUsd({ model: 'haiku', inputTokens: 1_000_000, outputTokens: 0 })).toBe(1);
    expect(estimateCostUsd({ model: 'sonnet', inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(18);
  });

  it('counts cache writes and cheap cache reads', () => {
    expect(
      estimateCostUsd({ model: 'sonnet', cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000 }),
    ).toBeCloseTo(6.3);
  });

  it('treats missing numbers as zero and unknown models as Sonnet', () => {
    expect(estimateCostUsd({})).toBe(0);
    expect(estimateCostUsd({ model: 'mystery', inputTokens: 1_000_000 })).toBe(3);
  });
});

describe('feedHealth', () => {
  it('is ok within two runs, late after, down after six', () => {
    expect(feedHealth(minsAgo(8), 5, NOW)).toBe('ok');
    expect(feedHealth(minsAgo(20), 5, NOW)).toBe('late');
    expect(feedHealth(minsAgo(45), 5, NOW)).toBe('down');
  });

  it('gives a twice-daily job a day before it is late', () => {
    expect(feedHealth(minsAgo(20 * 60), 12 * 60, NOW)).toBe('ok');
    expect(feedHealth(minsAgo(30 * 60), 12 * 60, NOW)).toBe('late');
  });

  it('is unknown when there is no timestamp', () => {
    expect(feedHealth(null, 5, NOW)).toBe('unknown');
    expect(feedHealth('nonsense', 5, NOW)).toBe('unknown');
  });
});

describe('ageLabel', () => {
  it('reads like a person would say it', () => {
    expect(ageLabel(minsAgo(0), NOW)).toBe('just now');
    expect(ageLabel(minsAgo(7), NOW)).toBe('7 min ago');
    expect(ageLabel(minsAgo(125), NOW)).toBe('2 h 5 min ago');
    expect(ageLabel(minsAgo(3 * 24 * 60), NOW)).toBe('3 days ago');
    expect(ageLabel(undefined, NOW)).toBe('never');
  });
});

describe('waitlistStatus', () => {
  it('tells claimed weeks that are running from those that ended', () => {
    expect(waitlistStatus({ claimedByUid: 'u1', premiumUntil: daysFromNow(2) }, NOW)).toBe('week-running');
    expect(waitlistStatus({ claimedByUid: 'u1', premiumUntil: daysFromNow(-1) }, NOW)).toBe('week-ended');
    expect(waitlistStatus({ usedCount: 1 }, NOW)).toBe('week-ended');
  });

  it('flags unclaimed codes that are about to expire, or have', () => {
    expect(waitlistStatus({ expiresAt: daysFromNow(10) }, NOW)).toBe('unclaimed');
    expect(waitlistStatus({ expiresAt: daysFromNow(2) }, NOW)).toBe('expiring');
    expect(waitlistStatus({ expiresAt: daysFromNow(-1) }, NOW)).toBe('expired');
    expect(waitlistStatus({ active: false, expiresAt: daysFromNow(10) }, NOW)).toBe('disabled');
  });
});

describe('helpers', () => {
  it('counts by key', () => {
    expect(countBy(['a', 'b', 'a'], (x) => x)).toEqual({ a: 2, b: 1 });
  });

  it('lists the last days in London order', () => {
    const days = lastDays(3, NOW);
    expect(days).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  });

  it('normalises the admin email list', () => {
    expect([...parseAdminEmails(' A@x.com, b@Y.com ,,')]).toEqual(['a@x.com', 'b@y.com']);
    expect(parseAdminEmails(undefined).size).toBe(0);
  });
});

describe('subscriptionPlan', () => {
  it('shows a paid trial or active plan, and treats everything else as free', () => {
    expect(subscriptionPlan({ premiumPlan: 'monthly', premiumStatus: 'trial' })).toEqual({
      label: 'Premium Monthly',
      trial: true,
    });
    expect(subscriptionPlan({ premiumPlan: 'annual', premiumStatus: 'active' })).toEqual({
      label: 'Premium Annual',
      trial: false,
    });
    expect(subscriptionPlan({ premiumPlan: 'monthly', premiumStatus: 'cancelled' }).label).toBe('Free');
    expect(subscriptionPlan({}).label).toBe('Free');
  });
});
