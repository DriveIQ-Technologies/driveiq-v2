import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREMIUM_ENTITLEMENT_ID,
  hasActivePremiumEntitlement,
} from '@/services/premiumEntitlement';

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
