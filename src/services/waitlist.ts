/**
 * Waitlist → free Premium week (server-backed, uid-scoped).
 *
 * Entitlement is granted by `claimWaitlistPremium` when the backend is
 * reachable. Local storage is a per-account cache keyed by Firebase uid —
 * never shared across accounts on the same device.
 */

import { WAITLIST_EMAILS } from '@/data/waitlistAllowlist';
import { track, refreshUserTraits } from './analytics';
import { auth, db, fsApi, functions, functionsApi } from './firebase';

const TRIAL_ENDS_KEY = 'driveiq.premium.trialEnds';
const TRIAL_EMAIL_KEY = 'driveiq.premium.trialEmail';
const TRIAL_UID_KEY = 'driveiq.premium.trialUid';
const TRIAL_END_SEEN_KEY = 'driveiq.waitlist.trialEndSeen';

export type WaitlistClaimStatus =
  | 'granted'
  | 'already_active'
  | 'not_on_waitlist'
  | 'already_claimed'
  | 'invalid_token'
  | 'invalid_email';

export interface WaitlistClaimResponse {
  ok: boolean;
  status: WaitlistClaimStatus;
  premiumUntil: string | null;
  waitlistEmail: string | null;
  message: string;
}

const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app';
const CLAIM_HTTP_URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/claimWaitlistPremiumHttp`;

type ClaimHttpBody = {
  result?: WaitlistClaimResponse;
  error?: { message?: string; status?: string };
};

export function friendlyWaitlistClaimError(e: unknown): string {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : '';
  if (message.includes('not_on_waitlist')) {
    return 'That email is not on the DriveIQ waitlist.';
  }
  if (code === 'functions/not-found' || message.includes('404')) {
    return 'Waitlist claim is not live yet. Ask the team to deploy the latest backend.';
  }
  if (code === 'functions/unauthenticated' || message.includes('401') || message.includes('Sign in')) {
    return 'Sign in again, then try claiming your waitlist week.';
  }
  if (message === 'waitlist/unavailable') {
    return 'Waitlist claim is unavailable on this build. Check your connection and try again.';
  }
  if (message && message !== 'Something went wrong. Please try again.') {
    return message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}

const envEmails = (): string[] =>
  (process.env.EXPO_PUBLIC_WAITLIST_EMAILS ?? '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function currentAccountUid(): string | null {
  const user = auth?.currentUser;
  if (!user || user.isAnonymous) return null;
  return user.uid;
}

function buildLocalTrialEnds(nowMs = Date.now()): string {
  return new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function emailOnAllowlist(email: string): Promise<boolean> {
  const needle = normalizeEmail(email);
  if (!needle) return false;
  if (WAITLIST_EMAILS.includes(needle) || envEmails().includes(needle)) return true;
  if (!db || !fsApi) return false;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, 'waitlist', needle));
    return snap.exists();
  } catch (e) {
    console.warn('[waitlist] allowlist read failed', e);
    return false;
  }
}

/** Drop cached waitlist week (e.g. on sign-out). */
export async function clearWaitlistCache(): Promise<void> {
  const { removeItem } = await import('./storage');
  await Promise.all([
    removeItem(TRIAL_ENDS_KEY),
    removeItem(TRIAL_EMAIL_KEY),
    removeItem(TRIAL_UID_KEY),
  ]);
}

async function cacheWaitlistGrant(
  premiumUntil: string,
  waitlistEmail: string,
  uid?: string | null,
): Promise<void> {
  const owner = uid ?? currentAccountUid();
  if (!owner) return;
  const { setItem } = await import('./storage');
  await setItem(TRIAL_ENDS_KEY, premiumUntil);
  await setItem(TRIAL_EMAIL_KEY, waitlistEmail);
  await setItem(TRIAL_UID_KEY, owner);
}

async function getLocalWaitlistGrant(): Promise<{
  premiumUntil: string | null;
  waitlistEmail: string | null;
  cachedUid: string | null;
}> {
  const { getItem } = await import('./storage');
  const [premiumUntil, waitlistEmail, cachedUid] = await Promise.all([
    getItem(TRIAL_ENDS_KEY),
    getItem(TRIAL_EMAIL_KEY),
    getItem(TRIAL_UID_KEY),
  ]);
  return {
    premiumUntil: premiumUntil || null,
    waitlistEmail: waitlistEmail || null,
    cachedUid: cachedUid || null,
  };
}

/** Local cache only counts for the signed-in account. */
async function getLocalWaitlistForCurrentUser(): Promise<{
  premiumUntil: string | null;
  waitlistEmail: string | null;
} | null> {
  const uid = currentAccountUid();
  if (!uid) return null;
  const local = await getLocalWaitlistGrant();
  if (local.cachedUid !== uid) return null;
  if (!local.premiumUntil || Date.parse(local.premiumUntil) <= Date.now()) return null;
  return {
    premiumUntil: local.premiumUntil,
    waitlistEmail: local.waitlistEmail,
  };
}

async function grantLocalWaitlistWeek(waitlistEmail: string): Promise<WaitlistClaimResponse> {
  const uid = currentAccountUid();
  if (!uid) {
    return {
      ok: false,
      status: 'invalid_email',
      premiumUntil: null,
      waitlistEmail: null,
      message: 'Sign in to claim your waitlist week.',
    };
  }

  const existing = await getLocalWaitlistForCurrentUser();
  if (existing?.premiumUntil) {
    return {
      ok: true,
      status: 'already_active',
      premiumUntil: existing.premiumUntil,
      waitlistEmail: existing.waitlistEmail ?? waitlistEmail,
      message: 'Your free waitlist week is already active on this account.',
    };
  }

  const premiumUntil = buildLocalTrialEnds();
  await cacheWaitlistGrant(premiumUntil, waitlistEmail, uid);
  await refreshUserTraits({ tier: 'premium', waitlist_week: true });
  track('waitlist_premium_week_granted', { days: 7, via: 'local_fallback' });
  return {
    ok: true,
    status: 'granted',
    premiumUntil,
    waitlistEmail,
    message: 'Your free waitlist week of Premium is active.',
  };
}

export async function getWaitlistTrialEnds(): Promise<string | null> {
  const uid = currentAccountUid();
  if (!uid) return null;

  const local = await getLocalWaitlistForCurrentUser();
  if (local?.premiumUntil) return local.premiumUntil;

  const synced = await syncWaitlistEntitlementFromFirestore();
  return synced?.premiumUntil ?? null;
}

export async function hasSeenWaitlistTrialEnd(): Promise<boolean> {
  const { getItem } = await import('./storage');
  const v = await getItem(TRIAL_END_SEEN_KEY);
  return v === '1';
}

export async function markWaitlistTrialEndSeen(): Promise<void> {
  const { setItem } = await import('./storage');
  await setItem(TRIAL_END_SEEN_KEY, '1');
}

export async function waitlistTrialActive(): Promise<boolean> {
  const ends = await getWaitlistTrialEnds();
  if (!ends) return false;
  const t = Date.parse(ends);
  return Number.isFinite(t) && t > Date.now();
}

/** Reconcile waitlist entitlement when auth user changes. */
export async function refreshWaitlistForCurrentUser(): Promise<void> {
  const uid = currentAccountUid();
  if (!uid) {
    await clearWaitlistCache();
    return;
  }

  const local = await getLocalWaitlistGrant();
  if (local.cachedUid && local.cachedUid !== uid) {
    await clearWaitlistCache();
  }

  await syncWaitlistEntitlementFromFirestore();
}

/** Read server entitlement into the local cache (cross-device sync). */
export async function syncWaitlistEntitlementFromFirestore(): Promise<{
  premiumUntil: string | null;
  waitlistEmail: string | null;
} | null> {
  const uid = currentAccountUid();
  if (!uid || !db || !fsApi) return null;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, 'users', uid));
    const entSnap = await fsApi.getDoc(fsApi.doc(db, 'users', uid, 'entitlements', 'waitlist'));
    const root = snap.exists() ? snap.data() : {};
    const ent = entSnap.exists() ? entSnap.data() : {};
    const data = { ...root, ...ent } as {
      premiumUntil?: string;
      waitlistEmail?: string;
      waitlistClaimedAt?: string;
    };
    const premiumUntil =
      typeof data.premiumUntil === 'string' && Date.parse(data.premiumUntil) > Date.now()
        ? data.premiumUntil
        : null;
    const waitlistEmail =
      typeof data.waitlistEmail === 'string' ? data.waitlistEmail : null;

    if (premiumUntil && waitlistEmail) {
      await cacheWaitlistGrant(premiumUntil, waitlistEmail, uid);
      await refreshUserTraits({ tier: 'premium', waitlist_week: true });
      return { premiumUntil, waitlistEmail };
    }

    return { premiumUntil: null, waitlistEmail: null };
  } catch (e) {
    console.warn('[waitlist] entitlement sync failed', e);
    return null;
  }
}

async function callClaimWaitlistPremium(payload: {
  mode: 'auto' | 'manual';
  waitlistEmail?: string;
  claimToken?: string;
}): Promise<WaitlistClaimResponse> {
  const currentUser = auth?.currentUser;
  if (!currentUser || currentUser.isAnonymous) {
    throw new Error('Sign in to claim your waitlist week.');
  }

  const post = async (forceRefresh: boolean): Promise<WaitlistClaimResponse> => {
    const token = await currentUser.getIdToken(forceRefresh);
    const res = await fetch(CLAIM_HTTP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: payload }),
    });
    const raw = await res.text();
    let json: ClaimHttpBody | null = null;
    try {
      json = raw ? (JSON.parse(raw) as ClaimHttpBody) : null;
    } catch {
      throw new Error(`waitlist/bad-json http/${res.status}`);
    }
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || `waitlist/http/${res.status}`);
    }
    if (!json?.result) throw new Error('waitlist/empty');
    return json.result;
  };

  try {
    return await post(false);
  } catch (httpErr) {
    const msg = httpErr instanceof Error ? httpErr.message : String(httpErr);
    if (msg.includes('401') || msg.toLowerCase().includes('sign in')) {
      return post(true);
    }
    if (functions && functionsApi) {
      try {
        const fn = functionsApi.httpsCallable(functions, 'claimWaitlistPremium');
        const res = await fn(payload);
        return res.data as WaitlistClaimResponse;
      } catch {
        /* fall through */
      }
    }
    throw httpErr;
  }
}

async function applyClaimResult(result: WaitlistClaimResponse): Promise<boolean> {
  if (
    result.ok &&
    (result.status === 'granted' || result.status === 'already_active') &&
    result.premiumUntil &&
    result.waitlistEmail
  ) {
    await cacheWaitlistGrant(result.premiumUntil, result.waitlistEmail);
    await refreshUserTraits({ tier: 'premium', waitlist_week: true });
    if (result.status === 'granted') {
      track('waitlist_premium_week_granted', { days: 7, via: 'server' });
    }
    return result.status === 'granted';
  }
  return false;
}

/**
 * After sign-in / sign-up: silently match account email to the waitlist.
 * Returns true when a new week was granted just now.
 */
export async function applyWaitlistPremium(email: string): Promise<boolean> {
  const trimmed = normalizeEmail(email);
  if (!trimmed) return false;
  if (!currentAccountUid()) return false;

  await refreshWaitlistForCurrentUser();

  try {
    const result = await callClaimWaitlistPremium({ mode: 'auto' });
    return applyClaimResult(result);
  } catch (e) {
    console.warn('[waitlist] auto claim failed', e);
    const allowed = await emailOnAllowlist(trimmed);
    if (!allowed) return false;
    const fallback = await grantLocalWaitlistWeek(trimmed);
    return fallback.status === 'granted';
  }
}

async function fallbackManualEmailClaim(email: string): Promise<WaitlistClaimResponse> {
  const allowed = await emailOnAllowlist(email);
  if (!allowed) {
    return {
      ok: false,
      status: 'not_on_waitlist',
      premiumUntil: null,
      waitlistEmail: null,
      message: 'That email is not on the DriveIQ waitlist.',
    };
  }
  return grantLocalWaitlistWeek(email);
}

/** Manual claim when the account email differs from the waitlist email. */
export async function claimWaitlistByEmail(waitlistEmail: string): Promise<WaitlistClaimResponse> {
  const email = normalizeEmail(waitlistEmail);
  if (!email) {
    return {
      ok: false,
      status: 'invalid_email',
      premiumUntil: null,
      waitlistEmail: null,
      message: 'Enter a valid waitlist email address.',
    };
  }
  try {
    const result = await callClaimWaitlistPremium({ mode: 'manual', waitlistEmail: email });
    await applyClaimResult(result);
    if (result.status === 'granted') {
      track('waitlist_claim_manual', { method: 'email' });
    }
    return result;
  } catch (e) {
    console.warn('[waitlist] manual email claim failed', e);
    return fallbackManualEmailClaim(email);
  }
}

/** Manual claim using a one-time code from the waitlist invite. */
export async function claimWaitlistByToken(claimToken: string): Promise<WaitlistClaimResponse> {
  const token = claimToken.trim();
  if (!token) {
    return {
      ok: false,
      status: 'invalid_token',
      premiumUntil: null,
      waitlistEmail: null,
      message: 'Enter your claim code.',
    };
  }
  try {
    const result = await callClaimWaitlistPremium({ mode: 'manual', claimToken: token });
    await applyClaimResult(result);
    if (result.status === 'granted') {
      track('waitlist_claim_manual', { method: 'token' });
    }
    return result;
  } catch (e) {
    console.warn('[waitlist] manual token claim failed', e);
    return {
      ok: false,
      status: 'invalid_token',
      premiumUntil: null,
      waitlistEmail: null,
      message:
        'Claim code verification is temporarily unavailable. Use your waitlist email instead.',
    };
  }
}

/** Dev-only hint: seed/env allowlist still used for pre-release smoke tests. */
export function isDevAllowlistEmail(email: string): boolean {
  const needle = normalizeEmail(email);
  return WAITLIST_EMAILS.includes(needle) || envEmails().includes(needle);
}
