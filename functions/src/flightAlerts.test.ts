/**
 * Watched-flight alerts, through the real dispatcher: user doc with a watched
 * flight → latest airport board → push. In-memory Firestore; the push sender
 * is mocked so nothing is sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: { tokens: string[]; title: string; body: string; data: Record<string, string> }[] = [];

vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('./londonTime.js', () => ({ isQuietHours: () => false }));
vi.mock('./push.js', () => ({
  sendPushToTokens: async (
    tokens: string[],
    p: { title: string; body: string; data: Record<string, string> },
  ) => {
    sent.push({ tokens, ...p });
    return { sent: tokens.length, invalidTokens: [], failed: 0 };
  },
}));

import { dispatchPushNotifications } from './dispatch.js';
import type { CachedFlight } from './airports.js';

type Data = Record<string, unknown>;

function fakeDb(users: Record<string, Data>) {
  const store = new Map<string, Data>();
  for (const [uid, d] of Object.entries(users)) store.set(`users/${uid}`, d);
  const ref = (path: string) => ({
    id: path.split('/').pop()!,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (d: Data, o?: { merge?: boolean }) => {
      store.set(path, o?.merge ? { ...(store.get(path) ?? {}), ...d } : d);
    },
  });
  const usersQuery = {
    orderBy: () => usersQuery,
    limit: () => usersQuery,
    startAfter: () => ({ get: async () => ({ empty: true, docs: [], size: 0 }) }),
    get: async () => {
      const docs = [...store.keys()]
        .filter((k) => /^users\/[^/]+$/.test(k))
        .map((k) => ({ id: k.split('/')[1], data: () => store.get(k)!, ref: ref(k) }));
      return { empty: docs.length === 0, docs, size: docs.length };
    },
  };
  return {
    db: { collection: () => usersQuery, doc: ref } as never,
    store,
  };
}

const TOKEN = 'ExponentPushToken[test-device-aaaaaaaa]';

const SCHED = Date.parse('2026-09-29T18:45:00Z'); // 19:45 London
const MIN = 60_000;

function flight(over: Partial<CachedFlight> = {}): CachedFlight {
  const delay = over.delayMinutes ?? 0;
  return {
    id: 'adb-departure-BA 544-2026-09-29 19:45Z',
    flightNumber: 'BA 544',
    direction: 'departure',
    counterpart: 'Rome',
    status: 'Expected',
    cancelled: false,
    delayed: false,
    delayMinutes: 0,
    scheduledMs: SCHED,
    revisedMs: SCHED + delay * MIN,
    effectiveMs: SCHED + delay * MIN,
    ...over,
  } as CachedFlight;
}

/** An arrival from Faro into Gatwick North, due 21:50 London. */
const ARR_SCHED = Date.parse('2026-09-29T20:50:00Z');
function arrival(over: Partial<CachedFlight> = {}): CachedFlight {
  return flight({
    id: 'adb-arrival-U2 8538-2026-09-29 20:50Z',
    flightNumber: 'U2 8538',
    direction: 'arrival',
    counterpart: 'Faro',
    terminal: 'N',
    scheduledMs: ARR_SCHED,
    revisedMs: ARR_SCHED,
    effectiveMs: ARR_SCHED,
    ...over,
  });
}

function user(over: Data = {}, f: CachedFlight = flight(), airportId = 'lhr'): Data {
  return {
    fcmTokens: [TOKEN],
    savedFlights: [
      {
        id: f.id,
        airportId,
        flightNumber: f.flightNumber,
        cancelled: false,
        delayed: false,
        delayMinutes: 0,
      },
    ],
    ...over,
  };
}

async function run(db: never, board: CachedFlight[]) {
  await dispatchPushNotifications({ db, incidents: [], lines: [], flightsByAirport: { lhr: board } });
}
const late = (m: number, over: Partial<CachedFlight> = {}) =>
  flight({ delayed: true, delayMinutes: m, revisedMs: SCHED + m * MIN, ...over });

describe('watched flight alerts', () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it('alerts when a watched flight becomes delayed, and opens Heathrow on tap', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [late(25)]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      tokens: [TOKEN],
      title: 'BA 544 delayed',
      body: 'BA 544 is now delayed by 25m, due 20:10.',
      data: { kind: 'saved-flight', airportId: 'lhr', event: 'delayed' },
    });
  });

  it('does not repeat the same delay on the next run', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [late(25)]);
    await run(db, [late(25)]);
    expect(sent).toHaveLength(1);
  });

  it('alerts again when the delay grows by 15 minutes or more', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [late(25)]);
    await run(db, [late(35)]); // +10: quiet
    await run(db, [late(45)]); // +20 on the last alert's snapshot
    expect(sent.map((s) => s.body)).toEqual([
      'BA 544 is now delayed by 25m, due 20:10.',
      'BA 544 is now delayed by 45m, due 20:30.',
    ]);
  });

  it('alerts when a watched flight is cancelled', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [flight({ cancelled: true, status: 'Canceled' })]);
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('BA 544 cancelled');
    expect(sent[0].body).toBe('BA 544 to Rome is cancelled.');
  });

  it('stays quiet when nothing changed, or the flight was already delayed when saved', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [flight()]);
    const alreadyLate = user();
    (alreadyLate.savedFlights as Data[])[0].delayed = true;
    (alreadyLate.savedFlights as Data[])[0].delayMinutes = 30;
    const { db: db2 } = fakeDb({ u2: alreadyLate });
    await run(db2, [late(30)]);
    expect(sent).toHaveLength(0);
  });

  it('respects the flight alerts switch in notification settings', async () => {
    const { db } = fakeDb({ u1: user({ notificationPrefs: { 'saved-flights': false } }) });
    await run(db, [late(25)]);
    expect(sent).toHaveLength(0);
  });

  it('skips a watched flight that is not on the current board', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [late(40, { id: 'some-other-flight' })]);
    expect(sent).toHaveLength(0);
  });

  it('tells you when a watched arrival lands, with the terminal', async () => {
    const { db } = fakeDb({ u1: user({}, arrival(), 'lgw') });
    await run(db, [arrival()]); // first check: record only
    await run(db, [arrival({ status: 'Arrived', revisedMs: ARR_SCHED - 8 * MIN })]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: 'U2 8538 has landed',
      body: 'From Faro, landed 21:42 · Terminal N.',
      data: { kind: 'saved-flight', airportId: 'lgw', event: 'landed' },
    });
  });

  it('says "landed" once, and not for a flight that had already landed when watched', async () => {
    const { db } = fakeDb({ u1: user({}, arrival(), 'lgw') });
    await run(db, [arrival({ status: 'Arrived' })]); // already down at first sight
    await run(db, [arrival({ status: 'Arrived' })]);
    expect(sent).toHaveLength(0);
    const { db: db2 } = fakeDb({ u2: user({}, arrival(), 'lgw') });
    await run(db2, [arrival()]);
    await run(db2, [arrival({ status: 'Arrived' })]);
    await run(db2, [arrival({ status: 'Arrived' })]);
    expect(sent).toHaveLength(1);
  });

  it('tells you when a watched departure leaves', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [flight({ status: 'Boarding' })]);
    await run(db, [flight({ status: 'Departed' })]);
    expect(sent.map((s) => [s.title, s.body])).toEqual([['BA 544 has departed', 'To Rome, left 19:45.']]);
  });

  it('tells you when an arrival is now due 15+ minutes earlier', async () => {
    const { db } = fakeDb({ u1: user({}, arrival(), 'lgw') });
    await run(db, [arrival()]);
    await run(db, [arrival({ revisedMs: ARR_SCHED - 10 * MIN })]); // 10 early: quiet
    await run(db, [arrival({ revisedMs: ARR_SCHED - 20 * MIN })]); // 20 early vs what we told them
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: 'U2 8538 arriving earlier',
      body: 'Now due 21:30, was 21:50 · Terminal N.',
      data: { event: 'earlier' },
    });
  });

  it('after a delay alert, "earlier" is measured from the new time it gave', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [flight()]);
    await run(db, [late(60)]); // told: due 20:45
    await run(db, [late(40)]); // now 20:25: 20 earlier than we said
    expect(sent.map((s) => s.title)).toEqual(['BA 544 delayed', 'BA 544 leaving earlier']);
    expect(sent[1].body).toBe('Now due 20:25, was 20:45.');
  });

  it('a cancellation beats everything else in the same check', async () => {
    const { db } = fakeDb({ u1: user() });
    await run(db, [flight()]);
    await run(db, [late(90, { cancelled: true, status: 'Canceled' })]);
    expect(sent.map((s) => s.title)).toEqual(['BA 544 cancelled']);
  });
});
