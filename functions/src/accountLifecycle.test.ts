import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleRegisterAccount,
  resolveAuthProvider,
  type RegisterAuthUser,
} from './accountLifecycle.js';

/** Minimal in-memory Firestore: one doc, merge writes, real transaction order. */
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

const appleUser: RegisterAuthUser = {
  uid: 'uid-1',
  email: 'Ada@Example.COM',
  displayName: 'Ada Lovelace',
  emailVerified: true,
  providerData: [{ providerId: 'apple.com' }],
};

const brevo = { apiKey: 'k', senderEmail: 'hello@driveiq.app', senderName: 'DriveIQ' };

type FetchArgs = [url: string, init?: { body?: string }];

function mockFetchOk() {
  const fetchMock = vi.fn(
    async (..._args: FetchArgs) => new Response('{}', { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolveAuthProvider', () => {
  it('maps Firebase provider ids to short names', () => {
    expect(resolveAuthProvider([{ providerId: 'apple.com' }])).toBe('apple');
    expect(resolveAuthProvider([{ providerId: 'google.com' }])).toBe('google');
    expect(resolveAuthProvider([{ providerId: 'password' }])).toBe('email');
  });

  it('is unknown for an anonymous session with no providers', () => {
    expect(resolveAuthProvider([])).toBe('unknown');
    expect(resolveAuthProvider(undefined)).toBe('unknown');
  });
});

describe('handleRegisterAccount', () => {
  it('writes the account fields a lifecycle job can query, lowercasing the email', async () => {
    mockFetchOk();
    const { db, store } = fakeDb();
    const res = await handleRegisterAccount({ db, user: appleUser, brevo, isNewAccount: true });

    expect(res.created).toBe(true);
    expect(res.authProvider).toBe('apple');
    expect(store.data?.email).toBe('ada@example.com');
    expect(store.data?.displayName).toBe('Ada Lovelace');
    expect(store.data?.authProvider).toBe('apple');
    expect(store.data?.emailVerified).toBe(true);
    expect(typeof store.data?.createdAt).toBe('string');
    expect(store.data?.marketingConsent).toBe(false);
  });

  it('skips entirely for an anonymous session with no email', async () => {
    const fetchMock = mockFetchOk();
    const { db, store } = fakeDb();
    const res = await handleRegisterAccount({
      db,
      user: { uid: 'uid-anon', email: null, providerData: [] },
      brevo,
      isNewAccount: true,
    });

    expect(res.welcomeSent).toBe(false);
    expect(store.data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the welcome exactly once for a new account', async () => {
    const fetchMock = mockFetchOk();
    const { db } = fakeDb();

    const first = await handleRegisterAccount({ db, user: appleUser, brevo, isNewAccount: true });
    expect(first.welcomeSent).toBe(true);

    const second = await handleRegisterAccount({ db, user: appleUser, brevo, isNewAccount: true });
    expect(second.welcomeSent).toBe(false);
    expect(second.created).toBe(false);

    const sends = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/smtp/email'));
    expect(sends).toHaveLength(1);
  });

  it('never welcomes an existing account, but still backfills its fields', async () => {
    const fetchMock = mockFetchOk();
    const { db, store } = fakeDb();

    const res = await handleRegisterAccount({ db, user: appleUser, brevo, isNewAccount: false });

    expect(res.welcomeSent).toBe(false);
    expect(store.data?.email).toBe('ada@example.com');
    expect(store.data?.welcomeEmailSentAt).toBeUndefined();
    const sends = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/smtp/email'));
    expect(sends).toHaveLength(0);
  });

  it('syncs the Brevo contact as transactional-only until consent is given', async () => {
    const fetchMock = mockFetchOk();
    const { db } = fakeDb();
    await handleRegisterAccount({ db, user: appleUser, brevo, isNewAccount: true });

    const contactCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/contacts'));
    expect(contactCall).toBeDefined();
    const body = JSON.parse(String(contactCall?.[1]?.body));
    expect(body.email).toBe('ada@example.com');
    expect(body.updateEnabled).toBe(true);
    expect(body.attributes.FIRSTNAME).toBe('Ada');
    expect(body.attributes.AUTH_PROVIDER).toBe('apple');
    expect(body.attributes.MARKETING_CONSENT).toBe(false);
    // No marketing list membership without consent.
    expect(body.listIds).toBeUndefined();
  });

  it('still writes fields and sends the welcome when the Brevo contact sync fails', async () => {
    const fetchMock = vi.fn(async (...args: FetchArgs) =>
      String(args[0]).endsWith('/contacts')
        ? new Response('boom', { status: 500 })
        : new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { db, store } = fakeDb();
    const res = await handleRegisterAccount({ db, user: appleUser, brevo, isNewAccount: true });

    expect(res.welcomeSent).toBe(true);
    expect(store.data?.email).toBe('ada@example.com');
  });

  it('releases the welcome reservation when the send fails, so a retry can send', async () => {
    const failing = vi.fn(async (...args: FetchArgs) =>
      String(args[0]).endsWith('/smtp/email')
        ? new Response('nope', { status: 500 })
        : new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', failing);

    const { db, store } = fakeDb();
    const first = await handleRegisterAccount({ db, user: appleUser, brevo, isNewAccount: true });
    expect(first.welcomeSent).toBe(false);
    expect(store.data?.welcomeEmailSentAt).toBeNull();

    const fetchMock = mockFetchOk();
    const retry = await handleRegisterAccount({ db, user: appleUser, brevo, isNewAccount: true });
    expect(retry.welcomeSent).toBe(true);
    const sends = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/smtp/email'));
    expect(sends).toHaveLength(1);
  });

  it('does not lose createdAt on a later call', async () => {
    mockFetchOk();
    const { db, store } = fakeDb();
    await handleRegisterAccount({
      db,
      user: appleUser,
      brevo,
      isNewAccount: true,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const created = store.data?.createdAt;

    await handleRegisterAccount({
      db,
      user: appleUser,
      brevo,
      isNewAccount: false,
      now: () => new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(store.data?.createdAt).toBe(created);
  });

  it('skips the welcome and keeps it sendable when Brevo is not configured', async () => {
    const fetchMock = mockFetchOk();
    const { db, store } = fakeDb();
    const res = await handleRegisterAccount({
      db,
      user: appleUser,
      brevo: {},
      isNewAccount: true,
    });

    expect(res.welcomeSent).toBe(false);
    expect(store.data?.welcomeEmailSentAt).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
