import { resolveEventPlace } from '@/data/londonVenues';
import type { AppEvent } from '@/types/event';
import { isInRange, type DateRange } from '@/utils/dateFilters';
import { defaultEndsAt } from '@/utils/duration';
import { londonYmd } from '@/utils/ukTime';

/**
 * ESPN scoreboard (unofficial public endpoints) — ALL sports.
 *
 * Base URL pattern: https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard
 *
 * Where {path} is e.g. `soccer/eng.1`, `cricket/eng.test`,
 * `rugby/eng.premiership`, `football/nfl`, `basketball/nba`, `boxing`, `mma/ufc`.
 *
 * One service replaces what used to need separate adapters. We fan out across
 * every London-relevant feed in parallel; results are normalised into the
 * shared `AppEvent` shape so they slot into the existing map markers and
 * filter logic without any downstream changes.
 *
 * IMPORTANT: ESPN's endpoints are undocumented and unsupported. They reserve
 * the right to change or remove them without notice. Used here because no
 * other free source delivers comparable cross-sport breadth.
 *
 * Coverage: soccer (every English division + women's + friendlies + UCL +
 * WC), cricket (Test, county championship, T20 Blast, ODI, internationals),
 * rugby (Premiership, Championship, Six Nations, World Cup), NFL, NBA,
 * boxing, UFC/MMA.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

interface SportFeed {
  /** Path segment used in the URL, e.g. "soccer/eng.1" or "boxing". */
  path: string;
  /** Human-readable competition name used in the pin description. */
  label: string;
  /** Sub-category fed into pinDescriptorFor for icon selection
   *  (Football / Cricket / Rugby / Basketball / Boxing / etc). */
  sub: string;
}

const SPORT_FEEDS: SportFeed[] = [
  // ── Soccer (English football) ───────────────────────────────────────
  { path: 'soccer/eng.1', label: 'Premier League', sub: 'Football' },
  { path: 'soccer/eng.2', label: 'Championship', sub: 'Football' },
  { path: 'soccer/eng.3', label: 'League One', sub: 'Football' },
  { path: 'soccer/eng.4', label: 'League Two', sub: 'Football' },
  { path: 'soccer/eng.5', label: 'National League', sub: 'Football' },
  { path: 'soccer/eng.fa', label: 'FA Cup', sub: 'Football' },
  { path: 'soccer/eng.league_cup', label: 'EFL Cup', sub: 'Football' },
  { path: 'soccer/eng.charity', label: 'Community Shield', sub: 'Football' },
  { path: 'soccer/eng.w.1', label: 'Women’s Super League', sub: 'Football' },
  { path: 'soccer/eng.w.fa', label: 'Women’s FA Cup', sub: 'Football' },
  { path: 'soccer/fifa.friendly', label: 'International Friendlies', sub: 'Football' },
  // Club pre-season friendlies (Emirates Cup, summer warm-ups at London
  // grounds). Verified live 23 Jul 2026 — feed carries worldwide club
  // friendlies; findLondonPlace() below keeps only London-hosted ones.
  // Client requirement: pre-season must be 100% covered before the new
  // season starts.
  { path: 'soccer/club.friendly', label: 'Pre-season Friendly', sub: 'Football' },
  { path: 'soccer/uefa.champions', label: 'UEFA Champions League', sub: 'Football' },
  { path: 'soccer/uefa.europa', label: 'UEFA Europa League', sub: 'Football' },
  { path: 'soccer/fifa.world', label: 'FIFA World Cup', sub: 'Football' },

  // Cricket is fetched separately via fetchCricinfoLondon() (ESPN web cricket
  // calendar API). The static cricket/* scoreboard slugs here use stale league
  // IDs and return 0 current-season fixtures — do not re-add them.

  // ── Rugby ───────────────────────────────────────────────────────────
  // Twickenham, StoneX (Saracens), the Stoop (Harlequins).
  // ESPN rugby uses numeric league IDs (not dashed slugs like soccer);
  // dashed paths return HTTP 400. League IDs come from the dropdown at
  // site.web.api.espn.com/apis/site/v2/leagues/dropdown?sport=rugby.
  { path: 'rugby/267979', label: 'Premiership Rugby', sub: 'Rugby' },
  { path: 'rugby/270557', label: 'United Rugby Championship', sub: 'Rugby' },
  { path: 'rugby/271937', label: 'European Champions Cup', sub: 'Rugby' },
  { path: 'rugby/272073', label: 'European Challenge Cup', sub: 'Rugby' },
  { path: 'rugby/180659', label: 'Six Nations', sub: 'Rugby' },
  { path: 'rugby/164205', label: 'Rugby World Cup', sub: 'Rugby' },
  { path: 'rugby/289234', label: 'International Test Match', sub: 'Rugby' },
  { path: 'rugby/268565', label: 'British and Irish Lions Tour', sub: 'Rugby' },

  // ── American sports (London games / pre-season tours) ──────────────
  // NFL London games (Wembley + Tottenham), NBA London exhibition.
  { path: 'football/nfl', label: 'NFL', sub: 'American Football' },
  { path: 'basketball/nba', label: 'NBA', sub: 'Basketball' },
  { path: 'basketball/wnba', label: 'WNBA', sub: 'Basketball' },

  // ── Combat sports ──────────────────────────────────────────────────
  // O2 Arena, Wembley boxing nights, UFC London.
  { path: 'boxing', label: 'Boxing', sub: 'Boxing' },
  { path: 'mma/ufc', label: 'UFC', sub: 'MMA' },
];

interface EspnVenueAddress {
  city?: string;
  country?: string;
  state?: string;
}
interface EspnVenue {
  fullName?: string;
  address?: EspnVenueAddress;
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
  athlete?: { displayName?: string; shortName?: string };
}
interface EspnStatusType {
  name?: string;
  state?: string; // 'pre' | 'post' | 'in'
  completed?: boolean;
}
interface EspnStatus {
  type?: EspnStatusType;
}
interface EspnCompetition {
  venue?: EspnVenue;
  competitors?: EspnCompetitor[];
}
interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  shortName?: string;
  status?: EspnStatus;
  competitions?: EspnCompetition[];
}
interface EspnScoreboardResponse {
  events?: EspnEvent[];
}

// The range boundaries are London day edges, so they must be formatted in
// London too. Using the device calendar shifted the queried day for anyone
// west of UTC and dropped a day's fixtures.
const yyyymmdd = (d: Date): string => londonYmd(d).replace(/-/g, '');

const fetchFeed = async (
  feed: SportFeed,
  range: DateRange,
): Promise<EspnEvent[]> => {
  const url = `${BASE}/${feed.path}/scoreboard?dates=${yyyymmdd(
    range.start,
  )}-${yyyymmdd(range.end)}&limit=200`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 400/404 here usually means ESPN doesn't have this competition right
      // now (off-season) or the slug isn't valid for the date range. Quiet
      // log rather than warn — too many feeds for noisy individual warnings.
      if (res.status !== 400 && res.status !== 404) {
        console.warn('[espn]', feed.path, 'non-OK', res.status);
      }
      return [];
    }
    const json = (await res.json()) as EspnScoreboardResponse;
    return json.events ?? [];
  } catch (e) {
    console.warn('[espn]', feed.path, 'network error', e);
    return [];
  }
};

const isFinished = (s?: EspnStatus): boolean =>
  s?.type?.state === 'post' ||
  s?.type?.completed === true ||
  s?.type?.name === 'STATUS_FINAL';

const isLive = (s?: EspnStatus): boolean =>
  s?.type?.state === 'in' || s?.type?.name === 'STATUS_IN_PROGRESS';

/**
 * For 2-team fixtures (soccer/cricket/rugby/NFL/NBA) we have home/away
 * competitors. For individual sports (boxing/MMA) competitors carry an
 * `athlete` rather than a team. This builds a sensible pin title for both.
 */
const buildTitle = (
  event: EspnEvent,
): { title: string; hasScore: boolean } => {
  const comp = event.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === 'home');
  const away = comp?.competitors?.find((c) => c.homeAway === 'away');

  const homeName =
    home?.team?.shortDisplayName ??
    home?.team?.displayName ??
    home?.athlete?.shortName ??
    home?.athlete?.displayName ??
    '';
  const awayName =
    away?.team?.shortDisplayName ??
    away?.team?.displayName ??
    away?.athlete?.shortName ??
    away?.athlete?.displayName ??
    '';

  const homeScore = home?.score;
  const awayScore = away?.score;
  const hasScore =
    homeScore != null &&
    awayScore != null &&
    homeScore !== '' &&
    awayScore !== '';

  // Individual-sport events often pack everything into `event.name`
  // (e.g. "Joshua vs Wilder · Heavyweight Title"). Use that when teams are
  // unavailable.
  if (!homeName && !awayName) {
    return { title: event.name ?? event.shortName ?? 'Event', hasScore };
  }

  if (isFinished({ type: { state: 'post' } }) && hasScore) {
    // unused — real check happens at call site
  }

  if (hasScore) {
    return {
      title: `${homeName} ${homeScore}-${awayScore} ${awayName}`,
      hasScore: true,
    };
  }
  return { title: `${homeName} vs ${awayName}`, hasScore: false };
};

export async function fetchEspnLondon(range: DateRange): Promise<AppEvent[]> {
  const results = await Promise.all(
    SPORT_FEEDS.map(async (feed) => ({
      events: await fetchFeed(feed, range),
      feed,
    })),
  );

  let totalRaw = 0;
  let droppedNotLondon = 0;
  let droppedOutOfRange = 0;
  const bySport: Record<string, number> = {};
  const out: AppEvent[] = [];
  const seen = new Set<string>();

  for (const { events, feed } of results) {
    totalRaw += events.length;
    if (events.length > 0) {
      bySport[feed.sub] = (bySport[feed.sub] ?? 0) + events.length;
    }

    for (const e of events) {
      const id = `espn-${e.id}`;
      if (seen.has(id)) continue;

      const comp = e.competitions?.[0];
      const venueName = comp?.venue?.fullName ?? null;
      const home = comp?.competitors?.find((c) => c.homeAway === 'home');
      const homeName =
        home?.team?.displayName ?? home?.team?.shortDisplayName ?? '';

      const place = resolveEventPlace(venueName, homeName);
      if (!place) {
        droppedNotLondon++;
        continue;
      }

      if (!isInRange(e.date, range)) {
        droppedOutOfRange++;
        continue;
      }

      const { title, hasScore } = buildTitle(e);
      let finalTitle = title;
      let descriptionPrefix = '';
      if (isFinished(e.status) && hasScore) {
        descriptionPrefix = 'Final · ';
      } else if (isLive(e.status) && hasScore) {
        descriptionPrefix = 'Live · ';
      } else if (!hasScore) {
        // pure-scheduled event — fall through; title already "Home vs Away"
        finalTitle = title;
      }

      seen.add(id);
      out.push({
        id,
        source: 'espn',
        category: 'sports',
        title: finalTitle,
        startsAt: e.date,
        endsAt: defaultEndsAt(e.date, feed.sub),
        venue: place.venue,
        latitude: place.latitude,
        longitude: place.longitude,
        description: `${descriptionPrefix}${feed.label}`,
        subCategory: feed.sub,
      });
    }
  }

  const sportSummary =
    Object.entries(bySport)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'none';
  console.log(
    `[espn] ${totalRaw} raw fixtures across ${SPORT_FEEDS.length} feeds ` +
      `(${sportSummary}) → ${out.length} London events ` +
      `(dropped: ${droppedNotLondon} non-London, ${droppedOutOfRange} out of range)`,
  );

  // Per-feed breakdown — exposes broken slugs (consistent 0 returns in-
  // season) so we can tell which paths ESPN doesn't recognise.
  const perFeedLines: string[] = [];
  const deadFeeds: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const { events, feed } = results[i];
    perFeedLines.push(`${feed.path}=${events.length}`);
    if (events.length === 0) deadFeeds.push(feed.path);
  }
  console.log(`[espn] per-feed: ${perFeedLines.join(', ')}`);
  if (deadFeeds.length > 0) {
    console.log(
      `[espn] ${deadFeeds.length} feeds returned 0 (could be off-season or invalid slug): ${deadFeeds.join(', ')}`,
    );
  }

  return out.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}
