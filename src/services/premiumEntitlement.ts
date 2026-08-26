/** Pure Premium entitlement check (no React Native imports — safe for Vitest). */

export const DEFAULT_PREMIUM_ENTITLEMENT_ID = 'premium';

export function hasActivePremiumEntitlement(
  active: Record<string, unknown> | null | undefined,
  entitlementId: string = DEFAULT_PREMIUM_ENTITLEMENT_ID,
): boolean {
  if (!active) return false;
  if (active[entitlementId]) return true;
  return Boolean(active.premium || active.Premium || active.pro || active.Pro);
}
