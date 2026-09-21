import { afterEach, describe, expect, it, vi } from 'vitest';

import { chunkTokens, isExpoPushToken, sendPushToTokens } from './push.js';

/**
 * This module silently dropped every notification for months: it sent raw APNs
 * tokens to FCM, which rejected them, and the failure was caught and logged
 * where nobody looked. These tests pin the things that would let that recur —
 * that legacy tokens are recognised and skipped rather than sent, that a
 * non-ok response counts as failure rather than success, and that dead tokens
 * are reported back so callers can prune them.
 */

const EXPO_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const EXPO_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
/** What the old client stored on iOS: a raw APNs device token. */
const LEGACY_APNS = '74f9d1a0b3c84e2f9a1d5c7b3e8f0a2c4d6e8f0a1b2c3d4e5f6a7b8c9d0e1f2a';

function okTickets(n: number) {
  return { ok: true, json: async () => ({ data: Array.from({ length: n }, () => ({ status: 'ok' })) }) };
}

afterEach(() => vi.unstubAllGlobals());

describe('isExpoPushToken', () => {
  it('accepts Expo tokens and rejects the legacy APNs shape', () => {
    expect(isExpoPushToken(EXPO_A)).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[xyz]')).toBe(true);
    expect(isExpoPushToken(LEGACY_APNS)).toBe(false);
    expect(isExpoPushToken('')).toBe(false);
    expect(isExpoPushToken(undefined)).toBe(false);
  });
});

describe('chunkTokens', () => {
  it('never exceeds the Expo 100-per-request limit', () => {
    const many = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const chunks = chunkTokens(many);
    expect(chunks.length).toBe(3);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(100);
    expect(chunks.flat()).toEqual(many);
  });
});

describe('sendPushToTokens', () => {
  it('sends only Expo tokens and skips legacy ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okTickets(1));
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendPushToTokens([EXPO_A, LEGACY_APNS], { title: 'T', body: 'B' });

    expect(res.sent).toBe(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toHaveLength(1);
    expect(body[0].to).toBe(EXPO_A);
    expect(body[0].title).toBe('T');
  });

  it('does not call the network when nothing is sendable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendPushToTokens([LEGACY_APNS, ''], { title: 'T', body: 'B' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, failed: 0, invalidTokens: [] });
  });

  it('reports DeviceNotRegistered tokens so callers can prune them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { status: 'ok' },
          { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        ],
      }),
    }));

    const res = await sendPushToTokens([EXPO_A, EXPO_B], { title: 'T', body: 'B' });

    expect(res.sent).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.invalidTokens).toEqual([EXPO_B]);
  });

  it('counts a non-ok HTTP response as failure, not success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    const res = await sendPushToTokens([EXPO_A], { title: 'T', body: 'B' });
    expect(res).toMatchObject({ sent: 0, failed: 1 });
  });

  it('counts an empty ticket list as failure rather than silent success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
    const res = await sendPushToTokens([EXPO_A], { title: 'T', body: 'B' });
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(1);
  });

  it('survives a thrown network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const res = await sendPushToTokens([EXPO_A], { title: 'T', body: 'B' });
    expect(res).toMatchObject({ sent: 0, failed: 1 });
  });

  it('carries the data payload through for deep links', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okTickets(1));
    vi.stubGlobal('fetch', fetchMock);
    await sendPushToTokens([EXPO_A], {
      title: 'T', body: 'B', data: { kind: 'community-report', reportId: 'r1' },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body[0].data).toEqual({ kind: 'community-report', reportId: 'r1' });
  });
});
