import { describe, expect, it } from 'vitest';

import { friendlyPurchaseError } from '@/services/premiumPurchaseFlow';

describe('friendlyPurchaseError', () => {
  it('maps missing subscription on restore', () => {
    expect(
      friendlyPurchaseError('No active Premium subscription found', 'restore'),
    ).toContain('No active Premium');
  });

  it('maps a hung App Store response', () => {
    expect(
      friendlyPurchaseError('The App Store did not respond. You have not been charged.', 'purchase'),
    ).toContain('did not respond');
  });
});
