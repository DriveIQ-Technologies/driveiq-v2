import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREMIUM_ENTITLEMENT_ID,
  hasActivePremiumEntitlement,
} from '@/services/premiumEntitlement';
import {
  PACKAGE_ANNUAL_ID,
  PACKAGE_MONTHLY_ID,
  packageMonthlyEquivalent,
  packagePriceLabel,
  type PricePackage,
} from '@/services/premiumPrices';

function pkg(partial: {
  identifier: string;
  packageType?: string;
  price: number;
  currencyCode: string;
  priceString?: string;
}): PricePackage {
  return {
    identifier: partial.identifier,
    packageType: partial.packageType,
    product: {
      price: partial.price,
      currencyCode: partial.currencyCode,
      priceString: partial.priceString ?? `${partial.currencyCode} ${partial.price}`,
    },
  };
}

describe('hasActivePremiumEntitlement', () => {
  it('detects configured entitlement id', () => {
    expect(
      hasActivePremiumEntitlement(
        { [DEFAULT_PREMIUM_ENTITLEMENT_ID]: {} },
        DEFAULT_PREMIUM_ENTITLEMENT_ID,
      ),
    ).toBe(true);
  });

  it('detects common aliases', () => {
    expect(hasActivePremiumEntitlement({ premium: {} })).toBe(true);
    expect(hasActivePremiumEntitlement({ pro: {} })).toBe(true);
  });

  it('rejects empty entitlements', () => {
    expect(hasActivePremiumEntitlement({})).toBe(false);
    expect(hasActivePremiumEntitlement(null)).toBe(false);
  });
});

describe('packagePriceLabel', () => {
  it('keeps RevenueCat GBP prices', () => {
    expect(
      packagePriceLabel(
        pkg({
          identifier: PACKAGE_MONTHLY_ID,
          packageType: 'MONTHLY',
          price: 6.99,
          currencyCode: 'GBP',
          priceString: '£6.99',
        }),
      ),
    ).toBe('£6.99');
    expect(
      packagePriceLabel(
        pkg({
          identifier: PACKAGE_ANNUAL_ID,
          packageType: 'ANNUAL',
          price: 49.99,
          currencyCode: 'GBP',
          priceString: '£49.99',
        }),
      ),
    ).toBe('£49.99');
  });

  it("shows the store's own price, never a dollar price relabelled as pounds", () => {
    // Seen on a US-store simulator: Apple said $49.99 and the paywall said
    // £49.99 — not what Apple's purchase sheet (or App Review) would show.
    expect(
      packagePriceLabel(
        pkg({
          identifier: PACKAGE_MONTHLY_ID,
          packageType: 'MONTHLY',
          price: 8.99,
          currencyCode: 'USD',
          priceString: '$8.99',
        }),
      ),
    ).toBe('$8.99');
    expect(
      packagePriceLabel(
        pkg({
          identifier: PACKAGE_ANNUAL_ID,
          packageType: 'ANNUAL',
          price: 64.99,
          currencyCode: 'EUR',
          priceString: '64,99 €',
        }),
      ),
    ).toBe('64,99 €');
  });

  it('formats the store price itself when no display string is given', () => {
    const p = pkg({ identifier: PACKAGE_MONTHLY_ID, packageType: 'MONTHLY', price: 8.99, currencyCode: 'USD' });
    p.product.priceString = null;
    expect(packagePriceLabel(p)).toBe('US$8.99');
  });

  it('falls back to the UK list price only when the store gives no price', () => {
    const p = pkg({ identifier: PACKAGE_ANNUAL_ID, packageType: 'ANNUAL', price: 0, currencyCode: '' });
    p.product.priceString = '';
    expect(packagePriceLabel(p)).toBe('£49.99');
  });

  it('gives the yearly plan a per-month figure in the store currency', () => {
    expect(
      packageMonthlyEquivalent(
        pkg({
          identifier: PACKAGE_ANNUAL_ID,
          packageType: 'ANNUAL',
          price: 49.99,
          currencyCode: 'GBP',
          priceString: '£49.99',
        }),
      ),
    ).toBe('£4.17');
    expect(
      packageMonthlyEquivalent(
        pkg({
          identifier: PACKAGE_ANNUAL_ID,
          packageType: 'ANNUAL',
          price: 59.99,
          currencyCode: 'USD',
          priceString: '$59.99',
        }),
      ),
    ).toBe('US$5.00');
    const withStoreString = pkg({ identifier: PACKAGE_ANNUAL_ID, packageType: 'ANNUAL', price: 59.99, currencyCode: 'USD' });
    withStoreString.product.pricePerMonthString = '$4.99';
    expect(packageMonthlyEquivalent(withStoreString)).toBe('$4.99');
    expect(
      packageMonthlyEquivalent(
        pkg({ identifier: PACKAGE_MONTHLY_ID, packageType: 'MONTHLY', price: 6.99, currencyCode: 'GBP' }),
      ),
    ).toBeNull();
  });
});
