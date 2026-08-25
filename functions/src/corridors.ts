/**
 * Per-corridor road cache (task 06). Mirrors app roadsCorridors.ts.
 */

import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { enqueueCopy } from './copyQueue.js';

export type CorridorStatus = 'clear' | 'slow' | 'incident';

export interface TrafficIncident {
  id: string;
  severity: string;
  category: string;
  location?: string;
  comments?: string;
  subCategory?: string;
  hasClosures?: boolean;
}

export interface RoadCorridor {
  id: string;
  label: string;
  aliases: string[];
}

export const ROAD_CORRIDORS: RoadCorridor[] = [
  { id: 'm25', label: 'M25', aliases: ['M25'] },
  { id: 'm4', label: 'M4', aliases: ['M4'] },
  { id: 'm40', label: 'M40', aliases: ['M40'] },
  { id: 'm1', label: 'M1', aliases: ['M1'] },
  { id: 'm3', label: 'M3', aliases: ['M3'] },
  { id: 'm11', label: 'M11', aliases: ['M11'] },
  { id: 'm23', label: 'M23', aliases: ['M23'] },
  { id: 'a1m', label: 'A1(M)', aliases: ['A1(M)', 'A1M'] },
  { id: 'a1', label: 'A1', aliases: ['A1'] },
  { id: 'a2', label: 'A2', aliases: ['A2'] },
  { id: 'a3', label: 'A3', aliases: ['A3', 'A3(M)', 'A3M'] },
  { id: 'a4', label: 'A4', aliases: ['A4'] },
  { id: 'a10', label: 'A10', aliases: ['A10'] },
  { id: 'a12', label: 'A12', aliases: ['A12'] },
  { id: 'a13', label: 'A13', aliases: ['A13'] },
  { id: 'a40', label: 'A40 Westway', aliases: ['A40', 'Westway'] },
  { id: 'a406', label: 'A406 North Circular', aliases: ['A406', 'North Circular'] },
  { id: 'a205', label: 'A205 South Circular', aliases: ['A205', 'South Circular'] },
  { id: 'blackwall', label: 'Blackwall Tunnel', aliases: ['Blackwall Tunnel', 'Blackwall'] },
  {
    id: 'rotherhithe',
    label: 'Rotherhithe Tunnel',
    aliases: ['Rotherhithe Tunnel', 'Rotherhithe'],
  },
  {
    id: 'dartford',
    label: 'Dartford Crossing',
    aliases: ['Dartford Crossing', 'Dartford Tunnel', 'Queen Elizabeth II Bridge'],
  },
  { id: 'limehouse', label: 'Limehouse Link', aliases: ['Limehouse Link', 'Limehouse'] },
];

const withText = (i: TrafficIncident): string =>
  [i.location, i.comments, i.subCategory, i.category].filter(Boolean).join(' ');

const includesAlias = (text: string, alias: string): boolean => {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'i').test(text);
};

export function incidentCorridor(incident: TrafficIncident): RoadCorridor | null {
  const text = withText(incident);
  for (const corridor of ROAD_CORRIDORS) {
    if (corridor.aliases.some((a) => includesAlias(text, a))) return corridor;
  }
  return null;
}

const incidentWeight = (i: TrafficIncident): number => {
  const sev = String(i.severity).toLowerCase();
  const category = String(i.category).toLowerCase();
  if (i.hasClosures || sev === 'severe' || sev === 'serious') return 3;
  if (category.includes('accident') || category.includes('closure')) return 3;
  if (sev === 'moderate' || category.includes('delay') || category.includes('works')) return 2;
  return 1;
};

export interface CorridorBucket {
  corridor: RoadCorridor;
  status: CorridorStatus;
  incidents: TrafficIncident[];
}

export function buildCorridorBuckets(incidents: TrafficIncident[]): CorridorBucket[] {
  const byId = new Map<string, CorridorBucket>();
  for (const c of ROAD_CORRIDORS) {
    byId.set(c.id, { corridor: c, status: 'clear', incidents: [] });
  }
  for (const inc of incidents) {
    const corridor = incidentCorridor(inc);
    if (!corridor) continue;
    byId.get(corridor.id)?.incidents.push(inc);
  }
  for (const bucket of byId.values()) {
    let max = 0;
    for (const inc of bucket.incidents) max = Math.max(max, incidentWeight(inc));
    bucket.status = max >= 3 ? 'incident' : max >= 2 ? 'slow' : 'clear';
  }
  return ROAD_CORRIDORS.map((c) => byId.get(c.id)!);
}

export async function ingestCorridorRoads(
  db: Firestore,
  incidents: TrafficIncident[],
): Promise<void> {
  const buckets = buildCorridorBuckets(incidents);
  const writes = buckets.map(async (bucket) => {
    const prevSnap = await db.doc(`roadCache/corridors/${bucket.corridor.id}`).get();
    const prevStatus = String(prevSnap.data()?.status ?? 'clear');
    await db.doc(`roadCache/corridors/${bucket.corridor.id}`).set(
      {
        id: bucket.corridor.id,
        label: bucket.corridor.label,
        status: bucket.status,
        incidentCount: bucket.incidents.length,
        incidents: bucket.incidents.slice(0, 8).map((i) => ({
          id: i.id,
          severity: i.severity,
          category: i.category,
          location: i.location ?? null,
          hasClosures: !!i.hasClosures,
        })),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    if (
      bucket.status === 'incident' &&
      prevStatus !== 'incident' &&
      bucket.incidents.length > 0
    ) {
      const top = bucket.incidents[0];
      const raw = [bucket.corridor.label, top.severity, top.category, top.location]
        .filter(Boolean)
        .join(' · ');
      await enqueueCopy(db, `corridor-${bucket.corridor.id}`, {
        kind: 'road',
        rawRecord: raw,
        collection: 'road',
      });
    }
  });
  await Promise.all(writes);
  logger.info('ingest.corridors', {
    incidentCorridors: buckets.filter((b) => b.status !== 'clear').length,
  });
}
