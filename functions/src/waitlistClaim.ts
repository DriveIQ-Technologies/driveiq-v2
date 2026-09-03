/**
 * Waitlist token claim logic (token-first).
 *
 * Token is the source of truth. A token can be redeemed once and is bound to
 * the first uid that claims it.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

export const WAITLIST_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const TOKEN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type WaitlistClaimStatus =
  | 'granted'
  | 'already_active'
  | 'already_used'
  | 'already_claimed'
  | 'invalid_token'
  | 'invalid_email'
  | 'expired'
  | 'inactive'
  | 'already_subscribed';

export interface WaitlistClaimResult {
  ok: boolean;
  status: WaitlistClaimStatus;
  premiumUntil: string | null;
  waitlistEmail: string | null;
  token: string | null;
  message: string;
}

export type WaitlistCodeRequestStatus =
  | 'sent'
  | 'invalid_email'
  | 'not_found'
  | 'already_claimed';

export interface WaitlistCodeRequestResult {
  ok: boolean;
  status: WaitlistCodeRequestStatus;
  message: string;
}

interface WaitlistTokenDoc {
  email?: string;
  active?: boolean;
  expiresAt?: string;
  premiumDays?: number;
  claimedByUid?: string;
  claimedAt?: string;
  premiumUntil?: string;
  usedCount?: number;
  maxUses?: number;
  updatedAt?: unknown;
}

interface UserEntitlementDoc {
  tier?: string;
  entitlement?: string;
  premiumUntil?: string;
  waitlistEmail?: string;
  waitlistToken?: string;
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

export function buildGrantEnds(nowMs = Date.now(), premiumDays = 7): string {
  const ms = Math.max(1, premiumDays) * 24 * 60 * 60 * 1000;
  return new Date(nowMs + ms).toISOString();
}

export function userMessageForStatus(status: WaitlistClaimStatus): string {
  switch (status) {
    case 'granted':
      return 'Your free waitlist week of Premium is active.';
    case 'already_active':
      return 'Your free waitlist week is already active on this account.';
    case 'already_used':
      return 'This account already used its waitlist free week.';
    case 'already_claimed':
      return 'This token has already been claimed.';
    case 'invalid_token':
      return 'That claim code is not valid.';
    case 'invalid_email':
      return 'Enter a valid waitlist email address.';
    case 'expired':
      return 'This claim code has expired.';
    case 'inactive':
      return 'This claim code is currently inactive.';
    case 'already_subscribed':
      return 'This account already has Premium. The waitlist code was not consumed.';
    default:
      return 'Could not claim the waitlist offer.';
  }
}

export function userMessageForCodeRequest(status: WaitlistCodeRequestStatus): string {
  switch (status) {
    case 'sent':
      return 'If your waitlist email is registered, we have sent your claim code.';
    case 'invalid_email':
      return 'Enter a valid waitlist email address.';
    case 'already_claimed':
      return 'This waitlist code was already claimed.';
    case 'not_found':
    default:
      return 'If your waitlist email is registered, we have sent your claim code.';
  }
}

export function evaluateExistingClaim(
  tokenDoc: WaitlistTokenDoc,
  uid: string,
  nowMs = Date.now(),
): WaitlistClaimResult | null {
  const claimedBy = tokenDoc.claimedByUid;
  if (!claimedBy) return null;
  if (claimedBy === uid && isPremiumUntilActive(tokenDoc.premiumUntil, nowMs)) {
    return {
      ok: true,
      status: 'already_active',
      premiumUntil: tokenDoc.premiumUntil ?? null,
      waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
      token: null,
      message: userMessageForStatus('already_active'),
    };
  }
  if (claimedBy === uid) {
    return {
      ok: false,
      status: 'already_used',
      premiumUntil: tokenDoc.premiumUntil ?? null,
      waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
      token: null,
      message: userMessageForStatus('already_used'),
    };
  }
  return {
    ok: false,
    status: 'already_claimed',
    premiumUntil: tokenDoc.premiumUntil ?? null,
    waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
    token: null,
    message: userMessageForStatus('already_claimed'),
  };
}

function tokenClaimable(tokenDoc: WaitlistTokenDoc, nowMs: number): boolean {
  if (tokenDoc.active === false) return false;
  if (typeof tokenDoc.expiresAt === 'string' && Date.parse(tokenDoc.expiresAt) <= nowMs) {
    return false;
  }
  const usedCount = Number.isFinite(tokenDoc.usedCount) ? Number(tokenDoc.usedCount) : 0;
  const maxUses = Number.isFinite(tokenDoc.maxUses) ? Number(tokenDoc.maxUses) : 1;
  return usedCount < Math.max(1, maxUses);
}

/**
 * Main token claim flow.
 *
 * Claim route A/B:
 * - Route A: claim by waitlist email (auto-match path).
 * - Route B: claim by explicit token code.
 */
export async function handleClaimWaitlistPremium(opts: {
  db: Firestore;
  uid: string;
  claimToken?: string;
  waitlistEmail?: string;
  nowMs?: number;
}): Promise<WaitlistClaimResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const claimToken = normalizeClaimToken(opts.claimToken ?? '');
  const waitlistEmail = normalizeEmail(opts.waitlistEmail ?? '');

  if (!claimToken && !waitlistEmail) {
    return {
      ok: false,
      status: 'invalid_token',
      premiumUntil: null,
      waitlistEmail: null,
      token: null,
      message: userMessageForStatus('invalid_token'),
    };
  }

  return opts.db.runTransaction(async (tx) => {
    let token = claimToken;
    if (!token) {
      if (!waitlistEmail) {
        return {
          ok: false,
          status: 'invalid_email',
          premiumUntil: null,
          waitlistEmail: null,
          token: null,
          message: userMessageForStatus('invalid_email'),
        };
      }
      const emailMatches = await tx.get(
        opts.db.collection('waitlistTokens').where('email', '==', waitlistEmail).limit(25),
      );
      if (emailMatches.empty) {
        return {
          ok: false,
          status: 'invalid_email',
          premiumUntil: null,
          waitlistEmail,
          token: null,
          message: userMessageForStatus('invalid_email'),
        };
      }

      for (const doc of emailMatches.docs) {
        const data = (doc.data() ?? {}) as WaitlistTokenDoc;
        const existing = evaluateExistingClaim(data, opts.uid, nowMs);
        if (existing?.status === 'already_active' || existing?.status === 'already_used') {
          return { ...existing, token: doc.id };
        }
      }
      const claimable = emailMatches.docs.find((doc) =>
        tokenClaimable((doc.data() ?? {}) as WaitlistTokenDoc, nowMs),
      );
      if (!claimable) {
        return {
          ok: false,
          status: 'already_claimed',
          premiumUntil: null,
          waitlistEmail,
          token: null,
          message: userMessageForStatus('already_claimed'),
        };
      }
      token = claimable.id;
    }

    const tokenRef = opts.db.doc(`waitlistTokens/${token}`);
    const entitlementRef = opts.db.doc(`users/${opts.uid}/entitlements/waitlist`);
    const userRef = opts.db.doc(`users/${opts.uid}`);
    const claimRef = opts.db.doc(`waitlistClaims/${token}`);

    const tokenSnap = await tx.get(tokenRef);
    if (!tokenSnap.exists) {
      return {
        ok: false,
        status: 'invalid_token',
        premiumUntil: null,
        waitlistEmail: null,
        token,
        message: userMessageForStatus('invalid_token'),
      };
    }
    const tokenDoc = (tokenSnap.data() ?? {}) as WaitlistTokenDoc;
    if (tokenDoc.active === false) {
      return {
        ok: false,
        status: 'inactive',
        premiumUntil: null,
        waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
        token,
        message: userMessageForStatus('inactive'),
      };
    }
    if (typeof tokenDoc.expiresAt === 'string' && Date.parse(tokenDoc.expiresAt) <= nowMs) {
      return {
        ok: false,
        status: 'expired',
        premiumUntil: null,
        waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
        token,
        message: userMessageForStatus('expired'),
      };
    }
    const existing = evaluateExistingClaim(tokenDoc, opts.uid, nowMs);
    if (existing) return { ...existing, token };

    const [entitlementSnap, userSnap] = await Promise.all([tx.get(entitlementRef), tx.get(userRef)]);
    const entitlement = (entitlementSnap.data() ?? {}) as UserEntitlementDoc;
    const user = (userSnap.data() ?? {}) as UserEntitlementDoc;
    const usedByUid =
      Boolean(entitlement.waitlistToken || user.waitlistToken) ||
      Boolean(entitlement.waitlistClaimedAt || user.waitlistClaimedAt);
    if (usedByUid) {
      return {
        ok: false,
        status: 'already_used',
        premiumUntil: user.premiumUntil ?? entitlement.premiumUntil ?? null,
        waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
        token,
        message: userMessageForStatus('already_used'),
      };
    }
    const alreadyPremium =
      user.tier === 'premium' ||
      user.entitlement === 'premium' ||
      entitlement.tier === 'premium' ||
      entitlement.entitlement === 'premium' ||
      isPremiumUntilActive(user.premiumUntil, nowMs) ||
      isPremiumUntilActive(entitlement.premiumUntil, nowMs);
    if (alreadyPremium) {
      return {
        ok: false,
        status: 'already_subscribed',
        premiumUntil: user.premiumUntil ?? entitlement.premiumUntil ?? null,
        waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
        token,
        message: userMessageForStatus('already_subscribed'),
      };
    }

    const premiumDays = Number.isFinite(tokenDoc.premiumDays) ? Number(tokenDoc.premiumDays) : 7;
    const premiumUntil = buildGrantEnds(nowMs, premiumDays);
    const claimedAt = new Date(nowMs).toISOString();
    const usedCount = Number.isFinite(tokenDoc.usedCount) ? Number(tokenDoc.usedCount) : 0;
    const maxUses = Number.isFinite(tokenDoc.maxUses) ? Number(tokenDoc.maxUses) : 1;
    if (usedCount >= Math.max(1, maxUses)) {
      return {
        ok: false,
        status: 'already_claimed',
        premiumUntil: tokenDoc.premiumUntil ?? null,
        waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
        token,
        message: userMessageForStatus('already_claimed'),
      };
    }

    tx.set(
      tokenRef,
      {
        claimedByUid: opts.uid,
        claimedAt,
        premiumUntil,
        usedCount: usedCount + 1,
        updatedAt: claimedAt,
      },
      { merge: true },
    );

    tx.set(
      entitlementRef,
      {
        tier: 'premium',
        entitlement: 'premium',
        premiumUntil,
        waitlistEmail: tokenDoc.email ?? null,
        waitlistClaimedAt: claimedAt,
        waitlistToken: token,
        updatedAt: claimedAt,
      },
      { merge: true },
    );

    tx.set(
      userRef,
      {
        tier: 'premium',
        entitlement: 'premium',
        premiumUntil,
        waitlistEmail: tokenDoc.email ?? null,
        waitlistClaimedAt: claimedAt,
        waitlistToken: token,
        updatedAt: claimedAt,
      },
      { merge: true },
    );

    tx.set(
      claimRef,
      {
        token,
        uid: opts.uid,
        email: tokenDoc.email ?? null,
        claimedAt,
        premiumUntil,
      },
      { merge: true },
    );

    return {
      ok: true,
      status: 'granted',
      premiumUntil,
      waitlistEmail: typeof tokenDoc.email === 'string' ? tokenDoc.email : null,
      token,
      message: userMessageForStatus('granted'),
    };
  });
}

/** Callable wrapper — maps domain failures to HttpsError where appropriate. */
export async function claimWaitlistPremiumCallable(opts: {
  db: Firestore;
  uid: string;
  claimToken?: string;
  waitlistEmail?: string;
}): Promise<WaitlistClaimResult> {
  if (!opts.uid) {
    throw new HttpsError('unauthenticated', 'Sign in to claim your waitlist week.');
  }
  return handleClaimWaitlistPremium(opts);
}

/**
 * Resolve an active claim token for a waitlist email.
 *
 * Returns a generic success-style message for not-found results so callers can
 * avoid leaking which emails are in the waitlist cohort.
 */
export async function requestWaitlistCodeByEmail(opts: {
  db: Firestore;
  waitlistEmail?: string;
  nowMs?: number;
}): Promise<WaitlistCodeRequestResult & { token: string | null; waitlistEmail: string | null }> {
  const nowMs = opts.nowMs ?? Date.now();
  const email = normalizeEmail(opts.waitlistEmail ?? '');
  if (!email) {
    return {
      ok: false,
      status: 'invalid_email',
      message: userMessageForCodeRequest('invalid_email'),
      token: null,
      waitlistEmail: null,
    };
  }

  const waitlistSnap = await opts.db.doc(`waitlist/${email}`).get();
  const waitlistCode = waitlistSnap.exists
    ? normalizeClaimToken(String((waitlistSnap.data() as { claimToken?: unknown })?.claimToken ?? ''))
    : '';
  if (!waitlistCode) {
    return {
      ok: true,
      status: 'not_found',
      message: userMessageForCodeRequest('not_found'),
      token: null,
      waitlistEmail: email,
    };
  }

  const tokenSnap = await opts.db.doc(`waitlistTokens/${waitlistCode}`).get();
  if (!tokenSnap.exists) {
    return {
      ok: true,
      status: 'not_found',
      message: userMessageForCodeRequest('not_found'),
      token: null,
      waitlistEmail: email,
    };
  }
  const tokenDoc = (tokenSnap.data() ?? {}) as WaitlistTokenDoc;
  if (!tokenClaimable(tokenDoc, nowMs)) {
    return {
      ok: false,
      status: 'already_claimed',
      message: userMessageForCodeRequest('already_claimed'),
      token: null,
      waitlistEmail: email,
    };
  }

  return {
    ok: true,
    status: 'sent',
    message: userMessageForCodeRequest('sent'),
    token: waitlistCode,
    waitlistEmail: email,
  };
}

/**
 * Seed a token into waitlistTokens with 14-day expiry from creation.
 */
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
  await db.doc(`waitlistTokens/${normalizedToken}`).set(
    {
      email: normalizedEmail,
      active: true,
      premiumDays: 7,
      maxUses: 1,
      usedCount: 0,
      expiresAt: new Date(Date.now() + TOKEN_WINDOW_MS).toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
