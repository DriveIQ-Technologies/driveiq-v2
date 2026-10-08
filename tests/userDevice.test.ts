import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every signed-in account records its platform, independent of push. Android
 * cannot register a push token yet, so before this the dashboard could not see
 * Android users at all.
 */

const setDocMock = vi.fn<(...args: unknown[]) => Promise<void>>();
const getDocMock = vi.fn<(...args: unknown[]) => Promise<{ exists: () => boolean }>>();
const currentUser: { uid: string; isAnonymous: boolean; email?: string | null } | null = {
  uid: 'uid-1',
  isAnonymous: false,
  email: 'ada@example.com',
};
const authMock = { currentUser };

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '6.3.8' } } }));
vi.mock('@/services/firebase', () => ({
  auth: authMock,
  db: {},
  fsApi: {
    doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
    setDoc: (...a: unknown[]) => setDocMock(...a),
    getDoc: (...a: unknown[]) => getDocMock(...a),
  },
}));

async function load() {
  vi.resetModules();
  return import('@/services/userDevice');
}

beforeEach(() => {
  setDocMock.mockReset().mockResolvedValue(undefined);
  getDocMock.mockReset().mockResolvedValue({ exists: () => false });
  authMock.currentUser = { uid: 'uid-1', isAnonymous: false, email: 'ada@example.com' };
});

describe('userDeviceFields', () => {
  it('reports platform, app version and last seen time', async () => {
    const { userDeviceFields } = await load();
    expect(userDeviceFields(new Date('2026-10-06T09:00:00.000Z'))).toEqual({
      platform: 'android',
      appVersion: '6.3.8',
      lastSeenAt: '2026-10-06T09:00:00.000Z',
    });
  });
});

describe('coarsePlace', () => {
  it('rounds to about a kilometre and rejects nonsense', async () => {
    const { coarsePlace } = await load();
    expect(coarsePlace(51.3762, -0.0981)).toEqual({ lat: 51.38, lng: -0.1 });
    expect(coarsePlace(Number.NaN, 0)).toBeNull();
  });
});

describe('recordInstall', () => {
  it('writes an install row for anonymous browse, with no account', async () => {
    authMock.currentUser = { uid: 'anon', isAnonymous: true, email: null };
    const { recordInstall } = await load();
    await recordInstall();
    const [path, data, opts] = setDocMock.mock.calls[0];
    expect(path).toBe('installs/anon');
    expect(data).toMatchObject({ platform: 'android', account: false, email: null });
    expect(typeof (data as { firstSeenAt: string }).firstSeenAt).toBe('string');
    expect(opts).toEqual({ merge: true });
  });

  it('does not move firstSeenAt once the row exists', async () => {
    getDocMock.mockResolvedValue({ exists: () => true });
    const { recordInstall } = await load();
    await recordInstall();
    const data = setDocMock.mock.calls[0][1] as Record<string, unknown>;
    expect(data.firstSeenAt).toBeUndefined();
    expect(data.account).toBe(true);
    expect(data.email).toBe('ada@example.com');
  });
});

describe('recordUserDevice', () => {
  it('merges the fields onto the signed-in user doc', async () => {
    const { recordUserDevice } = await load();
    await recordUserDevice();

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [path, data, opts] = setDocMock.mock.calls[0];
    expect(path).toBe('users/uid-1');
    expect(data).toMatchObject({ platform: 'android', appVersion: '6.3.8' });
    expect(typeof (data as { lastSeenAt: string }).lastSeenAt).toBe('string');
    // Merge, so fcmTokens / pushPlatform and everything else survive.
    expect(opts).toEqual({ merge: true });
  });

  it('writes once per account per app session', async () => {
    const { recordUserDevice } = await load();
    await recordUserDevice();
    await recordUserDevice();
    expect(setDocMock).toHaveBeenCalledTimes(1);

    authMock.currentUser = { uid: 'uid-2', isAnonymous: false };
    await recordUserDevice();
    expect(setDocMock).toHaveBeenCalledTimes(2);
  });

  it('skips anonymous browse sessions', async () => {
    authMock.currentUser = { uid: 'anon', isAnonymous: true };
    const { recordUserDevice } = await load();
    await recordUserDevice();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('never throws, and retries after a failed write', async () => {
    setDocMock.mockRejectedValueOnce(new Error('offline'));
    const { recordUserDevice } = await load();
    await expect(recordUserDevice()).resolves.toBeUndefined();
    await recordUserDevice();
    expect(setDocMock).toHaveBeenCalledTimes(2);
  });
});
