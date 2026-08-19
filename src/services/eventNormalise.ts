/**
 * Local event normalisation (task 08).
 *
 * Listings APIs mix doors, on-sale and kick-off into one start field. A
 * driver cares when people arrive and when they walk out. This writes a
 * clean record on the phone so cards read correctly before the nightly
 * Cloud Function is deployed. Firestore overlays (Claude copy + Zak's
 * overrides) win field-by-field when present.
 */

import {
  occupancyBand,
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
  const profile = venueProfileFor(event.venue);
  const sports = event.category === 'sports';
  const music = !sports && isMusic(event);
  const theatre = !sports && isTheatre(event);

  let doorsAt = event.doorsAt;
  let realStartAt = event.realStartAt;
  let estimatedFinishAt = event.estimatedFinishAt;

  if (sports) {
    realStartAt = realStartAt ?? event.startsAt;
    const doorsMin = profile?.sportsDoorsBeforeMin ?? 75;
    doorsAt = doorsAt ?? addMinutesIso(realStartAt, -doorsMin);
    estimatedFinishAt =
      estimatedFinishAt ?? event.endsAt ?? defaultEndsAt(realStartAt, event.subCategory);
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
    if (!estimatedFinishAt) {
      estimatedFinishAt = profile?.concertFinishHhmm
        ? finishAtHour(event.startsAt, profile.concertFinishHhmm)
        : event.endsAt ?? defaultEndsAt(realStartAt, event.subCategory ?? 'Music');
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
  if (profile && (turnoutMin == null || turnoutMax == null)) {
    const range = turnoutRange(
      profile.capacity,
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

async function getDocData(
  collection: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!db || !fsApi) return null;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, collection, id));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Merge Firestore nightly records and manual overrides onto locally
 * normalised events. Overrides always win. Times out so a missing backend
 * never blocks the map.
 */
export async function mergeRemoteEventRecords(events: AppEvent[]): Promise<AppEvent[]> {
  if (!db || !fsApi || events.length === 0) return events;

  const run = async (): Promise<AppEvent[]> => {
    const venueKeys = Array.from(
      new Set(
        events.map((e) => (e.venue ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')),
      ),
    ).filter(Boolean);

    const venueEntries = await Promise.all(
      venueKeys.map(async (key) => [key, pickOverlay((await getDocData('venueOverrides', key)) ?? undefined)] as const),
    );
    const venueCache = new Map(venueEntries);

    return Promise.all(
      events.map(async (event) => {
        const id = recordIdFor(event.id);
        const venueKey = (event.venue ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const [record, override] = await Promise.all([
          getDocData('eventRecords', id),
          getDocData('eventOverrides', id),
        ]);
        let next = applyOverlay(event, pickOverlay(record ?? undefined));
        next = applyOverlay(next, venueCache.get(venueKey) ?? {});
        next = applyOverlay(next, pickOverlay(override ?? undefined));
        if (next.estimatedFinishAt) next.endsAt = next.estimatedFinishAt;
        return next;
      }),
    );
  };

  return Promise.race([
    run(),
    new Promise<AppEvent[]>((resolve) => setTimeout(() => resolve(events), 2500)),
  ]);
}
