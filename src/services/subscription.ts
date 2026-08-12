/**
 * Soft Premium entitlement until RevenueCat is wired.
 *
 * Flip `driveiq.pro.unlock` in AsyncStorage (or set EXPO_PUBLIC_PRO_PREVIEW=1)
 * to exercise gated features during Play Store review / TestFlight.
 */

import { Alert } from 'react-native';
import { getItem, setItem } from './storage';
import { refreshUserTraits, track } from './analytics';

const UNLOCK_KEY = 'driveiq.pro.unlock';

export async function hasProAccess(): Promise<boolean> {
  if (process.env.EXPO_PUBLIC_PRO_PREVIEW === '1') return true;
  const v = await getItem(UNLOCK_KEY);
  return v === '1';
}

/** Dev / review helper — not shown in production UI yet. */
export async function setProAccessForTesting(on: boolean): Promise<void> {
  await setItem(UNLOCK_KEY, on ? '1' : '0');
  await refreshUserTraits({ tier: on ? 'premium' : 'free' });
  track('pro_access_toggled_for_testing', { enabled: on });
}

export function showProPaywall(feature: string): void {
  track('paywall_viewed', { trigger: feature });
  Alert.alert(
    'DriveIQ Premium',
    `${feature} is part of DriveIQ Premium. Subscriptions are not live in stores yet. This is a preview of what is coming.`,
  );
}
