/**
 * Publish London events: normalise times, phrase copy, write Firestore.
 * Manual eventOverrides and venueOverrides always win.
 */
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { phraseAndStore } from './copy.js';
import {
  normalisePublishedEvent,
  recordIdFor,
  templateEventLine,
  type PublishedEvent,
} from './eventNormalise.js';

function overlayFields(data: Record<string, unknown> | undefined): Partial<PublishedEvent> {
  if (!data) return {};
  const out: Partial<PublishedEvent> = {};
  const str = (k: keyof PublishedEvent) => {
    const v = data[k as string];
    if (typeof v === 'string' && v.trim()) (out as Record<string, unknown>)[k] = v;
  };
  const num = (k: 'turnoutMin' | 'turnoutMax') => {
    const v = Number(data[k]);
    if (Number.isFinite(v) && v > 0) out[k] = v;
  };
  str('doorsAt');
  str('realStartAt');
  str('estimatedFinishAt');
  str('copyLine');
  str('description');
  num('turnoutMin');
  num('turnoutMax');
  return out;
}

function fingerprint(e: PublishedEvent): string {
  return [e.title, e.realStartAt, e.estimatedFinishAt, e.doorsAt].join('|');
}

function isPriority(e: PublishedEvent, now: number): boolean {
  const start = Date.parse(e.realStartAt || e.startsAt);
  const soon = Number.isFinite(start) && start <= now + 48 * 60 * 60 * 1000;
  const venue = (e.venue ?? '').toLowerCase();
  const big =
    e.source === 'featured' ||
    e.category === 'sports' ||
    venue.includes('o2') ||
    venue.includes('wembley') ||
    venue.includes('albert hall') ||
    venue.includes('tottenham') ||
    venue.includes('emirates') ||
    venue.includes('hyde park');
  return soon || big;
}

function dropTmWhenFeatured(events: PublishedEvent[]): PublishedEvent[] {
  const featuredRah = events.filter(
    (e) => e.source === 'featured' && /albert hall/i.test(e.venue),
  );
  return events.filter((e) => {
    if (e.source === 'featured' || !/albert hall/i.test(e.venue)) return true;
    const t = Date.parse(e.startsAt);
    return !featuredRah.some((f) => Math.abs(Date.parse(f.startsAt) - t) < 3 * 60 * 60 * 1000);
  });
}

function toAppEventDoc(e: PublishedEvent, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: e.id,
    source: e.source,
    category: e.category,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    venue: e.venue,
    latitude: e.latitude,
    longitude: e.longitude,
    description: e.description ?? null,
    subCategory: e.subCategory ?? null,
    url: e.url ?? null,
    doorsAt: e.doorsAt ?? null,
    realStartAt: e.realStartAt ?? null,
    estimatedFinishAt: e.estimatedFinishAt ?? null,
    turnoutMin: e.turnoutMin ?? null,
    turnoutMax: e.turnoutMax ?? null,
    copyLine: e.copyLine ?? null,
    listedStart: e.startsAt,
    listedEnd: e.endsAt,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

const COPY_CAP = 80;

export async function publishLondonEvents(opts: {
  db: Firestore;
  apiKey: string | undefined;
  events: PublishedEvent[];
}): Promise<number> {
  const now = Date.now();
  const unique = dropTmWhenFeatured(opts.events);
  let copyBudget = COPY_CAP;
  let written = 0;
  const writer = opts.db.bulkWriter();
  const keptIds = new Set<string>();

  for (const raw of unique) {
    const id = recordIdFor(raw.id);
    keptIds.add(id);
    const [overrideSnap, venueSnap, copySnap] = await Promise.all([
      opts.db.doc(`eventOverrides/${id}`).get(),
      opts.db
        .doc(`venueOverrides/${raw.venue.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
        .get(),
      opts.db.doc(`copy/events/lines/${id}`).get(),
    ]);
    const override = overlayFields(overrideSnap.data() as Record<string, unknown> | undefined);
    const venue = overlayFields(venueSnap.data() as Record<string, unknown> | undefined);

    let event = normalisePublishedEvent(raw);
    const fp = fingerprint(event);
    const existingCopy = copySnap.data() as { line?: string; fingerprint?: string; source?: string } | undefined;
    let copyLine = event.copyLine ?? templateEventLine(event);
    let copySource = 'template';

    if (existingCopy?.line && existingCopy.fingerprint === fp) {
      copyLine = existingCopy.line;
      copySource = String(existingCopy.source ?? 'template');
    } else if (opts.apiKey && copyBudget > 0 && isPriority(event, now)) {
      copyBudget -= 1;
      const rawRecord = [
        event.subCategory || event.category || 'Event',
        event.venue,
        event.title,
        `doors ${event.doorsAt ?? ''}`,
        `start ${event.realStartAt ?? event.startsAt}`,
        `finish ${event.estimatedFinishAt ?? event.endsAt}`,
        event.turnoutMin != null && event.turnoutMax != null
          ? `turnout ${event.turnoutMin}-${event.turnoutMax}`
          : '',
      ]
        .filter(Boolean)
        .join(' · ');
      await phraseAndStore({
        db: opts.db,
        apiKey: opts.apiKey,
        collection: 'events',
        id,
        kind: 'event',
        rawRecord,
        model: isPriority(event, now) ? 'sonnet' : 'haiku',
        extra: { eventId: event.id, venue: event.venue, title: event.title, fingerprint: fp },
      });
      const fresh = await opts.db.doc(`copy/events/lines/${id}`).get();
      copyLine = String(fresh.data()?.line ?? copyLine);
      copySource = String(fresh.data()?.source ?? 'claude');
    }

    event = {
      ...event,
      copyLine,
      description: copyLine,
      ...venue,
      ...override,
    };
    if (event.estimatedFinishAt) event.endsAt = event.estimatedFinishAt;

    const doc = toAppEventDoc(event, { copySource, fingerprint: fp });
    writer.set(opts.db.doc(`eventRecords/${id}`), doc, { merge: false });
    writer.set(opts.db.doc(`eventsPublished/${id}`), doc, { merge: false });
    written += 1;
  }

  await writer.close();

  const stale = await opts.db.collection('eventsPublished').limit(800).get();
  const cleanup = opts.db.bulkWriter();
  let removed = 0;
  for (const doc of stale.docs) {
    if (keptIds.has(doc.id)) continue;
    const ends = Date.parse(String(doc.data().estimatedFinishAt || doc.data().endsAt || ''));
    if (!Number.isFinite(ends) || ends < now - 36 * 60 * 60 * 1000) {
      cleanup.delete(doc.ref);
      removed += 1;
    }
  }
  await cleanup.close();

  await opts.db.doc('eventsPublishedMeta/current').set({
    updatedAt: new Date().toISOString(),
    count: written,
    copyBudgetLeft: copyBudget,
    removedStale: removed,
  });

  logger.info('events.published', { count: written, removedStale: removed });
  return written;
}

/** @deprecated Prefer publishLondonEvents with the live ingest list. */
export async function normaliseTomorrow(opts: {
  db: Firestore;
  apiKey: string | undefined;
  events: Array<{
    id: string;
    title: string;
    venue: string;
    subCategory?: string;
    category?: string;
    startsAt: string;
    endsAt?: string;
  }>;
}): Promise<number> {
  const mapped: PublishedEvent[] = opts.events
    .filter((e) => e.startsAt)
    .map((e) => ({
      id: e.id,
      source: 'ticketmaster',
      category: (e.category === 'sports' ? 'sports' : 'other') as 'sports' | 'other',
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt ?? e.startsAt,
      venue: e.venue,
      latitude: 51.5074,
      longitude: -0.1278,
      subCategory: e.subCategory,
    }));
  return publishLondonEvents({ db: opts.db, apiKey: opts.apiKey, events: mapped });
}
