/**
 * Trial lifecycle mail: the day before the first charge, and a confirmation
 * when they cancel during the free trial.
 *
 * Designed HTML matches the welcome emails. Tokens are filled here.
 */

import { type EmailContent, escapeHtml, loadEmailTemplate } from './emailTheme.js';
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

const PRICE_LINE: Record<PremiumPlan, string> = {
  monthly: '£6.99 a month',
  annual: '£49.99 a year',
};

const CHARGE_DETAIL: Record<PremiumPlan, string> = {
  monthly: '£6.99 is charged tomorrow, then every month after that.',
  annual: '£49.99 is charged tomorrow, then once a year after that.',
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

const FIRSTNAME_TAG = '{% if params.FIRSTNAME %}, {{ params.FIRSTNAME }}{% endif %}';
const DATE_TAG = '{% if params.TRIAL_END_DATE %}{{ params.TRIAL_END_DATE }}{% else %}Ended{% endif %}';
const DATE_UPPER_TAG = '{% if params.TRIAL_END_DATE %}{{ params.TRIAL_END_DATE }}{% else %}ENDED{% endif %}';
const UNTIL_TAG =
  '{% if params.UNTIL_LINE %}{{ params.UNTIL_LINE }}{% else %}The account goes back to Free. You will not be charged.{% endif %}';

function fill(fileName: string, pairs: Record<string, string>): string {
  let html = loadEmailTemplate(fileName);
  const tokens = Object.keys(pairs).sort((a, b) => b.length - a.length);
  for (const token of tokens) html = html.replaceAll(token, pairs[token] ?? '');
  return html;
}

function nameBit(displayName?: string | null): { html: string; text: string } {
  const first = firstNameFrom(displayName);
  if (!first) return { html: '', text: '' };
  return { html: `, ${escapeHtml(first)}`, text: `, ${first}` };
}

export function buildTrialDay6Email(opts: {
  plan: PremiumPlan;
  trialEndsAt: Date;
  displayName?: string | null;
}): EmailContent {
  const when = formatChargeLondon(opts.trialEndsAt);
  const plan = PLAN_NAME[opts.plan];
  const name = nameBit(opts.displayName);
  const html = fill('trialEndsTomorrow.html', {
    [FIRSTNAME_TAG]: name.html,
    '{{ params.PLAN }}': plan,
    [DATE_UPPER_TAG]: escapeHtml(when.toUpperCase()),
    '{{ params.PRICE_LINE }}': PRICE_LINE[opts.plan],
    '{{ params.PRICE }}': PRICE[opts.plan],
    '{{ params.CHARGE_DETAIL }}': CHARGE_DETAIL[opts.plan],
  });
  const text = [
    `Your free trial ends tomorrow${name.text}.`,
    '',
    `Tomorrow is the first charge on ${plan}. Cancel before then and you pay nothing.`,
    '',
    `Plan: ${plan}`,
    `Tomorrow: ${PRICE[opts.plan]}`,
    'Due today: £0.00',
    '',
    CHARGE_DETAIL[opts.plan],
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
  const name = nameBit(opts.displayName);
  const when = opts.accessUntil ? formatChargeLondon(opts.accessUntil) : 'Ended';
  const untilLine = opts.accessUntil
    ? `You can keep using ${plan} until ${when}. After that the account goes back to Free.`
    : 'The account goes back to Free. You will not be charged.';
  const html = fill('trialCancelled.html', {
    [FIRSTNAME_TAG]: name.html,
    '{{ params.PLAN }}': plan,
    [DATE_UPPER_TAG]: escapeHtml(when.toUpperCase()),
    [DATE_TAG]: escapeHtml(when),
    [UNTIL_TAG]: escapeHtml(untilLine),
  });
  const text = [
    `Your trial is cancelled${name.text}.`,
    '',
    `Your DriveIQ ${plan} free trial is cancelled. You will not be charged.`,
    '',
    untilLine,
    '',
    'iPhone: https://apps.apple.com/account/subscriptions',
    'Android: https://play.google.com/store/account/subscriptions',
    '',
    'The DriveIQ team',
  ].join('\n');
  return {
    subject: 'Your DriveIQ Premium trial is cancelled',
    html,
    text,
  };
}
