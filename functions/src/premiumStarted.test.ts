import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleNotifyPremiumStarted } from './premiumStarted.js';

function fakeDb(initial: Record<string, unknown> | null = null) {
  const store: { data: Record<string, unknown> | null } = { data: initial };
  const ref = {
    get: async () => ({ data: () => store.data ?? undefined }),
    set: async (patch: Record<string, unknown>, opts?: { merge?: boolean }) => {
      store.data = opts?.merge ? { ...(store.data ?? {}), ...patch } : { ...patch };
    },
  };
  const db = {
    doc: () => ref,
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async () => ({ data: () => store.data ?? undefined }),
        set: (_r: unknown, patch: Record<string, unknown>, opts?: { merge?: boolean }) => {
          store.data = opts?.merge ? { ...(store.data ?? {}), ...patch } : { ...patch };
        },
      }),
  };
  return { db: db as never, store };
}

const user = { uid: 'uid-1', email: 'Ada@Example.COM', displayName: 'Ada Lovelace' };
const brevo = { apiKey: 'k', senderEmail: 'hello@driveiq.app', senderName: 'DriveIQ' };

afterEach(() => vi.unstubAllGlobals());

describe('handleNotifyPremiumStarted', () => {
  it('sends the annual trial welcome once', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { db, store } = fakeDb();

    const first = await handleNotifyPremiumStarted({
      db,
      user,
      brevo,
      plan: 'annual',
      trialStarted: true,
      now: () => new Date('2026-09-28T10:00:00.000Z'),
    });
    const second = await handleNotifyPremiumStarted({
      db,
      user,
      brevo,
      plan: 'annual',
      trialStarted: true,
    });

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(typeof store.data?.premiumWelcomeSentAt).toBe('string');
    expect(store.data?.premiumPlan).toBe('annual');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const posted = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      subject: string;
      htmlContent: string;
      to: Array<{ email: string }>;
    };
    expect(posted.to[0]?.email).toBe('ada@example.com');
    expect(posted.subject).toContain('Ada');
    expect(posted.htmlContent).toContain('Premium Annual');
  });

  it('sends the monthly trial welcome', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { db, store } = fakeDb();

    const res = await handleNotifyPremiumStarted({
      db,
      user,
      brevo,
      plan: 'monthly',
      trialStarted: true,
    });

    expect(res.sent).toBe(true);
    expect(store.data?.premiumPlan).toBe('monthly');
    const posted = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      htmlContent: string;
    };
    expect(posted.htmlContent).toContain('Premium Monthly');
    expect(posted.htmlContent).toContain('£6.99');
  });

  it('does not send for a paid-from-day-one subscribe', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { db } = fakeDb();

    const noTrial = await handleNotifyPremiumStarted({
      db,
      user,
      brevo,
      plan: 'annual',
      trialStarted: false,
    });

    expect(noTrial.sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('releases the reservation when Brevo is missing so a retry can send', async () => {
    const { db, store } = fakeDb();
    const res = await handleNotifyPremiumStarted({
      db,
      user,
      brevo: {},
      plan: 'annual',
      trialStarted: true,
    });
    expect(res.sent).toBe(false);
    expect(store.data?.premiumWelcomeSentAt).toBeNull();
  });
});
