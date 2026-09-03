/**
 * Waitlist claim flow.
 *
 * Token remains the proof and source of truth.
 * Route A auto-match claims by waitlist email through the same backend
 * transaction as manual token claims.
 */
import { track, refreshUserTraits } from './analytics';
import { auth, db, fsApi, functions, functionsApi } from './firebase';

const TRIAL_ENDS_KEY = 'driveiq.premium.trialEnds';
const TRIAL_EMAIL_KEY = 'driveiq.premium.trialEmail';
const TRIAL_UID_KEY = 'driveiq.premium.trialUid';
const TRIAL_TOKEN_KEY = 'driveiq.waitlist.pendingToken';
const TRIAL_END_SEEN_KEY = 'driveiq.waitlist.trialEndSeen';

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

export interface WaitlistClaimResponse {
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

export interface WaitlistCodeRequestResponse {
  ok: boolean;
  status: WaitlistCodeRequestStatus;
  message: string;
}

const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app';
const CLAIM_HTTP_URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/claimWaitlistPremiumHttp`;
const REQUEST_CODE_HTTP_URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/requestWaitlistCodeHttp`;

type ClaimHttpBody = {
  result?: WaitlistClaimResponse;
  error?: { message?: string; status?: string };
};

type RequestCodeHttpBody = {
  result?: WaitlistCodeRequestResponse;
  error?: { message?: string; status?: string };
};

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeClaimToken(raw: string): string {
  return raw.trim().replace(/[\s-]+/g, '').toUpperCase();
}

function currentAccountUid(): string | null {
  const user = auth?.currentUser;
  if (!user || user.isAnonymous) return null;
  return user.uid;
}

export function friendlyWaitlistClaimError(e: unknown): string {
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : '';
  if (message.includes('expired')) return 'This claim code has expired.';
  if (message.includes('inactive')) return 'This claim code is currently inactive.';
  if (message.includes('already_subscribed')) {
    return 'This account already has Premium. The waitlist code was not consumed.';
  }
  if (message.includes('already_used')) {
    return 'This account already used a waitlist free week.';
  }
  if (message.includes('already_claimed')) return 'This claim code was already used.';
  if (message.includes('invalid_token')) return 'That claim code is not valid.';
  if (message.includes('401') || message.toLowerCase().includes('sign in')) {
    return 'Sign in again, then try claiming your free week.';
  }
  if (message) return message;
  return 'Could not reach the claim service. Please try again.';
}

export function friendlyWaitlistCodeRequestError(e: unknown): string {
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : '';
  if (message.includes('invalid_email')) return 'Enter a valid waitlist email address.';
  if (message.includes('server_error')) {
    return 'Could not send your code right now. Please try again in a moment.';
  }
  if (message) return message;
  return 'Could not send your code yet. Please try again.';
}

/** Drop cached waitlist week + pending token (e.g. on sign-out). */
export async function clearWaitlistCache(): Promise<void> {
  const { removeItem } = await import('./storage');
  await Promise.all([
    removeItem(TRIAL_ENDS_KEY),
    removeItem(TRIAL_EMAIL_KEY),
    removeItem(TRIAL_UID_KEY),
    removeItem(TRIAL_TOKEN_KEY),
  ]);
}

export async function setPendingWaitlistToken(token: string): Promise<void> {
  const clean = normalizeClaimToken(token);
  if (!clean) return;
  const { setItem } = await import('./storage');
  await setItem(TRIAL_TOKEN_KEY, clean);
}

async function takePendingWaitlistToken(): Promise<string | null> {
  const { getItem, removeItem } = await import('./storage');
  const raw = await getItem(TRIAL_TOKEN_KEY);
  const clean = normalizeClaimToken(raw ?? '');
  await removeItem(TRIAL_TOKEN_KEY);
  return clean || null;
}

async function cacheWaitlistGrant(
  premiumUntil: string,
  waitlistEmail: string | null,
  uid?: string | null,
): Promise<void> {
  const owner = uid ?? currentAccountUid();
  if (!owner) return;
  const { setItem } = await import('./storage');
  await setItem(TRIAL_ENDS_KEY, premiumUntil);
  await setItem(TRIAL_EMAIL_KEY, waitlistEmail ?? '');
  await setItem(TRIAL_UID_KEY, owner);
}

async function getLocalWaitlistForCurrentUser(): Promise<{
  premiumUntil: string | null;
  waitlistEmail: string | null;
} | null> {
  const uid = currentAccountUid();
  if (!uid) return null;
  const { getItem } = await import('./storage');
  const [premiumUntil, waitlistEmail, cachedUid] = await Promise.all([
    getItem(TRIAL_ENDS_KEY),
    getItem(TRIAL_EMAIL_KEY),
    getItem(TRIAL_UID_KEY),
  ]);
  if (cachedUid !== uid) return null;
  if (!premiumUntil || Date.parse(premiumUntil) <= Date.now()) return null;
  return {
    premiumUntil,
    waitlistEmail: waitlistEmail || null,
  };
}

export async function getWaitlistTrialEnds(): Promise<string | null> {
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
    const [rootSnap, entSnap] = await Promise.all([
      fsApi.getDoc(fsApi.doc(db, 'users', uid)),
      fsApi.getDoc(fsApi.doc(db, 'users', uid, 'entitlements', 'waitlist')),
    ]);
    const root = rootSnap.exists() ? rootSnap.data() : {};
    const ent = entSnap.exists() ? entSnap.data() : {};
    const data = { ...root, ...ent } as {
      premiumUntil?: string;
      waitlistEmail?: string;
    };
    const premiumUntil =
      typeof data.premiumUntil === 'string' && Date.parse(data.premiumUntil) > Date.now()
        ? data.premiumUntil
        : null;
    const waitlistEmail = typeof data.waitlistEmail === 'string'
      ? normalizeEmail(data.waitlistEmail)
      : null;
    if (premiumUntil) {
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

async function callClaimWaitlist(payload: {
  claimToken?: string;
  waitlistEmail?: string;
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
      const fn = functionsApi.httpsCallable(functions, 'claimWaitlistPremium');
      const res = await fn(payload);
      return res.data as WaitlistClaimResponse;
    }
    throw httpErr;
  }
}

async function applyClaimResult(result: WaitlistClaimResponse): Promise<boolean> {
  if (
    result.ok &&
    (result.status === 'granted' || result.status === 'already_active') &&
    result.premiumUntil
  ) {
    await cacheWaitlistGrant(result.premiumUntil, result.waitlistEmail ?? null);
    await refreshUserTraits({ tier: 'premium', waitlist_week: true });
    if (result.status === 'granted') {
      track('waitlist_premium_week_granted', { days: 7, via: 'token', token: result.token });
    }
    return result.status === 'granted';
  }
  return false;
}

/** Legacy no-op: waitlist grants are token-based now. */
export async function applyWaitlistPremium(_email: string): Promise<boolean> {
  return false;
}

/** Token claim is the only entitlement-granting path. */
export async function claimWaitlistByToken(claimToken: string): Promise<WaitlistClaimResponse> {
  const clean = normalizeClaimToken(claimToken);
  if (!clean) {
    return {
      ok: false,
      status: 'invalid_token',
      premiumUntil: null,
      waitlistEmail: null,
      token: null,
      message: 'Enter your claim code.',
    };
  }
  const result = await callClaimWaitlist({ claimToken: clean });
  await applyClaimResult(result);
  if (result.status === 'granted') {
    track('waitlist_claim_manual', { method: 'token' });
  }
  return result;
}

/** Route A auto-match: claim using waitlist email through the same endpoint/transaction. */
export async function claimWaitlistByEmail(waitlistEmail: string): Promise<WaitlistClaimResponse> {
  const clean = normalizeEmail(waitlistEmail);
  if (!clean) {
    return {
      ok: false,
      status: 'invalid_email',
      premiumUntil: null,
      waitlistEmail: null,
      token: null,
      message: 'Enter a valid waitlist email address.',
    };
  }
  const result = await callClaimWaitlist({ waitlistEmail: clean });
  await applyClaimResult(result);
  if (result.status === 'granted') {
    track('waitlist_claim_auto', { method: 'email' });
  }
  return result;
}

/** Claim any pending token captured from a deep link. */
export async function claimPendingWaitlistToken(): Promise<WaitlistClaimResponse | null> {
  const token = await takePendingWaitlistToken();
  if (!token) return null;
  return claimWaitlistByToken(token);
}

/**
 * Waitlist fallback: request the existing claim code for a waitlist email.
 * Response is intentionally generic for unknown emails.
 */
export async function requestWaitlistCodeByEmail(
  waitlistEmail: string,
): Promise<WaitlistCodeRequestResponse> {
  const clean = normalizeEmail(waitlistEmail);
  if (!clean) {
    return {
      ok: false,
      status: 'invalid_email',
      message: 'Enter a valid waitlist email address.',
    };
  }
  const res = await fetch(REQUEST_CODE_HTTP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { waitlistEmail: clean } }),
  });
  const raw = await res.text();
  let json: RequestCodeHttpBody | null = null;
  try {
    json = raw ? (JSON.parse(raw) as RequestCodeHttpBody) : null;
  } catch {
    if (res.status === 500) {
      throw new Error('waitlist/server_error');
    }
    throw new Error(`waitlist/bad-json http/${res.status}`);
  }
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message || `waitlist/http/${res.status}`);
  }
  if (!json?.result) throw new Error('waitlist/empty');
  track('waitlist_code_requested', { status: json.result.status });
  return json.result;
}
