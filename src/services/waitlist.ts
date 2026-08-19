/**
 * Waitlist → free Premium week (task 09).
 *
 * Waitlisters sign in with the email they joined on. If that email is on
 * the allowlist (Firestore `waitlist/{email}`, env, or the seed file) we
 * load a seven-day Premium entitlement. The week is granted once per
 * install. RevenueCat is not live yet, so this is a local + Firestore flag
 * that `hasProAccess()` already understands.
 */

import { WAITLIST_EMAILS } from '@/data/waitlistAllowlist';
import { track, refreshUserTraits } from './analytics';
import { db, fsApi } from './firebase';
import { getItem, setItem } from './storage';

const TRIAL_ENDS_KEY = 'driveiq.premium.trialEnds';
const TRIAL_EMAIL_KEY = 'driveiq.premium.trialEmail';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const envEmails = (): string[] =>
  (process.env.EXPO_PUBLIC_WAITLIST_EMAILS ?? '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);

export async function getWaitlistTrialEnds(): Promise<string | null> {
  const ends = await getItem(TRIAL_ENDS_KEY);
  return ends || null;
}

export async function waitlistTrialActive(): Promise<boolean> {
  const ends = await getWaitlistTrialEnds();
  if (!ends) return false;
  const t = Date.parse(ends);
  return Number.isFinite(t) && t > Date.now();
}

async function emailOnAllowlist(email: string): Promise<boolean> {
  const needle = email.trim().toLowerCase();
  if (!needle) return false;
  if (WAITLIST_EMAILS.includes(needle) || envEmails().includes(needle)) {
    return true;
  }
  if (!db || !fsApi) return false;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, 'waitlist', needle));
    return snap.exists();
  } catch (e) {
    console.warn('[waitlist] allowlist read failed', e);
    return false;
  }
}

/**
 * If `email` is a waitlister and this install has not used its week,
 * start the seven-day Premium trial. Returns true when a week was granted
 * just now.
 */
export async function applyWaitlistPremium(email: string): Promise<boolean> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return false;

  const already = await getItem(TRIAL_ENDS_KEY);
  if (already) {
    const t = Date.parse(already);
    if (Number.isFinite(t) && t > Date.now()) return false;
    // Week already used. Do not restart it on a later sign-in.
    if (Number.isFinite(t)) return false;
  }

  const allowed = await emailOnAllowlist(trimmed);
  if (!allowed) return false;

  const ends = new Date(Date.now() + WEEK_MS).toISOString();
  await setItem(TRIAL_ENDS_KEY, ends);
  await setItem(TRIAL_EMAIL_KEY, trimmed);
  await refreshUserTraits({ tier: 'premium', waitlist_week: true });
  track('waitlist_premium_week_granted', { days: 7 });
  return true;
}
