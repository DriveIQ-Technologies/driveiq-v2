/**
 * Events added by hand from the events admin page.
 *
 * For fixtures no feed carries (or carries late): stored in `manualEvents`,
 * merged into every ingest, and they win over a feed's copy of the same
 * fixture. They go through the normal publish path, so they get the same
 * doors / finish / copy handling as everything else.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { typicalFinishAt, type EventKind } from './eventDurations.js';
import type { PublishedEvent } from './eventNormalise.js';
import { knownSportsVenues, type SportsPlace } from './londonSportsVenues.js';
import { ukOffset } from './londonTime.js';

export const MANUAL_SOURCE = 'manual';

/**
 * Types offered on the form. Each is stored as the event's subCategory, which
 * is what the app reads for the category chip, the filter bucket (Sports /
 * Music / Theatre / Comedy / Film / Family / Other) and the sport pin glyph.
 */
export const MANUAL_SPORTS_TYPES = [
  'Football',
  'Rugby',
  'Cricket',
  'American Football',
  'Tennis',
  'Boxing',
  'Basketball',
  'Horse Racing',
  'Sports',
] as const;
export const MANUAL_OTHER_TYPES = ['Music', 'Theatre', 'Comedy', 'Film', 'Family', 'Other'] as const;

/** Big non-sports venues the sports table doesn't hold. */
const EXTRA_VENUES: SportsPlace[] = [
  { venue: 'Royal Albert Hall', latitude: 51.501, longitude: -0.1774 },
  { venue: 'Hyde Park', latitude: 51.5073, longitude: -0.1657 },
  { venue: 'Alexandra Palace', latitude: 51.5942, longitude: -0.1309 },
  { venue: 'Victoria Park', latitude: 51.5362, longitude: -0.0402 },
  { venue: 'Finsbury Park', latitude: 51.5696, longitude: -0.103 },
  { venue: 'Crystal Palace Park', latitude: 51.4219, longitude: -0.0713 },
];

export function manualVenueOptions(): SportsPlace[] {
  const byName = new Map<string, SportsPlace>();
  for (const p of [...knownSportsVenues(), ...EXTRA_VENUES]) {
    if (!byName.has(p.venue)) byName.set(p.venue, p);
  }
  return [...byName.values()].sort((a, b) => a.venue.localeCompare(b.venue));
}

/** Same box the Ticketmaster ingest accepts. */
const AREA = { minLat: 51.25, maxLat: 52.1, minLon: -0.9, maxLon: 0.35 };
export function inLondonArea(lat: number, lon: number): boolean {
  return lat >= AREA.minLat && lat <= AREA.maxLat && lon >= AREA.minLon && lon <= AREA.maxLon;
}

export interface ManualEventInput {
  title?: string;
  /** A name from manualVenueOptions(), or 'other'. */
  venue?: string;
  /** With venue 'other'. */
  venueName?: string;
  latitude?: number;
  longitude?: number;
  /** YYYY-MM-DD, London. */
  date?: string;
  /** HH:MM, London. */
  startTime?: string;
  /** HH:MM, London; before the start means after midnight. Optional. */
  endTime?: string;
  /** HH:MM, London, before the start. Optional. */
  doorsTime?: string;
  /** Expected crowd, e.g. "90000". Optional. */
  crowd?: string;
  /** One line for drivers; replaces the generated line. Optional. */
  note?: string;
  type?: string;
  url?: string;
}

/**
 * What was typed on the form beyond the basics. Written to
 * eventOverrides/{id}, which the publisher applies last — otherwise the venue
 * profile recomputes doors / finish / turnout and a typed 22:45 finish at the
 * O2 came out as the 23:00 curfew.
 */
export interface ManualEventOverrides {
  doorsAt?: string;
  realStartAt?: string;
  estimatedFinishAt?: string;
  turnoutMin?: number;
  turnoutMax?: number;
  copyLine?: string;
  description?: string;
}

export interface ManualEventDoc {
  title: string;
  venue: string;
  latitude: number;
  longitude: number;
  startsAt: string;
  endsAt: string;
  endIsEstimated: boolean;
  category: 'sports' | 'other';
  subCategory: string;
  url: string | null;
  overrides: ManualEventOverrides;
  createdAt: string;
}

function londonToUtcIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const t = Date.parse(`${date}T${time}:00${ukOffset(date)}`);
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

function kindFor(type: string): EventKind {
  if ((MANUAL_SPORTS_TYPES as readonly string[]).includes(type)) return 'sports';
  if (type === 'Music') return 'music';
  if (type === 'Theatre' || type === 'Comedy') return 'theatre';
  if (type === 'Film') return 'film';
  return 'other';
}

/**
 * Validate the form and build the stored record. Coordinates for venue
 * 'other' must already be resolved (postcode lookup happens in the handler).
 */
export function buildManualEvent(
  input: ManualEventInput,
  now: number = Date.now(),
): { ok: true; event: ManualEventDoc } | { ok: false; error: string } {
  const title = (input.title ?? '').trim().slice(0, 140);
  if (!title) return { ok: false, error: 'Add a title.' };

  let place: SportsPlace | undefined;
  if (input.venue === 'other') {
    const name = (input.venueName ?? '').trim().slice(0, 100);
    if (!name) return { ok: false, error: 'Add the venue name.' };
    const lat = Number(input.latitude);
    const lon = Number(input.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inLondonArea(lat, lon)) {
      return { ok: false, error: 'That postcode is not in the London area.' };
    }
    place = { venue: name, latitude: lat, longitude: lon };
  } else {
    place = manualVenueOptions().find((p) => p.venue === input.venue);
    if (!place) return { ok: false, error: 'Pick a venue.' };
  }

  const date = (input.date ?? '').trim();
  const startsAt = londonToUtcIso(date, (input.startTime ?? '').trim());
  if (!startsAt) return { ok: false, error: 'Add the date and start time.' };
  if (Date.parse(startsAt) < now - 12 * 60 * 60 * 1000) {
    return { ok: false, error: 'That start time is in the past.' };
  }

  const type = (input.type ?? '').trim();
  const allTypes = [...MANUAL_SPORTS_TYPES, ...MANUAL_OTHER_TYPES] as readonly string[];
  if (!allTypes.includes(type)) return { ok: false, error: 'Pick a type.' };
  const category = kindFor(type) === 'sports' ? 'sports' : 'other';

  let endsAt: string;
  let endIsEstimated: boolean;
  const endTime = (input.endTime ?? '').trim();
  if (endTime) {
    const sameDay = londonToUtcIso(date, endTime);
    if (!sameDay) return { ok: false, error: 'End time should look like 22:30.' };
    // 23:00 → 01:00 finishes the next day.
    endsAt =
      Date.parse(sameDay) > Date.parse(startsAt)
        ? sameDay
        : new Date(Date.parse(sameDay) + 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    endIsEstimated = false;
  } else {
    endsAt = typicalFinishAt(startsAt, { kind: kindFor(type), subCategory: type, title });
    endIsEstimated = true;
  }

  const url = (input.url ?? '').trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) {
    return { ok: false, error: 'The link should start with https://' };
  }

  const overrides: ManualEventOverrides = {};
  if (!endIsEstimated) overrides.estimatedFinishAt = endsAt;

  const doorsTime = (input.doorsTime ?? '').trim();
  if (doorsTime) {
    const doorsAt = londonToUtcIso(date, doorsTime);
    if (!doorsAt) return { ok: false, error: 'Doors time should look like 18:15.' };
    if (Date.parse(doorsAt) >= Date.parse(startsAt)) {
      return { ok: false, error: 'Doors should be before the start time.' };
    }
    overrides.doorsAt = doorsAt;
    overrides.realStartAt = startsAt;
  }

  const crowdText = (input.crowd ?? '').replace(/[,\s]/g, '');
  if (crowdText) {
    const crowd = Number(crowdText);
    if (!Number.isInteger(crowd) || crowd < 100 || crowd > 150_000) {
      return { ok: false, error: 'Expected crowd should be a number like 90000.' };
    }
    // The app shows turnout as a range; same spread as the venue profiles.
    overrides.turnoutMin = Math.round((crowd * 0.8) / 100) * 100;
    overrides.turnoutMax = crowd;
  }

  const note = (input.note ?? '').trim().replace(/\s+/g, ' ');
  if (note) {
    if (note.length > 160) return { ok: false, error: 'Keep the driver note under 160 characters.' };
    overrides.copyLine = note;
    overrides.description = note;
  }

  return {
    ok: true,
    event: {
      title,
      venue: place.venue,
      latitude: place.latitude,
      longitude: place.longitude,
      startsAt,
      endsAt,
      endIsEstimated,
      category,
      subCategory: type,
      url: url || null,
      overrides,
      createdAt: new Date(now).toISOString(),
    },
  };
}

/** Stable doc id: date + title, so the same fixture saved twice overwrites. */
export function manualEventId(e: Pick<ManualEventDoc, 'title' | 'startsAt'>): string {
  const slug = e.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${e.startsAt.slice(0, 10)}-${slug || 'event'}`;
}

/** The id the event carries through eventsRaw / eventsPublished. */
export function manualRawId(docId: string): string {
  return `${MANUAL_SOURCE}-${docId}`;
}

export function manualToPublished(docId: string, d: ManualEventDoc): PublishedEvent {
  return {
    id: manualRawId(docId),
    source: MANUAL_SOURCE,
    category: d.category,
    title: d.title,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    endIsEstimated: d.endIsEstimated,
    venue: d.venue,
    latitude: d.latitude,
    longitude: d.longitude,
    subCategory: d.subCategory,
    ...(d.url ? { url: d.url } : {}),
  };
}

/** Manual events that have not finished (36h grace, as elsewhere). */
export async function loadManualEvents(
  db: Firestore,
  now: number = Date.now(),
): Promise<{ docId: string; doc: ManualEventDoc }[]> {
  const snap = await db.collection('manualEvents').limit(500).get();
  const cutoff = now - 36 * 60 * 60 * 1000;
  return snap.docs
    .map((d) => ({ docId: d.id, doc: d.data() as ManualEventDoc }))
    .filter(({ doc }) => {
      const ends = Date.parse(String(doc.endsAt ?? doc.startsAt ?? ''));
      return Number.isFinite(ends) && ends >= cutoff;
    })
    .sort((a, b) => a.doc.startsAt.localeCompare(b.doc.startsAt));
}
