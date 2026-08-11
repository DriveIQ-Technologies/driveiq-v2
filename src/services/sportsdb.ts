import {
  findLondonPlace,
  LONDON_VENUE_LIST,
  type LondonPlace,
} from '@/data/londonVenues';
import type { AppEvent } from '@/types/event';
import { isInRange, type DateRange } from '@/utils/dateFilters';
import { cleanDescription } from '@/utils/description';
import { defaultEndsAt } from '@/utils/duration';
import { ukOffset } from '@/utils/ukTime';

/**
 * Unified TheSportsDB service — venue-first coverage backbone.
 *
 * Iterates curated `LONDON_VENUE_LIST` and asks TheSportsDB what's next at
 * each ground. This is the durable layer for friendlies / cricket / rugby
 * that ESPN league feeds miss (e.g. Millwall vs Antwerp at The Den).
 *
 * Two execution paths:
 *
 *   1. Premium (REQUIRED for production) — `EXPO_PUBLIC_SPORTSDB_API_KEY`
 *      set. Calls `/api/v2/json/schedule/next/venue/{idVenue}` per venue.
 *
 *   2. Free-tier fallback — league-next only. Incomplete for friendlies and
 *      most non-PL sports; logs a loud warning so we never ship silent gaps.
 */

const PREMIUM_KEY = process.env.EXPO_PUBLIC_SPORTSDB_API_KEY ?? '';
const FREE_KEY = '123';

const V1_BASE = (key: string) => `https://www.thesportsdb.com/api/v1/json/${key}`;
const V2_BASE = 'https://www.thesportsdb.com/api/v2/json';

const FREE_TIER_LEAGUES: { id: number; name: string; sub: string }[] = [
  { id: 4328, name: 'English Premier League', sub: 'Football' },
  { id: 4329, name: 'English Championship', sub: 'Football' },
  { id: 4396, name: 'English League One', sub: 'Football' },
  { id: 4480, name: 'English League Two', sub: 'Football' },
  { id: 4481, name: 'English National League', sub: 'Football' },
  { id: 4395, name: 'FA Cup', sub: 'Football' },
  { id: 4346, name: 'NFL', sub: 'American Football' },
];

/** Football / cricket grounds we always expect coverage from in season. */
const CRITICAL_VENUE_NAMES = new Set([
  'The Den',
  'Vicarage Road',
  "Lord's Cricket Ground",
  'The Oval',
  'Emirates Stadium',
  'Stamford Bridge',
  'Tottenham Hotspur Stadium',
  'London Stadium',
  'Selhurst Park',
  'Craven Cottage',
  'Gtech Community Stadium',
  'Loftus Road',
  'Wembley Stadium',
  'Twickenham Stadium',
]);

interface TsdbEvent {
  idEvent: string;
  strEvent?: string;
  strEventAlternate?: string;
  dateEvent?: string;
  strTime?: string;
  strTimestamp?: string;
  strVenue?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  strLeague?: string | null;
  strSport?: string | null;
  strDescriptionEN?: string | null;
}

interface TsdbResponse {
  events?: TsdbEvent[] | null;
  schedule?: TsdbEvent[] | null;
}

const buildIso = (e: TsdbEvent): string | null => {
  if (e.strTimestamp) {
    return e.strTimestamp.replace(/\+00:00$/, 'Z');
  }
  if (e.dateEvent) {
    // strTime is London wall-clock — tagging it `Z` showed kick-offs an
    // hour late during BST (and could push late games onto the next day).
    const time = e.strTime && e.strTime !== '00:00:00' ? e.strTime : '12:00:00';
    return `${e.dateEvent}T${time}${ukOffset(e.dateEvent)}`;
  }
  return null;
};

/**
 * Map sport / league strings to UI sub-categories. Club Friendlies and
 * exhibition soccer must land as Football so pre-season home games pin
 * correctly (client gap: Millwall / Watford friendlies, Jul 2026).
 */
const subCategoryFor = (
  sport: string | undefined | null,
  league?: string | null,
): string => {
  const hay = `${sport ?? ''} ${league ?? ''}`.toLowerCase();
  if (
    hay.includes('friendly') ||
    hay.includes('friendlies') ||
    hay.includes('pre-season') ||
    hay.includes('preseason')
  ) {
    return 'Football';
  }
  if (hay.includes('american') || hay.includes('nfl')) return 'American Football';
  if (hay.includes('soccer') || hay.includes('football')) return 'Football';
  if (hay.includes('rugby')) return 'Rugby';
  if (hay.includes('cricket')) return 'Cricket';
  if (hay.includes('basketball')) return 'Basketball';
  if (hay.includes('tennis')) return 'Tennis';
  if (hay.includes('box')) return 'Boxing';
  if (hay.includes('mma') || hay.includes('ufc')) return 'MMA';
  if (hay.includes('ice hockey') || hay.includes('hockey')) return 'Hockey';
  if (hay.includes('motorsport') || hay.includes('formula')) return 'Motorsport';
  if (hay.includes('darts')) return 'Darts';
  return sport ?? 'Sports';
};

const normalise = (
  e: TsdbEvent,
  range: DateRange,
  knownPlace?: LondonPlace,
): AppEvent | null => {
  const iso = buildIso(e);
  if (!iso || !isInRange(iso, range)) return null;

  const place =
    knownPlace ?? findLondonPlace(e.strVenue, e.strHomeTeam) ?? null;
  if (!place) return null;

  const title =
    e.strEvent ||
    e.strEventAlternate ||
    (e.strHomeTeam && e.strAwayTeam
      ? `${e.strHomeTeam} vs ${e.strAwayTeam}`
      : `${subCategoryFor(e.strSport, e.strLeague)} fixture`);

  const sub = subCategoryFor(e.strSport, e.strLeague);
  return {
    id: `tsdb-${e.idEvent}`,
    source: 'thesportsdb',
    category: 'sports',
    title,
    startsAt: iso,
    endsAt: defaultEndsAt(iso, sub),
    venue: place.venue,
    latitude: place.latitude,
    longitude: place.longitude,
    description:
      cleanDescription(e.strDescriptionEN) ??
      (e.strLeague ? e.strLeague : undefined),
    subCategory: sub,
  };
};

const fetchVenueSchedule = async (venueId: number): Promise<TsdbEvent[]> => {
  const url = `${V2_BASE}/schedule/next/venue/${venueId}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-API-KEY': PREMIUM_KEY },
    });
    if (!res.ok) {
      console.warn('[sportsdb v2] non-OK', venueId, res.status);
      return [];
    }
    const json = (await res.json()) as TsdbResponse;
    return json.schedule ?? json.events ?? [];
  } catch (e) {
    console.warn('[sportsdb v2] network error', venueId, e);
    return [];
  }
};

const venueIdCache = new Map<string, number | null>();

const searchTermsFor = (place: LondonPlace): string[] => {
  const full = place.venue;
  const trimmed = full
    .replace(/\b(Cricket Ground|Community Stadium|National Sports Centre)\b/i, '')
    .trim();
  return trimmed && trimmed !== full ? [full, trimmed] : [full];
};

/** Prefer hardcoded sportsdbVenueId; fall back to searchvenues.php once. */
const resolveVenueId = async (place: LondonPlace): Promise<number | null> => {
  if (typeof place.sportsdbVenueId === 'number') return place.sportsdbVenueId;
  if (venueIdCache.has(place.venue)) return venueIdCache.get(place.venue) ?? null;

  for (const term of searchTermsFor(place)) {
    try {
      const res = await fetch(
        `${V1_BASE(PREMIUM_KEY || FREE_KEY)}/searchvenues.php?t=${encodeURIComponent(term)}`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        venues?: { idVenue?: string; strVenue?: string; strCountry?: string }[];
      };
      const candidates = json.venues ?? [];
      const hit =
        candidates.find((v) =>
          (v.strCountry ?? '').toLowerCase().includes('england'),
        ) ?? candidates[0];
      const id = hit?.idVenue != null ? parseInt(hit.idVenue, 10) : NaN;
      if (Number.isFinite(id)) {
        venueIdCache.set(place.venue, id);
        return id;
      }
    } catch (e) {
      console.warn('[sportsdb] venue-id lookup failed', place.venue, e);
    }
  }
  venueIdCache.set(place.venue, null);
  return null;
};

const fetchPremiumByVenue = async (range: DateRange): Promise<AppEvent[]> => {
  const resolved = await Promise.all(
    LONDON_VENUE_LIST.map(async (v) => ({
      place: v,
      id: await resolveVenueId(v),
    })),
  );
  const venuesWithIds = resolved
    .filter((r): r is { place: LondonPlace; id: number } => r.id != null)
    .map((r) => ({ ...r.place, sportsdbVenueId: r.id }));

  const unresolvedCritical = resolved
    .filter((r) => r.id == null && CRITICAL_VENUE_NAMES.has(r.place.venue))
    .map((r) => r.place.venue);
  if (unresolvedCritical.length > 0) {
    console.warn(
      `[sportsdb v2] CRITICAL venues with no SportsDB id: ${unresolvedCritical.join(', ')}`,
    );
  }

  console.log(
    `[sportsdb v2] venue ids resolved for ${venuesWithIds.length}/${LONDON_VENUE_LIST.length} venues`,
  );

  if (venuesWithIds.length === 0) {
    console.warn(
      '[sportsdb v2] no venue IDs could be resolved — venue loop skipped this fetch.',
    );
    return [];
  }

  const batches = await Promise.all(
    venuesWithIds.map(async (v) => ({
      events: await fetchVenueSchedule(v.sportsdbVenueId),
      place: v,
    })),
  );

  const out: AppEvent[] = [];
  const seen = new Set<string>();
  const emptyCritical: string[] = [];

  for (const { events, place } of batches) {
    let kept = 0;
    for (const e of events) {
      if (seen.has(e.idEvent)) continue;
      const norm = normalise(e, range, place);
      if (!norm) continue;
      seen.add(e.idEvent);
      out.push(norm);
      kept++;
    }
    if (kept === 0 && CRITICAL_VENUE_NAMES.has(place.venue)) {
      emptyCritical.push(
        `${place.venue}(raw=${events.length})`,
      );
    }
  }

  if (emptyCritical.length > 0) {
    console.warn(
      `[sportsdb v2] CRITICAL venues returned 0 in-range events: ${emptyCritical.join(', ')} — ` +
        'verify against club fixtures; may be genuinely dark or a provider gap.',
    );
  }

  console.log(
    `[sportsdb v2] ${venuesWithIds.length} venues queried, ${out.length} London events in range`,
  );
  return out;
};

const fetchLeagueNext = async (
  leagueId: number,
  leagueName: string,
): Promise<TsdbEvent[]> => {
  const url = `${V1_BASE(FREE_KEY)}/eventsnextleague.php?id=${leagueId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[sportsdb v1] non-OK', leagueName, res.status);
      return [];
    }
    const json = (await res.json()) as TsdbResponse;
    return json.events ?? [];
  } catch (e) {
    console.warn('[sportsdb v1] network error', leagueName, e);
    return [];
  }
};

const fetchFreeTierByLeague = async (
  range: DateRange,
): Promise<AppEvent[]> => {
  const batches = await Promise.all(
    FREE_TIER_LEAGUES.map(async (l) => ({
      events: await fetchLeagueNext(l.id, l.name),
      league: l,
    })),
  );

  let totalRaw = 0;
  let droppedNotLondon = 0;
  let droppedOutOfRange = 0;
  const out: AppEvent[] = [];
  const seen = new Set<string>();

  for (const { events, league } of batches) {
    totalRaw += events.length;
    for (const e of events) {
      if (seen.has(e.idEvent)) continue;

      const place = findLondonPlace(e.strVenue, e.strHomeTeam);
      if (!place) {
        droppedNotLondon++;
        continue;
      }

      const norm = normalise(
        { ...e, strSport: e.strSport ?? league.sub },
        range,
        place,
      );
      if (!norm) {
        droppedOutOfRange++;
        continue;
      }

      seen.add(e.idEvent);
      out.push(norm);
    }
  }

  console.log(
    `[sportsdb v1] ${FREE_TIER_LEAGUES.length} leagues queried, ` +
      `${totalRaw} raw fixtures → ${out.length} London events ` +
      `(dropped: ${droppedNotLondon} non-London, ${droppedOutOfRange} out of range)`,
  );
  return out;
};

/**
 * Returns every London sports event in the date range, regardless of league
 * or sport. Routes through Premium (v2 venue schedule) when a Premium key is
 * configured, falling back to the free-tier league pull otherwise.
 */
export async function fetchSportsLondon(range: DateRange): Promise<AppEvent[]> {
  if (!PREMIUM_KEY) {
    console.warn(
      '[sportsdb] EXPO_PUBLIC_SPORTSDB_API_KEY not set — free-tier league fallback only. ' +
        'Football home fixtures/friendlies still load via FotMob (no key). ' +
        'Premium only needed for the all-sports venue loop.',
    );
  }

  const out = PREMIUM_KEY
    ? await fetchPremiumByVenue(range)
    : await fetchFreeTierByLeague(range);

  return out.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}
