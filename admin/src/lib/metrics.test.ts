import { describe, expect, it } from 'vitest';

import {
  ageLabel,
  countBy,
  devicePlatform,
  estimateCostUsd,
  feedHealth,
  lastDays,
  parseAdminEmails,
  platformCounts,
  subscriptionPlan,
  waitlistStatus,
  boardEveryMinutes,
  isAirportNight,
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

describe('devicePlatform', () => {
  it('uses the platform the app records on every start', () => {
    expect(devicePlatform({ platform: 'android' })).toBe('android');
    expect(devicePlatform({ platform: 'ios', pushPlatform: 'android' })).toBe('ios');
  });

  it('falls back to the push platform for users not on the updated app', () => {
    expect(devicePlatform({ pushPlatform: 'ios' })).toBe('ios');
  });

  it('is unknown when neither is set', () => {
    expect(devicePlatform({})).toBe('unknown');
    expect(devicePlatform({ platform: 'web' })).toBe('unknown');
  });
});

describe('platformCounts', () => {
  it('adds legacy push-only users without double counting', () => {
    expect(
      platformCounts({
        total: 100,
        platformIos: 30,
        platformAndroid: 20,
        // 25 iPhone push users, 10 of whom already report platform.
        pushIos: 25,
        pushIosWithPlatform: 10,
        pushAndroid: 0,
        pushAndroidWithPlatform: 0,
      }),
    ).toEqual({ ios: 45, android: 20, unknown: 35 });
  });

  it('never goes negative', () => {
    expect(
      platformCounts({
        total: 1,
        platformIos: 1,
        platformAndroid: 1,
        pushIos: 0,
        pushIosWithPlatform: 1,
        pushAndroid: 0,
        pushAndroidWithPlatform: 0,
      }),
    ).toEqual({ ios: 1, android: 1, unknown: 0 });
  });
});

describe('isAirportNight', () => {
  it('covers 01:00 to 04:15 London, summer and winter', () => {
    expect(isAirportNight(Date.parse('2026-10-07T02:08:00+01:00'))).toBe(true);
    expect(isAirportNight(Date.parse('2026-10-07T04:10:00+01:00'))).toBe(true);
    expect(isAirportNight(Date.parse('2026-10-07T04:20:00+01:00'))).toBe(false);
    expect(isAirportNight(Date.parse('2026-10-07T00:50:00+01:00'))).toBe(false);
    expect(isAirportNight(Date.parse('2026-12-07T02:00:00Z'))).toBe(true);
  });

  it('a board refreshed 20 minutes ago is healthy at night, not down', () => {
    const now = Date.parse('2026-10-07T02:08:00+01:00');
    const at = new Date(now - 20 * 60_000).toISOString();
    expect(feedHealth(at, isAirportNight(now) ? 30 : 10, now)).toBe('ok');
  });

  it('treats the 29 minute overnight gap as healthy, and late on the daytime 5 minute clock', () => {
    const now = Date.parse('2026-10-08T02:01:00+01:00');
    const at = new Date(now - 29 * 60_000).toISOString();
    expect(isAirportNight(now)).toBe(true);
    expect(boardEveryMinutes(5, now)).toBe(30);
    expect(feedHealth(at, boardEveryMinutes(5, now), now)).toBe('ok');
    expect(feedHealth(at, 5, now)).toBe('late');
  });
});
