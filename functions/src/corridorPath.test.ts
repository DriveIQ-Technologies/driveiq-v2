import { describe, expect, it } from 'vitest';

import { corridorDocPath, ingestCorridorRoads, type TrafficIncident } from './corridors.js';

/** Rejects a path the way Firestore does: a document path has an even number of segments. */
function strictDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const check = (path: string) => {
    if (path.split('/').length % 2 !== 0) {
      throw new Error(`"${path}" does not contain an even number of components.`);
    }
  };
  return {
    docs,
    db: {
      doc: (path: string) => {
        check(path);
        return {
          get: async () => ({ data: () => docs.get(path) }),
          set: async (data: Record<string, unknown>) => {
            docs.set(path, data);
          },
        };
      },
    } as never,
  };
}

const m25: TrafficIncident = {
  id: 'TIMS-1',
  severity: 'Serious',
  category: 'Collision',
  location: 'M25 clockwise J10-J11',
  comments: 'Lane closed',
  hasClosures: true,
};

describe('corridor cache', () => {
  it('uses a real document path', () => {
    // The old 'roadCache/corridors/m25' was three segments — a collection path.
    expect(corridorDocPath('m25').split('/')).toHaveLength(2);
  });

  it('writes without Firestore rejecting the path — the crash that stopped road alerts', async () => {
    const { db, docs } = strictDb();
    await expect(ingestCorridorRoads(db, [m25])).resolves.toBeUndefined();
    expect([...docs.keys()].some((k) => k.startsWith('roadCorridors/'))).toBe(true);
  });
});
