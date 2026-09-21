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
  it('covers the whole local day in two calls (AeroDataBox caps a window at 12h)', async () => {
    const fetchMock = vi.fn(
      async (..._a: FetchArgs) =>
        new Response(JSON.stringify(flightPayload(['BA1'])), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { db } = fakeDb();
    await ingestAirportDay(db, 'key', 'lhr', new Date('2026-09-20T14:00:00'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('EGLL');
    // Midnight -> midday, then midday -> next midnight.
    expect(urls[0]).toContain('T00:00');
    expect(urls[0]).toContain('T12:00');
    expect(urls[1]).toContain('T12:00');
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

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('airportCacheDay/EGKK');
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

    // Both windows return the same two flights; the merge keys on id.
    expect(count).toBe(2);
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
