import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getPremiumSource() is read from the map screen, the sidebar, the flights
 * sheet, the station hub, AI quota and analytics — several on mount. Each read
 * used to run a native RevenueCat round trip, so opening the app fired a burst
 * of identical calls. These cover the cache that collapses that burst, and —
 * more importantly — that it can never serve a stale "not premium" to someone
 * who just subscribed or claimed a waitlist week.
 */

const revenueCatPremium = vi.fn<() => Promise<boolean>>();
const getItemMock = vi.fn<(key: string) => Promise<string | null>>();
const waitlistActiveMock = vi.fn<() => Promise<boolean>>();

const premiumListeners = new Set<() => void>();
function emitPremiumChange() {
  for (const l of premiumListeners) l();
}

vi.mock('@/services/purchases', () => ({
  configurePurchases: vi.fn(),
  hasRevenueCatPremium: () => revenueCatPremium(),
  isPurchasesNativeAvailable: () => true,
  purchasesUnavailableMessage: () => '',
  subscribePremiumChanges: (l: () => void) => {
    premiumListeners.add(l);
    return () => premiumListeners.delete(l);
  },
}));
vi.mock('@/services/storage', () => ({
  getItem: (k: string) => getItemMock(k),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));
vi.mock('@/services/waitlist', () => ({
  waitlistTrialActive: () => waitlistActiveMock(),
  getWaitlistTrialEnds: vi.fn(),
}));
vi.mock('@/services/analytics', () => ({ refreshUserTraits: vi.fn(), track: vi.fn() }));
vi.mock('@/services/firebase', () => ({ auth: null, db: null, fsApi: null }));
vi.mock('@/services/dialog', () => ({ showDialog: vi.fn() }));

async function load() {
  vi.resetModules();
  return import('@/services/subscription');
}

beforeEach(() => {
  premiumListeners.clear();
  revenueCatPremium.mockReset().mockResolvedValue(false);
  getItemMock.mockReset().mockResolvedValue(null);
  waitlistActiveMock.mockReset().mockResolvedValue(false);
});

describe('getPremiumSource caching', () => {
  it('collapses a concurrent burst into a single entitlement read', async () => {
    const { getPremiumSource } = await load();

    const results = await Promise.all(
      Array.from({ length: 16 }, () => getPremiumSource()),
    );

    expect(results.every((r) => r === 'none')).toBe(true);
    expect(revenueCatPremium).toHaveBeenCalledTimes(1);
  });

  it('serves sequential reads from cache inside the TTL', async () => {
    const { getPremiumSource } = await load();

    await getPremiumSource();
    await getPremiumSource();
    await getPremiumSource();

    expect(revenueCatPremium).toHaveBeenCalledTimes(1);
  });

  it('re-reads after invalidation so a new subscriber is never shown the paywall', async () => {
    const { getPremiumSource, invalidatePremiumSource } = await load();

    expect(await getPremiumSource()).toBe('none');
    expect(revenueCatPremium).toHaveBeenCalledTimes(1);

    // They subscribe: RevenueCat now reports the entitlement.
    revenueCatPremium.mockResolvedValue(true);

    // Without invalidation the cache would still say "none"...
    expect(await getPremiumSource()).toBe('none');

    invalidatePremiumSource();
    expect(await getPremiumSource()).toBe('revenuecat');
    expect(revenueCatPremium).toHaveBeenCalledTimes(2);
  });

  it('recovers from a premature false once RevenueCat finishes configuring', async () => {
    // The real regression: AirportFlightsSheet resolved entitlement at app
    // start, before configurePurchases() had run. hasRevenueCatPremium()
    // returns false when the SDK is not configured, so a paying user was
    // pinned to "free" and shown "Upgrade to Premium" on their flights board.
    const { getPremiumSource } = await load();

    revenueCatPremium.mockResolvedValue(false); // SDK not configured yet
    expect(await getPremiumSource()).toBe('none');

    // configurePurchases() completes and RevenueCat reports the entitlement.
    revenueCatPremium.mockResolvedValue(true);
    emitPremiumChange();

    expect(await getPremiumSource()).toBe('revenuecat');
  });

  it('does not cache across a failed read', async () => {
    const { getPremiumSource, invalidatePremiumSource } = await load();
    revenueCatPremium.mockRejectedValue(new Error('SDK unavailable'));

    expect(await getPremiumSource()).toBe('none');

    invalidatePremiumSource();
    revenueCatPremium.mockResolvedValue(true);
    expect(await getPremiumSource()).toBe('revenuecat');
  });
});
