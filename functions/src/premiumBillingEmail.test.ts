import { describe, expect, it } from 'vitest';

import { buildTrialCancelledEmail, buildTrialDay6Email } from './premiumBillingEmail.js';

const ends = new Date('2026-10-06T12:00:00.000Z');

describe('buildTrialDay6Email', () => {
  it('fills the designed template for a monthly trial', () => {
    const email = buildTrialDay6Email({
      plan: 'monthly',
      trialEndsAt: ends,
      displayName: 'Zak Ariye',
    });
    expect(email.subject).toBe('Your DriveIQ Premium trial ends tomorrow');
    expect(email.html).toContain('Your free trial ends tomorrow, Zak.');
    expect(email.html).toContain('Premium Monthly');
    expect(email.html).toContain('£6.99');
    expect(email.html).toContain('apps.apple.com/account/subscriptions');
    expect(email.html).toContain('play.google.com/store/account/subscriptions');
    expect(email.html).not.toContain('{{ params.');
    expect(email.html).not.toContain('{%');
    expect(email.text).toContain('£6.99 is charged tomorrow, then every month after that.');
  });

  it('uses the annual price and omits a dangling comma', () => {
    const email = buildTrialDay6Email({ plan: 'annual', trialEndsAt: ends, displayName: null });
    expect(email.html).toContain('Your free trial ends tomorrow.');
    expect(email.html).not.toMatch(/ends tomorrow,/);
    expect(email.html).toContain('£49.99 a year');
    expect(email.html).toContain('once a year');
    expect(email.html).not.toContain('£6.99');
  });
});

describe('buildTrialCancelledEmail', () => {
  it('says they will not be charged and keeps access until the date', () => {
    const email = buildTrialCancelledEmail({
      plan: 'monthly',
      accessUntil: ends,
      displayName: '<Zak>',
    });
    expect(email.subject).toContain('cancelled');
    expect(email.html).toContain('Your trial is cancelled, &lt;Zak&gt;.');
    expect(email.html).not.toContain('<Zak>');
    expect(email.html).toContain('You will not be charged.');
    expect(email.html).toContain('Premium Monthly');
    expect(email.html).toContain('£0.00');
    expect(email.html).not.toContain('{{ params.');
    expect(email.html).not.toContain('{%');
  });
});
