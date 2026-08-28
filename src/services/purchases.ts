/**
 * RevenueCat Purchases SDK wrapper for DriveIQ Premium.
 *
 * Project: DriveIQ
 *   Entitlement: premium
 *   Offering:    default (Current)
 *   Packages:    $rc_annual → driveiq_premium_annual (£49.99/yr)
 *                $rc_monthly → driveiq_premium_monthly (£6.99/mo)
 *   Trial:       7-day intro on both products
 *   Paywall:     published in RevenueCat, attached to `default`
 *
 * Requires a development / TestFlight / Play build — Expo Go mocks purchases.
 */

import { Platform } from 'react-native';

import { track } from './analytics';
import {
  DEFAULT_PREMIUM_ENTITLEMENT_ID,
  hasActivePremiumEntitlement,
} from './premiumEntitlement';

export const PREMIUM_ENTITLEMENT_ID =
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim() ||
  DEFAULT_PREMIUM_ENTITLEMENT_ID;

/** Must match RevenueCat offering identifier (Current = `default`). */
export const PREMIUM_OFFERING_ID =
  process.env.EXPO_PUBLIC_REVENUECAT_OFFERING_ID?.trim() || 'default';

export const PACKAGE_ANNUAL_ID = '$rc_annual';
export const PACKAGE_MONTHLY_ID = '$rc_monthly';

const IOS_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim() ||
  'appl_pmTJlOhMDIDEwjpAFQwYdASWQFt';

const ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() || '';

type PurchasesModule = typeof import('react-native-purchases');
type CustomerInfo = import('react-native-purchases').CustomerInfo;
type PurchasesPackage = import('react-native-purchases').PurchasesPackage;
type PurchasesOffering = import('react-native-purchases').PurchasesOffering;

let Purchases: PurchasesModule['default'] | null = null;
let configured = false;
let nativeUnavailableLogged = false;
let lastCustomerInfo: CustomerInfo | null = null;
let cachedOffering: PurchasesOffering | null = null;
let offeringsPrefetch: Promise<PurchasesOffering | null> | null = null;
const listeners = new Set<(pro: boolean) => void>();

/** True when the RNPurchases native module is compiled into this binary. */
export function isPurchasesNativeAvailable(): boolean {
  try {
    const { NativeModules } = require('react-native') as typeof import('react-native');
    return Boolean(NativeModules.RNPurchases);
  } catch {
    return false;
  }
}

export function purchasesUnavailableMessage(): string {
  return 'In-app purchases need a development or store build (EAS / TestFlight / Play). They do not work in Expo Go — rebuild the app with native modules included.';
}

function loadPurchases(): PurchasesModule['default'] | null {
  if (Purchases) return Purchases;
  if (!isPurchasesNativeAvailable()) {
    if (!nativeUnavailableLogged) {
      nativeUnavailableLogged = true;
      console.warn('[purchases] RNPurchases native module not in this build', purchasesUnavailableMessage());
    }
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases') as PurchasesModule;
    Purchases = mod.default ?? null;
    return Purchases;
  } catch (e) {
    console.warn('[purchases] SDK unavailable', e);
    return null;
  }
}

function apiKeyForPlatform(): string | null {
  if (Platform.OS === 'ios') return IOS_API_KEY || null;
  if (Platform.OS === 'android') return ANDROID_API_KEY || null;
  return null;
}

function emitPremium(pro: boolean): void {
  for (const l of listeners) {
    try {
      l(pro);
    } catch {
      /* ignore */
    }
  }
}

export function subscribePremiumChanges(listener: (pro: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isPurchasesConfigured(): boolean {
  return configured;
}

export async function configurePurchases(): Promise<boolean> {
  if (configured) return true;
  const P = loadPurchases();
  if (!P) return false;

  const apiKey = apiKeyForPlatform();
  if (!apiKey) {
    console.warn(
      `[purchases] No RevenueCat API key for ${Platform.OS}. Set EXPO_PUBLIC_REVENUECAT_${Platform.OS === 'ios' ? 'IOS' : 'ANDROID'}_API_KEY.`,
    );
    return false;
  }

  try {
    if (__DEV__ && typeof P.setLogLevel === 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { LOG_LEVEL } = require('react-native-purchases') as PurchasesModule;
        P.setLogLevel(LOG_LEVEL.DEBUG);
      } catch {
        /* non-fatal in dev */
      }
    }
    P.configure({ apiKey });
    configured = true;
    track('purchases_configured', { platform: Platform.OS });

    P.addCustomerInfoUpdateListener((info) => {
      lastCustomerInfo = info;
      emitPremium(hasPremiumEntitlement(info));
    });

    lastCustomerInfo = await P.getCustomerInfo();
    emitPremium(hasPremiumEntitlement(lastCustomerInfo));
    // Warm offerings + StoreKit products so the paywall opens instantly.
    void prefetchOfferings();
    return true;
  } catch (e) {
    Purchases = null;
    configured = false;
    console.warn('[purchases] configure failed', e);
    track('purchases_configure_failed');
    return false;
  }
}

export function hasPremiumEntitlement(info: CustomerInfo | null | undefined): boolean {
  return hasActivePremiumEntitlement(
    info?.entitlements?.active as Record<string, unknown> | undefined,
    PREMIUM_ENTITLEMENT_ID,
  );
}

export async function getCustomerInfo(force = false): Promise<CustomerInfo | null> {
  const P = loadPurchases();
  if (!P || !configured) return lastCustomerInfo;
  if (!force && lastCustomerInfo) return lastCustomerInfo;
  try {
    lastCustomerInfo = await P.getCustomerInfo();
    emitPremium(hasPremiumEntitlement(lastCustomerInfo));
    return lastCustomerInfo;
  } catch (e) {
    console.warn('[purchases] getCustomerInfo failed', e);
    return lastCustomerInfo;
  }
}

export async function hasRevenueCatPremium(): Promise<boolean> {
  if (!configured) return false;
  const info = await getCustomerInfo(true);
  return hasPremiumEntitlement(info);
}

/**
 * Link Firebase uid as the RevenueCat app user ID (anonymous or full account).
 * Always call logIn — never logOut — so anonymous→identified upgrades keep
 * the same customer record and subscriptions survive reinstall + restore.
 */
export async function identifyPurchasesUser(uid: string | null | undefined): Promise<void> {
  const P = loadPurchases();
  if (!P || !configured || !uid) return;
  try {
    const { customerInfo } = await P.logIn(uid);
    lastCustomerInfo = customerInfo;
    emitPremium(hasPremiumEntitlement(customerInfo));
    track('purchases_user_identified');
    // Offerings are per-subscriber; refresh after identity settles.
    void prefetchOfferings(true);
  } catch (e) {
    console.warn('[purchases] identify failed', e);
  }
}

function pickOffering(
  offerings: import('react-native-purchases').PurchasesOfferings,
): PurchasesOffering | null {
  return (
    offerings.current ??
    offerings.all[PREMIUM_OFFERING_ID] ??
    offerings.all[Object.keys(offerings.all)[0]] ??
    null
  );
}

/**
 * Fetch and cache the Current offering (and StoreKit product metadata).
 * Safe to call repeatedly — in-flight requests are coalesced.
 */
export async function prefetchOfferings(force = false): Promise<PurchasesOffering | null> {
  const P = loadPurchases();
  if (!P || !configured) return cachedOffering;
  if (offeringsPrefetch) return offeringsPrefetch;
  if (!force && cachedOffering) return cachedOffering;

  offeringsPrefetch = (async () => {
    try {
      const offerings = await P.getOfferings();
      cachedOffering = pickOffering(offerings);
      track('purchases_offerings_prefetched', {
        packages: cachedOffering?.availablePackages?.length ?? 0,
      });
      return cachedOffering;
    } catch (e) {
      console.warn('[purchases] prefetchOfferings failed', e);
      return cachedOffering;
    } finally {
      offeringsPrefetch = null;
    }
  })();

  return offeringsPrefetch;
}

/** Sync peek at packages warmed at launch — no network. */
export function getCachedPremiumPackages(): PurchasesPackage[] {
  return sortPremiumPackages(cachedOffering?.availablePackages ?? []);
}

/** Prefer Current offering, then explicit `default`. Uses launch cache first. */
export async function getCurrentOffering(force = false): Promise<PurchasesOffering | null> {
  if (!force && cachedOffering) return cachedOffering;
  return prefetchOfferings(force);
}

/** Order: annual, monthly, then anything else. */
export function sortPremiumPackages(pkgs: PurchasesPackage[]): PurchasesPackage[] {
  const rank = (p: PurchasesPackage): number => {
    if (p.identifier === PACKAGE_ANNUAL_ID || p.packageType === 'ANNUAL') return 0;
    if (p.identifier === PACKAGE_MONTHLY_ID || p.packageType === 'MONTHLY') return 1;
    return 2;
  };
  return [...pkgs].sort((a, b) => rank(a) - rank(b));
}

export function preferredPremiumPackage(
  pkgs: PurchasesPackage[],
): PurchasesPackage | undefined {
  const ordered = sortPremiumPackages(pkgs);
  return (
    ordered.find((p) => p.identifier === PACKAGE_ANNUAL_ID) ??
    ordered.find((p) => p.packageType === 'ANNUAL') ??
    ordered.find((p) => p.identifier === PACKAGE_MONTHLY_ID) ??
    ordered.find((p) => p.packageType === 'MONTHLY') ??
    ordered[0]
  );
}

export function packageHasFreeTrial(pkg: PurchasesPackage): boolean {
  const intro = pkg.product.introPrice;
  if (!intro) return false;
  return intro.price === 0;
}

export function packageTrialLabel(pkg: PurchasesPackage): string | null {
  if (!packageHasFreeTrial(pkg)) return null;
  const intro = pkg.product.introPrice;
  const units = intro?.periodNumberOfUnits;
  const unit = String(intro?.periodUnit ?? 'DAY').toUpperCase();
  if (units === 7 || unit.includes('DAY')) return '7-day free trial';
  if (units) return `${units}-day free trial`;
  return '7-day free trial';
}

export type PurchaseResult =
  | { ok: true; customerInfo: CustomerInfo }
  | { ok: false; cancelled: boolean; message: string };

export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<PurchaseResult> {
  const P = loadPurchases();
  if (!P || !configured) {
    return { ok: false, cancelled: false, message: 'Purchases are not available in this build.' };
  }
  try {
    const { customerInfo } = await P.purchasePackage(pkg);
    lastCustomerInfo = customerInfo;
    const pro = hasPremiumEntitlement(customerInfo);
    emitPremium(pro);
    track('purchase_succeeded', {
      product_id: pkg.product.identifier,
      package_id: pkg.identifier,
      premium: pro,
    });
    return { ok: true, customerInfo };
  } catch (e: unknown) {
    const err = e as { userCancelled?: boolean; message?: string; code?: number };
    if (err?.userCancelled) {
      track('purchase_cancelled');
      return { ok: false, cancelled: true, message: 'Purchase cancelled.' };
    }
    const message = err?.message ?? 'Purchase failed. Please try again.';
    track('purchase_failed', { message: message.slice(0, 120) });
    return { ok: false, cancelled: false, message };
  }
}

export async function restorePurchases(): Promise<PurchaseResult> {
  const P = loadPurchases();
  if (!P || !configured) {
    return { ok: false, cancelled: false, message: 'Purchases are not available in this build.' };
  }
  try {
    const customerInfo = await P.restorePurchases();
    lastCustomerInfo = customerInfo;
    const pro = hasPremiumEntitlement(customerInfo);
    emitPremium(pro);
    track('purchase_restored', { premium: pro });
    if (!pro) {
      return {
        ok: false,
        cancelled: false,
        message: 'No active Premium subscription found for this Apple / Google account.',
      };
    }
    return { ok: true, customerInfo };
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : 'Could not restore purchases. Please try again.';
    track('purchase_restore_failed');
    return { ok: false, cancelled: false, message };
  }
}

/**
 * Present the published RevenueCat paywall on offering `default`.
 * Uses the dashboard paywall only — no custom in-app purchase UI.
 */
export async function presentRevenueCatPaywall(): Promise<
  'purchased' | 'restored' | 'cancelled' | 'unavailable'
> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const UI = require('react-native-purchases-ui') as typeof import('react-native-purchases-ui');
    const RevenueCatUI = UI.default;
    const { PAYWALL_RESULT } = UI;
    if (!configured || !RevenueCatUI?.presentPaywall) return 'unavailable';

    const offering = await getCurrentOffering();
    const result = await RevenueCatUI.presentPaywall({
      displayCloseButton: true,
      offering: offering ?? undefined,
    });
    await getCustomerInfo(true);

    if (result === PAYWALL_RESULT.PURCHASED) return 'purchased';
    if (result === PAYWALL_RESULT.RESTORED) return 'restored';
    if (result === PAYWALL_RESULT.NOT_PRESENTED) {
      if (await hasRevenueCatPremium()) return 'purchased';
      return 'unavailable';
    }
    return 'cancelled';
  } catch (e) {
    console.warn('[purchases] presentPaywall failed', e);
    return 'unavailable';
  }
}

export function packagePriceLabel(pkg: PurchasesPackage): string {
  return pkg.product.priceString;
}

export function packagePeriodLabel(pkg: PurchasesPackage): string {
  if (pkg.identifier === PACKAGE_ANNUAL_ID || pkg.packageType === 'ANNUAL') {
    return 'per year';
  }
  if (pkg.identifier === PACKAGE_MONTHLY_ID || pkg.packageType === 'MONTHLY') {
    return 'per month';
  }
  const id = `${pkg.packageType} ${pkg.identifier} ${pkg.product.subscriptionPeriod ?? ''}`.toLowerCase();
  if (id.includes('annual') || id.includes('year')) return 'per year';
  if (id.includes('month')) return 'per month';
  if (id.includes('week') || pkg.packageType === 'WEEKLY') return 'per week';
  if (pkg.packageType === 'LIFETIME') return 'one-time';
  return pkg.product.subscriptionPeriod ? `every ${pkg.product.subscriptionPeriod}` : '';
}

export function packageDisplayTitle(pkg: PurchasesPackage): string {
  if (pkg.identifier === PACKAGE_ANNUAL_ID || pkg.packageType === 'ANNUAL') {
    return 'Annual';
  }
  if (pkg.identifier === PACKAGE_MONTHLY_ID || pkg.packageType === 'MONTHLY') {
    return 'Monthly';
  }
  return pkg.product.title || pkg.identifier;
}
