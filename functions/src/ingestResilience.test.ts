import { afterEach, describe, expect, it, vi } from 'vitest';

import { ingestLiveFeeds } from './ingest.js';

function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    doc: (path: string) => ({
      get: async () => ({ data: () => docs.get(path), exists: docs.has(path) }),
      set: async (data: Record<string, unknown>) => {
        docs.set(path, data);
      },
    }),
  } as never;
}

const HIGHWAYS = [
  { id: 'nh-1', severity: 'Severe', eventCategory: 'Closure', roadNumber: 'M25', description: 'M25 closed J10-J11' },
];

function routeFetch(tflRoadBody: unknown) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('trafficengland')) return new Response(JSON.stringify(HIGHWAYS), { status: 200 });
    if (u.includes('/Road/')) return new Response(JSON.stringify(tflRoadBody), { status: 200 });
    if (u.includes('/Line/')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response('[]', { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('ingestLiveFeeds resilience', () => {
  it('survives TfL answering 200 with an error object instead of a list', async () => {
    // Seen live at 23:54: "rows is not iterable" discarded the whole road feed.
    vi.stubGlobal('fetch', routeFetch({ $type: 'Tfl.Apps.Api.Common.ApiError', message: 'x' }));
    const incidents = await ingestLiveFeeds(fakeDb());
    // Highways England still comes through even though TfL's reply was junk.
    expect(incidents.some((i) => /M25/.test(`${i.location} ${i.comments}`))).toBe(true);
  });

  it('survives an empty body from TfL', async () => {
    vi.stubGlobal('fetch', routeFetch(null));
    await expect(ingestLiveFeeds(fakeDb())).resolves.toBeInstanceOf(Array);
  });
});
