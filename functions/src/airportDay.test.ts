import { afterEach, describe, expect, it, vi } from 'vitest';

import { ingestAirportDay } from './airports.js';

type FetchArgs = [url: string, init?: unknown];

function fakeDb() {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const db = {
    doc: (path: string) => ({
      get: async () => ({ data: () => undefined }),
      set: async (data: Record<string, unknown>) => {
        writes.push({ path, data });
      },
    }),
  };
  return { db: db as never, writes };
}

function flightPayload(numbers: string[]) {
  return {
    departures: numbers.map((n) => ({
      number: n,
      status: 'Scheduled',
      airline: { name: 'Test Air' },
      movement: {
        airport: { name: 'Somewhere', iata: 'XXX' },
        scheduledTime: { utc: '2026-09-20 09:00Z', local: '2026-09-20 10:00+01:00' },
      },
    })),
    arrivals: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ingestAirportDay', () => {
  it('reaches 36h past midnight in three calls, so late-night flights are never cut off', async () => {
    const fetchMock = vi.fn(
      async (..._a: FetchArgs) =>
        new Response(JSON.stringify(flightPayload(['BA1'])), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { db } = fakeDb();
    await ingestAirportDay(db, 'key', 'lhr', new Date('2026-09-20T14:00:00'));

    // A board bounded to the calendar day goes empty at 22:00 — the bug this
    // fixes. Three 12h windows: 00:00->12:00, 12:00->24:00, 24:00->36:00.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('EGLL');
    expect(urls[0]).toContain('2026-09-20T00:00');
    expect(urls[0]).toContain('2026-09-20T12:00');
    // The final window runs into the NEXT day, which is the whole point.
    expect(urls[2]).toContain('2026-09-21T00:00');
    expect(urls[2]).toContain('2026-09-21T12:00');
  });

  it('still covers the small hours when polled late in the evening', async () => {
    const fetchMock = vi.fn(
      async (..._a: FetchArgs) =>
        new Response(JSON.stringify(flightPayload(['BA1'])), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { db } = fakeDb();
    // 22:00 — previously the board ended 2 hours later and showed nothing after.
    await ingestAirportDay(db, 'key', 'lhr', new Date('2026-09-20T22:00:00'));

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('2026-09-21T00:00'))).toBe(true);
    expect(urls.some((u) => u.includes('2026-09-21T12:00'))).toBe(true);
  });

  it('writes one document per window so a busy airport cannot exceed the 1 MiB limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (..._a: FetchArgs) =>
          new Response(JSON.stringify(flightPayload(['BA1'])), { status: 200 }),
      ),
    );
    const { db, writes } = fakeDb();
    await ingestAirportDay(db, 'key', 'lhr', new Date('2026-09-20T14:00:00'));

    // Heathrow over 36h is ~2,500 flights; one document would be rejected.
    expect(writes.map((w) => w.path)).toEqual([
      'airportCacheDay/EGLL-0',
      'airportCacheDay/EGLL-1',
      'airportCacheDay/EGLL-2',
    ]);
  });

  it('keeps the other windows when one of them fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (..._a: FetchArgs) => {
        call += 1;
        return call === 2
          ? new Response('boom', { status: 500 })
          : new Response(JSON.stringify(flightPayload(['BA1'])), { status: 200 });
      }),
    );
    const { db, writes } = fakeDb();
    await ingestAirportDay(db, 'key', 'lhr', new Date('2026-09-20T14:00:00'));

    // The failed window keeps its previous copy instead of blanking the board.
    expect(writes.map((w) => w.path)).toEqual([
      'airportCacheDay/EGLL-0',
      'airportCacheDay/EGLL-2',
    ]);
  });

  it('writes to airportCacheDay, leaving the near-term doc untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (..._a: FetchArgs) =>
          new Response(JSON.stringify(flightPayload(['BA1'])), { status: 200 }),
      ),
    );

    const { db, writes } = fakeDb();
    await ingestAirportDay(db, 'key', 'lgw', new Date('2026-09-20T14:00:00'));

    expect(writes).toHaveLength(3);
    expect(writes[0].path).toBe('airportCacheDay/EGKK-0');
    expect(writes[0].data.airportId).toBe('lgw');
    expect(typeof writes[0].data.updatedAtMs).toBe('number');
  });

  it('de-duplicates flights that appear in both halves of the day', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (..._a: FetchArgs) =>
          new Response(JSON.stringify(flightPayload(['BA1', 'BA2'])), { status: 200 }),
      ),
    );

    const { db, writes } = fakeDb();
    const count = await ingestAirportDay(db, 'key', 'lhr', new Date('2026-09-20T14:00:00'));

    // Each window returns the same two flights; they are stored per window.
    expect(count).toBe(6);
    expect((writes[0].data.flights as unknown[]).length).toBe(2);
  });

  it('ignores an unknown airport without calling the API', async () => {
    const fetchMock = vi.fn(async (..._a: FetchArgs) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { db, writes } = fakeDb();
    const count = await ingestAirportDay(db, 'key', 'nope', new Date());

    expect(count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('cache protection on upstream failure', () => {
  it('does not publish an empty day board when both windows fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (..._a: FetchArgs) => new Response('quota exceeded', { status: 429 })),
    );

    const { db, writes } = fakeDb();
    const count = await ingestAirportDay(db, 'key', 'lhr', new Date('2026-09-20T14:00:00'));

    // Nothing written: the previous good board survives, window by window.
    expect(count).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('still publishes the windows that succeeded', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (..._a: FetchArgs) => {
        call += 1;
        return call === 1
          ? new Response('boom', { status: 500 })
          : new Response(JSON.stringify(flightPayload(['BA9'])), { status: 200 });
      }),
    );

    const { db, writes } = fakeDb();
    const count = await ingestAirportDay(db, 'key', 'lhr', new Date('2026-09-20T14:00:00'));

    expect(count).toBe(2);
    expect(writes).toHaveLength(2);
  });
});
