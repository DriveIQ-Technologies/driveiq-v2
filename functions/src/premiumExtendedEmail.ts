/**
 * "Premium extended": for waitlisters who started a store free trial before
 * claiming their waitlist week, so the week was added after the trial.
 *
 * Sent once, about three days before the trial ends, while there's still time
 * to turn off auto-renew if they want both weeks free.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import type { BrevoConfig } from './accountLifecycle.js';
import { sendBrevoEmail } from './brevo.js';
import { type EmailContent, escapeHtml, loadEmailTemplate } from './emailTheme.js';
import { firstNameFrom } from './welcomeEmail.js';

const HOUR = 60 * 60 * 1000;

/**
 * Due from 84h before the trial ends, so the daily 09:00 run sends it about
 * three days ahead. Someone whose week was added later still gets it, down to
 * 12h before; after that there's no time left to act on it.
 */
export function dueForExtendedEmail(trialEndsAt: Date, now: Date): boolean {
  const ms = trialEndsAt.getTime() - now.getTime();
  return ms > 12 * HOUR && ms <= 84 * HOUR;
}

/** The waitlist week was put after the store trial, not over it. */
export function weekAddedAfterTrial(user: { premiumTrialEndsAt?: unknown; waitlistStartsAt?: unknown }): boolean {
  const end = typeof user.premiumTrialEndsAt === 'string' ? Date.parse(user.premiumTrialEndsAt) : NaN;
  const start = typeof user.waitlistStartsAt === 'string' ? Date.parse(user.waitlistStartsAt) : NaN;
  return Number.isFinite(end) && Number.isFinite(start) && start >= end - 60_000;
}

const londonDay = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long' }).format(at);

export function buildPremiumExtendedEmail(opts: {
  firstName?: string | null;
  trialEndsAt: Date;
  premiumUntil: Date;
}): EmailContent {
  const first = firstNameFrom(opts.firstName);
  const name = first ? first[0].toUpperCase() + first.slice(1) : null;
  const trialEnd = londonDay(opts.trialEndsAt);
  const until = londonDay(opts.premiumUntil);
  const html = loadEmailTemplate('premiumExtended.html')
    .replaceAll('{{FIRSTNAME_BIT}}', name ? `, ${escapeHtml(name)}` : '')
    .replaceAll('{{TRIAL_END_UPPER}}', escapeHtml(trialEnd.toUpperCase()))
    .replaceAll('{{TRIAL_END}}', escapeHtml(trialEnd))
    .replaceAll('{{PREMIUM_UNTIL_UPPER}}', escapeHtml(until.toUpperCase()))
    .replaceAll('{{PREMIUM_UNTIL}}', escapeHtml(until));

  const text = [
    `Your free week is added${name ? `, ${name}` : ''}.`,
    '',
    `You started your 7-day Premium trial before claiming your waitlist week, so we've added that week straight after your trial. Premium now stays on until ${until}.`,
    '',
    'Now: free trial, Premium is on.',
    `${trialEnd}: your waitlist week starts.`,
    `${until}: Premium ends, unless you stay on.`,
    '',
    `Before ${trialEnd}, one thing to know: your trial is a subscription with Apple or Google, so they'll still charge you when it ends on ${trialEnd}, unless you turn off auto-renew before then.`,
    '',
    `Option A, both weeks free: open DriveIQ, tap Menu, then Manage subscription and cancel. You keep Premium until ${until} and won't be charged.`,
    'Option B, stay on: do nothing. Premium carries on as normal after your trial.',
    '',
    'Sorry for the mix-up, and thank you for being one of our first drivers.',
    '',
    'Good shifts ahead,',
    'The DriveIQ Technologies team',
    '',
    'Questions? Just reply to this email, or write to hello@driveiq.app.',
    'DriveIQ Technologies Ltd · Company no. 17106675 · 124 City Road, London EC1V 2NX',
  ].join('\n');

  return { subject: 'Your free waitlist week is added', html, text };
}

/**
 * Daily job. `redirectTo` sends every due email to those addresses instead
 * (subject "[TEST] …", nothing marked as sent), to check the real selection
 * and timing against live data.
 */
export async function handlePremiumExtendedEmails(opts: {
  db: Firestore;
  brevo: BrevoConfig;
  now?: () => Date;
  redirectTo?: string[];
  /** Test mode: how many of the due emails to actually send (rest are only counted). */
  testLimit?: number;
}): Promise<{ checked: number; due: number; sent: number }> {
  const now = (opts.now ?? (() => new Date()))();
  const testing = Boolean(opts.redirectTo?.length);
  const snap = await opts.db
    .collection('users')
    .where('premiumStatus', 'in', ['trial', 'cancelled'])
    .limit(1000)
    .get();
  let due = 0;
  let sent = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (!testing && typeof data.premiumExtendedEmailSentAt === 'string') continue;
    if (!weekAddedAfterTrial(data)) continue;
    const ends = new Date(String(data.premiumTrialEndsAt));
    const until = new Date(String(data.premiumUntil ?? ''));
    if (Number.isNaN(until.getTime()) || !dueForExtendedEmail(ends, now)) continue;
    const email = String(data.email ?? '').trim();
    if (!email || !opts.brevo.apiKey || !opts.brevo.senderEmail) continue;
    due += 1;
    if (testing && sent >= (opts.testLimit ?? Infinity)) continue;

    // First name from the waitlist sign-up (kept on the server-only token).
    let firstName = typeof data.displayName === 'string' ? data.displayName : null;
    const token = typeof data.waitlistToken === 'string' ? data.waitlistToken : '';
    if (token) {
      const t = await opts.db.doc(`waitlistTokens/${token}`).get();
      const fromList = t.get('firstName');
      if (typeof fromList === 'string' && fromList.trim()) firstName = fromList;
    }
    const content = buildPremiumExtendedEmail({ firstName, trialEndsAt: ends, premiumUntil: until });
    const recipients = testing ? opts.redirectTo! : [email];

    if (!testing) await doc.ref.set({ premiumExtendedEmailSentAt: now.toISOString() }, { merge: true });
    try {
      for (const to of recipients) {
        await sendBrevoEmail({
          apiKey: opts.brevo.apiKey,
          toEmail: to,
          sender: { email: opts.brevo.senderEmail, name: opts.brevo.senderName },
          subject: testing ? `[TEST] ${content.subject}` : content.subject,
          html: content.html,
          text: content.text,
        });
      }
      sent += 1;
      logger.info('premium_extended.sent', { uid: doc.id, testing });
    } catch (e) {
      if (!testing) await doc.ref.set({ premiumExtendedEmailSentAt: null }, { merge: true });
      logger.error('premium_extended.fail', { uid: doc.id, message: e instanceof Error ? e.message : 'error' });
    }
  }
  return { checked: snap.size, due, sent };
}
