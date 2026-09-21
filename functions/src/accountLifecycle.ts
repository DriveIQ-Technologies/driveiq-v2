/**
 * Account registration: the data foundation every lifecycle email depends on.
 *
 * Why this is an endpoint and not an auth.user().onCreate() trigger:
 * the app signs in anonymously on first open (AuthProvider), then calls
 * linkWithCredential to upgrade that same uid when the user signs up. So
 * onCreate fires once, for an anonymous user with no email, and never again
 * at the moment that actually matters. The client calls this after a real
 * sign-in instead, which covers Apple, Google, email and the upgrade path
 * identically.
 *
 * Idempotent: safe to call on every sign-in. The welcome email is guarded by a
 * transaction so a retry or a double-tap cannot send it twice.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { sendBrevoEmail, upsertBrevoContact } from './brevo.js';
import { buildWelcomeEmail, firstNameFrom } from './welcomeEmail.js';

export type AuthProviderId = 'apple' | 'google' | 'email' | 'unknown';

export interface RegisterAuthUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  emailVerified?: boolean;
  providerData?: Array<{ providerId?: string | null }>;
}

export interface BrevoConfig {
  apiKey?: string;
  senderEmail?: string;
  senderName?: string;
}

export interface RegisterAccountResult {
  ok: true;
  /** false when the account was already registered on an earlier call. */
  created: boolean;
  welcomeSent: boolean;
  authProvider: AuthProviderId;
}

/** Map Firebase provider ids to the short form stored on users/{uid}. */
export function resolveAuthProvider(
  providerData?: Array<{ providerId?: string | null }>,
): AuthProviderId {
  const ids = (providerData ?? []).map((p) => p?.providerId ?? '');
  if (ids.includes('apple.com')) return 'apple';
  if (ids.includes('google.com')) return 'google';
  if (ids.includes('password')) return 'email';
  return 'unknown';
}

export async function handleRegisterAccount(opts: {
  db: Firestore;
  user: RegisterAuthUser;
  brevo: BrevoConfig;
  /**
   * True only when this sign-in actually created the account. Gates the
   * welcome email so users who predate this feature get their fields
   * backfilled silently instead of a "welcome" to an old account.
   */
  isNewAccount?: boolean;
  now?: () => Date;
}): Promise<RegisterAccountResult> {
  const { db, user, brevo } = opts;
  const now = (opts.now ?? (() => new Date()))();
  const uid = user.uid;
  if (!uid) throw new Error('missing_uid');

  const email = (user.email ?? '').trim().toLowerCase();
  const authProvider = resolveAuthProvider(user.providerData);

  // Anonymous browse sessions have no address and nothing to email.
  if (!email) {
    logger.info('account_register.skip_no_email', { uid, authProvider });
    return { ok: true, created: false, welcomeSent: false, authProvider };
  }

  const ref = db.doc(`users/${uid}`);
  const nowIso = now.toISOString();

  // Claim the welcome send inside a transaction so concurrent sign-ins on two
  // devices cannot both decide they are the first.
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const alreadyRegistered = typeof data.accountRegisteredAt === 'string';
    const alreadyWelcomed = typeof data.welcomeEmailSentAt === 'string';

    const patch: Record<string, unknown> = {
      email,
      displayName: user.displayName ?? null,
      emailVerified: Boolean(user.emailVerified),
      authProvider,
      updatedAt: nowIso,
    };
    // createdAt is written once and never moved.
    if (!alreadyRegistered) {
      patch.createdAt = nowIso;
      patch.accountRegisteredAt = nowIso;
      // Marketing is opt-in: the contact syncs to Brevo for transactional
      // sends only, and joins no marketing list until the user opts in.
      // The signup UI for this is not built yet — the field is written now so
      // turning it on later needs no migration.
      patch.marketingConsent = false;
      patch.marketingConsentAt = null;
    }
    // Only a genuinely new account is welcomed, and only once.
    const shouldSendWelcome = Boolean(opts.isNewAccount) && !alreadyWelcomed;
    if (shouldSendWelcome) {
      // Reserve the send now; cleared below if the send fails.
      patch.welcomeEmailSentAt = nowIso;
    }
    tx.set(ref, patch, { merge: true });
    return { shouldSendWelcome, alreadyRegistered };
  });

  // Brevo contact sync. Non-fatal: the user doc is the source of truth and a
  // failed sync can be replayed on the next sign-in.
  if (brevo.apiKey) {
    try {
      await upsertBrevoContact({
        apiKey: brevo.apiKey,
        email,
        attributes: {
          ...(firstNameFrom(user.displayName)
            ? { FIRSTNAME: firstNameFrom(user.displayName) as string }
            : {}),
          AUTH_PROVIDER: authProvider,
          SIGNUP_DATE: nowIso,
          EMAIL_VERIFIED: Boolean(user.emailVerified),
          MARKETING_CONSENT: false,
        },
      });
    } catch (e) {
      logger.warn('account_register.brevo_contact_fail', {
        uid,
        message: e instanceof Error ? e.message : 'error',
      });
    }
  }

  let welcomeSent = false;
  if (claim.shouldSendWelcome) {
    if (!brevo.apiKey || !brevo.senderEmail) {
      // Release the reservation so a later call can still send it.
      await ref.set({ welcomeEmailSentAt: null }, { merge: true });
      logger.warn('account_register.welcome_skipped_no_brevo', { uid });
    } else {
      try {
        const content = buildWelcomeEmail({ displayName: user.displayName });
        await sendBrevoEmail({
          apiKey: brevo.apiKey,
          toEmail: email,
          sender: { email: brevo.senderEmail, name: brevo.senderName },
          subject: content.subject,
          html: content.html,
          text: content.text,
        });
        welcomeSent = true;
        logger.info('account_register.welcome_sent', { uid, authProvider });
      } catch (e) {
        await ref.set({ welcomeEmailSentAt: null }, { merge: true });
        logger.error('account_register.welcome_fail', {
          uid,
          message: e instanceof Error ? e.message : 'error',
        });
      }
    }
  }

  return {
    ok: true,
    created: !claim.alreadyRegistered,
    welcomeSent,
    authProvider,
  };
}
