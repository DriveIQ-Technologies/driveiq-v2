import { isInDriveIQArea } from '@/data/londonVenues';
import type { AppEvent } from '@/types/event';
import type { DateRange } from '@/utils/dateFilters';

import { fetchCricinfoLondon } from './cricinfo';
import { fetchEspnLondon } from './espn';
import { fetchFeaturedLondon } from './featuredEvents';
import { fetchFootballDataLondon } from './footballData';
import { fetchFotmobLondon } from './fotmobCalendars';
import { fetchSampleEvents } from './sampleEvents';
import { fetchSportsLondon } from './sportsdb';
import { fetchTicketmasterLondon } from './ticketmaster';
import { fetchVenueSiteEvents } from './venueSites';

/**
 * Single entry-point used by the UI. Fans out to every provider in parallel,
 * merges the result, de-duplicates by id, and falls back to sample data if
 * none of them returned anything (e.g. no API keys configured yet).
 *
 * Coverage layers (venue-first redundancy — no single feed can blank a sport):
 *   - fotmob        → FREE home football calendars (friendlies + league),
 *                     no API key — primary SportsDB Premium alternative
 *   - sportsdb      → optional Premium venue loop (all sports) if key set
 *   - espn          → soccer / rugby / NFL / NBA / boxing / UFC
 *   - cricinfo      → cricket via ESPN web calendar API
 *   - football-data → PL / Championship / cups backup
 *   - venue-sites   → ICS / JSON fallbacks (Oval, RAH, …)
 *   - featured      → curated seasonal safety net
 *   - ticketmaster  → non-sports entertainment
 */
export async function fetchAllEvents(range: DateRange): Promise<AppEvent[]> {
  const [espn, cricinfo, footballData, sports, fotmob, ticketmaster, featured, venueSites] =
    await Promise.all([
      fetchEspnLondon(range).catch((e) => {
        console.warn('[events] espn failed', e);
        return [] as AppEvent[];
      }),
      fetchCricinfoLondon(range).catch((e) => {
        console.warn('[events] cricinfo failed', e);
        return [] as AppEvent[];
      }),
      fetchFootballDataLondon(range).catch((e) => {
        console.warn('[events] football-data failed', e);
        return [] as AppEvent[];
      }),
      fetchSportsLondon(range).catch((e) => {
        console.warn('[events] sportsdb failed', e);
        return [] as AppEvent[];
      }),
      fetchFotmobLondon(range).catch((e) => {
        console.warn('[events] fotmob failed', e);
        return [] as AppEvent[];
      }),
      fetchTicketmasterLondon(range).catch((e) => {
        console.warn('[events] ticketmaster failed', e);
        return [] as AppEvent[];
      }),
      fetchFeaturedLondon(range).catch((e) => {
        console.warn('[events] featured failed', e);
        return [] as AppEvent[];
      }),
      fetchVenueSiteEvents(range).catch((e) => {
        console.warn('[events] venue-sites failed', e);
        return [] as AppEvent[];
      }),
    ]);

  console.log(
    `[events] provider counts: espn=${espn.length} cric=${cricinfo.length} ` +
      `football-data=${footballData.length} sportsdb=${sports.length} ` +
      `fotmob=${fotmob.length} tm=${ticketmaster.length} ics=${venueSites.length} ` +
      `featured=${featured.length}`,
  );

  // FotMob is a first-class free football source (not a last-resort scrape).
  const apiCombined = [
    ...espn,
    ...cricinfo,
    ...footballData,
    ...sports,
    ...fotmob,
    ...ticketmaster,
  ];

  // Venue-site scrapers are a FALLBACK (Oval ICS, RAH, etc.). Drop any scrape
  // that clashes with an API/FotMob event at the same venue within ±3h.
  const THREE_H = 3 * 60 * 60 * 1000;
  const venueSiteUnique = venueSites.filter((v) => {
    const t = new Date(v.startsAt).getTime();
    return !apiCombined.some(
      (a) =>
        a.venue === v.venue &&
        Math.abs(new Date(a.startsAt).getTime() - t) <= THREE_H,
    );
  });
  apiCombined.push(...venueSiteUnique);

  // Curated featured events always ride alongside the API results. When no
  // API keys are configured we still want the demo to look populated, so
  // fall back to sample data — but keep featured on top.
  const base = apiCombined.length === 0 ? await fetchSampleEvents(range) : apiCombined;
  const combined = [...featured, ...base];

  // De-duplicate (featured wins since it's inserted first).
  const byId = new Map<string, AppEvent>();
  for (const e of combined) if (!byId.has(e.id)) byId.set(e.id, e);

  // Final geo gate — providers can still leak far-away venues (TM Bristol,
  // mis-geocoded coords). Keep only pins inside the DriveIQ coverage box.
  let droppedGeo = 0;
  const merged = Array.from(byId.values())
    .filter((e) => {
      if (isInDriveIQArea(e.latitude, e.longitude)) return true;
      droppedGeo++;
      return false;
    })
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  if (droppedGeo > 0) {
    console.warn(`[events] dropped ${droppedGeo} outside DriveIQ area`);
  }
  warnOnEmptyCoverageVenues(merged);
  return merged;
}

/**
 * Coverage tripwire: grounds that must not go silently empty when fixtures
 * exist. An empty result in the next 7 days is often a provider gap (Lord's /
 * Oval cricket Jul 2026; The Den friendlies Jul 2026) — shout before users do.
 *
 * Match substrings cover provider name variants (TM "Allianz Stadium,
 * Twickenham", FotMob "Vicarage Road Stadium", etc.).
 */
const COVERAGE_VENUES: { label: string; match: string[] }[] = [
  { label: "Lord's", match: ["lord's"] },
  { label: 'The Oval', match: ['oval'] },
  { label: 'The Den', match: ['the den'] },
  { label: 'Vicarage Road', match: ['vicarage'] },
  { label: 'Kenilworth Road', match: ['kenilworth'] },
  { label: 'Stadium MK', match: ['stadium mk'] },
  { label: 'The National Bowl', match: ['national bowl'] },
  { label: 'Wembley Stadium', match: ['wembley stadium'] },
  { label: 'Twickenham', match: ['twickenham', 'allianz stadium'] },
  { label: 'The O2', match: ['o2 arena', 'the o2'] },
  { label: 'Royal Albert Hall', match: ['albert hall'] },
  { label: 'Emirates Stadium', match: ['emirates'] },
  { label: 'Tottenham Hotspur Stadium', match: ['tottenham'] },
  { label: 'Stamford Bridge', match: ['stamford bridge'] },
  { label: 'London Stadium', match: ['london stadium'] },
  { label: 'Selhurst Park', match: ['selhurst'] },
  { label: 'Craven Cottage', match: ['craven cottage'] },
  { label: 'Gtech Community Stadium', match: ['gtech'] },
  { label: 'Loftus Road', match: ['loftus'] },
  { label: 'Boston Manor Park', match: ['boston manor'] },
  { label: 'Burgess Park', match: ['burgess'] },
  { label: 'Gunnersbury Park', match: ['gunnersbury'] },
  { label: 'Crystal Palace Bowl', match: ['crystal palace bowl'] },
  { label: 'Victoria Park', match: ['victoria park'] },
  { label: 'Wimbledon (AELTC)', match: ['all england'] },
];

function warnOnEmptyCoverageVenues(events: AppEvent[]): void {
  const now = Date.now();
  const weekOut = now + 7 * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>(COVERAGE_VENUES.map((v) => [v.label, 0]));
  for (const e of events) {
    const venue = (e.venue ?? '').toLowerCase();
    const hit = COVERAGE_VENUES.find((v) =>
      v.match.some((m) => venue.includes(m)),
    );
    if (!hit) continue;
    const t = new Date(e.startsAt).getTime();
    if (t >= now - 12 * 60 * 60 * 1000 && t <= weekOut) {
      counts.set(hit.label, (counts.get(hit.label) ?? 0) + 1);
    }
  }
  const empty = COVERAGE_VENUES.map((v) => v.label).filter(
    (label) => (counts.get(label) ?? 0) === 0,
  );
  if (empty.length > 0) {
    console.warn(
      `[events] COVERAGE GAP — no events in next 7 days at: ${empty.join(', ')}. ` +
        'Verify against club fixture lists; may be genuinely dark or a provider miss.',
    );
  }
}
