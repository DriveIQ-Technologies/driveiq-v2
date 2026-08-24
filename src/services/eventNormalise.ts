/**
 * Local event normalisation (task 08).
 *
 * Listings APIs mix doors, on-sale and kick-off into one start field. A
 * driver cares when people arrive and when they walk out. This writes a
 * clean record on the phone so cards read correctly before the nightly
 * Cloud Function is deployed. Firestore overlays (Claude copy + Zak's
 * overrides) win field-by-field when present.
 */

import { findLondonPlace } from '@/data/londonVenues';
import {
  occupancyBand,
  profileFitsEvent,
  turnoutRange,
  venueProfileFor,
} from '@/data/venueProfiles';
import type { AppEvent } from '@/types/event';
import { addMinutesIso, defaultEndsAt } from '@/utils/duration';
import { londonYmd, ukOffset } from '@/utils/ukTime';
import { templateEventLine } from './copyTemplates';
import { db, fsApi } from './firebase';

const MUSIC = /music|concert|rock|pop|jazz|festival|dance|electronic/i;
const THEATRE = /theatre|theater|musical|comedy|arts|opera|ballet/i;
const FESTIVAL_DAY =
  /festival|points east|south facing|wireless|hyde park|bowl|park|common/i;

const isMusic = (e: AppEvent): boolean =>
  MUSIC.test(e.subCategory ?? '') || MUSIC.test(e.title);

const isTheatre = (e: AppEvent): boolean =>
  THEATRE.test(e.subCategory ?? '') || THEATRE.test(e.title);

function londonWallHour(iso: string): number {
  const hour = new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
  return Number.parseInt(hour, 10);
}

function finishAtHour(iso: string, hhmm: string): string {
  const ymd = londonYmd(new Date(iso));
  const [h, m] = hhmm.split(':');
  return new Date(`${ymd}T${h}:${m}:00${ukOffset(ymd)}`).toISOString();
}

export function recordIdFor(eventId: string): string {
  return eventId.replace(/\//g, '_');
}

export function normaliseEventLocal(event: AppEvent): AppEvent {
  const sports = event.category === 'sports';
  const music = !sports && isMusic(event);
  const theatre = !sports && isTheatre(event);
  const intimate =
    !sports &&
    (theatre ||
      event.category === 'family' ||
      /family|musical|kids|children|dinosaur|comedy|theatre|theater/i.test(
        `${event.title} ${event.subCategory ?? ''}`,
      ));

  // Cached TM rows still said "Wembley Stadium" for park-theatre shows.
  if (intimate && /wembley stadium/i.test(event.venue ?? '')) {
    const theatrePlace = findLondonPlace('Troubadour Wembley Park Theatre');
    if (theatrePlace) {
      event = {
        ...event,
        venue: theatrePlace.venue,
        latitude: theatrePlace.latitude,
        longitude: theatrePlace.longitude,
      };
    }
  }

  const profile = venueProfileFor(event.venue);

  let doorsAt = event.doorsAt;
  let realStartAt = event.realStartAt;
  let estimatedFinishAt = event.estimatedFinishAt;

  if (sports) {
    realStartAt = realStartAt ?? event.startsAt;
    const doorsMin = profile?.sportsDoorsBeforeMin ?? 75;
    doorsAt = doorsAt ?? addMinutesIso(realStartAt, -doorsMin);
    const listedEnd = event.endsAt ? Date.parse(event.endsAt) : NaN;
    const startMs = Date.parse(realStartAt);
    const endLooksLikeMultiDay =
      Number.isFinite(listedEnd) &&
      Number.isFinite(startMs) &&
      listedEnd - startMs > 16 * 60 * 60 * 1000;
    estimatedFinishAt =
      estimatedFinishAt ??
      (endLooksLikeMultiDay
        ? defaultEndsAt(realStartAt, event.subCategory)
        : event.endsAt) ??
      defaultEndsAt(realStartAt, event.subCategory);
  } else if (music) {
    const listedHour = londonWallHour(event.startsAt);
    const listedLooksLikeDoors = listedHour >= 17 && listedHour <= 19;
    if (listedLooksLikeDoors) {
      doorsAt = doorsAt ?? event.startsAt;
      const offset = profile?.concertStartAfterDoorsMin ?? 60;
      realStartAt = realStartAt ?? addMinutesIso(doorsAt, offset);
    } else {
      realStartAt = realStartAt ?? event.startsAt;
      doorsAt = doorsAt ?? addMinutesIso(realStartAt, -60);
    }
    const festivalDay =
      FESTIVAL_DAY.test(`${event.title} ${event.venue} ${event.subCategory ?? ''}`) ||
      listedHour < 17;
    if (!estimatedFinishAt) {
      if (profile?.concertFinishHhmm) {
        estimatedFinishAt = finishAtHour(event.startsAt, profile.concertFinishHhmm);
      } else if (festivalDay) {
        estimatedFinishAt = finishAtHour(event.startsAt, '22:30');
      } else {
        estimatedFinishAt =
          event.endsAt ?? defaultEndsAt(realStartAt, event.subCategory ?? 'Music');
      }
    }
  } else if (theatre) {
    realStartAt = realStartAt ?? event.startsAt;
    doorsAt = doorsAt ?? addMinutesIso(realStartAt, -30);
    estimatedFinishAt =
      estimatedFinishAt ?? event.endsAt ?? defaultEndsAt(realStartAt, event.subCategory);
  } else {
    realStartAt = realStartAt ?? event.startsAt;
    doorsAt = doorsAt ?? addMinutesIso(realStartAt, -45);
    estimatedFinishAt =
      estimatedFinishAt ?? event.endsAt ?? defaultEndsAt(realStartAt, event.subCategory);
  }

  let turnoutMin = event.turnoutMin;
  let turnoutMax = event.turnoutMax;
  const usableProfile = profile && profileFitsEvent(profile, event) ? profile : null;
  if (usableProfile && (turnoutMin == null || turnoutMax == null)) {
    const range = turnoutRange(
      usableProfile.capacity,
      occupancyBand(event.subCategory, sports),
    );
    turnoutMin = turnoutMin ?? range.min;
    turnoutMax = turnoutMax ?? range.max;
  }

  const next: AppEvent = {
    ...event,
    doorsAt,
    realStartAt,
    estimatedFinishAt,
    turnoutMin,
    turnoutMax,
    endsAt: estimatedFinishAt ?? event.endsAt,
  };
  next.copyLine = event.copyLine ?? templateEventLine(next);
  if (!next.description) next.description = next.copyLine;
  return next;
}

export type EventRecordOverlay = Partial<
  Pick<
    AppEvent,
    | 'doorsAt'
    | 'realStartAt'
    | 'estimatedFinishAt'
    | 'turnoutMin'
    | 'turnoutMax'
    | 'copyLine'
    | 'description'
  >
>;

function pickOverlay(raw: Record<string, unknown> | undefined): EventRecordOverlay {
  if (!raw) return {};
  const out: EventRecordOverlay = {};
  const str = (k: keyof EventRecordOverlay) => {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) (out[k] as string) = v;
  };
  const num = (k: 'turnoutMin' | 'turnoutMax') => {
    const v = Number(raw[k]);
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

function applyOverlay(event: AppEvent, overlay: EventRecordOverlay): AppEvent {
  const next = { ...event, ...overlay };
  if (overlay.estimatedFinishAt) next.endsAt = overlay.estimatedFinishAt;
  return next;
}

export function venueKeyFor(venue: string | undefined): string {
  return (venue ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Firestore caps `in` filters at 30 values. */
const ID_CHUNK = 30;
/** Parallel chunk queries. Enough to be quick without flooding the socket. */
const CHUNK_CONCURRENCY = 6;

type OverlayMap = Map<string, EventRecordOverlay>;

async function fetchOverlayChunk(
  collectionName: string,
  ids: string[],
): Promise<[string, EventRecordOverlay][]> {
  if (!db || !fsApi || ids.length === 0) return [];
  try {
    const snap = await fsApi.getDocs(
      fsApi.query(
        fsApi.collection(db, collectionName),
        fsApi.where(fsApi.documentId(), 'in', ids),
      ),
    );
    return snap.docs.map(
      (d) => [d.id, pickOverlay(d.data() as Record<string, unknown>)] as [
        string,
        EventRecordOverlay,
      ],
    );
  } catch (e) {
    console.warn(`[events] overlay read failed for ${collectionName}`, e);
    return [];
  }
}

/**
 * Read a whole set of overlay docs in chunked `documentId() in [...]` queries.
 *
 * This used to be one `getDoc` per event per collection — roughly 2,000 round
 * trips on a ~1,000 event launch, which pinned the JS thread and made the map
 * feel frozen for the first half minute. Chunking cuts it to a few dozen.
 */
async function fetchOverlays(
  collectionName: string,
  ids: string[],
): Promise<OverlayMap> {
  const out: OverlayMap = new Map();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    chunks.push(unique.slice(i, i + ID_CHUNK));
  }
  for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
    const results = await Promise.all(
      chunks.slice(i, i + CHUNK_CONCURRENCY).map((c) => fetchOverlayChunk(collectionName, c)),
    );
    for (const rows of results) {
      for (const [id, overlay] of rows) out.set(id, overlay);
    }
  }
  return out;
}

/**
 * Merge Firestore nightly records and manual overrides onto locally
 * normalised events. Overrides always win. Times out so a missing backend
 * never blocks the map.
 */
export async function mergeRemoteEventRecords(events: AppEvent[]): Promise<AppEvent[]> {
  if (!db || !fsApi || events.length === 0) return events;

  const run = async (): Promise<AppEvent[]> => {
    const recordIds = events.map((e) => recordIdFor(e.id));
    const venueKeys = events.map((e) => venueKeyFor(e.venue));

    const [records, overrides, venues] = await Promise.all([
      fetchOverlays('eventRecords', recordIds),
      fetchOverlays('eventOverrides', recordIds),
      fetchOverlays('venueOverrides', venueKeys),
    ]);

    return events.map((event) => {
      const id = recordIdFor(event.id);
      let next = applyOverlay(event, records.get(id) ?? {});
      next = applyOverlay(next, venues.get(venueKeyFor(event.venue)) ?? {});
      next = applyOverlay(next, overrides.get(id) ?? {});
      if (next.estimatedFinishAt) next.endsAt = next.estimatedFinishAt;
      return next;
    });
  };

  return Promise.race([
    run(),
    new Promise<AppEvent[]>((resolve) => setTimeout(() => resolve(events), 6000)),
  ]);
}
