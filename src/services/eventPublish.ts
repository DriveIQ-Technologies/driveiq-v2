/**
 * Server-published London events (Cloud Function ingest → Firestore).
 * The map prefers this catalogue when it is fresh; otherwise it falls back
 * to on-device Ticketmaster / featured pulls.
 */

import type { AppEvent } from '@/types/event';
import { db, fsApi } from './firebase';

const FRESH_MS = 36 * 60 * 60 * 1000;
const MIN_COUNT = 20;

export interface PublishedCatalogue {
  events: AppEvent[];
  updatedAt: number;
}

function asEvent(raw: Record<string, unknown>): AppEvent | null {
  const id = typeof raw.id === 'string' ? raw.id : '';
  const title = typeof raw.title === 'string' ? raw.title : '';
  const startsAt = typeof raw.startsAt === 'string' ? raw.startsAt : '';
  const endsAt =
    typeof raw.endsAt === 'string'
      ? raw.endsAt
      : typeof raw.estimatedFinishAt === 'string'
        ? raw.estimatedFinishAt
        : startsAt;
  const venue = typeof raw.venue === 'string' ? raw.venue : 'London';
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (!id || !title || !startsAt || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const source = String(raw.source ?? 'ticketmaster');
  return {
    id,
    source: source as AppEvent['source'],
    category: raw.category === 'sports' ? 'sports' : 'other',
    title,
    startsAt,
    endsAt,
    venue,
    latitude,
    longitude,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    subCategory: typeof raw.subCategory === 'string' ? raw.subCategory : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    doorsAt: typeof raw.doorsAt === 'string' ? raw.doorsAt : undefined,
    realStartAt: typeof raw.realStartAt === 'string' ? raw.realStartAt : undefined,
    estimatedFinishAt:
      typeof raw.estimatedFinishAt === 'string' ? raw.estimatedFinishAt : undefined,
    turnoutMin: Number.isFinite(Number(raw.turnoutMin)) ? Number(raw.turnoutMin) : undefined,
    turnoutMax: Number.isFinite(Number(raw.turnoutMax)) ? Number(raw.turnoutMax) : undefined,
    copyLine: typeof raw.copyLine === 'string' ? raw.copyLine : undefined,
  };
}

export async function fetchPublishedEvents(): Promise<PublishedCatalogue | null> {
  if (!db || !fsApi) return null;
  try {
    const metaSnap = await fsApi.getDoc(fsApi.doc(db, 'eventsPublishedMeta', 'current'));
    const meta = metaSnap.exists() ? (metaSnap.data() as Record<string, unknown>) : null;
    const updatedAt = meta?.updatedAt ? Date.parse(String(meta.updatedAt)) : NaN;
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > FRESH_MS) return null;

    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const snap = await fsApi.getDocs(
      fsApi.query(
        fsApi.collection(db, 'eventsPublished'),
        fsApi.where('startsAt', '>=', cutoff),
        fsApi.orderBy('startsAt', 'asc'),
        fsApi.limit(800),
      ),
    );
    const events = snap.docs
      .map((d) => asEvent(d.data() as Record<string, unknown>))
      .filter((e): e is AppEvent => e != null);
    if (events.length < MIN_COUNT) return null;
    return { events, updatedAt };
  } catch (e) {
    console.warn('[events] published catalogue unavailable', e);
    return null;
  }
}
