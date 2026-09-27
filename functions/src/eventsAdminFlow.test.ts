/**
 * The whole path a hand-added event takes: admin page → manualEvents /
 * eventsRaw / eventOverrides → publish → the eventsPublished record the app
 * reads. Uses an in-memory Firestore; the publish code is the real one.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { handleEventsAdmin } from './eventsAdmin.js';
import { eventsFromRawDocs, publishLondonEvents } from './events.js';
import { ukOffset } from './londonTime.js';

type Data = Record<string, unknown>;

function fakeDb(seed: Record<string, Data> = {}) {
  const store = new Map<string, Data>(Object.entries(seed));
  const ref = (path: string) => ({
    id: path.split('/').pop()!,
    path,
    get: async () => ({
      exists: store.has(path),
      id: path.split('/').pop()!,
      ref: ref(path),
      data: () => (store.has(path) ? structuredClone(store.get(path)) : undefined),
    }),
    set: async (d: Data, o?: { merge?: boolean }) => {
      store.set(path, o?.merge ? { ...(store.get(path) ?? {}), ...d } : structuredClone(d));
    },
    delete: async () => {
      store.delete(path);
    },
  });
  const db = {
    doc: ref,
    collection: (name: string) => ({
      limit: () => ({
        get: async () => ({
          docs: [...store.keys()]
            .filter((k) => k.startsWith(`${name}/`) && k.split('/').length === 2)
            .map((k) => ({ id: k.split('/')[1], ref: ref(k), data: () => structuredClone(store.get(k)) })),
          get size() {
            return this.docs.length;
          },
        }),
      }),
    }),
    bulkWriter: () => {
      const ops: (() => Promise<void>)[] = [];
      return {
        set: (r: ReturnType<typeof ref>, d: Data, o?: { merge?: boolean }) => ops.push(() => r.set(d, o)),
        delete: (r: ReturnType<typeof ref>) => ops.push(() => r.delete()),
        close: async () => {
          for (const op of ops) await op();
        },
      };
    },
  };
  const republish = async () => {
    const snap = await db.collection('eventsRaw').limit().get();
    await publishLondonEvents({
      db: db as never,
      apiKey: undefined,
      events: eventsFromRawDocs(snap.docs.map((d) => d.data() as Data)),
    });
  };
  return { db, store, republish };
}

function fakeRes() {
  const r = {
    code: 0,
    body: '',
    status(c: number) {
      r.code = c;
      return r;
    },
    set() {
      return r;
    },
    send(b: string) {
      r.body = b;
    },
  };
  return r;
}

// Tomorrow in London, so the start is never "in the past" whenever this runs.
const day = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
const off = ukOffset(day);

const form = {
  action: 'add',
  key: 'pass',
  title: 'England v Spain',
  type: 'Football',
  venue: 'Wembley Stadium',
  date: day,
  startTime: '19:45',
};

describe('events admin, end to end', () => {
  it('publishes a hand-added event in the shape the app reads', async () => {
    const { db, store, republish } = fakeDb();
    const res = fakeRes();
    await handleEventsAdmin({ db: db as never, req: { method: 'POST', body: form }, res, adminKey: 'pass', republish });

    expect(res.code).toBe(200);
    expect(res.body).toContain('It is live in the app now');
    expect(res.body).toContain('Live in app');

    const id = `manual-${day}-england-v-spain`;
    const pub = store.get(`eventsPublished/${id}`)!;
    expect(pub).toBeTruthy();
    // Fields the app's asEvent() needs, and the ones its event sheet shows.
    expect(pub).toMatchObject({
      id,
      source: 'manual',
      category: 'sports',
      subCategory: 'Football',
      title: 'England v Spain',
      venue: 'Wembley Stadium',
    });
    expect(typeof pub.startsAt).toBe('string');
    expect(Number.isFinite(pub.latitude)).toBe(true);
    // Filled in from the Wembley profile when not typed.
    expect(pub.doorsAt).toBeTruthy();
    expect(pub.turnoutMax).toBe(90000);
    expect(String(pub.copyLine)).toContain('Wembley');
  });

  it('typed doors, finish, crowd and note win over the venue estimate', async () => {
    const { db, store, republish } = fakeDb();
    await handleEventsAdmin({
      db: db as never,
      req: {
        method: 'POST',
        body: { ...form, doorsTime: '18:00', endTime: '22:00', crowd: '85000', note: 'Sold out.' },
      },
      res: fakeRes(),
      adminKey: 'pass',
      republish,
    });
    const pub = store.get(`eventsPublished/manual-${day}-england-v-spain`)!;
    expect(new Date(String(pub.doorsAt)).toISOString()).toBe(new Date(`${day}T18:00:00${off}`).toISOString());
    expect(new Date(String(pub.endsAt)).toISOString()).toBe(new Date(`${day}T22:00:00${off}`).toISOString());
    expect(pub.turnoutMax).toBe(85000);
    expect(pub.copyLine).toBe('Sold out.');
  });

  it('replaces the league feed copy of the same match instead of showing both', async () => {
    const start = new Date(`${day}T19:45:00${off}`).toISOString();
    const espn = {
      id: 'espn-999',
      source: 'espn',
      category: 'sports',
      title: 'England vs Spain',
      startsAt: start,
      endsAt: start,
      venue: 'Wembley Stadium',
      latitude: 51.556,
      longitude: -0.2796,
      subCategory: 'Football',
    };
    const { db, store, republish } = fakeDb({ 'eventsRaw/espn-999': espn, 'eventsPublished/espn-999': espn });
    await handleEventsAdmin({ db: db as never, req: { method: 'POST', body: form }, res: fakeRes(), adminKey: 'pass', republish });

    const wembley = [...store.keys()].filter((k) => k.startsWith('eventsPublished/'));
    expect(wembley).toEqual([`eventsPublished/manual-${day}-england-v-spain`]);
  });

  it('removing it takes it out of the app', async () => {
    const { db, store, republish } = fakeDb();
    await handleEventsAdmin({ db: db as never, req: { method: 'POST', body: { ...form, note: 'x' } }, res: fakeRes(), adminKey: 'pass', republish });
    const docId = `${day}-england-v-spain`;
    const res = fakeRes();
    await handleEventsAdmin({
      db: db as never,
      req: { method: 'POST', body: { action: 'delete', key: 'pass', id: docId } },
      res,
      adminKey: 'pass',
      republish,
    });
    expect(res.body).toContain('Removed from the app.');
    for (const p of ['manualEvents/', 'eventsRaw/manual-', 'eventsPublished/manual-', 'eventOverrides/manual-']) {
      expect([...store.keys()].some((k) => k.startsWith(p))).toBe(false);
    }
  });

  it('keeps the form filled in and says why when something is wrong', async () => {
    const { db, store, republish } = fakeDb();
    const res = fakeRes();
    await handleEventsAdmin({
      db: db as never,
      req: { method: 'POST', body: { ...form, doorsTime: '21:00' } },
      res,
      adminKey: 'pass',
      republish,
    });
    expect(res.body).toContain('Doors should be before the start time.');
    expect(res.body).toContain('value="England v Spain"');
    expect(store.size).toBe(0);
  });
});
