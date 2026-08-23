import { findLondonPlace, resolveEventPlace } from '@/data/londonVenues';
import type { AppEvent } from '@/types/event';
import {
  eventOverlapsRange,
  type DateRange,
} from '@/utils/dateFilters';
import { defaultEndsAt } from '@/utils/duration';
import { londonDayBounds, londonYmd } from '@/utils/ukTime';

/**
 * London cricket fixtures via ESPN's web cricket API.
 *
 * ESPN's main site.api.espn.com cricket scoreboard feeds use stale numeric
 * league IDs (e.g. 19531 → a 2019 Kenya tour) and return 0 events for the
 * current season. The hs-consumer-api.espncricinfo.com endpoints are Akamai-
 * blocked from many networks (403).
 *
 * What works (verified Jul 2026):
 *   1. Personalized header — lists every active cricket series + today's matches
 *      GET site.web.api.espn.com/.../scoreboard/header?sport=cricket&region=gb
 *   2. Per-series calendar — scoreboard?limit=200 returns a `calendar[]` of match
 *      days for that series
 *   3. Per-day fixtures — scoreboard?dates=YYYYMMDD returns that day's slate
 *      with full venue names (Lord's, Kennington Oval, …)
 *
 * We discover series dynamically from the header, walk each series' calendar
 * for days overlapping the requested range, and resolve venues through the
 * curated London map. Still undocumented / unsupported — same caveat as the
 * rest of the ESPN pipeline.
 */

const WEB_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket';
const HEADER_URL =
  'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=gb&tz=Europe/London';

/** Used when the personalized header is empty or unreachable. IDs verified Jul 2026. */
const FALLBACK_LEAGUES: { id: string; name: string }[] = [
  { id: '19601', name: "The Hundred Men's Competition" },
  { id: '21376', name: "The Hundred Women's Competition" },
  { id: '8335', name: 'Royal London One-Day Cup' },
];

interface EspnVenue {
  fullName?: string;
  address?: { city?: string; country?: string };
}
interface EspnTeam {
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
}
interface EspnCompetitor {
  homeAway?: 'home' | 'away' | string;
  team?: EspnTeam;
  score?: string;
}
interface EspnCompetition {
  venue?: EspnVenue;
  competitors?: EspnCompetitor[];
}
interface EspnEvent {
  id: string;
  date: string;
  endDate?: string;
  name?: string;
  shortName?: string;
  competitions?: EspnCompetition[];
}
interface EspnScoreboardResponse {
  leagues?: { calendar?: string[]; name?: string }[];
  events?: EspnEvent[];
}
interface EspnHeaderLeague {
  id?: string | number;
  name?: string;
  events?: EspnEvent[];
}
interface EspnHeaderResponse {
  sports?: { leagues?: EspnHeaderLeague[] }[];
}

// London calendar day, not the device's — see the same note in espn.ts.
const yyyymmdd = (d: Date): string => londonYmd(d).replace(/-/g, '');


const subCategoryFor = (seriesName: string, description: string): string => {
  const hay = `${seriesName} ${description}`.toLowerCase();
  if (hay.includes('hundred') || hay.includes('t20 blast') || hay.includes('t20'))
    return 'Cricket T20';
  if (hay.includes('one-day') || hay.includes('one day') || hay.includes('odi'))
    return 'Cricket ODI';
  if (hay.includes('test')) return 'Cricket Test';
  if (hay.includes('county') || hay.includes('championship')) return 'Cricket';
  return 'Cricket';
};

const buildTitle = (event: EspnEvent): string => {
  const comp = event.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === 'home');
  const away = comp?.competitors?.find((c) => c.homeAway === 'away');
  const homeName =
    home?.team?.abbreviation ??
    home?.team?.shortDisplayName ??
    home?.team?.displayName ??
    '';
  const awayName =
    away?.team?.abbreviation ??
    away?.team?.shortDisplayName ??
    away?.team?.displayName ??
    '';
  if (homeName && awayName) {
    const hs = home?.score;
    const as = away?.score;
    if (hs || as) return `${homeName} ${hs ?? '-'} vs ${awayName} ${as ?? '-'}`;
    return `${homeName} vs ${awayName}`;
  }
  return event.shortName ?? event.name ?? 'Cricket match';
};

const fetchJson = async <T>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (e) {
    console.warn('[cricinfo] network error', url, e);
    return null;
  }
};

/** Active cricket series IDs from the personalized header. */
const discoverLeagueIds = async (): Promise<{ id: string; name: string }[]> => {
  const json = await fetchJson<EspnHeaderResponse>(HEADER_URL);
  const leagues = json?.sports?.[0]?.leagues ?? [];
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const l of leagues) {
    const id = l.id != null ? String(l.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: l.name ?? 'Cricket' });
  }
  if (out.length > 0) return out;
  console.warn('[cricinfo] header empty/unreachable — using fallback league list');
  return FALLBACK_LEAGUES;
};

const calendarDaysInRange = (
  calendar: string[],
  range: DateRange,
): string[] => {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  const days = new Set<string>();
  for (const iso of calendar) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) continue;
    // Day chips are London days; use London midnight bounds (not device TZ).
    const ymd = londonYmd(d);
    const { start: dayStart, end: dayEnd } = londonDayBounds(ymd);
    if (dayStart.getTime() <= endMs && dayEnd.getTime() >= startMs) {
      days.add(yyyymmdd(d));
    }
  }
  return [...days];
};

async function fetchDayBoards(
  leagueId: string,
  days: string[],
): Promise<(EspnScoreboardResponse | null)[]> {
  // Keep pressure low on ESPN web endpoints to avoid random 403/slowdowns.
  const BATCH = 4;
  const out: (EspnScoreboardResponse | null)[] = [];
  for (let i = 0; i < days.length; i += BATCH) {
    const chunk = days.slice(i, i + BATCH);
    const rows = await Promise.all(
      chunk.map((day) =>
        fetchJson<EspnScoreboardResponse>(
          `${WEB_BASE}/${leagueId}/scoreboard?dates=${day}&limit=50`,
        ),
      ),
    );
    out.push(...rows);
  }
  return out;
}

const normaliseEvent = (
  event: EspnEvent,
  seriesName: string,
  range: DateRange,
): AppEvent | null => {
  if (!event.date) return null;

  const comp = event.competitions?.[0];
  const venueName = comp?.venue?.fullName ?? null;
  const home = comp?.competitors?.find((c) => c.homeAway === 'home');
  const homeName =
    home?.team?.displayName ?? home?.team?.shortDisplayName ?? '';

  const place = resolveEventPlace(venueName, homeName);
  if (!place) return null;

  const subCategory = subCategoryFor(seriesName, event.name ?? '');
  const endsAt = event.endDate ?? defaultEndsAt(event.date, subCategory);
  if (!eventOverlapsRange(event.date, endsAt, range)) return null;

  return {
    id: `cric-${event.id}`,
    source: 'espn',
    category: 'sports',
    title: buildTitle(event),
    startsAt: event.date,
    endsAt,
    venue: place.venue,
    latitude: place.latitude,
    longitude: place.longitude,
    description: seriesName,
    subCategory,
  };
};

export async function fetchCricinfoLondon(
  range: DateRange,
): Promise<AppEvent[]> {
  const leagues = await discoverLeagueIds();
  if (leagues.length === 0) {
    console.warn('[cricinfo] no cricket series available');
    return [];
  }

  const out: AppEvent[] = [];
  const seenIds = new Set<string>();
  let rawMatches = 0;
  let droppedNotLondon = 0;
  let droppedOutOfRange = 0;

  // Walk each active series: calendar → per-day scoreboard.
  await Promise.all(
    leagues.map(async ({ id, name }) => {
      const meta = await fetchJson<EspnScoreboardResponse>(
        `${WEB_BASE}/${id}/scoreboard?limit=200`,
      );
      const calendar = meta?.leagues?.[0]?.calendar ?? [];
      const days = calendarDaysInRange(calendar, range);
      if (days.length === 0) return;

      const dayResults = await fetchDayBoards(id, days);

      for (const board of dayResults) {
        for (const event of board?.events ?? []) {
          rawMatches++;
          const norm = normaliseEvent(event, name, range);
          if (!norm) {
            const comp = event.competitions?.[0];
            const venueName = comp?.venue?.fullName ?? '';
            if (venueName && !findLondonPlace(venueName)) droppedNotLondon++;
            else droppedOutOfRange++;
            continue;
          }
          if (seenIds.has(norm.id)) continue;
          seenIds.add(norm.id);
          out.push(norm);
        }
      }
    }),
  );

  console.log(
    `[cricinfo] ${rawMatches} raw cricket fixtures across ${leagues.length} series → ${out.length} London events ` +
      `(dropped: ${droppedNotLondon} non-London, ${droppedOutOfRange} out of range)`,
  );
  return out.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}
