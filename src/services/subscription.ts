/**
 * Soft Premium entitlement until RevenueCat is wired.
 *
 * Flip `driveiq.pro.unlock` in AsyncStorage (or set EXPO_PUBLIC_PRO_PREVIEW=1)
 * to exercise gated features during Play Store review / TestFlight.
 */

import { showDialog } from './dialog';
import { getItem, setItem } from './storage';
import { refreshUserTraits, track } from './analytics';
import { getWaitlistTrialEnds, waitlistTrialActive } from './waitlist';
import { auth, db, fsApi } from './firebase';

const UNLOCK_KEY = 'driveiq.pro.unlock';

export async function hasProAccess(): Promise<boolean> {
  if (process.env.EXPO_PUBLIC_PRO_PREVIEW === '1') return true;
  const v = await getItem(UNLOCK_KEY);
  if (v === '1') return true;
  return waitlistTrialActive();
}

/** Dev / review helper — not shown in production UI yet. */
export async function setProAccessForTesting(on: boolean): Promise<void> {
  await setItem(UNLOCK_KEY, on ? '1' : '0');
  await refreshUserTraits({ tier: on ? 'premium' : 'free' });
  track('pro_access_toggled_for_testing', { enabled: on });
  await syncPremiumEntitlement();
}

/**
 * Write the current local entitlement to Firestore so the Cloud Function
 * agent uses the same Free/Premium window as the app.
 */
export async function syncPremiumEntitlement(): Promise<void> {
  const uid = auth?.currentUser?.uid;
  if (!uid || !db || !fsApi) return;
  try {
    const pro = await hasProAccess();
    const trialEnds = await getWaitlistTrialEnds();
    const patch: Record<string, unknown> = {
      tier: pro ? 'premium' : 'free',
      entitlement: pro ? 'premium' : 'free',
      updatedAt: new Date().toISOString(),
    };
    if (pro && trialEnds) patch.premiumUntil = trialEnds;
    await fsApi.setDoc(fsApi.doc(db, 'users', uid), patch, { merge: true });
  } catch (e) {
    console.warn('[subscription] entitlement sync failed', e);
  }
}

export interface PaywallOptions {
  source?: string;
  inline?: boolean;
}

export function showPremiumPaywall(feature: string, opts?: PaywallOptions): void {
  track('paywall_viewed', { trigger: feature, source: opts?.source });
  if (opts?.inline) {
    track('inline_upgrade_taken', { feature, source: opts?.source });
  }
  showDialog(
    'DriveIQ Premium',
    `${feature} is part of DriveIQ Premium. Subscriptions are not live in stores yet. This is a preview of what is coming.`,
    [
      { label: 'Not now', style: 'cancel' },
      {
        label: 'See Premium',
        onPress: () => {
          track('paywall_cta_tapped', { feature, source: opts?.source ?? 'dialog' });
        },
      },
    ],
  );
}

/** @deprecated Use showPremiumPaywall */
export const showProPaywall = showPremiumPaywall;
