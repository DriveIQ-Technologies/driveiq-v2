/**
 * Free-account welcome, sent once on first registration.
 *
 * Fires on account creation rather than verification, so Apple and Google
 * signups get it too. Uses the designed HTML; FIRSTNAME is filled here.
 */

import { type EmailContent, escapeHtml, loadEmailTemplate } from './emailTheme.js';

const FIRSTNAME_TAG = '{% if params.FIRSTNAME %}, {{ params.FIRSTNAME }}{% endif %}';

/** First name where we have one. Apple only gives it on first authorisation. */
export function firstNameFrom(displayName?: string | null): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  return first ? first : null;
}

export function buildWelcomeEmail(opts: { displayName?: string | null }): EmailContent {
  const first = firstNameFrom(opts.displayName);
  const nameBit = first ? `, ${escapeHtml(first)}` : '';
  const html = loadEmailTemplate('welcomeFree.html').replaceAll(FIRSTNAME_TAG, nameBit);

  const textName = first ? `, ${first}` : '';
  const text = [
    `Welcome aboard${textName}.`,
    '',
    "From tonight, London's events, rail, roads and airports are working for you.",
    '',
    'Your first shift:',
    '1. Account created — you are in.',
    '2. Switch on notifications. Settings → DriveIQ → Notifications.',
    '3. Save tonight\'s events. Reminder 1 hour before start, 25 minutes before crowds leave.',
    '4. Ask the agent something. Try "Which airport is busiest after 9?"',
    '',
    'Included free: live London map, today and tomorrow events, every',
    'disruption alert, next 3 hours of flights (1 watched), 1 saved station,',
    '10 AI questions a day (resets midnight London).',
    '',
    'Premium is 7 days free, then £6.99 a month or £49.99 a year.',
    'Start from the Premium tab in the app.',
    '',
    'Questions? hello@driveiq.app',
  ].join('\n');

  return {
    subject: first ? `${first}, welcome to DriveIQ` : 'Welcome to DriveIQ',
    html,
    text,
  };
}
