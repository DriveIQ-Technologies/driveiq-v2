/**
 * Store subscription state on the user, separate from a waitlist week.
 *
 * RevenueCat tells us when a trial starts, renews, or is cancelled.
 * A daily job emails anyone still on a trial about a day before the charge.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { sendBrevoEmail } from './brevo.js';
import type { BrevoConfig } from './accountLifecycle.js';
import { buildTrialCancelledEmail, buildTrialDay6Email } from './premiumBillingEmail.js';
import { resolvePremiumPlan, type PremiumPlan } from './premiumWelcomeEmail.js';

const HOUR = 60 * 60 * 1000;

export interface RevenueCatEvent {
  type?: string;
  app_user_id?: string;
  product_id?: string;
  period_type?: string;
  expiration_at_ms?: number | null;
}

/** True when the first charge is about a day away (the day-6 reminder). */
export function dueForTrialReminder(trialEndsAt: Date, now: Date): boolean {
  const ms = trialEndsAt.getTime() - now.getTime();
  return ms >= 12 * HOUR && ms <= 36 * HOUR;
}

export function storeUid(appUserId: string | undefined): string | null {
  const id = String(appUserId ?? '').trim();
  if (!id || id.startsWith('$RCAnonymous')) return null;
  return id;
}

function expiresIso(ms: number | null | undefined): string | null {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

export interface BillingUpdate {
  uid: string;
  patch: Record<string, unknown>;
  /** Send the "you will not be charged" mail. Trial cancels only. */
  sendCancelEmail: boolean;
  plan: PremiumPlan | null;
  accessUntil: string | null;
}

/**
 * What to write for one RevenueCat event. Waitlist entitlements are never
 * touched. Unknown or anonymous events are ignored.
 */
export function billingUpdateFor(event: RevenueCatEvent, now: Date): BillingUpdate | null {
  const uid = storeUid(event.app_user_id);
  const type = String(event.type ?? '').toUpperCase();
  if (!uid || !type || type === 'TEST') return null;

  const plan = resolvePremiumPlan(event.product_id);
  const until = expiresIso(event.expiration_at_ms);
  const nowIso = now.toISOString();
  const base: Record<string, unknown> = {
    premiumSource: 'store',
    updatedAt: nowIso,
    ...(plan ? { premiumPlan: plan } : {}),
    ...(until ? { premiumExpiresAt: until } : {}),
  };

  if (type === 'INITIAL_PURCHASE' || type === 'PRODUCT_CHANGE') {
    const trial = String(event.period_type ?? '').toUpperCase() === 'TRIAL';
    return {
      uid,
      plan,
      accessUntil: until,
      sendCancelEmail: false,
      patch: {
        ...base,
        premiumStatus: trial ? 'trial' : 'active',
        premiumCancelledAt: null,
        ...(trial && until ? { premiumTrialEndsAt: until } : {}),
      },
    };
  }

  if (type === 'RENEWAL') {
    return {
      uid,
      plan,
      accessUntil: until,
      sendCancelEmail: false,
      patch: {
        ...base,
        premiumStatus: 'active',
        premiumCancelledAt: null,
      },
    };
  }

  if (type === 'UNCANCELLATION') {
    const trial = String(event.period_type ?? '').toUpperCase() === 'TRIAL';
    return {
      uid,
      plan,
      accessUntil: until,
      sendCancelEmail: false,
      patch: {
        ...base,
        premiumStatus: trial ? 'trial' : 'active',
        premiumCancelledAt: null,
      },
    };
  }

  if (type === 'CANCELLATION') {
    const trial = String(event.period_type ?? '').toUpperCase() === 'TRIAL';
    return {
      uid,
      plan,
      accessUntil: until,
      sendCancelEmail: trial,
      patch: {
        ...base,
        premiumStatus: 'cancelled',
        premiumCancelledAt: nowIso,
        ...(trial && until ? { premiumTrialEndsAt: until } : {}),
      },
    };
  }

  if (type === 'EXPIRATION') {
    return {
      uid,
      plan,
      accessUntil: until,
      sendCancelEmail: false,
      patch: { ...base, premiumStatus: 'expired' },
    };
  }

  return null;
}

export function webhookAuthorized(header: string | undefined, secret: string): boolean {
  const got = String(header ?? '').trim();
  const expected = secret.trim();
  if (!expected || !got) return false;
  return got === expected || got === `Bearer ${expected}`;
}

export async function handleRevenueCatWebhook(opts: {
  db: Firestore;
  brevo: BrevoConfig;
  event: RevenueCatEvent;
  now?: () => Date;
}): Promise<{ ok: true; applied: boolean; cancelSent: boolean }> {
  const now = (opts.now ?? (() => new Date()))();
  const update = billingUpdateFor(opts.event, now);
  if (!update) return { ok: true, applied: false, cancelSent: false };

  const ref = opts.db.doc(`users/${update.uid}`);
  const snap = await ref.get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const plan =
    update.plan ??
    (data.premiumPlan === 'monthly' || data.premiumPlan === 'annual' ? data.premiumPlan : null);

  let cancelSent = false;
  const patch = { ...update.patch };
  if (update.sendCancelEmail && typeof data.premiumCancelEmailSentAt !== 'string') {
    patch.premiumCancelEmailSentAt = now.toISOString();
  }
  await ref.set(patch, { merge: true });

  if (update.sendCancelEmail && typeof data.premiumCancelEmailSentAt !== 'string') {
    const email = String(data.email ?? '').trim();
    if (!email || !plan || !opts.brevo.apiKey || !opts.brevo.senderEmail) {
      await ref.set({ premiumCancelEmailSentAt: null }, { merge: true });
      logger.warn('premium_cancel.skip_send', { uid: update.uid, hasEmail: Boolean(email) });
    } else {
      try {
        const content = buildTrialCancelledEmail({
          plan,
          displayName: typeof data.displayName === 'string' ? data.displayName : null,
          accessUntil: update.accessUntil ? new Date(update.accessUntil) : null,
        });
        await sendBrevoEmail({
          apiKey: opts.brevo.apiKey,
          toEmail: email,
          sender: { email: opts.brevo.senderEmail, name: opts.brevo.senderName },
          subject: content.subject,
          html: content.html,
          text: content.text,
        });
        cancelSent = true;
        logger.info('premium_cancel.sent', { uid: update.uid, plan });
      } catch (e) {
        await ref.set({ premiumCancelEmailSentAt: null }, { merge: true });
        logger.error('premium_cancel.fail', {
          uid: update.uid,
          message: e instanceof Error ? e.message : 'error',
        });
      }
    }
  }

  return { ok: true, applied: true, cancelSent };
}

export async function handleTrialDay6Reminders(opts: {
  db: Firestore;
  brevo: BrevoConfig;
  now?: () => Date;
}): Promise<{ checked: number; sent: number }> {
  const now = (opts.now ?? (() => new Date()))();
  const snap = await opts.db.collection('users').where('premiumStatus', '==', 'trial').limit(500).get();
  let sent = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (typeof data.premiumDay6EmailSentAt === 'string') continue;
    if (typeof data.premiumCancelledAt === 'string') continue;
    const plan = data.premiumPlan === 'monthly' || data.premiumPlan === 'annual' ? data.premiumPlan : null;
    const endsRaw = typeof data.premiumTrialEndsAt === 'string' ? data.premiumTrialEndsAt : '';
    const ends = new Date(endsRaw);
    if (!plan || Number.isNaN(ends.getTime()) || !dueForTrialReminder(ends, now)) continue;

    const email = String(data.email ?? '').trim();
    if (!email || !opts.brevo.apiKey || !opts.brevo.senderEmail) continue;

    await doc.ref.set({ premiumDay6EmailSentAt: now.toISOString() }, { merge: true });
    try {
      const content = buildTrialDay6Email({
        plan,
        trialEndsAt: ends,
        displayName: typeof data.displayName === 'string' ? data.displayName : null,
      });
      await sendBrevoEmail({
        apiKey: opts.brevo.apiKey,
        toEmail: email,
        sender: { email: opts.brevo.senderEmail, name: opts.brevo.senderName },
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
      sent += 1;
      logger.info('premium_day6.sent', { uid: doc.id, plan });
    } catch (e) {
      await doc.ref.set({ premiumDay6EmailSentAt: null }, { merge: true });
      logger.error('premium_day6.fail', {
        uid: doc.id,
        message: e instanceof Error ? e.message : 'error',
      });
    }
  }

  return { checked: snap.size, sent };
}
