import { findLondonPlace } from '@/data/londonVenues';
import type { AppEvent } from '@/types/event';
import { isInRange, type DateRange } from '@/utils/dateFilters';
import { defaultEndsAt } from '@/utils/duration';

/**
 * Football-Data.org — free-tier service for real, current football fixtures.
 *
 * Docs: https://www.football-data.org/documentation/quickstart
 *
 * Why this exists: TheSportsDB's free tier is artificially crippled to a
 * handful of seeded queries and returns near-zero current data. Football-
 * Data.org's free tier ACTUALLY returns live fixtures — Premier League,
 * Championship, FA Cup, Champions League — with no per-query lockdown.
 *
 * Authentication
 * --------------
 * Header `X-Auth-Token: <your token>`. Token is issued for free at signup,
 * stored in `EXPO_PUBLIC_FOOTBALLDATA_API_KEY`. The service no-ops cleanly
 * if no token is set, so unconfigured installs don't error.
 *
 * Throttling
 * ----------
 * Free tier: 10 requests per minute. We only ever make ONE call per refresh
 * (the `/matches?dateFrom=...&dateTo=...` endpoint returns every fixture in
 * a window across all competitions on your subscription), so we're miles
 * under the limit in normal operation. If we ever hit 429, we honour the
 * `X-RequestCounter-Reset` header and back off rather than retry-stampeding.
 *
 * Coordinates
 * -----------
 * Football-Data.org returns a `venue` name string (and only sometimes) — no
 * lat/long. We resolve coordinates through the curated `londonVenues.ts` map
 * using venue name first, then home-team name as the fallback. Any fixture
 * we can't pin to a known London venue is dropped (that's the point — the
 * map is London-only).
 */

const API_KEY = process.env.EXPO_PUBLIC_FOOTBALLDATA_API_KEY ?? '';
const BASE = 'https://api.football-data.org/v4';

interface FdTeam {
  id: number;
  name: string;
  shortName?: string;
  tla?: string;
}

interface FdCompetition {
  id: number;
  name: string;
  code: string;
}

interface FdScore {
  winner?: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
  duration?: string;
  fullTime?: { home: number | null; away: number | null };
  halfTime?: { home: number | null; away: number | null };
}

interface FdMatch {
  id: number;
  utcDate: string; // "2026-05-30T14:00:00Z"
  status: string; // 'SCHEDULED' | 'LIVE' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | ...
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  competition: FdCompetition;
  venue?: string | null;
  score?: FdScore;
}

interface FdMatchesResponse {
  matches?: FdMatch[];
  resultSet?: { count?: number };
  count?: number;
}

const fmtDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDays = (d: Date, days: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

/**
 * football-data.org's free tier rejects any /matches query whose date span
 * is greater than 10 days ({"errorCode":400,"message":"Specified period
 * must not exceed 10 days."}). To support our wider "All" window we slice
 * the requested range into <=10-day chunks and fan out.
 */
const chunkRange = (range: DateRange, maxDays = 10): DateRange[] => {
  const out: DateRange[] = [];
  let cursor = new Date(range.start);
  const end = new Date(range.end);
  while (cursor.getTime() <= end.getTime()) {
    // -1 because the API treats both endpoints as inclusive, so a 10-day
    // window from "2026-05-19" runs through "2026-05-28".
    const chunkEnd = addDays(cursor, maxDays - 1);
    out.push({
      start: new Date(cursor),
      end: chunkEnd.getTime() < end.getTime() ? chunkEnd : new Date(end),
    });
    cursor = addDays(cursor, maxDays);
  }
  return out;
};

const fetchChunk = async (
  chunk: DateRange,
): Promise<{ matches: FdMatch[]; error?: string }> => {
  const url = `${BASE}/matches?dateFrom=${fmtDate(chunk.start)}&dateTo=${fmtDate(chunk.end)}`;
  try {
    const res = await fetch(url, { headers: { 'X-Auth-Token': API_KEY } });
    if (res.status === 429) {
      const resetIn = res.headers.get('X-RequestCounter-Reset') ?? '?';
      return {
        matches: [],
        error: `rate-limited — resets in ${resetIn}s (free tier is 10 req/min)`,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { matches: [], error: `${res.status} ${body.slice(0, 120)}` };
    }
    const json = (await res.json()) as FdMatchesResponse;
    return { matches: json.matches ?? [] };
  } catch (e: unknown) {
    return { matches: [], error: (e as Error)?.message ?? 'network error' };
  }
};

export async function fetchFootballDataLondon(
  range: DateRange,
): Promise<AppEvent[]> {
  if (!API_KEY) {
    console.warn(
      '[football-data] EXPO_PUBLIC_FOOTBALLDATA_API_KEY not set — skipping',
    );
    return [];
  }

  // Split the requested range into ≤10-day chunks so we don't trip the
  // free-tier "Specified period must not exceed 10 days" guard.
  const chunks = chunkRange(range, 10);
  const results = await Promise.all(chunks.map(fetchChunk));

  const errors = results.filter((r) => r.error).map((r) => r.error!);
  if (errors.length) {
    console.warn(
      `[football-data] ${errors.length}/${chunks.length} chunks failed:`,
      errors.slice(0, 3).join(' | '),
    );
  }

  // Merge + dedupe by match id (chunks shouldn't overlap, but be safe).
  const matchMap = new Map<number, FdMatch>();
  for (const r of results) {
    for (const m of r.matches) matchMap.set(m.id, m);
  }
  const matches = Array.from(matchMap.values());

  // Diagnostic: tally every fixture by competition + flag the English ones
  // by name. Tells us whether English football is in the free-tier feed at
  // all (vs filed under a competition we don't have access to), and surfaces
  // any Wembley fixtures present but buried later in the sort order.
  if (matches.length > 0) {
    const byComp: Record<string, number> = {};
    const english: { comp: string; home: string; away: string; date: string }[] = [];
    for (const m of matches) {
      const comp = m.competition?.name ?? 'Unknown';
      byComp[comp] = (byComp[comp] ?? 0) + 1;
      const home = m.homeTeam?.name ?? '';
      const away = m.awayTeam?.name ?? '';
      const tag = `${comp} ${home} ${away}`.toLowerCase();
      if (
        tag.includes('premier league') ||
        tag.includes('championship') ||
        tag.includes('league one') ||
        tag.includes('league two') ||
        tag.includes('national league') ||
        tag.includes('fa cup') ||
        tag.includes('community shield') ||
        tag.includes('league cup') ||
        tag.includes('england')
      ) {
        english.push({
          comp,
          home,
          away,
          date: m.utcDate?.slice(0, 10) ?? '?',
        });
      }
    }
    const compSummary = Object.entries(byComp)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(`[football-data] competitions in feed: ${compSummary}`);
    if (english.length > 0) {
      console.log(`[football-data] ${english.length} English fixtures detected:`);
      for (const e of english.slice(0, 10)) {
        console.log(`  • ${e.date} ${e.comp}: ${e.home} vs ${e.away}`);
      }
    } else {
      console.log('[football-data] no English fixtures in this window');
    }
  }

  let droppedNotLondon = 0;
  let droppedOutOfRange = 0;
  const out: AppEvent[] = [];
  const seen = new Set<string>();

  for (const m of matches) {
    const id = `fd-${m.id}`;
    if (seen.has(id)) continue;

    // Try the explicit venue first (often missing on free tier), then the
    // home-team name (which our curated map always knows for London clubs).
    const place = findLondonPlace(
      m.venue ?? null,
      m.homeTeam?.name,
      m.homeTeam?.shortName,
    );
    if (!place) {
      droppedNotLondon++;
      continue;
    }

    if (!isInRange(m.utcDate, range)) {
      droppedOutOfRange++;
      continue;
    }

    const homeName = m.homeTeam?.shortName ?? m.homeTeam?.name ?? 'Home';
    const awayName = m.awayTeam?.shortName ?? m.awayTeam?.name ?? 'Away';

    // For FINISHED / IN_PLAY matches surface the score in the pin title
    // instead of "Home vs Away" — way more useful when a user taps a past
    // result on the map. SCHEDULED matches keep the "vs" formatting.
    const status = (m.status ?? '').toUpperCase();
    const home = m.score?.fullTime?.home;
    const away = m.score?.fullTime?.away;
    const hasScore = typeof home === 'number' && typeof away === 'number';

    let title: string;
    let descriptionPrefix = '';
    if (status === 'FINISHED' && hasScore) {
      title = `${homeName} ${home}-${away} ${awayName}`;
      descriptionPrefix = 'Final · ';
    } else if ((status === 'IN_PLAY' || status === 'LIVE' || status === 'PAUSED') && hasScore) {
      title = `${homeName} ${home}-${away} ${awayName}`;
      descriptionPrefix = 'Live · ';
    } else {
      title = `${homeName} vs ${awayName}`;
    }

    seen.add(id);
    out.push({
      id,
      source: 'football-data',
      category: 'sports',
      title,
      startsAt: m.utcDate,
      endsAt: defaultEndsAt(m.utcDate, 'Football'),
      venue: place.venue,
      latitude: place.latitude,
      longitude: place.longitude,
      description: `${descriptionPrefix}${m.competition?.name ?? ''}`.trim(),
      subCategory: 'Football',
    });
  }

  // Same diagnostics-friendly log shape as the sportsdb free-tier fallback,
  // so the console immediately tells you whether the API returned nothing,
  // returned non-London fixtures, or returned fixtures outside the range.
  console.log(
    `[football-data] ${matches.length} raw fixtures → ${out.length} London events ` +
      `(dropped: ${droppedNotLondon} non-London, ${droppedOutOfRange} out of range)`,
  );
  return out;
}
