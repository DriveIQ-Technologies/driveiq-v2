/**
 * DriveIQ Premium entitlement + paywall.
 *
 * Sources of Premium (any one unlocks):
 *   1. RevenueCat active entitlement (`premium`)
 *   2. Waitlist free week
 *   3. EXPO_PUBLIC_PRO_PREVIEW=1 or local test unlock
 *
 * Paywall UI is in-app (branded sheet). Purchases still go through RevenueCat
 * packages on offering `default` ($rc_annual / $rc_monthly).
 */

import { showDialog } from './dialog';
import { getItem, setItem } from './storage';
import { refreshUserTraits, track } from './analytics';
import { getWaitlistTrialEnds, waitlistTrialActive } from './waitlist';
import { auth, db, fsApi } from './firebase';
import {
  configurePurchases,
  hasRevenueCatPremium,
  isPurchasesNativeAvailable,
  purchasesUnavailableMessage,
} from './purchases';

const UNLOCK_KEY = 'driveiq.pro.unlock';

type PaywallListener = (req: { feature: string; source?: string; inline?: boolean }) => void;
let paywallListener: PaywallListener | null = null;

/** PremiumPaywallHost registers here so services can open the sheet. */
export function registerPaywallHost(listener: PaywallListener | null): void {
  paywallListener = listener;
}

export type PremiumSource =
  | 'none'
  | 'revenuecat'
  | 'waitlist'
  | 'preview'
  | 'dev_unlock';

/** Which path unlocked Premium — for UI labels and debugging. */
export async function getPremiumSource(): Promise<PremiumSource> {
  if (process.env.EXPO_PUBLIC_PRO_PREVIEW === '1') return 'preview';
  const v = await getItem(UNLOCK_KEY);
  if (v === '1') return 'dev_unlock';
  if (await waitlistTrialActive()) return 'waitlist';
  try {
    if (await hasRevenueCatPremium()) return 'revenuecat';
  } catch {
    /* SDK may be unavailable in Expo Go */
  }
  return 'none';
}

export async function hasProAccess(): Promise<boolean> {
  return (await getPremiumSource()) !== 'none';
}

/** Dev / review helper — not shown in production UI. */
export async function setProAccessForTesting(on: boolean): Promise<void> {
  await setItem(UNLOCK_KEY, on ? '1' : '0');
  await refreshUserTraits({ tier: on ? 'premium' : 'free' });
  track('pro_access_toggled_for_testing', { enabled: on });
  await syncPremiumEntitlement();
}

/**
 * Write the current entitlement to Firestore so Cloud Functions use the
 * same Free/Premium window as the app.
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
    else if (!pro) patch.premiumUntil = null;
    await fsApi.setDoc(fsApi.doc(db, 'users', uid), patch, { merge: true });
    await refreshUserTraits({ tier: pro ? 'premium' : 'free' });
  } catch (e) {
    console.warn('[subscription] entitlement sync failed', e);
  }
}

export interface PaywallOptions {
  source?: string;
  inline?: boolean;
}

/**
 * Open the branded Premium paywall.
 * Inline upgrade bars are the trigger; this sheet is the destination.
 * Store purchases still use RevenueCat offerings / packages.
 */
export function showPremiumPaywall(feature: string, opts?: PaywallOptions): void {
  track('paywall_viewed', { trigger: feature, source: opts?.source });
  if (opts?.inline) {
    track('inline_upgrade_taken', { feature, source: opts?.source });
  }
  track('paywall_cta_tapped', { feature, source: opts?.source ?? 'dialog' });

  void (async () => {
    if (!isPurchasesNativeAvailable()) {
      showDialog('DriveIQ Premium', purchasesUnavailableMessage(), [{ label: 'OK' }]);
      return;
    }

    const ok = await configurePurchases();
    if (!ok) {
      showDialog(
        'DriveIQ Premium',
        'Could not connect to the store. Check your connection and try again, or use Restore Purchases if you already subscribed.',
        [{ label: 'OK' }],
      );
      return;
    }

    if (paywallListener) {
      paywallListener({ feature, source: opts?.source, inline: opts?.inline });
      return;
    }

    showDialog(
      'DriveIQ Premium',
      `${feature} is part of DriveIQ Premium. Open the menu and tap Upgrade to Premium, or Restore Purchases if you already subscribed.`,
      [{ label: 'OK' }],
    );
  })();
}

/** @deprecated Use showPremiumPaywall */
export const showProPaywall = showPremiumPaywall;
