import { describe, expect, it } from 'vitest';

import { enqueueCopy } from './copyQueue.js';

/** Tiny in-memory Firestore: enough for doc().get() and doc().set(). */
function fakeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(seed));
  const db = {
    doc: (path: string) => ({
      get: async () => ({ data: () => docs.get(path) }),
      set: async (data: Record<string, unknown>) => {
        docs.set(path, { ...(docs.get(path) ?? {}), ...data });
      },
    }),
  };
  return { db: db as never, docs };
}

const RAW = 'Serious · Collision · [A302] Lower Grosvenor Place (SW1W)';

describe('enqueueCopy', () => {
  it('queues a record that has never been phrased', async () => {
    const { db, docs } = fakeDb();
    await enqueueCopy(db, 'tfl-road-1', { kind: 'road', rawRecord: RAW });
    expect(docs.has('copyQueue/tfl-road-1')).toBe(true);
  });

  it('does not re-queue a record already phrased — the source of the AI bill', async () => {
    // This ran every 5 minutes for every incident, whether or not it changed.
    const { db, docs } = fakeDb({
      'copy/road/lines/tfl-road-1': {
        rawRecord: RAW,
        line: 'Collision on Lower Grosvenor Place. Expect delays around Victoria.',
      },
    });
    await enqueueCopy(db, 'tfl-road-1', { kind: 'road', rawRecord: RAW });
    expect(docs.has('copyQueue/tfl-road-1')).toBe(false);
  });

  it('re-queues when the incident itself changes', async () => {
    const { db, docs } = fakeDb({
      'copy/road/lines/tfl-road-1': { rawRecord: RAW, line: 'Old but fine copy.' },
    });
    await enqueueCopy(db, 'tfl-road-1', {
      kind: 'road',
      rawRecord: `${RAW} · Road now closed`,
    });
    expect(docs.has('copyQueue/tfl-road-1')).toBe(true);
  });

  it('re-queues when the stored line is a refusal saved before the guard existed', async () => {
    const { db, docs } = fakeDb({
      'copy/rail/lines/tfl-rail-gwr': {
        rawRecord: 'Great Western Railway · Special Service',
        line: "I can't phrase this record. There isn't enough useful information.",
      },
    });
    await enqueueCopy(db, 'tfl-rail-gwr', {
      kind: 'rail',
      rawRecord: 'Great Western Railway · Special Service',
    });
    expect(docs.has('copyQueue/tfl-rail-gwr')).toBe(true);
  });
});
