/**
 * Paywall price display. App Store Connect and RevenueCat list Premium in GBP
 * (£6.99 / month, £49.99 / year). StoreKit / TestFlight often return USD.
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

function storefrontLooksUk(storefront?: string | null): boolean {
  const code = (storefront ?? '').toUpperCase();
  return code === '' || code === 'GB' || code === 'GBR' || code === 'UK';
}

function storeLooksUsd(pkg: PricePackage): boolean {
  const code = (pkg.product.currencyCode ?? '').toUpperCase();
  const raw = pkg.product.priceString ?? '';
  return code === 'USD' || raw.includes('$') || /USD/i.test(raw);
}

/**
 * Show the UK list price in pounds when StoreKit reports dollars.
 */
export function packagePriceLabel(pkg: PricePackage, storefront?: string | null): string {
  const storePrice = pkg.product.price;
  const storeCode = (pkg.product.currencyCode ?? '').toUpperCase();
  const catalogue = catalogueGbpAmount(pkg);
  const hasStorePrice = typeof storePrice === 'number' && storePrice > 0;

  if (storeCode === 'GBP' && hasStorePrice) {
    return formatMoney(storePrice, 'GBP');
  }

  if (storeLooksUsd(pkg) || storefrontLooksUk(storefront)) {
    if (catalogue != null) return formatMoney(catalogue, 'GBP');
    if (hasStorePrice) return formatMoney(storePrice, 'GBP');
  }

  if (hasStorePrice && storeCode) {
    return formatMoney(storePrice, storeCode);
  }

  const raw = pkg.product.priceString?.trim() ?? '';
  if (raw) {
    return raw.replace(/\bUS\$/g, '£').replace(/\$/g, '£').replace(/\s*USD\s*$/i, '');
  }
  if (catalogue != null) return formatMoney(catalogue, 'GBP');
  return '';
}

export function packageMonthlyEquivalent(
  pkg: PricePackage,
  storefront?: string | null,
): string | null {
  if (!isAnnualPackage(pkg)) return null;
  const label = packagePriceLabel(pkg, storefront);
  const match = label.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  const yearly = match ? Number(match[1]) : catalogueGbpAmount(pkg);
  if (yearly == null || !(yearly > 0)) return null;
  return formatMoney(yearly / 12, 'GBP');
}
