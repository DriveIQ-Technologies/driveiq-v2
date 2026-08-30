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
        'GB',
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
        'GB',
      ),
    ).toBe('£49.99');
  });

  it('shows pound list prices when StoreKit reports dollars', () => {
    expect(
      packagePriceLabel(
        pkg({
          identifier: PACKAGE_MONTHLY_ID,
          packageType: 'MONTHLY',
          price: 6.99,
          currencyCode: 'USD',
          priceString: '$6.99',
        }),
        'USA',
      ),
    ).toBe('£6.99');
    expect(
      packagePriceLabel(
        pkg({
          identifier: PACKAGE_ANNUAL_ID,
          packageType: 'ANNUAL',
          price: 49.99,
          currencyCode: 'USD',
          priceString: '$49.99',
        }),
        null,
      ),
    ).toBe('£49.99');
  });

  it('uses the yearly list price for the monthly equivalent', () => {
    expect(
      packageMonthlyEquivalent(
        pkg({
          identifier: PACKAGE_ANNUAL_ID,
          packageType: 'ANNUAL',
          price: 49.99,
          currencyCode: 'USD',
          priceString: '$49.99',
        }),
      ),
    ).toBe('£4.17');
  });
});
