import { findLondonPlace } from '@/data/londonVenues';
import type { AppEvent } from '@/types/event';
import { eventOverlapsRange, type DateRange } from '@/utils/dateFilters';
import { defaultEndsAt } from '@/utils/duration';
import { ukOffset } from '@/utils/ukTime';

/**
 * FotMob team ICS calendars — free football home-fixture backbone.
 *
 * No API key. Public calendar URLs include LOCATION on every VEVENT, so we
 * keep home games only and drop away trips. Covers Club Friendlies that ESPN
 * `club.friendly` misses (e.g. Millwall vs Antwerp at The Den, 1 Aug 2026).
 *
 * This is the production alternative to TheSportsDB Premium for London
 * football. Cricket still comes from the ESPN web calendar + Oval ICS +
 * featured Hundred list.
 *
 * Team IDs verified against fotmob.com/teams/{id} (Jul 2026).
 */

const FOTMOB_ICS = (teamId: number) =>
  `https://pub.fotmob.com/prod/pub/api/v2/calendar/team/${teamId}.ics`;

interface ClubCalendar {
  /** FotMob numeric team id. */
  teamId: number;
  /** Canonical venue — must resolve via findLondonPlace. */
  venue: string;
  /** Lower-case substring(s) that must appear in LOCATION for a home game. */
  locationMatch: string[];
  label: string;
}

const CLUBS: ClubCalendar[] = [
  { teamId: 9825, venue: 'Emirates Stadium', locationMatch: ['emirates'], label: 'Arsenal' },
  { teamId: 8455, venue: 'Stamford Bridge', locationMatch: ['stamford bridge'], label: 'Chelsea' },
  {
    teamId: 8586,
    venue: 'Tottenham Hotspur Stadium',
    locationMatch: ['tottenham hotspur stadium'],
    label: 'Tottenham',
  },
  {
    teamId: 8654,
    venue: 'London Stadium',
    locationMatch: ['london stadium'],
    label: 'West Ham',
  },
  { teamId: 9826, venue: 'Selhurst Park', locationMatch: ['selhurst'], label: 'Crystal Palace' },
  { teamId: 9879, venue: 'Craven Cottage', locationMatch: ['craven cottage'], label: 'Fulham' },
  {
    teamId: 9937,
    venue: 'Gtech Community Stadium',
    locationMatch: ['gtech'],
    label: 'Brentford',
  },
  { teamId: 10172, venue: 'Loftus Road', locationMatch: ['loftus'], label: 'QPR' },
  { teamId: 10004, venue: 'The Den', locationMatch: ['the den'], label: 'Millwall' },
  { teamId: 8451, venue: 'The Valley', locationMatch: ['the valley'], label: 'Charlton' },
  {
    teamId: 8351,
    venue: 'Brisbane Road',
    locationMatch: ['brisbane', 'betwright'],
    label: 'Leyton Orient',
  },
  {
    teamId: 158319,
    venue: 'Plough Lane',
    locationMatch: ['plough lane'],
    label: 'AFC Wimbledon',
  },
  {
    teamId: 45729,
    venue: 'Hayes Lane',
    locationMatch: ['hayes lane', 'copperjax'],
    label: 'Bromley',
  },
  // Nearby traffic-relevant Championship / League One grounds (client Jul–Aug
  // 2026 — Watford friendlies; Luton Kenilworth Road + MK Stadium).
  { teamId: 9817, venue: 'Vicarage Road', locationMatch: ['vicarage'], label: 'Watford' },
  {
    teamId: 8346,
    venue: 'Kenilworth Road',
    locationMatch: ['kenilworth'],
    label: 'Luton Town',
  },
  {
    teamId: 8645,
    venue: 'Stadium MK',
    locationMatch: ['stadium mk', 'stadium:mk'],
    label: 'MK Dons',
  },
];

const parseIcsDateTime = (raw: string): number | null => {
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (compact) {
    const [, y, mo, d, h, mi, s, z] = compact;
    // Floating (no-Z) ICS times are London wall-clock — parse with the UK
    // offset, not the device timezone (wrong for users travelling abroad).
    const suffix = z ? 'Z' : ukOffset(`${y}-${mo}-${d}`);
    const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${suffix}`);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
};

const fetchText = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[fotmob] non-OK', res.status, url);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn('[fotmob] network error', url, e);
    return null;
  }
};

const icsToHomeEvents = (
  ics: string,
  club: ClubCalendar,
  place: { venue: string; latitude: number; longitude: number },
  range: DateRange,
): AppEvent[] => {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const out: AppEvent[] = [];

  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const get = (field: string): string | null => {
      const mm = body.match(new RegExp(`^${field}[^:]*:(.*)$`, 'm'));
      return mm ? mm[1].trim() : null;
    };

    const summary = get('SUMMARY');
    const dtstart = get('DTSTART');
    if (!summary || !dtstart) continue;

    const location = (get('LOCATION') ?? '').replace(/\\,/g, ',').toLowerCase();
    if (!club.locationMatch.some((m) => location.includes(m))) continue;

    const startMs = /^\d{8}$/.test(dtstart)
      ? (() => {
          const d = `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`;
          return Date.parse(`${d}T15:00:00${ukOffset(d)}`);
        })()
      : parseIcsDateTime(dtstart);
    if (startMs == null) continue;

    const startsAt = new Date(startMs).toISOString();
    const dtend = get('DTEND');
    let endsAt: string | null = null;
    if (dtend) {
      const endMs = /^\d{8}$/.test(dtend)
        ? (() => {
            const d = `${dtend.slice(0, 4)}-${dtend.slice(4, 6)}-${dtend.slice(6, 8)}`;
            return Date.parse(`${d}T17:00:00${ukOffset(d)}`);
          })()
        : parseIcsDateTime(dtend);
      if (endMs != null && endMs > startMs) endsAt = new Date(endMs).toISOString();
    }
    endsAt = endsAt ?? defaultEndsAt(startsAt, 'Football');
    if (!eventOverlapsRange(startsAt, endsAt, range)) continue;

    const title = summary
      .replace(/^[\u26BD\uFE0F\s]+/u, '')
      .replace(/\s+\(\d+-\d+\)\s*$/, '')
      .trim();
    const desc = get('DESCRIPTION') ?? '';
    const subCategory = /friendl/i.test(desc) ? 'Football' : 'Football';
    const uid = get('UID') ?? `${club.teamId}-${startsAt}`;

    out.push({
      id: `fotmob-${uid}`,
      source: 'fotmob',
      category: 'sports',
      title: title || `${club.label} home fixture`,
      startsAt,
      endsAt,
      venue: place.venue,
      latitude: place.latitude,
      longitude: place.longitude,
      description: /friendl/i.test(desc)
        ? 'Club Friendly'
        : undefined,
      subCategory,
    });
  }
  return out;
};

/**
 * Fetch home fixtures (incl. friendlies) for every curated London football
 * club via FotMob ICS. No API key required.
 */
export async function fetchFotmobLondon(range: DateRange): Promise<AppEvent[]> {
  const results = await Promise.all(
    CLUBS.map(async (club) => {
      const place = findLondonPlace(club.venue);
      if (!place) {
        console.warn('[fotmob] no coords for', club.venue);
        return [] as AppEvent[];
      }
      const body = await fetchText(FOTMOB_ICS(club.teamId));
      if (!body) return [] as AppEvent[];
      return icsToHomeEvents(body, club, place, range);
    }),
  );

  const byId = new Map<string, AppEvent>();
  for (const list of results) {
    for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const all = Array.from(byId.values()).sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  const perClub = CLUBS.map((c, i) => `${c.label}=${results[i].length}`).join(', ');
  console.log(`[fotmob] ${all.length} home fixtures (${perClub})`);
  return all;
}
