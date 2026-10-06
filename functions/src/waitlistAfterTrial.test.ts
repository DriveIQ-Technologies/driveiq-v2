import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { handleClaimWaitlistPremium, waitlistGrantStartMs } from './waitlistClaim.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T12:00:00.000Z');

/** Just enough Firestore for one claim transaction. */
function fakeDb(seed: Record<string, Record<string, unknown>>) {
  const docs = new Map(Object.entries(seed).map(([k, v]) => [k, { ...v }]));
  const ref = (path: string) => ({ path });
  const snap = (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) });
  const tx = {
    get: async (r: { path: string }) => snap(r.path),
    set: (r: { path: string }, data: Record<string, unknown>) => {
      docs.set(r.path, { ...(docs.get(r.path) ?? {}), ...data });
    },
  };
  const db = { doc: ref, runTransaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { db: db as unknown as Firestore, docs };
}

const waitlisted = (user: Record<string, unknown>) =>
  fakeDb({
    'waitlist/ada@example.com': { claimToken: 'ABCD2345', email: 'ada@example.com' },
    'waitlistTokens/ABCD2345': {
      email: 'ada@example.com', active: true, premiumDays: 7, maxUses: 1, usedCount: 0,
      expiresAt: new Date(NOW + 30 * DAY).toISOString(),
    },
    'users/u1': user,
  });

describe('waitlistGrantStartMs', () => {
  it('starts now for someone with no store trial', () => {
    expect(waitlistGrantStartMs({}, NOW)).toBe(NOW);
    expect(waitlistGrantStartMs({ premiumStatus: 'active' }, NOW)).toBe(NOW);
  });

  it('starts at the end of a running or cancelled trial', () => {
    const end = new Date(NOW + 4 * DAY).toISOString();
    expect(waitlistGrantStartMs({ premiumStatus: 'trial', premiumTrialEndsAt: end }, NOW)).toBe(NOW + 4 * DAY);
    expect(waitlistGrantStartMs({ premiumStatus: 'cancelled', premiumTrialEndsAt: end }, NOW)).toBe(NOW + 4 * DAY);
  });

  it('starts now once the trial is over or the date is missing', () => {
    const past = new Date(NOW - DAY).toISOString();
    expect(waitlistGrantStartMs({ premiumStatus: 'trial', premiumTrialEndsAt: past }, NOW)).toBe(NOW);
    expect(waitlistGrantStartMs({ premiumStatus: 'trial' }, NOW)).toBe(NOW);
  });
});

describe('claiming the waitlist week during a store trial', () => {
  it('adds the week after the trial instead of overlapping it', async () => {
    const trialEnd = new Date(NOW + 3 * DAY).toISOString();
    const { db, docs } = waitlisted({ premiumStatus: 'trial', premiumTrialEndsAt: trialEnd });
    const r = await handleClaimWaitlistPremium({ db, uid: 'u1', waitlistEmail: 'ada@example.com', nowMs: NOW });

    expect(r.status).toBe('granted');
    expect(r.premiumUntil).toBe(new Date(NOW + 10 * DAY).toISOString());
    expect(r.message).toMatch(/after your trial/);
    expect(docs.get('users/u1')?.premiumUntil).toBe(r.premiumUntil);
    expect(docs.get('users/u1')?.waitlistStartsAt).toBe(trialEnd);
    expect(docs.get('users/u1/entitlements/waitlist')?.premiumUntil).toBe(r.premiumUntil);
    expect(docs.get('waitlistTokens/ABCD2345')?.claimedByUid).toBe('u1');
    // Store fields are left for RevenueCat to manage.
    expect(docs.get('users/u1')?.premiumStatus).toBe('trial');
  });

  it('still starts the week straight away without a trial', async () => {
    const { db } = waitlisted({});
    const r = await handleClaimWaitlistPremium({ db, uid: 'u1', waitlistEmail: 'ada@example.com', nowMs: NOW });
    expect(r.status).toBe('granted');
    expect(r.premiumUntil).toBe(new Date(NOW + 7 * DAY).toISOString());
  });

  it('does not grant twice', async () => {
    const trialEnd = new Date(NOW + 3 * DAY).toISOString();
    const { db } = waitlisted({ premiumStatus: 'trial', premiumTrialEndsAt: trialEnd });
    await handleClaimWaitlistPremium({ db, uid: 'u1', waitlistEmail: 'ada@example.com', nowMs: NOW });
    const again = await handleClaimWaitlistPremium({ db, uid: 'u1', waitlistEmail: 'ada@example.com', nowMs: NOW + DAY });
    expect(again.ok).toBe(true);
    expect(again.status).toBe('already_active');
  });
});
