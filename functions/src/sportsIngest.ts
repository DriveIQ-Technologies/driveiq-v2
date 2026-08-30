/**
 * London sports ingest: FotMob home football ICS + ESPN scoreboards + cricket.
 * Ticketmaster does not carry league fixtures — this is the sports backbone.
 */
import { logger } from 'firebase-functions';
import { addDaysYmd, londonYmd, ukOffset } from './londonTime.js';
import type { PublishedEvent } from './eventNormalise.js';
import { FOTMOB_CLUBS, findSportsPlace, resolveSportsPlace } from './londonSportsVenues.js';

const HORIZON_DAYS = 7;
const FOTMOB_ICS = (teamId: number) =>
  `https://pub.fotmob.com/prod/pub/api/v2/calendar/team/${teamId}.ics`;
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const CRIC_WEB = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket';
const CRIC_HEADER =
  'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=gb&tz=Europe/London';

const ESPN_FEEDS: { path: string; label: string; sub: string }[] = [
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
  { path: 'soccer/club.friendly', label: 'Pre-season Friendly', sub: 'Football' },
  { path: 'soccer/uefa.champions', label: 'UEFA Champions League', sub: 'Football' },
  { path: 'soccer/uefa.europa', label: 'UEFA Europa League', sub: 'Football' },
  { path: 'rugby/267979', label: 'Premiership Rugby', sub: 'Rugby' },
  { path: 'rugby/270557', label: 'United Rugby Championship', sub: 'Rugby' },
  { path: 'rugby/271937', label: 'European Champions Cup', sub: 'Rugby' },
  { path: 'rugby/272073', label: 'European Challenge Cup', sub: 'Rugby' },
  { path: 'rugby/180659', label: 'Six Nations', sub: 'Rugby' },
  { path: 'rugby/164205', label: 'Rugby World Cup', sub: 'Rugby' },
  { path: 'rugby/289234', label: 'International Test Match', sub: 'Rugby' },
  { path: 'rugby/268565', label: 'British and Irish Lions Tour', sub: 'Rugby' },
  { path: 'football/nfl', label: 'NFL', sub: 'American Football' },
  { path: 'basketball/nba', label: 'NBA', sub: 'Basketball' },
  { path: 'basketball/wnba', label: 'WNBA', sub: 'Basketball' },
  { path: 'boxing', label: 'Boxing', sub: 'Boxing' },
  { path: 'mma/ufc', label: 'UFC', sub: 'MMA' },
];

function horizon(): { start: Date; end: Date } {
  const startYmd = londonYmd();
  const endYmd = addDaysYmd(startYmd, HORIZON_DAYS);
  return {
    start: new Date(`${startYmd}T00:00:00Z`),
    end: new Date(`${endYmd}T23:59:59Z`),
  };
}

function yyyymmdd(d: Date): string {
  return londonYmd(d).replace(/-/g, '');
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3600 * 1000).toISOString();
}

function durationHours(sub: string): number {
  if (sub.includes('Test')) return 8;
  if (sub.includes('ODI')) return 7;
  if (sub.includes('T20')) return 4;
  if (sub.includes('Rugby')) return 2.5;
  if (sub.includes('Boxing') || sub.includes('MMA')) return 4;
  if (sub.includes('NFL') || sub.includes('American')) return 3.5;
  return 2.5;
}

function parseIcsDateTime(raw: string): number | null {
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (compact) {
    const [, y, mo, d, h, mi, s, z] = compact;
    const suffix = z ? 'Z' : ukOffset(`${y}-${mo}-${d}`);
    const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${suffix}`);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

async function fetchFotmob(): Promise<PublishedEvent[]> {
  const range = horizon();
  const lists = await Promise.all(
    FOTMOB_CLUBS.map(async (club) => {
      const place = findSportsPlace(club.venue);
      if (!place) return [] as PublishedEvent[];
      try {
        const res = await fetch(FOTMOB_ICS(club.teamId));
        if (!res.ok) return [];
        const ics = (await res.text()).replace(/\r?\n[ \t]/g, '');
        const out: PublishedEvent[] = [];
        for (const block of ics.split('BEGIN:VEVENT').slice(1)) {
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
            ? Date.parse(
                `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}T15:00:00${ukOffset(
                  `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`,
                )}`,
              )
            : parseIcsDateTime(dtstart);
          if (startMs == null) continue;
          if (startMs < range.start.getTime() - 6 * 3600 * 1000 || startMs > range.end.getTime()) {
            continue;
          }
          const startsAt = new Date(startMs).toISOString();
          const uid = get('UID') ?? `${club.teamId}-${startsAt}`;
          const title = summary.replace(/^[\u26BD\uFE0F\s]+/u, '').replace(/\s+\(\d+-\d+\)\s*$/, '').trim();
          out.push({
            id: `fotmob-${uid}`,
            source: 'fotmob',
            category: 'sports',
            title: title || `${club.label} home fixture`,
            startsAt,
            endsAt: addHours(startsAt, 2.5),
            venue: place.venue,
            latitude: place.latitude,
            longitude: place.longitude,
            subCategory: 'Football',
          });
        }
        return out;
      } catch (e) {
        logger.warn('events.fotmob_fail', { club: club.label, error: e instanceof Error ? e.message : 'error' });
        return [];
      }
    }),
  );
  const byId = new Map<string, PublishedEvent>();
  for (const list of lists) for (const e of list) byId.set(e.id, e);
  logger.info('events.fotmob', { count: byId.size });
  return Array.from(byId.values());
}

async function fetchEspn(): Promise<PublishedEvent[]> {
  const range = horizon();
  const dates = `${yyyymmdd(range.start)}-${yyyymmdd(range.end)}`;
  const results = await Promise.all(
    ESPN_FEEDS.map(async (feed) => {
      try {
        const res = await fetch(`${ESPN_BASE}/${feed.path}/scoreboard?dates=${dates}&limit=200`);
        if (!res.ok) return { feed, events: [] as Record<string, unknown>[] };
        const json = (await res.json()) as { events?: Record<string, unknown>[] };
        return { feed, events: json.events ?? [] };
      } catch {
        return { feed, events: [] as Record<string, unknown>[] };
      }
    }),
  );

  const out: PublishedEvent[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const { feed, events } of results) {
    for (const raw of events) {
      const id = `espn-${String(raw.id ?? '')}`;
      if (!raw.id || seen.has(id)) continue;
      const comps = raw.competitions as Array<{
        venue?: { fullName?: string };
        competitors?: Array<{
          homeAway?: string;
          team?: { displayName?: string; shortDisplayName?: string };
          athlete?: { displayName?: string; shortName?: string };
          score?: string;
        }>;
      }> | undefined;
      const comp = comps?.[0];
      const venueName = comp?.venue?.fullName ?? null;
      const home = comp?.competitors?.find((c) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c) => c.homeAway === 'away');
      const homeName = home?.team?.displayName ?? home?.athlete?.displayName ?? '';
      const place = resolveSportsPlace(venueName, homeName);
      if (!place) {
        dropped += 1;
        continue;
      }
      const startsAt = String(raw.date ?? '');
      if (!startsAt) continue;
      const t = Date.parse(startsAt);
      if (!Number.isFinite(t) || t < range.start.getTime() - 6 * 3600 * 1000 || t > range.end.getTime()) {
        continue;
      }
      const awayName =
        away?.team?.shortDisplayName ?? away?.team?.displayName ?? away?.athlete?.shortName ?? '';
      const homeShort = home?.team?.shortDisplayName ?? home?.team?.displayName ?? home?.athlete?.shortName ?? '';
      const title =
        homeShort && awayName
          ? `${homeShort} vs ${awayName}`
          : String(raw.name ?? raw.shortName ?? 'Fixture');
      seen.add(id);
      out.push({
        id,
        source: 'espn',
        category: 'sports',
        title,
        startsAt,
        endsAt: addHours(startsAt, durationHours(feed.sub)),
        venue: place.venue,
        latitude: place.latitude,
        longitude: place.longitude,
        description: feed.label,
        subCategory: feed.sub,
      });
    }
  }
  logger.info('events.espn', { count: out.length, droppedNonLondon: dropped });
  return out;
}

const LONDON_CRICKET = /\b(surrey|middlesex|essex|kent|oval invincibles|london spirit|england|mcc)\b/i;

async function fetchCricket(): Promise<PublishedEvent[]> {
  const range = horizon();
  let leagues: { id: string; name: string }[] = [
    { id: '19601', name: "The Hundred Men's Competition" },
    { id: '21376', name: "The Hundred Women's Competition" },
  ];
  try {
    const res = await fetch(CRIC_HEADER);
    if (res.ok) {
      const json = (await res.json()) as {
        sports?: { leagues?: Array<{ id?: string | number; name?: string }> }[];
      };
      const found = (json.sports?.[0]?.leagues ?? [])
        .map((l) => ({ id: l.id != null ? String(l.id) : '', name: l.name ?? 'Cricket' }))
        .filter((l) => l.id);
      if (found.length) leagues = found.slice(0, 12);
    }
  } catch {
    /* fallback list */
  }

  const out: PublishedEvent[] = [];
  const seen = new Set<string>();
  await Promise.all(
    leagues.map(async (league) => {
      try {
        const res = await fetch(`${CRIC_WEB}/${league.id}/scoreboard?limit=200`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          events?: Array<{
            id?: string;
            date?: string;
            name?: string;
            shortName?: string;
            competitions?: Array<{
              venue?: { fullName?: string };
              competitors?: Array<{
                homeAway?: string;
                team?: { displayName?: string; shortDisplayName?: string };
              }>;
            }>;
          }>;
        };
        for (const e of json.events ?? []) {
          if (!e.id || !e.date) continue;
          const id = `cric-${e.id}`;
          if (seen.has(id)) continue;
          const comp = e.competitions?.[0];
          const venueName = comp?.venue?.fullName ?? null;
          const home = comp?.competitors?.find((c) => c.homeAway === 'home');
          const away = comp?.competitors?.find((c) => c.homeAway === 'away');
          const homeName = home?.team?.displayName ?? '';
          const awayName = away?.team?.displayName ?? '';
          if (!LONDON_CRICKET.test(homeName) && !LONDON_CRICKET.test(awayName)) continue;
          const place = resolveSportsPlace(venueName);
          if (!place) continue;
          const t = Date.parse(e.date);
          if (!Number.isFinite(t) || t < range.start.getTime() || t > range.end.getTime()) continue;
          const hour = Number.parseInt(
            new Date(e.date).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              hour12: false,
              timeZone: 'Europe/London',
            }),
            10,
          );
          if (hour < 9 || hour > 20) continue;
          seen.add(id);
          const sub = /hundred|t20/i.test(league.name) ? 'Cricket T20' : 'Cricket';
          out.push({
            id,
            source: 'espn',
            category: 'sports',
            title:
              homeName && awayName
                ? `${homeName} vs ${awayName}`
                : String(e.shortName ?? e.name ?? 'Cricket'),
            startsAt: e.date,
            endsAt: addHours(e.date, durationHours(sub)),
            venue: place.venue,
            latitude: place.latitude,
            longitude: place.longitude,
            description: league.name,
            subCategory: sub,
          });
        }
      } catch (err) {
        logger.warn('events.cricket_fail', {
          league: league.id,
          error: err instanceof Error ? err.message : 'error',
        });
      }
    }),
  );
  logger.info('events.cricket', { count: out.length, leagues: leagues.length });
  return out;
}

export async function fetchLondonSports(): Promise<PublishedEvent[]> {
  const [fotmob, espn, cricket] = await Promise.all([
    fetchFotmob(),
    fetchEspn(),
    fetchCricket(),
  ]);
  const byId = new Map<string, PublishedEvent>();
  for (const e of [...fotmob, ...espn, ...cricket]) byId.set(e.id, e);
  logger.info('events.sports_fetched', {
    fotmob: fotmob.length,
    espn: espn.length,
    cricket: cricket.length,
    total: byId.size,
  });
  return Array.from(byId.values());
}
