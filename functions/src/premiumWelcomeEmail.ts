/**
 * Premium trial welcome — designed HTML for annual and monthly.
 *
 * Sent once when someone starts a 7-day trial. Brevo {% params %} tags are
 * filled here so Cloud Functions can send it as a normal transactional mail.
 */

import { type EmailContent, escapeHtml, loadEmailTemplate } from './emailTheme.js';
import { firstNameFrom } from './welcomeEmail.js';

export type PremiumPlan = 'annual' | 'monthly';

const FIRSTNAME_TAG = '{% if params.FIRSTNAME %}, {{ params.FIRSTNAME }}{% endif %}';
const TRIAL_DATE_TAG =
  '{% if params.TRIAL_END_DATE %}{{ params.TRIAL_END_DATE }}{% else %}In 7 days{% endif %}';
const TRIAL_DATE_UPPER_TAG =
  '{% if params.TRIAL_END_DATE %}{{ params.TRIAL_END_DATE }}{% else %}IN 7 DAYS{% endif %}';
const TRIAL_CHARGE_TAG =
  '{% if params.TRIAL_END_DATE %}on {{ params.TRIAL_END_DATE }}{% else %}in 7 days{% endif %}';

export function formatTrialEndLondon(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(at);
}

export function defaultTrialEndsAt(now: Date): Date {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export function resolvePremiumPlan(plan: string | undefined): PremiumPlan | null {
  const p = (plan ?? '').trim().toLowerCase();
  if (p === 'annual' || p === '$rc_annual' || p === 'driveiq_premium_annual' || p.includes('annual')) {
    return 'annual';
  }
  if (p === 'monthly' || p === '$rc_monthly' || p === 'driveiq_premium_monthly' || p.includes('month')) {
    return 'monthly';
  }
  return null;
}

/** @deprecated use resolvePremiumPlan */
export function isAnnualPremiumPlan(plan: string | undefined): boolean {
  return resolvePremiumPlan(plan) === 'annual';
}

function fillWelcomeTemplate(fileName: string, nameBit: string, trialEnd: string): string {
  return loadEmailTemplate(fileName)
    .replaceAll(FIRSTNAME_TAG, nameBit)
    .replaceAll(TRIAL_DATE_TAG, trialEnd)
    .replaceAll(TRIAL_DATE_UPPER_TAG, trialEnd)
    .replaceAll(TRIAL_CHARGE_TAG, `on ${trialEnd}`);
}

export function buildPremiumWelcomeEmail(opts: {
  plan: PremiumPlan;
  displayName?: string | null;
  trialEndsAt?: Date;
  now?: Date;
}): EmailContent {
  const first = firstNameFrom(opts.displayName);
  const now = opts.now ?? new Date();
  const ends = opts.trialEndsAt ?? defaultTrialEndsAt(now);
  const trialEnd = escapeHtml(formatTrialEndLondon(ends));
  const nameBit = first ? `, ${escapeHtml(first)}` : '';
  const file =
    opts.plan === 'monthly' ? 'premiumWelcomeMonthly.html' : 'premiumWelcomeAnnual.html';
  const html = fillWelcomeTemplate(file, nameBit, trialEnd);
  const textName = first ? `, ${first}` : '';
  const price = opts.plan === 'monthly' ? '£6.99 a month' : '£49.99 a year';
  const every = opts.plan === 'monthly' ? 'every month' : 'every year';

  const text = [
    `Welcome to Premium${textName}.`,
    '',
    'Your 7-day free trial has started. You pay nothing today, and everything',
    'is unlocked from now.',
    '',
    `Plan: Premium ${opts.plan === 'monthly' ? 'Monthly' : 'Annual'}`,
    `Trial ends: ${formatTrialEndLondon(ends)}`,
    `First payment: ${price}, charged on ${formatTrialEndLondon(ends)}, then ${every} after that.`,
    "Cancel at least 24 hours before the trial ends and you won't be charged.",
    '',
    'Unlocked for you:',
    '- The whole day of flights at all five airports; watch as many as you like',
    '- Events about two weeks ahead',
    "- All 7 stations saved",
    '- Unlimited DriveIQ AI',
    '- Alerts stay instant, on every plan',
    '',
    'Manage or cancel any time: in the app, Menu, then Manage subscription.',
    'Or in your App Store or Google Play subscriptions.',
    '',
    'Questions? hello@driveiq.app',
    'DriveIQ Technologies Ltd · 124 City Road, London EC1V 2NX',
  ].join('\n');

  return {
    subject: first ? `${first}, welcome to DriveIQ Premium` : 'Welcome to DriveIQ Premium',
    html,
    text,
  };
}

export function buildPremiumAnnualWelcomeEmail(opts: {
  displayName?: string | null;
  trialEndsAt?: Date;
  now?: Date;
}): EmailContent {
  return buildPremiumWelcomeEmail({ ...opts, plan: 'annual' });
}

export function buildPremiumMonthlyWelcomeEmail(opts: {
  displayName?: string | null;
  trialEndsAt?: Date;
  now?: Date;
}): EmailContent {
  return buildPremiumWelcomeEmail({ ...opts, plan: 'monthly' });
}
