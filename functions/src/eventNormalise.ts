/**
 * Server-side event normalisation. Same rules as the app:
 * Proms / RAH listed time is curtain; O2 18:30 is not doors.
 * Manual eventOverrides / venueOverrides still win after this runs.
 */

import { addMinutesIso, londonYmd, ukOffset } from './londonTime.js';

export interface PublishedEvent {
  id: string;
  source: string;
  category: 'sports' | 'other';
  title: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  latitude: number;
  longitude: number;
  description?: string;
  subCategory?: string;
  url?: string;
  doorsAt?: string;
  realStartAt?: string;
  estimatedFinishAt?: string;
  turnoutMin?: number;
  turnoutMax?: number;
  copyLine?: string;
}

interface VenueProfile {
  names: string[];
  capacity: number;
  sportsDoorsBeforeMin?: number;
  concertStartAfterDoorsMin?: number;
  concertFinishHhmm?: string;
}

const VENUE_PROFILES: VenueProfile[] = [
  { names: ['wembley stadium'], capacity: 90000, sportsDoorsBeforeMin: 90, concertStartAfterDoorsMin: 90, concertFinishHhmm: '23:00' },
  { names: ['the o2 arena', 'o2 arena', 'the o2'], capacity: 20000, concertStartAfterDoorsMin: 60, concertFinishHhmm: '23:00' },
  { names: ['ovo arena wembley', 'wembley arena'], capacity: 12500, concertStartAfterDoorsMin: 60, concertFinishHhmm: '22:45' },
  { names: ['troubadour wembley park theatre', 'wembley park theatre'], capacity: 2000, concertStartAfterDoorsMin: 30 },
  { names: ['victoria park'], capacity: 40000, concertStartAfterDoorsMin: 60, concertFinishHhmm: '22:30' },
  { names: ['the national bowl', 'national bowl'], capacity: 65000, concertStartAfterDoorsMin: 75, concertFinishHhmm: '23:00' },
  { names: ['hyde park'], capacity: 65000, concertStartAfterDoorsMin: 75, concertFinishHhmm: '22:30' },
  { names: ['royal albert hall', 'albert hall'], capacity: 5272, concertStartAfterDoorsMin: 30 },
  { names: ['tottenham hotspur stadium'], capacity: 62850, sportsDoorsBeforeMin: 90, concertStartAfterDoorsMin: 75, concertFinishHhmm: '23:00' },
  { names: ['london stadium'], capacity: 62500, sportsDoorsBeforeMin: 90, concertStartAfterDoorsMin: 75, concertFinishHhmm: '23:00' },
  { names: ['emirates stadium', 'emirates'], capacity: 60704, sportsDoorsBeforeMin: 90 },
  { names: ['stamford bridge'], capacity: 40343, sportsDoorsBeforeMin: 75 },
  { names: ['selhurst park'], capacity: 25486, sportsDoorsBeforeMin: 75 },
  { names: ['craven cottage'], capacity: 24500, sportsDoorsBeforeMin: 75 },
  { names: ['gtech community stadium'], capacity: 17250, sportsDoorsBeforeMin: 75 },
  { names: ['twickenham stadium', 'twickenham'], capacity: 82223, sportsDoorsBeforeMin: 90 },
];

const MUSIC =
  /music|concert|rock|pop|jazz|festival|dance|electronic|hip-?hop|\brap\b|r&b|rnb|grime|drill/i;
const THEATRE = /theatre|theater|musical|comedy|arts|opera|ballet/i;
const FESTIVAL_DAY =
  /festival|points east|south facing|wireless|hyde park|bowl|park|common/i;
const PUBLISHED_START =
  /bbc proms|\bproms?\b|orchestra|philharmonic|symphony|concerto|chamber orchestra|requiem|oratorio/i;
const SEATED_HALL =
  /royal albert hall|\balbert hall\b|barbican hall|wigmore hall|royal festival hall|queen elizabeth hall|cadogan hall/i;
const O2_ARENA = /(?:^|\b)(?:the )?o2(?: arena)?\b/i;
const CLASSICAL_CROWD_OUT_MIN = 15;

const TROUBADOUR = {
  venue: 'Troubadour Wembley Park Theatre',
  latitude: 51.5578,
  longitude: -0.2833,
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function venueProfileFor(venue: string | undefined): VenueProfile | null {
  if (!venue) return null;
  const n = norm(venue);
  for (const profile of VENUE_PROFILES) {
    if (profile.names.some((name) => n === name)) return profile;
  }
  for (const profile of VENUE_PROFILES) {
    if (profile.names.some((name) => name.length >= 12 && n.includes(name))) return profile;
  }
  return null;
}

function londonWallHourMinute(iso: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  return {
    hour: Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10),
    minute: Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10),
  };
}

function listedIsPublishedStart(event: PublishedEvent): boolean {
  const hay = `${event.title} ${event.subCategory ?? ''}`;
  return PUBLISHED_START.test(hay) || SEATED_HALL.test(event.venue ?? '');
}

function isO2Arena(venue?: string): boolean {
  return O2_ARENA.test(venue ?? '');
}

function publishedFinishLooksReal(startIso: string, endIso?: string): boolean {
  if (!endIso) return false;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const dur = end - start;
  return dur >= 45 * 60 * 1000 && dur <= 6 * 60 * 60 * 1000;
}

function finishAtHour(iso: string, hhmm: string): string {
  const ymd = londonYmd(new Date(iso));
  const [h, m] = hhmm.split(':');
  return new Date(`${ymd}T${h}:${m}:00${ukOffset(ymd)}`).toISOString();
}

function defaultEndsAt(startsAt: string, sub?: string): string {
  const minutes = /theatre|comedy|arts/i.test(sub ?? '') ? 180 : 180;
  return addMinutesIso(startsAt, minutes);
}

function occupancyBand(sub: string | undefined, sports: boolean): { low: number; high: number } {
  const kind = (sub ?? '').toLowerCase();
  if (sports || kind.includes('football') || kind.includes('rugby')) return { low: 0.8, high: 1 };
  if (kind.includes('theatre') || kind.includes('comedy') || kind.includes('arts')) {
    return { low: 0.7, high: 0.95 };
  }
  return { low: 0.75, high: 1 };
}

function turnoutRange(capacity: number, band: { low: number; high: number }): { min: number; max: number } {
  const round = (n: number) => {
    if (n >= 10000) return Math.round(n / 1000) * 1000;
    if (n >= 1000) return Math.round(n / 500) * 500;
    return Math.round(n / 100) * 100;
  };
  let min = round(capacity * band.low);
  let max = round(capacity * band.high);
  if (min < 100) min = 100;
  if (max <= min) max = min + (capacity >= 10000 ? 1000 : 100);
  return { min, max };
}

function hhmm(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
}

export function templateEventLine(event: PublishedEvent): string {
  const kind = event.subCategory || (event.category === 'sports' ? 'Sport' : 'Event');
  const venue = event.venue || 'London';
  const finish = hhmm(event.estimatedFinishAt || event.endsAt);
  if (finish) return `${kind} at ${venue}. Crowds leaving around ${finish}.`;
  return `${kind} at ${venue}.`;
}

export function recordIdFor(eventId: string): string {
  return eventId.replace(/\//g, '_');
}

export function normalisePublishedEvent(event: PublishedEvent): PublishedEvent {
  const sports = event.category === 'sports';
  const music = !sports && (MUSIC.test(event.subCategory ?? '') || MUSIC.test(event.title));
  const theatre = !sports && (THEATRE.test(event.subCategory ?? '') || THEATRE.test(event.title));
  const intimate =
    !sports &&
    (theatre ||
      /family|musical|kids|children|dinosaur|comedy|theatre|theater/i.test(
        `${event.title} ${event.subCategory ?? ''}`,
      ));

  if (intimate && /wembley stadium/i.test(event.venue ?? '')) {
    event = {
      ...event,
      venue: TROUBADOUR.venue,
      latitude: TROUBADOUR.latitude,
      longitude: TROUBADOUR.longitude,
    };
  }

  const profile = venueProfileFor(event.venue);
  let doorsAt = event.doorsAt;
  let realStartAt = event.realStartAt;
  let estimatedFinishAt = event.estimatedFinishAt;

  if (sports) {
    realStartAt = realStartAt ?? event.startsAt;
    doorsAt = doorsAt ?? addMinutesIso(realStartAt, -(profile?.sportsDoorsBeforeMin ?? 75));
    const listedEnd = event.endsAt ? Date.parse(event.endsAt) : NaN;
    const startMs = Date.parse(realStartAt);
    const endLooksLikeMultiDay =
      Number.isFinite(listedEnd) && Number.isFinite(startMs) && listedEnd - startMs > 16 * 60 * 60 * 1000;
    estimatedFinishAt =
      estimatedFinishAt ??
      (endLooksLikeMultiDay ? defaultEndsAt(realStartAt, event.subCategory) : event.endsAt) ??
      defaultEndsAt(realStartAt, event.subCategory);
  } else if (music) {
    const { hour: listedHour, minute: listedMinute } = londonWallHourMinute(event.startsAt);
    const publishedStart = listedIsPublishedStart(event);
    const listedLooksLikeDoors =
      !publishedStart &&
      (listedHour === 17 || (listedHour === 18 && listedMinute === 0 && !isO2Arena(event.venue)));
    if (publishedStart) {
      realStartAt = realStartAt ?? event.startsAt;
      doorsAt = doorsAt ?? addMinutesIso(realStartAt, -30);
    } else if (listedLooksLikeDoors) {
      doorsAt = doorsAt ?? event.startsAt;
      realStartAt = realStartAt ?? addMinutesIso(doorsAt, profile?.concertStartAfterDoorsMin ?? 60);
    } else {
      realStartAt = realStartAt ?? event.startsAt;
      if (isO2Arena(event.venue) && listedHour >= 18 && listedHour < 21) {
        const six = finishAtHour(event.startsAt, '18:00');
        doorsAt =
          doorsAt ?? (Date.parse(six) < Date.parse(realStartAt) ? six : addMinutesIso(realStartAt, -30));
      } else {
        doorsAt = doorsAt ?? addMinutesIso(realStartAt, -60);
      }
    }
    const festivalDay =
      FESTIVAL_DAY.test(`${event.title} ${event.venue} ${event.subCategory ?? ''}`) || listedHour < 17;
    if (!estimatedFinishAt) {
      if (publishedStart && publishedFinishLooksReal(realStartAt, event.endsAt)) {
        estimatedFinishAt = addMinutesIso(event.endsAt, CLASSICAL_CROWD_OUT_MIN);
      } else if (profile?.concertFinishHhmm && !publishedStart) {
        estimatedFinishAt = finishAtHour(event.startsAt, profile.concertFinishHhmm);
      } else if (festivalDay) {
        estimatedFinishAt = finishAtHour(event.startsAt, '22:30');
      } else {
        estimatedFinishAt = event.endsAt ?? defaultEndsAt(realStartAt, event.subCategory ?? 'Music');
      }
    }
  } else if (theatre) {
    realStartAt = realStartAt ?? event.startsAt;
    doorsAt = doorsAt ?? addMinutesIso(realStartAt, -30);
    estimatedFinishAt = estimatedFinishAt ?? event.endsAt ?? defaultEndsAt(realStartAt, event.subCategory);
  } else {
    realStartAt = realStartAt ?? event.startsAt;
    doorsAt = doorsAt ?? addMinutesIso(realStartAt, -45);
    estimatedFinishAt = estimatedFinishAt ?? event.endsAt ?? defaultEndsAt(realStartAt, event.subCategory);
  }

  let turnoutMin = event.turnoutMin;
  let turnoutMax = event.turnoutMax;
  if (profile && (turnoutMin == null || turnoutMax == null)) {
    const range = turnoutRange(profile.capacity, occupancyBand(event.subCategory, sports));
    turnoutMin = turnoutMin ?? range.min;
    turnoutMax = turnoutMax ?? range.max;
  }

  const next: PublishedEvent = {
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
