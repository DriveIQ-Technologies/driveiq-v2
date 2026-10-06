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
    'Four things worth doing tonight:',
    '1. The live London map. Every concert, match and show is pinned with its',
    '   finish time. Filter by Today, Tomorrow or type.',
    '2. Switch on notifications. Choose which ones under Menu, then Notifications.',
    "3. Save tonight's events. We remind you an hour before it starts and",
    '   25 minutes before the crowd comes out.',
    '4. Ask DriveIQ AI, like "What\'s finishing near me tonight?"',
    '   Your free plan includes 10 questions a day.',
    '',
    'Free: every disruption alert instantly, tonight and tomorrow\'s events,',
    'next 3 hours of flights (1 watched flight), 1 saved station, 10 AI',
    'questions a day.',
    '',
    'Premium: £6.99 a month or £49.99 a year. Events about two weeks ahead,',
    'the whole day of flights at all five airports, unlimited watched flights,',
    'all 7 stations saved, unlimited AI.',
    'Try it free for 7 days: in the app, Menu, then Try Premium free for 7 days.',
    '',
    'Questions? hello@driveiq.app',
    'DriveIQ Technologies Ltd · 124 City Road, London EC1V 2NX',
  ].join('\n');

  return {
    subject: first ? `${first}, welcome to DriveIQ` : 'Welcome to DriveIQ',
    html,
    text,
  };
}
