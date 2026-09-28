/**
 * Paywall price display: always Apple's / Google's own price for the user's
 * store, in its currency, exactly as the purchase sheet will show it.
 *
 * This used to relabel a dollar price as pounds ("$49.99" shown as "£49.99")
 * so UK testers on a US sandbox saw the UK list price. But a US user, or an
 * App Review tester on the US store, then saw a price that didn't match what
 * they'd be charged — grounds for rejection. The GBP list below is only a
 * fallback for a store that returns no price at all.
 */

export const PACKAGE_ANNUAL_ID = '$rc_annual';
export const PACKAGE_MONTHLY_ID = '$rc_monthly';

export const PREMIUM_GBP = {
  monthly: 6.99,
  annual: 49.99,
} as const;

export type PricePackage = {
  identifier: string;
  packageType?: string;
  product: {
    price: number;
    currencyCode?: string | null;
    priceString?: string | null;
    /** RevenueCat's store-formatted monthly price, when it provides one. */
    pricePerMonthString?: string | null;
  };
};

export function isAnnualPackage(pkg: PricePackage): boolean {
  return pkg.identifier === PACKAGE_ANNUAL_ID || pkg.packageType === 'ANNUAL';
}

export function isMonthlyPackage(pkg: PricePackage): boolean {
  return pkg.identifier === PACKAGE_MONTHLY_ID || pkg.packageType === 'MONTHLY';
}

export function catalogueGbpAmount(pkg: PricePackage): number | null {
  if (isAnnualPackage(pkg)) return PREMIUM_GBP.annual;
  if (isMonthlyPackage(pkg)) return PREMIUM_GBP.monthly;
  return null;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : `${currency} `;
    return `${symbol}${amount.toFixed(2)}`;
  }
}

/** The store's own price for this plan, e.g. "£6.99" or "$9.99". */
export function packagePriceLabel(pkg: PricePackage): string {
  const raw = pkg.product.priceString?.trim() ?? '';
  if (raw) return raw;
  const storePrice = pkg.product.price;
  const storeCode = (pkg.product.currencyCode ?? '').toUpperCase();
  if (typeof storePrice === 'number' && storePrice > 0 && storeCode) {
    return formatMoney(storePrice, storeCode);
  }
  const catalogue = catalogueGbpAmount(pkg);
  return catalogue != null ? formatMoney(catalogue, 'GBP') : '';
}

/** Yearly plan as a per-month figure, in the store's currency. */
export function packageMonthlyEquivalent(pkg: PricePackage): string | null {
  if (!isAnnualPackage(pkg)) return null;
  const fromStore = pkg.product.pricePerMonthString?.trim();
  if (fromStore) return fromStore;
  const storePrice = pkg.product.price;
  const storeCode = (pkg.product.currencyCode ?? '').toUpperCase();
  if (typeof storePrice === 'number' && storePrice > 0 && storeCode) {
    return formatMoney(storePrice / 12, storeCode);
  }
  const catalogue = catalogueGbpAmount(pkg);
  return catalogue != null ? formatMoney(catalogue / 12, 'GBP') : null;
}
