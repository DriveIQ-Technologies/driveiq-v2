/**
 * Nightly event normalisation (task 08).
 *
 * Writes doors, real start, estimated finish, a one-line description and a
 * turnout range. Manual eventOverrides and venueOverrides are merged last
 * and are never overwritten by this job.
 */

import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { phraseAndStore } from './copy.js';

export interface RawEvent {
  id: string;
  title: string;
  venue: string;
  subCategory?: string;
  category?: string;
  startsAt: string;
  endsAt?: string;
}

function recordId(id: string): string {
  return id.replace(/\//g, '_');
}

function overlayFields(data: Record<string, unknown> | undefined) {
  if (!data) return {};
  const out: Record<string, unknown> = {};
  for (const key of [
    'doorsAt',
    'realStartAt',
    'estimatedFinishAt',
    'turnoutMin',
    'turnoutMax',
    'copyLine',
    'description',
  ]) {
    if (data[key] != null && data[key] !== '') out[key] = data[key];
  }
  return out;
}

export async function normaliseTomorrow(opts: {
  db: Firestore;
  apiKey: string | undefined;
  events: RawEvent[];
}): Promise<number> {
  let written = 0;
  for (const event of opts.events) {
    const id = recordId(event.id);
    const [overrideSnap, venueSnap] = await Promise.all([
      opts.db.doc(`eventOverrides/${id}`).get(),
      opts.db
        .doc(`venueOverrides/${event.venue.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
        .get(),
    ]);
    const override = overlayFields(overrideSnap.data() as Record<string, unknown> | undefined);
    const venue = overlayFields(venueSnap.data() as Record<string, unknown> | undefined);

    const raw = [
      event.subCategory || event.category || 'Event',
      event.venue,
      event.title,
      `listedStart ${event.startsAt}`,
      event.endsAt ? `listedEnd ${event.endsAt}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    await phraseAndStore({
      db: opts.db,
      apiKey: opts.apiKey,
      collection: 'events',
      id,
      kind: 'event',
      rawRecord: raw,
      model: 'sonnet',
      extra: { eventId: event.id, venue: event.venue, title: event.title },
    });

    const copySnap = await opts.db.doc(`copy/events/lines/${id}`).get();
    const copyLine = String(copySnap.data()?.line ?? '');

    const record = {
      id: event.id,
      title: event.title,
      venue: event.venue,
      listedStart: event.startsAt,
      listedEnd: event.endsAt ?? null,
      doorsAt: event.startsAt,
      realStartAt: event.startsAt,
      estimatedFinishAt: event.endsAt ?? event.startsAt,
      copyLine,
      description: copyLine,
      source: copySnap.data()?.source ?? 'template',
      updatedAt: new Date().toISOString(),
      ...venue,
      ...override,
    };

    await opts.db.doc(`eventRecords/${id}`).set(record, { merge: false });
    written += 1;
  }
  logger.info('events.normalised', { count: written });
  return written;
}
