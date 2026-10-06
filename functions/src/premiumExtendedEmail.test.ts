import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPremiumExtendedEmail,
  dueForExtendedEmail,
  handlePremiumExtendedEmails,
  weekAddedAfterTrial,
} from './premiumExtendedEmail.js';

const H = 60 * 60 * 1000;
const TRIAL_END = new Date('2026-10-12T17:40:00.000Z');
const UNTIL = new Date('2026-10-19T17:40:00.000Z');

describe('dueForExtendedEmail', () => {
  it('is due about three days out, from the daily run', () => {
    // Daily 09:00 London runs before a trial ending 12 Oct 18:40 BST.
    expect(dueForExtendedEmail(TRIAL_END, new Date('2026-10-08T08:00:00Z'))).toBe(false); // 105h
    expect(dueForExtendedEmail(TRIAL_END, new Date('2026-10-09T08:00:00Z'))).toBe(true); // 81h
  });

  it('still sends late, but not in the last 12 hours', () => {
    expect(dueForExtendedEmail(TRIAL_END, new Date(TRIAL_END.getTime() - 30 * H))).toBe(true);
    expect(dueForExtendedEmail(TRIAL_END, new Date(TRIAL_END.getTime() - 11 * H))).toBe(false);
    expect(dueForExtendedEmail(TRIAL_END, new Date(TRIAL_END.getTime() + H))).toBe(false);
  });
});

describe('weekAddedAfterTrial', () => {
  it('only matches a week that starts at the trial end', () => {
    expect(weekAddedAfterTrial({ premiumTrialEndsAt: TRIAL_END.toISOString(), waitlistStartsAt: TRIAL_END.toISOString() })).toBe(true);
    expect(weekAddedAfterTrial({ premiumTrialEndsAt: TRIAL_END.toISOString(), waitlistStartsAt: '2026-10-05T10:00:00Z' })).toBe(false);
    expect(weekAddedAfterTrial({ premiumTrialEndsAt: TRIAL_END.toISOString() })).toBe(false);
  });
});

describe('buildPremiumExtendedEmail', () => {
  it("fills the person's own dates and name", () => {
    const e = buildPremiumExtendedEmail({ firstName: 'naeem', trialEndsAt: TRIAL_END, premiumUntil: UNTIL });
    expect(e.html).toContain('is added, Naeem.');
    expect(e.html).toContain('<b style="color:#ffffff">19 October</b>');
    expect(e.html).toContain('BEFORE <!-- EDIT -->12 OCTOBER');
    expect(e.html).toContain('19 OCTOBER');
    expect(e.html).not.toMatch(/\{\{|\{%/);
    expect(e.text).toContain('Premium now stays on until 19 October.');
    expect(e.text).toContain('when it ends on 12 October');
  });

  it('reads cleanly without a name', () => {
    const e = buildPremiumExtendedEmail({ firstName: null, trialEndsAt: TRIAL_END, premiumUntil: UNTIL });
    expect(e.html).toContain('is added.');
    expect(e.html).not.toContain('added,');
  });
});

describe('handlePremiumExtendedEmails', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const users: Record<string, Record<string, unknown>> = {
      extended: {
        email: 'naeem@example.com', premiumStatus: 'trial', premiumTrialEndsAt: TRIAL_END.toISOString(),
        waitlistStartsAt: TRIAL_END.toISOString(), premiumUntil: UNTIL.toISOString(), waitlistToken: 'ABCD2345',
      },
      claimedFirst: {
        email: 'early@example.com', premiumStatus: 'trial', premiumTrialEndsAt: TRIAL_END.toISOString(),
        waitlistStartsAt: '2026-10-01T10:00:00Z', premiumUntil: '2026-10-08T10:00:00Z',
      },
      noWaitlist: { email: 'x@example.com', premiumStatus: 'trial', premiumTrialEndsAt: TRIAL_END.toISOString() },
    };
    const docRef = (id: string) => ({
      set: async (d: Record<string, unknown>) => { users[id] = { ...users[id], ...d }; },
    });
    const db = {
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => {
              const docs = Object.entries(users).map(([id, d]) => ({ id, ref: docRef(id), data: () => users[id] ?? d }));
              return { size: docs.length, docs };
            },
          }),
        }),
      }),
      doc: () => ({ get: async () => ({ get: (k: string) => (k === 'firstName' ? 'naeem' : undefined) }) }),
    } as unknown as Firestore;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    return { db, users, fetchMock };
  }
  const brevo = { apiKey: 'k', senderEmail: 'hello@driveiq.app', senderName: 'DriveIQ' };
  const due = () => new Date('2026-10-09T08:00:00Z');

  it('sends once, only to the waitlister whose week was added after the trial', async () => {
    const { db, users, fetchMock } = setup();
    const r = await handlePremiumExtendedEmails({ db, brevo, now: due });
    expect(r).toMatchObject({ due: 1, sent: 1 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.to).toEqual([{ email: 'naeem@example.com' }]);
    expect(body.subject).toBe('Your free waitlist week is added');
    expect(body.htmlContent).toContain('is added, Naeem.');
    expect(typeof users.extended.premiumExtendedEmailSentAt).toBe('string');

    const again = await handlePremiumExtendedEmails({ db, brevo, now: due });
    expect(again.sent).toBe(0);
  });

  it('test mode sends to the test addresses and marks nothing', async () => {
    const { db, users, fetchMock } = setup();
    const r = await handlePremiumExtendedEmails({ db, brevo, now: due, redirectTo: ['a@test.com', 'b@test.com'] });
    expect(r.sent).toBe(1);
    const to = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).to[0].email);
    expect(to).toEqual(['a@test.com', 'b@test.com']);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).subject).toMatch(/^\[TEST\]/);
    expect(users.extended.premiumExtendedEmailSentAt).toBeUndefined();
  });

  it('sends nothing too early', async () => {
    const { db, fetchMock } = setup();
    const r = await handlePremiumExtendedEmails({ db, brevo, now: () => new Date('2026-10-07T08:00:00Z') });
    expect(r.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
