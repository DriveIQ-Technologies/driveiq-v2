import { findLondonPlace, isInDriveIQArea } from '@/data/londonVenues';
import type { AppEvent, EventCategory } from '@/types/event';
import type { DateRange } from '@/utils/dateFilters';
import { pickEventDescription } from '@/utils/description';
import { defaultEndsAt, hasDefaultDuration } from '@/utils/duration';

/**
 * Ticketmaster Discovery API — non-sports events search.
 *
 * Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *
 * Ticketmaster is the non-sports provider for DriveIQ — music, theatre,
 * comedy, film, family, miscellaneous. Sports events are owned by the
 * football APIs (ESPN, football-data.org). Any event Ticketmaster returns
 * in the "Sports" segment is filtered out below; this is intentional and
 * not up for relitigation.
 *
 * Pinned to London via `marketId=202` + `city=London`. Time window passed
 * as ISO-8601 UTC `startDateTime` / `endDateTime`.
 */

const API_KEY = process.env.EXPO_PUBLIC_TICKETMASTER_API_KEY ?? '';
const BASE_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const LONDON_MARKET_ID = '202';

interface TmVenue {
  name?: string;
  city?: { name?: string };
  location?: { latitude?: string; longitude?: string };
}

interface TmClassification {
  segment?: { name?: string };
  genre?: { name?: string };
}

interface TmEvent {
  id: string;
  name: string;
  url?: string;
  info?: string;
  description?: string;
  pleaseNote?: string;
  dates?: {
    start?: { dateTime?: string; localDate?: string; localTime?: string };
    end?: { dateTime?: string; localDate?: string; localTime?: string };
  };
  classifications?: TmClassification[];
  _embedded?: { venues?: TmVenue[] };
}

interface TmResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { totalElements?: number; totalPages?: number };
}

// Ticketmaster caps page size at 200 and refuses deep paging beyond the first
// 1000 results ((page * size) must stay < 1000). size 200 × pages 0–4 = the
// full 1000 we're allowed to read, which is plenty for a 60-day London window
// and far better than the old single page of 100.
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

const toIsoUtc = (d: Date): string => {
  // Ticketmaster wants UTC ISO without milliseconds: "2026-05-05T00:00:00Z"
  const x = new Date(d);
  x.setMilliseconds(0);
  return x.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

// Ticketmaster files certain arena entertainment under its "Sports" segment
// even though they aren't team-sport fixtures and aren't covered by ESPN /
// football-data (e.g. WWE/wrestling, darts, e-sports). We let ONLY these
// genres through from Ticketmaster's Sports segment; real team sports
// (football, rugby, cricket, boxing, basketball…) still come solely from the
// football APIs to avoid duplicates. Match is substring, case-insensitive.
const ENTERTAINMENT_SPORTS_GENRES = ['wrestling', 'darts', 'e-sports', 'esports'];

const isAllowedEntertainmentSport = (genre?: string): boolean => {
  const g = (genre ?? '').toLowerCase();
  return ENTERTAINMENT_SPORTS_GENRES.some((k) => g.includes(k));
};

const classify = (segment?: string): { category: EventCategory; sub?: string } => {
  const s = (segment ?? '').toLowerCase();
  if (s === 'music') return { category: 'other', sub: 'Music' };
  if (s === 'arts & theatre') return { category: 'other', sub: 'Theatre' };
  if (s === 'film') return { category: 'other', sub: 'Film' };
  if (s === 'miscellaneous') return { category: 'other', sub: 'Other' };
  return { category: 'other', sub: segment };
};

const toNum = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// ── End-time estimation ─────────────────────────────────────────────────
// Ticketmaster's start time is the DOORS time; for big arena/stadium music the
// real finish is ~22:45 (O2 / Wembley shows end 22:30–23:00). A flat +3h gives
// wrong early finishes (~20:00), so for those venues we clamp to a standard
// late finish. Royal Albert Hall is deliberately excluded — its programme
// (proms, matinees) genuinely finishes earlier.
const BIG_MUSIC_VENUES = [
  'o2', 'wembley', 'tottenham', 'twickenham', 'ovo arena',
  'alexandra palace', 'excel', 'hyde park',
  'victoria park', 'national bowl', 'crystal palace bowl',
  'finsbury park', 'gunnersbury', 'boston manor', 'burgess park',
  'clapham common', 'brockwell',
];
const isBigMusicVenue = (venueName?: string): boolean => {
  const v = (venueName ?? '').toLowerCase();
  return BIG_MUSIC_VENUES.some((k) => v.includes(k));
};

const HOUR_MS = 3600 * 1000;

function estimateEndsAt(
  start: { dateTime?: string; localDate?: string; localTime?: string } | undefined,
  segmentName: string,
  venueName: string | undefined,
  subCategory: string | undefined,
): string {
  const dateTime = start?.dateTime;
  if (!dateTime) return defaultEndsAt(new Date().toISOString(), subCategory);

  const isMusic = (segmentName ?? '').toLowerCase() === 'music';
  if (isMusic && isBigMusicVenue(venueName) && start?.localDate && start?.localTime) {
    const utcMs = Date.parse(dateTime);
    const localMs = Date.parse(`${start.localDate}T${start.localTime}Z`);
    if (Number.isFinite(utcMs) && Number.isFinite(localMs)) {
      const offsetMs = localMs - utcMs; // e.g. +1h during BST
      const startHour = parseInt(start.localTime.slice(0, 2), 10);
      // Late-starting show → add 2.5h; otherwise a standard 22:45 local finish.
      if (startHour >= 21) return new Date(utcMs + 2.5 * HOUR_MS).toISOString();
      const endLocalMs = Date.parse(`${start.localDate}T22:45:00Z`);
      const endUtcMs = endLocalMs - offsetMs;
      if (endUtcMs > utcMs) return new Date(endUtcMs).toISOString();
      return new Date(utcMs + 2.5 * HOUR_MS).toISOString();
    }
  }
  return defaultEndsAt(dateTime, subCategory);
}

// ── Priority "never-miss" venues ────────────────────────────────────────
// London (marketId 202) returns ~10k events and TM caps deep paging at 1000,
// so big future events can fall outside the general pull. Worse, some marquee
// venues (e.g. Tottenham Hotspur Stadium) are tagged market 201 (All of UK)
// and NOT 202, so the London-market query misses them entirely. We query each
// of these venues directly by venueId (no market filter) every load and merge
// them in, guaranteeing they are never missed. IDs from the TM venue search.
interface PriorityVenue {
  name: string;
  venueId: string;
}
const PRIORITY_VENUES: PriorityVenue[] = [
  { name: 'Tottenham Hotspur Stadium', venueId: 'KovZ9177OxV' },
  { name: 'Wembley Stadium', venueId: 'KovZ9177ML0' },
  { name: 'The O2', venueId: 'KovZ9177PFf' },
  { name: 'Allianz Stadium, Twickenham', venueId: 'KovZ9177-bV' },
  { name: 'OVO Arena Wembley', venueId: 'KovZ9177yOV' },
  { name: 'Royal Albert Hall', venueId: 'KovZ9177Arf' },
  // Added 22 Jul 2026 after client report (Metallica 3/5 Jul + Athletics
  // 18 Jul at London Stadium missed by the market-202 pull). IDs verified
  // against the TM venue search on the same day.
  { name: 'London Stadium', venueId: 'KovZ9177EX0' },
  { name: 'The Kia Oval', venueId: 'KovZ9177Qcf' },
  { name: 'Twickenham Stoop', venueId: 'KovZ9177-Kf' },
  // Park festival venues (client Jul 2026). Crystal Palace Bowl + Victoria Park
  // carry South Facing / All Points East on TM. Boston Manor / Burgess /
  // Gunnersbury / Finsbury / Clapham / Brockwell / Southwark often sell via
  // RA/DICE — queried anyway so any TM listing pins; featuredEvents.ts
  // covers the self-ticketed weeks (Junction 2, Burgess summer series).
  { name: 'Crystal Palace Bowl', venueId: 'KovZ9177tzf' },
  { name: 'Victoria Park London', venueId: 'KovZ9177Mvf' },
  { name: 'Gunnersbury Park', venueId: 'KovZ9177HYf' },
  { name: 'Boston Manor Park', venueId: 'KovZpZAnIlaA' },
  { name: 'Burgess Park', venueId: 'KovZpZAlFnkA' },
  { name: 'Finsbury Park', venueId: 'KovZ9177Xaf' },
  { name: 'Clapham Common', venueId: 'KovZ91770BV' },
  { name: 'Brockwell Park', venueId: 'KovZ9177r20' },
  { name: 'Southwark Park', venueId: 'KovZpZAnnneA' },
  { name: 'Hyde Park', venueId: 'KovZ9177gxV' },
  { name: 'Alexandra Palace', venueId: 'KovZpZAn61lA' },
  { name: 'ExCeL', venueId: 'KovZ91771S0' },
  // Milton Keynes + Luton corridor (client Aug 2026). Outside TM market 202,
  // so National Bowl / Campbell Park / Stadium MK must be queried by venueId.
  // Football at Stadium MK / Kenilworth is still blocked on TM Sports segment —
  // FotMob covers those fixtures; TM here is for festivals + concerts.
  { name: 'The National Bowl', venueId: 'KovZ9177BnV' },
  { name: 'Campbell Park', venueId: 'KovZ9177B2f' },
  { name: 'Stadium MK', venueId: 'KovZ9177DNf' },
  { name: 'Stockwood Park', venueId: 'KovZ917777f' },
];

/** Map a raw Ticketmaster event to an AppEvent, or null if it should be dropped. */
function toAppEvent(e: TmEvent): AppEvent | null {
  const segName = e.classifications?.[0]?.segment?.name ?? 'Unknown';
  const genreName = e.classifications?.[0]?.genre?.name ?? '';

  // Team sports come only from ESPN/football-data; allow arena entertainment
  // (WWE/wrestling, darts, e-sports) through TM's Sports segment.
  const isSports = segName.toLowerCase() === 'sports';
  if (isSports && !isAllowedEntertainmentSport(genreName)) return null;

  // Prefer TM lat/lng; if missing (common for parks like Burgess Park),
  // resolve through the curated London venue map so the pin still lands.
  // marketId=202 still leaks non-London venues (e.g. Electric Bristol) —
  // drop anything outside the DriveIQ coverage box. TM also sometimes
  // sends 0,0 when geo is missing — treat that as absent.
  const venue = e._embedded?.venues?.[0];
  const rawVenueName = venue?.name ?? '';
  let place = findLondonPlace(rawVenueName);
  // "Troubadour Wembley Park Theatre" used to match the token "wembley"
  // and inherit the stadium name + 90k turnout. Keep the listing's own
  // name when the snap would upgrade a theatre into a stadium.
  const listingLooksIntimate = /theatre|theater|troubadour|park theatre|musical|family|kids|dinosaur/i.test(
    `${rawVenueName} ${e.name ?? ''} ${segName} ${genreName}`,
  );
  if (place?.venue === 'Wembley Stadium' && listingLooksIntimate) {
    place = findLondonPlace('Troubadour Wembley Park Theatre');
  }
  let lat = toNum(venue?.location?.latitude);
  let lon = toNum(venue?.location?.longitude);
  if (lat === 0 && lon === 0) {
    lat = null;
    lon = null;
  }
  // Known venues always snap to the curated pin. TM geocodes parks and
  // "London, GB" to the city centroid, which stacked unrelated events
  // on top of each other in the wrong place.
  if (place) {
    lat = place.latitude;
    lon = place.longitude;
  }
  if (lat == null || lon == null) return null;
  if (!isInDriveIQArea(lat, lon)) return null;

  const startsAt = e.dates?.start?.dateTime;
  if (!startsAt) return null;

  let category: EventCategory;
  let subCategory: string | undefined;
  let durationKey: string | undefined;
  if (isSports) {
    category = 'sports';
    subCategory = genreName || 'Sports';
    durationKey = hasDefaultDuration(genreName) ? genreName : 'Sports';
  } else {
    const c = classify(segName);
    category = c.category;
    subCategory = genreName || c.sub;
    // TM genres ("Rock", "Musical", "Hip-Hop/Rap"…) aren't duration keys —
    // using them silently fell back to 120 min, giving concerts/theatre a
    // wrong 2h end time. Prefer the genre only when it IS a known key
    // (e.g. "Comedy"), otherwise use the segment-level key ("Music",
    // "Theatre", "Film").
    durationKey = hasDefaultDuration(genreName) ? genreName : c.sub;
  }

  // TM's own end time is rare and occasionally spans a whole residency or
  // festival run on a single listing, which would pin the event on every
  // day chip in between. Only trust it when it's a plausible same-visit
  // window; otherwise estimate from the segment.
  const startMs = Date.parse(startsAt);
  const rawEnd = e.dates?.end?.dateTime;
  const rawEndMs = rawEnd ? Date.parse(rawEnd) : NaN;
  const plausibleEnd =
    rawEnd != null &&
    Number.isFinite(rawEndMs) &&
    rawEndMs > startMs &&
    rawEndMs - startMs <= 16 * HOUR_MS;
  const endsAt = plausibleEnd
    ? rawEnd
    : estimateEndsAt(e.dates?.start, segName, venue?.name, durationKey);

  return {
    id: `ticketmaster-${e.id}`,
    source: 'ticketmaster',
    category,
    title: e.name,
    startsAt,
    endsAt,
    venue: place?.venue ?? venue?.name ?? venue?.city?.name ?? 'London',
    latitude: lat,
    longitude: lon,
    // Client (26/31 Jul 2026): About must be a clean 1–2 lines. Prefer TM's
    // real `description` over `info` (info is usually bag/doors/tier copy).
    // pleaseNote is intentionally never a candidate.
    description: pickEventDescription(e.description, e.info),
    subCategory,
    url: e.url,
  };
}

/** Query one venue's events directly by venueId (no market filter). */
async function fetchTicketmasterVenue(
  venueId: string,
  range: DateRange,
): Promise<TmEvent[]> {
  const params = new URLSearchParams({
    apikey: API_KEY,
    venueId,
    countryCode: 'GB',
    size: '200',
    sort: 'date,asc',
    startDateTime: toIsoUtc(range.start),
    endDateTime: toIsoUtc(range.end),
  });
  try {
    const res = await fetch(`${BASE_URL}?${params.toString()}`);
    if (!res.ok) {
      console.warn('[ticketmaster] venue', venueId, 'non-OK', res.status);
      return [];
    }
    const json = (await res.json()) as TmResponse;
    return json._embedded?.events ?? [];
  } catch (e) {
    console.warn('[ticketmaster] venue', venueId, 'network error', e);
    return [];
  }
}

/** Fetch a single page of London events. Returns the raw events plus paging meta. */
async function fetchTicketmasterPage(
  range: DateRange,
  page: number,
): Promise<{ events: TmEvent[]; totalPages: number }> {
  const params = new URLSearchParams({
    apikey: API_KEY,
    // marketId 202 *is* London — passing city=London on top of it was
    // redundant and silently dropped venues whose recorded city differed
    // (e.g. Wembley, Twickenham, Croydon). marketId alone is the wider net.
    marketId: LONDON_MARKET_ID,
    countryCode: 'GB',
    size: String(PAGE_SIZE),
    page: String(page),
    sort: 'date,asc',
    startDateTime: toIsoUtc(range.start),
    endDateTime: toIsoUtc(range.end),
  });

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}?${params.toString()}`);
  } catch (e) {
    console.warn('[ticketmaster] network error (page', page, ')', e);
    return { events: [], totalPages: 0 };
  }
  if (!res.ok) {
    console.warn('[ticketmaster] non-OK (page', page, ')', res.status);
    return { events: [], totalPages: 0 };
  }

  const json = (await res.json()) as TmResponse;
  return {
    events: json._embedded?.events ?? [],
    totalPages: json.page?.totalPages ?? 0,
  };
}

export async function fetchTicketmasterLondon(range: DateRange): Promise<AppEvent[]> {
  if (!API_KEY) {
    console.warn('[ticketmaster] EXPO_PUBLIC_TICKETMASTER_API_KEY not set — skipping');
    return [];
  }

  // 1) General London pull (marketId 202), paged up to the 1000 ceiling.
  //    Page 0 first (need totalPages), then remaining pages in parallel.
  const generalRaw: TmEvent[] = [];
  const first = await fetchTicketmasterPage(range, 0);
  generalRaw.push(...first.events);
  const lastPage = Math.min(first.totalPages, MAX_PAGES);
  if (lastPage > 1) {
    const rest = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) =>
        fetchTicketmasterPage(range, i + 1),
      ),
    );
    for (const next of rest) {
      if (next.events.length > 0) generalRaw.push(...next.events);
    }
  }

  // 2) Priority "never-miss" venues, queried directly by venueId in batches
  //    (batched to stay under Ticketmaster's ~5 req/sec rate limit).
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const priorityResults: { v: PriorityVenue; events: TmEvent[] }[] = [];
  const BATCH_SIZE = 5;
  for (let i = 0; i < PRIORITY_VENUES.length; i += BATCH_SIZE) {
    const batch = PRIORITY_VENUES.slice(i, i + BATCH_SIZE);
    const res = await Promise.all(
      batch.map(async (v) => ({
        v,
        events: await fetchTicketmasterVenue(v.venueId, range).catch(
          () => [] as TmEvent[],
        ),
      })),
    );
    priorityResults.push(...res);
    if (i + BATCH_SIZE < PRIORITY_VENUES.length) {
      await delay(120);
    }
  }

  // 3) Map + de-duplicate by Ticketmaster event id (general first, then any
  //    priority-venue events the general pull didn't already include).
  const byId = new Map<string, AppEvent>();
  for (const e of generalRaw) {
    const mapped = toAppEvent(e);
    if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped);
  }
  let priorityAdded = 0;
  for (const { events } of priorityResults) {
    for (const e of events) {
      const mapped = toAppEvent(e);
      if (mapped && !byId.has(mapped.id)) {
        byId.set(mapped.id, mapped);
        priorityAdded++;
      }
    }
  }

  const out = Array.from(byId.values());

  const venueSummary = priorityResults
    .map(({ v, events }) => `${v.name.split(',')[0]}=${events.length}`)
    .join(', ');
  console.log(
    `[ticketmaster] general ${generalRaw.length} raw (≤${lastPage} of ${first.totalPages} pages); ` +
      `priority venues added ${priorityAdded} → ${out.length} total usable`,
  );
  console.log(`[ticketmaster] priority venue raw counts: ${venueSummary}`);
  return out;
}
