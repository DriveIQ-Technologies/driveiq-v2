/**
 * Trial lifecycle mail: the day before the first charge, and a confirmation
 * when they cancel during the free trial.
 */

import { type EmailContent, emailShell, escapeHtml } from './emailTheme.js';
import type { PremiumPlan } from './premiumWelcomeEmail.js';
import { firstNameFrom } from './welcomeEmail.js';

const PRICE: Record<PremiumPlan, string> = {
  monthly: '£6.99',
  annual: '£49.99',
};

const PLAN_NAME: Record<PremiumPlan, string> = {
  monthly: 'Premium Monthly',
  annual: 'Premium Annual',
};

const AFTER: Record<PremiumPlan, string> = {
  monthly: '£6.99 a month',
  annual: '£49.99 a year',
};

export function formatChargeLondon(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(at);
}

function greeting(displayName?: string | null): string {
  const first = firstNameFrom(displayName);
  return first ? `Hi ${escapeHtml(first)},` : 'Hi,';
}

export function buildTrialDay6Email(opts: {
  plan: PremiumPlan;
  trialEndsAt: Date;
  displayName?: string | null;
}): EmailContent {
  const when = escapeHtml(formatChargeLondon(opts.trialEndsAt));
  const price = PRICE[opts.plan];
  const plan = PLAN_NAME[opts.plan];
  const html = emailShell({
    preheader: `Your free trial ends tomorrow. ${price} will be charged unless you cancel.`,
    bodyRows: `
<tr><td style="padding:8px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#0E2A3A;">
  <p style="margin:0 0 12px;">${greeting(opts.displayName)}</p>
  <p style="margin:0 0 12px;">Your DriveIQ ${plan} free trial ends tomorrow, <strong>${when}</strong>.</p>
  <p style="margin:0 0 12px;">${price} (${AFTER[opts.plan]}) is charged then, and renews after that. You pay nothing if you cancel before the trial ends.</p>
  <p style="margin:0 0 8px;">Cancel in a couple of taps:</p>
  <p style="margin:0 0 6px;"><a href="https://apps.apple.com/account/subscriptions" style="color:#1F62C9;">Manage subscription (iPhone)</a></p>
  <p style="margin:0 0 12px;"><a href="https://play.google.com/store/account/subscriptions" style="color:#1F62C9;">Manage subscription (Android)</a></p>
  <p style="margin:0;">Drive safe,<br><strong>The DriveIQ team</strong></p>
</td></tr>`,
  });
  const text = [
    greeting(opts.displayName).replace(/<[^>]+>/g, ''),
    '',
    `Your DriveIQ ${plan} free trial ends tomorrow, ${formatChargeLondon(opts.trialEndsAt)}.`,
    '',
    `${price} (${AFTER[opts.plan]}) is charged then. Cancel before the trial ends and you will not be charged.`,
    '',
    'iPhone: https://apps.apple.com/account/subscriptions',
    'Android: https://play.google.com/store/account/subscriptions',
    '',
    'The DriveIQ team',
  ].join('\n');
  return {
    subject: 'Your DriveIQ Premium trial ends tomorrow',
    html,
    text,
  };
}

export function buildTrialCancelledEmail(opts: {
  plan: PremiumPlan;
  accessUntil?: Date | null;
  displayName?: string | null;
}): EmailContent {
  const plan = PLAN_NAME[opts.plan];
  const until = opts.accessUntil ? escapeHtml(formatChargeLondon(opts.accessUntil)) : '';
  const untilLine = until
    ? `You can keep using ${plan} until ${until}. After that the account goes back to Free.`
    : `The account goes back to Free. You will not be charged.`;
  const html = emailShell({
    preheader: 'Your trial is cancelled. You will not be charged.',
    bodyRows: `
<tr><td style="padding:8px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#0E2A3A;">
  <p style="margin:0 0 12px;">${greeting(opts.displayName)}</p>
  <p style="margin:0 0 12px;">Your DriveIQ ${plan} free trial is cancelled. You will not be charged.</p>
  <p style="margin:0 0 12px;">${untilLine}</p>
  <p style="margin:0;">Drive safe,<br><strong>The DriveIQ team</strong></p>
</td></tr>`,
  });
  const text = [
    greeting(opts.displayName).replace(/<[^>]+>/g, ''),
    '',
    `Your DriveIQ ${plan} free trial is cancelled. You will not be charged.`,
    '',
    opts.accessUntil
      ? `You can keep using ${plan} until ${formatChargeLondon(opts.accessUntil)}. After that the account goes back to Free.`
      : 'The account goes back to Free.',
    '',
    'The DriveIQ team',
  ].join('\n');
  return {
    subject: 'Your DriveIQ Premium trial is cancelled',
    html,
    text,
  };
}
