/**
 * Waitlist → seven-day Premium entitlement (server-side).
 *
 * One waitlist email can be claimed once, ever. The grant is stored under
 * `users/{uid}/entitlements/waitlist` so it survives reinstall and syncs
 * across devices. Claim locks live in `waitlistClaims/{email}` (admin-only).
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

export const WAITLIST_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type WaitlistClaimMode = 'auto' | 'manual';

export type WaitlistClaimStatus =
  | 'granted'
  | 'already_active'
  | 'not_on_waitlist'
  | 'already_claimed'
  | 'invalid_token'
  | 'invalid_email';

export interface WaitlistClaimResult {
  ok: boolean;
  status: WaitlistClaimStatus;
  premiumUntil: string | null;
  waitlistEmail: string | null;
  message: string;
}

export interface WaitlistDoc {
  claimToken?: string;
}

export interface WaitlistClaimDoc {
  claimedByUid?: string;
  claimedAt?: string;
  premiumUntil?: string;
}

export interface UserWaitlistEntitlementDoc {
  tier?: string;
  entitlement?: string;
  premiumUntil?: string;
  waitlistEmail?: string;
  waitlistClaimedAt?: string;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Uppercase alphanumeric claim codes; strips spaces and hyphens. */
export function normalizeClaimToken(raw: string): string {
  return raw.trim().replace(/[\s-]+/g, '').toUpperCase();
}

export function isPremiumUntilActive(until: string | undefined | null, nowMs = Date.now()): boolean {
  if (!until || typeof until !== 'string') return false;
  const t = Date.parse(until);
  return Number.isFinite(t) && t > nowMs;
}

export function buildGrantEnds(nowMs = Date.now()): string {
  return new Date(nowMs + WAITLIST_WEEK_MS).toISOString();
}

export function resolveClaimTarget(
  mode: WaitlistClaimMode,
  accountEmail: string | null | undefined,
  waitlistEmail?: string,
  claimToken?: string,
): { email?: string; token?: string; status?: WaitlistClaimStatus } {
  if (mode === 'auto') {
    const email = normalizeEmail(accountEmail ?? '');
    if (!email) return { status: 'invalid_email' };
    return { email };
  }

  const token = claimToken ? normalizeClaimToken(claimToken) : '';
  if (token) return { token };

  const email = normalizeEmail(waitlistEmail ?? '');
  if (!email) return { status: 'invalid_email' };
  return { email };
}

export function evaluateExistingClaim(
  claim: WaitlistClaimDoc,
  uid: string,
  nowMs = Date.now(),
): WaitlistClaimResult | null {
  const claimedBy = claim.claimedByUid;
  if (!claimedBy) return null;

  if (claimedBy === uid) {
    if (isPremiumUntilActive(claim.premiumUntil, nowMs)) {
      return {
        ok: true,
        status: 'already_active',
        premiumUntil: claim.premiumUntil ?? null,
        waitlistEmail: null,
        message: 'Your free waitlist week is already active on this account.',
      };
    }
    return {
      ok: false,
      status: 'already_claimed',
      premiumUntil: null,
      waitlistEmail: null,
      message: 'This waitlist spot was already used on your account.',
    };
  }

  return {
    ok: false,
    status: 'already_claimed',
    premiumUntil: null,
    waitlistEmail: null,
    message: 'This waitlist email has already been claimed.',
  };
}

export function userMessageForStatus(status: WaitlistClaimStatus): string {
  switch (status) {
    case 'granted':
      return 'Your free waitlist week of Premium is active.';
    case 'already_active':
      return 'Your free waitlist week is already active on this account.';
    case 'not_on_waitlist':
      return 'That email is not on the DriveIQ waitlist.';
    case 'already_claimed':
      return 'This waitlist offer has already been claimed.';
    case 'invalid_token':
      return 'That claim code is not valid.';
    case 'invalid_email':
      return 'Enter a valid waitlist email address.';
    default:
      return 'Could not claim the waitlist offer.';
  }
}

async function findWaitlistByToken(db: Firestore, token: string): Promise<string | null> {
  const snap = await db.collection('waitlist').where('claimToken', '==', token).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export async function handleClaimWaitlistPremium(opts: {
  db: Firestore;
  uid: string;
  accountEmail?: string | null;
  mode?: WaitlistClaimMode;
  waitlistEmail?: string;
  claimToken?: string;
  nowMs?: number;
}): Promise<WaitlistClaimResult> {
  const mode: WaitlistClaimMode = opts.mode ?? 'auto';
  const nowMs = opts.nowMs ?? Date.now();
  const target = resolveClaimTarget(mode, opts.accountEmail, opts.waitlistEmail, opts.claimToken);

  if (target.status === 'invalid_email') {
    return {
      ok: false,
      status: 'invalid_email',
      premiumUntil: null,
      waitlistEmail: null,
      message: userMessageForStatus('invalid_email'),
    };
  }

  let waitlistEmail = target.email ?? '';

  if (target.token) {
    const foundEmail = await findWaitlistByToken(opts.db, target.token);
    if (!foundEmail) {
      return {
        ok: false,
        status: 'invalid_token',
        premiumUntil: null,
        waitlistEmail: null,
        message: userMessageForStatus('invalid_token'),
      };
    }
    waitlistEmail = foundEmail;
  }

  if (!waitlistEmail) {
    return {
      ok: false,
      status: 'invalid_email',
      premiumUntil: null,
      waitlistEmail: null,
      message: userMessageForStatus('invalid_email'),
    };
  }

  const waitlistRef = opts.db.doc(`waitlist/${waitlistEmail}`);
  const claimRef = opts.db.doc(`waitlistClaims/${waitlistEmail}`);
  const entitlementRef = opts.db.doc(`users/${opts.uid}/entitlements/waitlist`);

  return opts.db.runTransaction(async (tx) => {
    const waitlistSnap = await tx.get(waitlistRef);

    if (!waitlistSnap.exists) {
      return {
        ok: false,
        status: 'not_on_waitlist',
        premiumUntil: null,
        waitlistEmail: null,
        message: userMessageForStatus('not_on_waitlist'),
      };
    }

    const claimSnap = await tx.get(claimRef);
    const claim = (claimSnap.data() ?? {}) as WaitlistClaimDoc;
    const existing = evaluateExistingClaim(claim, opts.uid, nowMs);
    if (existing) {
      if (existing.status === 'already_active') {
        return { ...existing, waitlistEmail };
      }
      return existing;
    }

    const entitlementSnap = await tx.get(entitlementRef);
    const entitlement = (entitlementSnap.data() ?? {}) as UserWaitlistEntitlementDoc;
    if (
      entitlement.waitlistEmail &&
      entitlement.waitlistEmail !== waitlistEmail &&
      isPremiumUntilActive(entitlement.premiumUntil, nowMs)
    ) {
      return {
        ok: false,
        status: 'already_claimed',
        premiumUntil: entitlement.premiumUntil ?? null,
        waitlistEmail: entitlement.waitlistEmail,
        message: 'Your account already has an active waitlist week.',
      };
    }

    const premiumUntil = buildGrantEnds(nowMs);
    const claimedAt = new Date(nowMs).toISOString();

    tx.set(
      claimRef,
      {
        claimedByUid: opts.uid,
        claimedAt,
        premiumUntil,
      },
      { merge: true },
    );

    tx.set(
      entitlementRef,
      {
        tier: 'premium',
        entitlement: 'premium',
        premiumUntil,
        waitlistEmail,
        waitlistClaimedAt: claimedAt,
        updatedAt: claimedAt,
      },
      { merge: true },
    );

    return {
      ok: true,
      status: 'granted',
      premiumUntil,
      waitlistEmail,
      message: userMessageForStatus('granted'),
    };
  });
}

/** Callable wrapper — maps domain failures to HttpsError where appropriate. */
export async function claimWaitlistPremiumCallable(opts: {
  db: Firestore;
  uid: string;
  accountEmail?: string | null;
  mode?: WaitlistClaimMode;
  waitlistEmail?: string;
  claimToken?: string;
}): Promise<WaitlistClaimResult> {
  if (!opts.uid) {
    throw new HttpsError('unauthenticated', 'Sign in to claim your waitlist week.');
  }
  return handleClaimWaitlistPremium(opts);
}

export async function seedWaitlistClaimToken(
  db: Firestore,
  email: string,
  claimToken: string,
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedToken = normalizeClaimToken(claimToken);
  if (!normalizedEmail || !normalizedToken) {
    throw new Error('email and claimToken required');
  }
  await db.doc(`waitlist/${normalizedEmail}`).set(
    {
      claimToken: normalizedToken,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
