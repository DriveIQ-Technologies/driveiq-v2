import { describe, expect, it } from 'vitest';

import { friendlyPurchaseError } from '@/services/premiumPurchaseFlow';

describe('friendlyPurchaseError', () => {
  it('maps missing subscription on restore', () => {
    expect(
      friendlyPurchaseError('No active Premium subscription found', 'restore'),
    ).toContain('No active Premium');
  });

  it('maps user cancel without throwing', () => {
    expect(friendlyPurchaseError('Purchase failed. Please try again.', 'purchase')).toContain(
      'not go through',
    );
  });
});
