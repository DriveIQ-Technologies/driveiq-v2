/**
 * London events ingest: Ticketmaster + featured Proms + league sports
 * (FotMob home football, ESPN scoreboards, cricket). Ticketmaster does not
 * carry Premier League / Championship / rugby fixtures — sports come from
 * those feeds, not from the chat agent inventing them.
 * Writes raw rows, then publishLondonEvents normalises, phrases, and publishes.
 */
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { addDaysYmd, londonYmd } from './londonTime.js';
import type { PublishedEvent } from './eventNormalise.js';
import { featuredPromsEvents } from './featuredProms.js';
import { fetchLondonSports } from './sportsIngest.js';

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';
const LONDON_MARKET_ID = '202';
const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const HORIZON_DAYS = 7;

const AREA = { minLat: 51.25, maxLat: 52.1, minLon: -0.9, maxLon: 0.35 };

const PRIORITY_VENUES: { name: string; venueId: string }[] = [
  { name: 'Tottenham Hotspur Stadium', venueId: 'KovZ9177OxV' },
  { name: 'Wembley Stadium', venueId: 'KovZ9177ML0' },
  { name: 'The O2', venueId: 'KovZ9177PFf' },
  { name: 'Allianz Stadium, Twickenham', venueId: 'KovZ9177-bV' },
  { name: 'OVO Arena Wembley', venueId: 'KovZ9177yOV' },
  { name: 'Royal Albert Hall', venueId: 'KovZ9177Arf' },
  { name: 'London Stadium', venueId: 'KovZ9177EX0' },
  { name: 'Hyde Park', venueId: 'KovZ9177gxV' },
  { name: 'Alexandra Palace', venueId: 'KovZpZAn61lA' },
  { name: 'Victoria Park London', venueId: 'KovZ9177Mvf' },
  { name: 'The National Bowl', venueId: 'KovZ9177BnV' },
];

interface TmVenue {
  name?: string;
  city?: { name?: string };
  location?: { latitude?: string; longitude?: string };
}

interface TmEvent {
  id?: string;
  name?: string;
  url?: string;
  info?: string;
  description?: string;
  dates?: {
    start?: { dateTime?: string; localDate?: string; localTime?: string };
    end?: { dateTime?: string };
  };
  classifications?: Array<{ segment?: { name?: string }; genre?: { name?: string } }>;
  _embedded?: { venues?: TmVenue[] };
}

function isInArea(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return false;
  return lat >= AREA.minLat && lat <= AREA.maxLat && lon >= AREA.minLon && lon <= AREA.maxLon;
}

function toIsoUtc(d: Date): string {
  const x = new Date(d);
  x.setMilliseconds(0);
  return x.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function horizon(): { start: Date; end: Date } {
  const startYmd = londonYmd();
  const endYmd = addDaysYmd(startYmd, HORIZON_DAYS);
  return {
    start: new Date(`${startYmd}T00:00:00Z`),
    end: new Date(`${endYmd}T23:59:59Z`),
  };
}

function classify(segment?: string, genre?: string): { category: 'sports' | 'other'; sub?: string } {
  const s = (segment ?? '').toLowerCase();
  if (s === 'music') return { category: 'other', sub: genre || 'Music' };
  if (s === 'arts & theatre') return { category: 'other', sub: genre || 'Theatre' };
  if (s === 'film') return { category: 'other', sub: genre || 'Film' };
  if (s === 'sports') return { category: 'sports', sub: genre || 'Sports' };
  return { category: 'other', sub: genre || segment || 'Other' };
}

const ENTERTAINMENT_SPORTS = ['wrestling', 'darts', 'e-sports', 'esports'];

function toPublished(e: TmEvent): PublishedEvent | null {
  const seg = e.classifications?.[0]?.segment?.name ?? '';
  const genre = e.classifications?.[0]?.genre?.name ?? '';
  const isSports = seg.toLowerCase() === 'sports';
  if (isSports && !ENTERTAINMENT_SPORTS.some((k) => genre.toLowerCase().includes(k))) return null;

  const venue = e._embedded?.venues?.[0];
  const lat = Number.parseFloat(venue?.location?.latitude ?? '');
  const lon = Number.parseFloat(venue?.location?.longitude ?? '');
  if (!isInArea(lat, lon)) return null;
  const startsAt = e.dates?.start?.dateTime;
  if (!startsAt || !e.id || !e.name) return null;

  const startMs = Date.parse(startsAt);
  const rawEnd = e.dates?.end?.dateTime;
  const rawEndMs = rawEnd ? Date.parse(rawEnd) : NaN;
  const plausibleEnd =
    rawEnd != null && Number.isFinite(rawEndMs) && rawEndMs > startMs && rawEndMs - startMs <= 16 * 3600 * 1000;
  const { category, sub } = classify(seg, genre);
  const endsAt = plausibleEnd ? rawEnd! : new Date(startMs + 3 * 3600 * 1000).toISOString();

  return {
    id: `ticketmaster-${e.id}`,
    source: 'ticketmaster',
    category,
    title: e.name,
    startsAt,
    endsAt,
    venue: venue?.name ?? venue?.city?.name ?? 'London',
    latitude: lat,
    longitude: lon,
    description: (e.description || e.info || '').replace(/\s+/g, ' ').trim().slice(0, 280) || undefined,
    subCategory: sub,
    url: e.url,
  };
}

async function fetchTmPage(
  apiKey: string,
  range: { start: Date; end: Date },
  page: number,
): Promise<{ events: TmEvent[]; totalPages: number }> {
  const params = new URLSearchParams({
    apikey: apiKey,
    marketId: LONDON_MARKET_ID,
    countryCode: 'GB',
    size: String(PAGE_SIZE),
    page: String(page),
    sort: 'date,asc',
    startDateTime: toIsoUtc(range.start),
    endDateTime: toIsoUtc(range.end),
  });
  const res = await fetch(`${TM_BASE}?${params.toString()}`);
  if (!res.ok) {
    logger.warn('events.tm_http', { status: res.status, page });
    return { events: [], totalPages: 0 };
  }
  const json = (await res.json()) as {
    _embedded?: { events?: TmEvent[] };
    page?: { totalPages?: number };
  };
  return { events: json._embedded?.events ?? [], totalPages: json.page?.totalPages ?? 0 };
}

async function fetchTmVenue(
  apiKey: string,
  venueId: string,
  range: { start: Date; end: Date },
): Promise<TmEvent[]> {
  const params = new URLSearchParams({
    apikey: apiKey,
    venueId,
    countryCode: 'GB',
    size: '200',
    sort: 'date,asc',
    startDateTime: toIsoUtc(range.start),
    endDateTime: toIsoUtc(range.end),
  });
  const res = await fetch(`${TM_BASE}?${params.toString()}`);
  if (!res.ok) {
    logger.warn('events.tm_venue_http', { status: res.status, venueId });
    return [];
  }
  const json = (await res.json()) as { _embedded?: { events?: TmEvent[] } };
  return json._embedded?.events ?? [];
}

export async function fetchLondonEvents(apiKey: string | undefined): Promise<PublishedEvent[]> {
  const range = horizon();
  const byId = new Map<string, PublishedEvent>();

  if (apiKey?.trim()) {
    const first = await fetchTmPage(apiKey, range, 0);
    const lastPage = Math.min(first.totalPages || 1, MAX_PAGES);
    const pages = [first.events];
    if (lastPage > 1) {
      const rest = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, i) => fetchTmPage(apiKey, range, i + 1)),
      );
      for (const p of rest) pages.push(p.events);
    }
    for (const row of pages.flat()) {
      const mapped = toPublished(row);
      if (mapped) byId.set(mapped.id, mapped);
    }

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < PRIORITY_VENUES.length; i += 5) {
      const batch = PRIORITY_VENUES.slice(i, i + 5);
      const rows = await Promise.all(batch.map((v) => fetchTmVenue(apiKey, v.venueId, range)));
      for (const list of rows) {
        for (const row of list) {
          const mapped = toPublished(row);
          if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped);
        }
      }
      if (i + 5 < PRIORITY_VENUES.length) await delay(150);
    }
    logger.info('events.tm_pages', { lastPage, count: byId.size });
  } else {
    logger.warn('events.ingest_no_tm_key');
  }

  const now = Date.now() - 6 * 60 * 60 * 1000;
  const weekEnd = Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000;
  for (const prom of featuredPromsEvents()) {
    const t = Date.parse(prom.startsAt);
    if (!Number.isFinite(t) || t < now || t > weekEnd) continue;
    byId.set(prom.id, prom);
  }

  const sports = await fetchLondonSports();
  for (const e of sports) if (!byId.has(e.id)) byId.set(e.id, e);

  const out = Array.from(byId.values());
  logger.info('events.london_fetched', {
    count: out.length,
    sports: sports.length,
    tm: out.filter((e) => e.source === 'ticketmaster').length,
  });
  return out;
}

export async function ingestEventsRaw(
  db: Firestore,
  apiKey: string | undefined,
): Promise<PublishedEvent[]> {
  const events = await fetchLondonEvents(apiKey);
  const writer = db.bulkWriter();
  for (const event of events) {
    const id = event.id.replace(/\//g, '_');
    writer.set(
      db.doc(`eventsRaw/${id}`),
      {
        id: event.id,
        source: event.source,
        category: event.category,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        venue: event.venue,
        latitude: event.latitude,
        longitude: event.longitude,
        description: event.description ?? null,
        subCategory: event.subCategory ?? null,
        url: event.url ?? null,
        ingestedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }
  await writer.close();
  logger.info('events.raw_ingested', { count: events.length });
  return events;
}
