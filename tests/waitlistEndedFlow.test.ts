import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real trigger (presentWaitlistEndedIfDue) and the real waitlist reads,
 * against a fake phone store and a fake Firestore. The pure decision was
 * already tested, but the date it was given came from getWaitlistTrialEnds(),
 * which drops a week that has ended — so in the app the popup never showed.
 */

const store = new Map<string, string>();
const server: Record<string, Record<string, unknown>> = {};
let currentUser: { uid: string; isAnonymous: boolean } | null = null;
let premium: string = 'none';

vi.mock('@/services/storage', () => ({
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => void store.set(k, v),
  removeItem: async (k: string) => void store.delete(k),
}));
vi.mock('@/services/firebase', () => ({
  get auth() {
    return { currentUser };
  },
  db: {},
  functions: null,
  functionsApi: null,
  fsApi: {
    doc: (_db: unknown, ...path: string[]) => path.join('/'),
    getDoc: async (path: string) => ({
      exists: () => path in server,
      data: () => server[path],
    }),
  },
}));
vi.mock('@/services/subscription', () => ({
  getPremiumSource: async () => premium,
  invalidatePremiumSource: vi.fn(),
}));
vi.mock('@/services/analytics', () => ({ track: vi.fn(), refreshUserTraits: vi.fn() }));

const { presentWaitlistEndedIfDue, registerWaitlistEndedHost } = await import('@/services/waitlistEnded');

const DAY = 24 * 60 * 60 * 1000;
const endedYesterday = new Date(Date.now() - DAY).toISOString();

describe('waitlist week ended popup, end to end', () => {
  let shown: number;

  beforeEach(() => {
    store.clear();
    for (const k of Object.keys(server)) delete server[k];
    currentUser = { uid: 'donnie', isAnonymous: false };
    premium = 'none';
    shown = 0;
    registerWaitlistEndedHost(() => {
      shown += 1;
    });
  });

  it('shows when the week ended and the phone has no copy of it (reinstall / new phone)', async () => {
    server['users/donnie/entitlements/waitlist'] = { premiumUntil: endedYesterday };
    await presentWaitlistEndedIfDue();
    expect(shown).toBe(1);
  });

  it('shows when the ended week is still in the phone cache', async () => {
    store.set('driveiq.premium.trialEnds', endedYesterday);
    store.set('driveiq.premium.trialUid', 'donnie');
    await presentWaitlistEndedIfDue();
    expect(shown).toBe(1);
  });

  it('shows once only, however often the app is opened', async () => {
    server['users/donnie/entitlements/waitlist'] = { premiumUntil: endedYesterday };
    await presentWaitlistEndedIfDue();
    await presentWaitlistEndedIfDue();
    await presentWaitlistEndedIfDue();
    expect(shown).toBe(1);
  });

  it('does not show while the week is still running', async () => {
    server['users/donnie/entitlements/waitlist'] = {
      premiumUntil: new Date(Date.now() + DAY).toISOString(),
    };
    premium = 'waitlist';
    await presentWaitlistEndedIfDue();
    expect(shown).toBe(0);
  });

  it('does not show to someone who has since subscribed', async () => {
    server['users/donnie/entitlements/waitlist'] = { premiumUntil: endedYesterday };
    premium = 'revenuecat';
    await presentWaitlistEndedIfDue();
    expect(shown).toBe(0);
  });

  it('does not show when signed out, or for an account that never had a week', async () => {
    currentUser = null;
    await presentWaitlistEndedIfDue();
    currentUser = { uid: 'someone-else', isAnonymous: false };
    await presentWaitlistEndedIfDue();
    expect(shown).toBe(0);
  });

  it('follows the server when it ends a week the phone still thinks is running', async () => {
    store.set('driveiq.premium.trialEnds', new Date(Date.now() + 3 * DAY).toISOString());
    store.set('driveiq.premium.trialUid', 'donnie');
    server['users/donnie/entitlements/waitlist'] = { premiumUntil: endedYesterday };
    await presentWaitlistEndedIfDue();
    expect(shown).toBe(1);
  });

  it("ignores another account's cached week on a shared phone", async () => {
    store.set('driveiq.premium.trialEnds', endedYesterday);
    store.set('driveiq.premium.trialUid', 'previous-user');
    await presentWaitlistEndedIfDue();
    expect(shown).toBe(0);
  });
});
