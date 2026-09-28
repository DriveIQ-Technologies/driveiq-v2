import { describe, expect, it } from 'vitest';

import {
  buildPremiumAnnualWelcomeEmail,
  buildPremiumMonthlyWelcomeEmail,
  formatTrialEndLondon,
  resolvePremiumPlan,
} from './premiumWelcomeEmail.js';

describe('formatTrialEndLondon', () => {
  it('formats a London calendar date', () => {
    expect(formatTrialEndLondon(new Date('2026-10-05T12:00:00.000Z'))).toBe('5 Oct 2026');
  });
});

describe('resolvePremiumPlan', () => {
  it('accepts the ids the app actually sends', () => {
    expect(resolvePremiumPlan('annual')).toBe('annual');
    expect(resolvePremiumPlan('$rc_annual')).toBe('annual');
    expect(resolvePremiumPlan('driveiq_premium_annual')).toBe('annual');
    expect(resolvePremiumPlan('monthly')).toBe('monthly');
    expect(resolvePremiumPlan('$rc_monthly')).toBe('monthly');
    expect(resolvePremiumPlan(undefined)).toBeNull();
  });
});

describe('buildPremiumAnnualWelcomeEmail', () => {
  const ends = new Date('2026-10-05T12:00:00.000Z');

  it('personalises greeting and fills the trial date', () => {
    const email = buildPremiumAnnualWelcomeEmail({
      displayName: 'Ada Lovelace',
      trialEndsAt: ends,
    });
    expect(email.subject).toBe('Ada, welcome to DriveIQ Premium');
    expect(email.html).toContain('Welcome to Premium, Ada.');
    expect(email.html).toContain('5 Oct 2026');
    expect(email.html).toContain('on 5 Oct 2026');
    expect(email.html).toContain('Premium Annual');
    expect(email.html).toContain('£49.99');
    expect(email.text).toContain('Welcome to Premium, Ada.');
    expect(email.text).toContain('5 Oct 2026');
  });

  it('does not leave a dangling comma when the name is unknown', () => {
    const email = buildPremiumAnnualWelcomeEmail({ displayName: null, trialEndsAt: ends });
    expect(email.subject).toBe('Welcome to DriveIQ Premium');
    expect(email.html).toContain('Welcome to Premium.');
    expect(email.html).not.toMatch(/Welcome to Premium,/);
    expect(email.html).not.toContain('{%');
    expect(email.html).not.toContain('params.FIRSTNAME');
  });

  it('escapes a name so it cannot inject markup', () => {
    const email = buildPremiumAnnualWelcomeEmail({
      displayName: '<script>alert(1)</script>',
      trialEndsAt: ends,
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('buildPremiumMonthlyWelcomeEmail', () => {
  const ends = new Date('2026-10-05T12:00:00.000Z');

  it('uses the monthly price and plan name', () => {
    const email = buildPremiumMonthlyWelcomeEmail({
      displayName: 'Ada Lovelace',
      trialEndsAt: ends,
    });
    expect(email.html).toContain('Premium Monthly');
    expect(email.html).toContain('£6.99 a month');
    expect(email.html).toContain('every month after that');
    expect(email.html).not.toContain('£49.99');
    expect(email.html).not.toContain('{%');
    expect(email.text).toContain('£6.99');
  });
});
