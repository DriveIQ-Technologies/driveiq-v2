import { isInDriveIQArea } from '@/data/londonVenues';
import type { AppEvent } from '@/types/event';
import type { DateRange } from '@/utils/dateFilters';
import { track } from './analytics';

import { fetchCricinfoLondon } from './cricinfo';
import { dedupeEvents } from './eventDedupe';
import { sanitizeEvents } from './eventSanity';
import { fetchEspnLondon } from './espn';
import { fetchFeaturedLondon } from './featuredEvents';
import { fetchFootballDataLondon } from './footballData';
import { fetchFotmobLondon } from './fotmobCalendars';
import { fetchSampleEvents } from './sampleEvents';
import { fetchSportsLondon } from './sportsdb';
import { fetchTicketmasterLondon } from './ticketmaster';
import { fetchVenueSiteEvents } from './venueSites';
import { mergeRemoteEventRecords, normaliseEventLocal } from './eventNormalise';

/** Per-provider budgets so one slow host can't blank sports coverage. */
const PROVIDER_TIMEOUT_MS: Record<string, number> = {
  espn: 20_000,
  cricinfo: 45_000,
  'football-data': 20_000,
  sportsdb: 30_000,
  fotmob: 15_000,
  ticketmaster: 15_000,
  featured: 8_000,
  'venue-sites': 15_000,
};

export type FetchAllEventsOptions = {
  /** Called whenever a provider lands and the merged list changes. */
  onPartial?: (events: AppEvent[]) => void;
};

/**
 * Single entry-point used by the UI. Fans out to every provider in parallel,
 * merges progressively (so the map can paint before Ticketmaster finishes),
 * de-duplicates by id, and falls back to sample data if none returned anything.
 *
 * Coverage layers (venue-first redundancy — no single feed can blank a sport):
 *   - fotmob        → FREE home football calendars (friendlies + league)
 *   - sportsdb      → optional Premium venue loop (all sports) if key set
 *   - espn          → soccer / rugby / NFL / NBA / boxing / UFC
 *   - cricinfo      → cricket via ESPN web calendar API
 *   - football-data → PL / Championship / cups backup
 *   - venue-sites   → ICS / JSON fallbacks (Oval, RAH, …)
 *   - featured      → curated seasonal safety net
 *   - ticketmaster  → non-sports entertainment
 */
export async function fetchAllEvents(
  range: DateRange,
  opts: FetchAllEventsOptions = {},
): Promise<AppEvent[]> {
  const buckets: {
    espn: AppEvent[];
    cricinfo: AppEvent[];
    footballData: AppEvent[];
    sports: AppEvent[];
    fotmob: AppEvent[];
    ticketmaster: AppEvent[];
    featured: AppEvent[];
    venueSites: AppEvent[];
  } = {
    espn: [],
    cricinfo: [],
    footballData: [],
    sports: [],
    fotmob: [],
    ticketmaster: [],
    featured: [],
    venueSites: [],
  };

  const emit = () => {
    opts.onPartial?.(
      finalize(buckets, /* allowSample */ false).map(normaliseEventLocal),
    );
  };

  const run = async (
    key: keyof typeof buckets,
    label: string,
    fn: () => Promise<AppEvent[]>,
  ) => {
    const started = Date.now();
    try {
      buckets[key] = await withTimeout(
        fn(),
        PROVIDER_TIMEOUT_MS[label] ?? 15_000,
        [],
        label,
      );
      track('events_provider_loaded', {
        provider: label,
        count: buckets[key].length,
        duration_ms: Date.now() - started,
      });
    } catch (e) {
      console.warn(`[events] ${label} failed`, e);
      buckets[key] = [];
      track('events_provider_failed', {
        provider: label,
        duration_ms: Date.now() - started,
      });
    }
    emit();
  };

  await Promise.all([
    run('espn', 'espn', () => fetchEspnLondon(range)),
    run('cricinfo', 'cricinfo', () => fetchCricinfoLondon(range)),
    run('footballData', 'football-data', () => fetchFootballDataLondon(range)),
    run('sports', 'sportsdb', () => fetchSportsLondon(range)),
    run('fotmob', 'fotmob', () => fetchFotmobLondon(range)),
    run('ticketmaster', 'ticketmaster', () => fetchTicketmasterLondon(range)),
    run('featured', 'featured', () => fetchFeaturedLondon(range)),
    run('venueSites', 'venue-sites', () => fetchVenueSiteEvents(range)),
  ]);

  console.log(
    `[events] provider counts: espn=${buckets.espn.length} cric=${buckets.cricinfo.length} ` +
      `football-data=${buckets.footballData.length} sportsdb=${buckets.sports.length} ` +
      `fotmob=${buckets.fotmob.length} tm=${buckets.ticketmaster.length} ics=${buckets.venueSites.length} ` +
      `featured=${buckets.featured.length}`,
  );

  const merged = (await finalizeAsync(buckets, range)).map(normaliseEventLocal);
  warnOnEmptyCoverageVenues(merged);
  try {
    return await mergeRemoteEventRecords(merged);
  } catch (e) {
    console.warn('[events] remote records skipped', e);
    return merged;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[events] ${label} timed out after ${ms}ms`);
      track('events_provider_timed_out', { provider: label, timeout_ms: ms });
      resolve(fallback);
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((e) => {
        clearTimeout(timer);
        console.warn(`[events] ${label} failed`, e);
        resolve(fallback);
      });
  });
}

function finalize(
  buckets: {
    espn: AppEvent[];
    cricinfo: AppEvent[];
    footballData: AppEvent[];
    sports: AppEvent[];
    fotmob: AppEvent[];
    ticketmaster: AppEvent[];
    featured: AppEvent[];
    venueSites: AppEvent[];
  },
  allowSample: boolean,
): AppEvent[] {
  const apiCombined = [
    ...buckets.espn,
    ...buckets.cricinfo,
    ...buckets.footballData,
    ...buckets.sports,
    ...buckets.fotmob,
    ...buckets.ticketmaster,
  ];

  apiCombined.push(...buckets.venueSites);

  const base = apiCombined.length === 0 && allowSample ? null : apiCombined;
  const combined = [...buckets.featured, ...(base ?? [])];

  // Every provider namespaces its own ids, so id-only dedupe let the same
  // fixture through once per provider. dedupeEvents matches on what the event
  // actually is (teams + day, or title + venue + performance).
  const { events: deduped, removed, samples } = dedupeEvents(combined);
  if (removed > 0) {
    console.log(`[events] collapsed ${removed} duplicate records across providers`);
    for (const s of samples) {
      console.log(`[events]   kept ${s.kept} — dropped ${s.dropped.join('; ')}`);
    }
  }

  let droppedGeo = 0;
  const merged = sanitizeEvents(
    deduped.filter((e) => {
      if (isInDriveIQArea(e.latitude, e.longitude)) return true;
      droppedGeo++;
      return false;
    }),
  ).sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  if (droppedGeo > 0 && allowSample) {
    console.warn(`[events] dropped ${droppedGeo} outside DriveIQ area`);
  }
  return merged;
}

async function finalizeAsync(
  buckets: Parameters<typeof finalize>[0],
  range: DateRange,
): Promise<AppEvent[]> {
  const apiEmpty =
    buckets.espn.length +
      buckets.cricinfo.length +
      buckets.footballData.length +
      buckets.sports.length +
      buckets.fotmob.length +
      buckets.ticketmaster.length +
      buckets.venueSites.length ===
    0;

  if (apiEmpty) {
    const samples = fetchSampleEvents(range);
    const withSamples = { ...buckets, ticketmaster: samples };
    return finalize(withSamples, true);
  }

  return finalize(buckets, true);
}

/**
 * Coverage tripwire: grounds that must not go silently empty when fixtures
 * exist. An empty result in the next 7 days is often a provider gap.
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
