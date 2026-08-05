import { findLondonPlace } from '@/data/londonVenues';
import type { AppEvent, EventCategory } from '@/types/event';
import { eventOverlapsRange, isInRange, type DateRange } from '@/utils/dateFilters';
import { cleanDescription } from '@/utils/description';
import { defaultEndsAt } from '@/utils/duration';

/**
 * Venue-website sources — for venues that self-ticket and are therefore
 * invisible to Ticketmaster and the sports APIs (client report 22 Jul 2026:
 * RAH's first TM listing was 20 Sep despite nightly Proms; Kia Oval and
 * Twickenham had ZERO TM events; London Stadium had one).
 *
 * VERIFIED 23 Jul 2026 against the live sites (via browser inspection):
 *
 *  - Royal Albert Hall  → public JSON feed behind their what's-on page:
 *    https://dzxpxc606eoab.cloudfront.net/Prod/events/20/72165/Live
 *    187 events incl. every BBC Prom, ISO dates with offsets, categories.
 *  - Kia Oval           → official ICS calendar feeds linked from
 *    kiaoval.com/fixtures ("SYNC FIXTURES TO CALENDAR"). Clean VEVENTs with
 *    LOCATION:"Kia Oval" on home games. NOTE: URLs are season-specific
 *    (wp-content/uploads/2026/...) — must be refreshed each January.
 *  - Jockey Club courses (Epsom, Sandown, Kempton) → the events LISTING has
 *    no structured data, but each event DETAIL page carries a schema.org
 *    Event JSON-LD block. We crawl listing → detail pages (capped).
 *  - Ascot / Windsor / Twickenham Allianz → no structured data found
 *    (client-rendered apps); configs kept as plain JSON-LD attempts and
 *    expected to log 0. Their marquee meetings should be curated in
 *    featuredEvents.ts until a feed is reverse-engineered.
 *  - London Stadium → site itself showed "No events!" (23 Jul 2026);
 *    West Ham fixtures come from ESPN, concerts from TM priority venue.
 *
 *  - FotMob club calendars → moved to fotmobCalendars.ts (free football
 *    backbone for all major London grounds + Watford, incl. friendlies).
 *
 * ROLE: fallback layer only. events.ts drops any venue-site event within
 * ±3h of an existing API event at the same venue, so the football APIs and
 * Ticketmaster always win and nothing duplicates.
 */

// ── Config ───────────────────────────────────────────────────────────────

type SourceKind = 'jsonld' | 'jsonld-crawl' | 'ics' | 'rah-json';

interface VenueSite {
  /** Canonical venue name — must resolve via findLondonPlace for coords. */
  venue: string;
  url: string;
  kind: SourceKind;
  defaultCategory: EventCategory;
  defaultSub: string;
  /** jsonld-crawl only: href substring that marks an event detail page. */
  crawlMatch?: string;
  /** ics only: only keep VEVENTs whose LOCATION contains this (lower-case).
   *  Filters away fixtures (away games) at other grounds. */
  icsLocationFilter?: string;
}

const MAX_CRAWL_PAGES = 10;

const VENUE_SITES: VenueSite[] = [
  {
    venue: 'Royal Albert Hall',
    url: 'https://dzxpxc606eoab.cloudfront.net/Prod/events/20/72165/Live',
    kind: 'rah-json',
    defaultCategory: 'other',
    defaultSub: 'Music',
  },
  {
    venue: 'The Oval',
    // Men's First XI 2026 — refresh path each season (see header note).
    url: 'https://www.kiaoval.com/wp-content/uploads/2026/01/202620Mens20First20XI20Fixtures.ics',
    kind: 'ics',
    defaultCategory: 'sports',
    defaultSub: 'Cricket',
    icsLocationFilter: 'kia oval',
  },
  {
    venue: 'The Oval',
    url: 'https://www.kiaoval.com/wp-content/uploads/2026/01/Surrey_Women_2026_Fixtures.ics',
    kind: 'ics',
    defaultCategory: 'sports',
    defaultSub: 'Cricket',
    icsLocationFilter: 'kia oval',
  },
  // FotMob club calendars live in fotmobCalendars.ts (free football backbone
  // covering all major London home grounds + Watford, incl. friendlies).
  {
    venue: 'Epsom Downs Racecourse',
    url: 'https://www.thejockeyclub.co.uk/epsom-downs/events-tickets/',
    kind: 'jsonld-crawl',
    crawlMatch: '/epsom-downs/events-tickets/',
    defaultCategory: 'sports',
    defaultSub: 'Horse Racing',
  },
  {
    venue: 'Sandown Park Racecourse',
    url: 'https://www.thejockeyclub.co.uk/sandown-park/events-tickets/',
    kind: 'jsonld-crawl',
    crawlMatch: '/sandown-park/events-tickets/',
    defaultCategory: 'sports',
    defaultSub: 'Horse Racing',
  },
  {
    venue: 'Kempton Park Racecourse',
    url: 'https://www.thejockeyclub.co.uk/kempton-park/events-tickets/',
    kind: 'jsonld-crawl',
    crawlMatch: '/kempton-park/events-tickets/',
    defaultCategory: 'sports',
    defaultSub: 'Horse Racing',
  },
  // Unverified single-page attempts — expected 0 until a feed is found.
  {
    venue: 'Ascot Racecourse',
    url: 'https://www.ascot.com/racing-and-events',
    kind: 'jsonld',
    defaultCategory: 'sports',
    defaultSub: 'Horse Racing',
  },
  {
    venue: 'Royal Windsor Racecourse',
    url: 'https://www.windsorracecourse.co.uk/whats-on/',
    kind: 'jsonld',
    defaultCategory: 'sports',
    defaultSub: 'Horse Racing',
  },
  {
    venue: 'Twickenham Stadium',
    url: 'https://allianzstadiumtwickenham.com/whats-on',
    kind: 'jsonld',
    defaultCategory: 'sports',
    defaultSub: 'Rugby',
  },
];

// ── Shared helpers ───────────────────────────────────────────────────────

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const fetchText = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/html,text/calendar,application/json', 'User-Agent': UA },
    });
    if (!res.ok) {
      console.warn('[venue-sites] non-OK', res.status, url.slice(0, 60));
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn('[venue-sites] network error', url.slice(0, 60), e);
    return null;
  }
};

const stableId = (venue: string, startsAt: string, title: string): string =>
  `venuesite-${venue}-${startsAt}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const makeEvent = (
  site: VenueSite,
  place: { venue: string; latitude: number; longitude: number },
  title: string,
  startsAt: string,
  endsAt: string | null,
  description: string | undefined,
  category: EventCategory,
  sub: string,
  url?: string,
): AppEvent => ({
  id: stableId(place.venue, startsAt, title),
  source: 'venue-site',
  category,
  title,
  startsAt,
  endsAt: endsAt ?? defaultEndsAt(startsAt, sub),
  venue: place.venue,
  latitude: place.latitude,
  longitude: place.longitude,
  // Same 1–2 line About rule as Ticketmaster (client, 26 Jul 2026) —
  // venue-site feeds can carry long marketing copy too.
  description: cleanDescription(description),
  subCategory: sub,
  url,
});

// ── JSON-LD (schema.org) ─────────────────────────────────────────────────

interface LdEvent {
  '@type'?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  description?: string;
  eventStatus?: string;
}

const extractLdBlocks = (html: string): unknown[] => {
  const out: unknown[] = [];
  const re =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* malformed block — skip */
    }
  }
  return out;
};

const collectLdEvents = (node: unknown, acc: LdEvent[]): void => {
  if (Array.isArray(node)) {
    for (const n of node) collectLdEvents(n, acc);
    return;
  }
  if (node == null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const types = ([] as unknown[]).concat(obj['@type'] ?? []);
  const isEvent = types.some(
    (t) => typeof t === 'string' && t.toLowerCase().includes('event'),
  );
  if (isEvent && typeof obj.startDate === 'string') acc.push(obj as LdEvent);
  for (const key of ['@graph', 'itemListElement', 'item', 'subEvent']) {
    if (obj[key]) collectLdEvents(obj[key], acc);
  }
};

const CANCELLED = ['eventcancelled', 'eventpostponed'];

const ldToEvents = (
  html: string,
  site: VenueSite,
  place: { venue: string; latitude: number; longitude: number },
  range: DateRange,
): AppEvent[] => {
  const lds: LdEvent[] = [];
  for (const block of extractLdBlocks(html)) collectLdEvents(block, lds);
  const out: AppEvent[] = [];
  for (const ev of lds) {
    if (!ev.name || !ev.startDate) continue;
    const status = (ev.eventStatus ?? '').toLowerCase();
    if (CANCELLED.some((c) => status.includes(c))) continue;
    const startMs = Date.parse(ev.startDate);
    if (!Number.isFinite(startMs)) continue;
    const startsAt = new Date(startMs).toISOString();
    if (!isInRange(startsAt, range)) continue;
    const endMs = ev.endDate ? Date.parse(ev.endDate) : NaN;
    const endsAt =
      Number.isFinite(endMs) && endMs > startMs
        ? new Date(endMs).toISOString()
        : null;
    out.push(
      makeEvent(
        site,
        place,
        ev.name,
        startsAt,
        endsAt,
        ev.description,
        site.defaultCategory,
        site.defaultSub,
        ev.url,
      ),
    );
  }
  return out;
};

/** Listing page → collect detail-page links → parse JSON-LD from each.
 *  Used for Jockey Club courses where only detail pages carry Event markup. */
const fetchJsonldCrawl = async (
  site: VenueSite,
  place: { venue: string; latitude: number; longitude: number },
  range: DateRange,
): Promise<AppEvent[]> => {
  const listing = await fetchText(site.url);
  if (!listing || !site.crawlMatch) return [];
  const origin = new URL(site.url).origin;
  const hrefs = new Set<string>();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(listing)) !== null) {
    const href = m[1];
    if (!href.includes(site.crawlMatch)) continue;
    const abs = href.startsWith('http') ? href : origin + href;
    // Skip generic /tickets/ sub-pages of the same event.
    hrefs.add(abs.replace(/\/tickets\/?$/, '/'));
    if (hrefs.size >= MAX_CRAWL_PAGES) break;
  }
  const pages = await Promise.all([...hrefs].map(fetchText));
  const out: AppEvent[] = [];
  for (const html of pages) {
    if (html) out.push(...ldToEvents(html, site, place, range));
  }
  return out;
};

// ── ICS (calendar feeds) ─────────────────────────────────────────────────

/** Parse ICS date-times: `20260801T140000Z`, `20260801T150000`, or ISO. */
const parseIcsDateTime = (raw: string): number | null => {
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (compact) {
    const [, y, mo, d, h, mi, s, z] = compact;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
};

/** Minimal VEVENT parser: unfolds continuation lines, extracts the fields we
 *  need. Date-only DTSTART (VALUE=DATE) is treated as a cricket day: play
 *  10:30–18:30 UK time; multi-day fixtures end on their final day. */
const icsToEvents = (
  ics: string,
  site: VenueSite,
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
    const location = (get('LOCATION') ?? '').toLowerCase();
    if (site.icsLocationFilter && !location.includes(site.icsLocationFilter)) continue;

    let startsAt: string;
    let endsAt: string | null = null;
    if (/^\d{8}$/.test(dtstart)) {
      // Date-only → day of cricket, UK summer time (+01:00).
      const d = `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`;
      startsAt = new Date(`${d}T10:30:00+01:00`).toISOString();
      const dtend = get('DTEND');
      if (dtend && /^\d{8}$/.test(dtend)) {
        // DTEND is exclusive → last day is DTEND - 1.
        const endDay = new Date(
          `${dtend.slice(0, 4)}-${dtend.slice(4, 6)}-${dtend.slice(6, 8)}T18:30:00+01:00`,
        );
        endDay.setDate(endDay.getDate() - 1);
        if (endDay.getTime() > Date.parse(startsAt)) endsAt = endDay.toISOString();
      }
    } else {
      const ms = parseIcsDateTime(dtstart);
      if (ms == null) continue;
      startsAt = new Date(ms).toISOString();
      const dtend = get('DTEND');
      if (dtend) {
        const endMs = parseIcsDateTime(dtend);
        if (endMs != null && endMs > ms) endsAt = new Date(endMs).toISOString();
      }
    }
    if (!eventOverlapsRange(startsAt, endsAt, range)) continue;

    // FotMob titles look like "⚽️ Millwall - Royal Antwerp" — strip emoji noise.
    const title = summary.replace(/^[\u26BD\uFE0F\u26BE\s]+/u, '').trim();

    out.push(
      makeEvent(
        site,
        place,
        title || summary,
        startsAt,
        endsAt,
        get('DESCRIPTION') ?? undefined,
        site.defaultCategory,
        site.defaultSub,
      ),
    );
  }
  return out;
};

// ── Royal Albert Hall JSON feed ──────────────────────────────────────────

interface RahEvent {
  Title?: string;
  Prefix?: string;
  StartDate?: string;
  EndDate?: string;
  Summary?: string;
  BookingStatus?: string;
  Categories?: unknown[];
}

const rahToEvents = (
  json: string,
  site: VenueSite,
  place: { venue: string; latitude: number; longitude: number },
  range: DateRange,
): AppEvent[] => {
  let parsed: RahEvent[];
  try {
    parsed = JSON.parse(json) as RahEvent[];
  } catch {
    console.warn('[venue-sites] RAH feed: invalid JSON');
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: AppEvent[] = [];
  for (const ev of parsed) {
    if (!ev.Title || !ev.StartDate) continue;
    if ((ev.BookingStatus ?? '').toLowerCase() === 'cancelled') continue;
    const startMs = Date.parse(ev.StartDate);
    if (!Number.isFinite(startMs)) continue;
    const startsAt = new Date(startMs).toISOString();
    if (!isInRange(startsAt, range)) continue;
    const cats = (ev.Categories ?? []).filter(
      (c): c is string => typeof c === 'string',
    );
    const sub = cats.includes('BBC Proms')
      ? 'Music'
      : cats.includes('Classical')
        ? 'Music'
        : cats[0] ?? site.defaultSub;
    // Feed's EndDate usually equals StartDate — treat as unknown.
    const endMs = ev.EndDate ? Date.parse(ev.EndDate) : NaN;
    const endsAt =
      Number.isFinite(endMs) && endMs > startMs
        ? new Date(endMs).toISOString()
        : null;
    out.push(
      makeEvent(
        site,
        place,
        ev.Title,
        startsAt,
        endsAt,
        ev.Summary,
        'other',
        sub,
      ),
    );
  }
  return out;
};

// ── Entry point ──────────────────────────────────────────────────────────

async function fetchSite(site: VenueSite, range: DateRange): Promise<AppEvent[]> {
  const place = findLondonPlace(site.venue);
  if (!place) {
    console.warn('[venue-sites] no coords for', site.venue, '— add to londonVenues');
    return [];
  }
  if (site.kind === 'jsonld-crawl') return fetchJsonldCrawl(site, place, range);
  const body = await fetchText(site.url);
  if (!body) return [];
  if (site.kind === 'ics') return icsToEvents(body, site, place, range);
  if (site.kind === 'rah-json') return rahToEvents(body, site, place, range);
  return ldToEvents(body, site, place, range);
}

export async function fetchVenueSiteEvents(range: DateRange): Promise<AppEvent[]> {
  const results = await Promise.all(
    VENUE_SITES.map(async (site) => ({
      site,
      events: await fetchSite(site, range).catch((e) => {
        console.warn('[venue-sites]', site.venue, 'failed', e);
        return [] as AppEvent[];
      }),
    })),
  );
  // De-duplicate across sources (e.g. the two Oval ICS feeds).
  const byId = new Map<string, AppEvent>();
  for (const { events } of results) {
    for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const all = Array.from(byId.values());
  const summary = results
    .map(({ site, events }) => `${site.venue.split(' ')[0]}:${site.kind}=${events.length}`)
    .join(', ');
  console.log(`[venue-sites] ${all.length} events (${summary})`);
  return all;
}
