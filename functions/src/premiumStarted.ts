/**
 * Send the Premium trial welcome once, after a successful subscribe.
 *
 * The app calls this after StoreKit / Play confirms an annual or monthly
 * trial. Idempotent: a retry or a double-tap cannot send it twice.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { sendBrevoEmail } from './brevo.js';
import type { BrevoConfig } from './accountLifecycle.js';
import {
  buildPremiumWelcomeEmail,
  defaultTrialEndsAt,
  resolvePremiumPlan,
} from './premiumWelcomeEmail.js';

export interface NotifyPremiumStartedUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
}

export interface NotifyPremiumStartedResult {
  ok: true;
  sent: boolean;
}

export async function handleNotifyPremiumStarted(opts: {
  db: Firestore;
  user: NotifyPremiumStartedUser;
  brevo: BrevoConfig;
  plan?: string;
  trialStarted?: boolean;
  now?: () => Date;
}): Promise<NotifyPremiumStartedResult> {
  const now = (opts.now ?? (() => new Date()))();
  const uid = opts.user.uid;
  if (!uid) throw new Error('missing_uid');

  const email = (opts.user.email ?? '').trim().toLowerCase();
  if (!email) {
    logger.info('premium_welcome.skip_no_email', { uid });
    return { ok: true, sent: false };
  }

  const plan = resolvePremiumPlan(opts.plan);
  if (!opts.trialStarted || !plan) {
    logger.info('premium_welcome.skip_not_trial', {
      uid,
      plan: opts.plan ?? null,
      trialStarted: Boolean(opts.trialStarted),
    });
    return { ok: true, sent: false };
  }

  const ref = opts.db.doc(`users/${uid}`);
  const nowIso = now.toISOString();
  const trialEnds = defaultTrialEndsAt(now);

  const claim = await opts.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    // Older annual-only field still counts as sent.
    if (
      typeof data.premiumWelcomeSentAt === 'string' ||
      typeof data.premiumAnnualWelcomeSentAt === 'string'
    ) {
      return { shouldSend: false };
    }
    tx.set(
      ref,
      {
        premiumWelcomeSentAt: nowIso,
        premiumPlan: plan,
        premiumStatus: 'trial',
        premiumSource: 'store',
        premiumTrialEndsAt: trialEnds.toISOString(),
        updatedAt: nowIso,
      },
      { merge: true },
    );
    return { shouldSend: true };
  });

  if (!claim.shouldSend) return { ok: true, sent: false };

  if (!opts.brevo.apiKey || !opts.brevo.senderEmail) {
    await ref.set({ premiumWelcomeSentAt: null }, { merge: true });
    logger.warn('premium_welcome.skipped_no_brevo', { uid });
    return { ok: true, sent: false };
  }

  try {
    const content = buildPremiumWelcomeEmail({
      plan,
      displayName: opts.user.displayName,
      trialEndsAt: trialEnds,
      now,
    });
    await sendBrevoEmail({
      apiKey: opts.brevo.apiKey,
      toEmail: email,
      sender: { email: opts.brevo.senderEmail, name: opts.brevo.senderName },
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    logger.info('premium_welcome.sent', { uid, plan });
    return { ok: true, sent: true };
  } catch (e) {
    await ref.set({ premiumWelcomeSentAt: null }, { merge: true });
    logger.error('premium_welcome.fail', {
      uid,
      message: e instanceof Error ? e.message : 'error',
    });
    return { ok: true, sent: false };
  }
}
