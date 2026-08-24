import type { AppEvent } from '@/types/event';
import { eventOverlapsRange, type DateRange } from '@/utils/dateFilters';
import { ukOffset } from '@/utils/ukTime';

/**
 * Curated "featured" events.
 *
 * Some of the biggest events in and around London simply aren't in any of our
 * API feeds (ESPN / football-data / SportsDB cover team sport; Ticketmaster
 * covers ticketed entertainment). Marquee fixtures like Royal Ascot, the Epsom
 * Derby or the Wimbledon Championships fall through the cracks — yet they're
 * exactly what drives traffic and transport demand on those days.
 *
 * This is a hand-maintained list that renders alongside the API events with a
 * gold "featured" pin + star badge so it stands out. To add an event, append
 * an entry below with accurate date, venue and coordinates. Past entries are
 * filtered out automatically by the date range, so the list can be pruned
 * occasionally but doesn't need constant gardening.
 *
 * All times are local London time (BST, UTC+1, in summer) written with an
 * explicit offset so they're unambiguous.
 */

const GUNNERSBURY = {
  venue: 'Gunnersbury Park',
  latitude: 51.4997,
  longitude: -0.2875,
  description: 'Summer live music at Gunnersbury Park, West London.',
};

const BOSTON_MANOR = {
  venue: 'Boston Manor Park',
  latitude: 51.4936,
  longitude: -0.3247,
  description: 'Junction 2 electronic music festival at Boston Manor Park, Brentford.',
};

const BURGESS = {
  venue: 'Burgess Park',
  latitude: 51.4855,
  longitude: -0.0765,
  description: 'Open-air festival day at Burgess Park, South London.',
};

const NATIONAL_BOWL = {
  venue: 'The National Bowl',
  latitude: 52.0148,
  longitude: -0.7562,
  description: 'Reggae Land at Milton Keynes National Bowl.',
};

const LORDS = {
  venue: "Lord's Cricket Ground",
  latitude: 51.5294,
  longitude: -0.1727,
};

const OVAL = {
  venue: 'The Oval',
  latitude: 51.4837,
  longitude: -0.1145,
};

function cricketMatch(
  id: string,
  title: string,
  date: string,
  startLocal: string,
  endLocal: string,
  loc: { venue: string; latitude: number; longitude: number },
  description: string,
  subCategory = 'Cricket T20',
): AppEvent {
  return {
    id: `featured-cricket-${id}`,
    source: 'featured',
    category: 'sports',
    title,
    startsAt: `${date}T${startLocal}:00${ukOffset(date)}`,
    endsAt: `${date}T${endLocal}:00${ukOffset(date)}`,
    venue: loc.venue,
    latitude: loc.latitude,
    longitude: loc.longitude,
    description,
    subCategory,
  };
}

// IMPORTANT: the featured list is built LAZILY (first call), not at module
// load. Building it at module scope crashed the app (23 Jul 2026): the array
// spreads promsEvents(), which reads PROMS_2026 — declared further down the
// file — and after Babel downlevels `const` to `var` that read yields
// `undefined` instead of a temporal-dead-zone error, so `.map` blew up at
// startup. Deferring construction until after the whole module has evaluated
// makes declaration order irrelevant. Do NOT convert this back to a
// module-level array.
let featuredCache: AppEvent[] | null = null;

function buildFeatured(): AppEvent[] {
  return [
  // ── Royal Ascot 2026 — Tue 16 to Sat 20 June ──────────────────────────
  // Gates 10:30, Royal Procession 14:00, racing 14:30 → ~18:00.
  // Ascot Racecourse, Berkshire.
  ascot('1 · Opening Day', '2026-06-16'),
  ascot('2', '2026-06-17'),
  ascot('3 · Ladies Day', '2026-06-18'),
  ascot('4', '2026-06-19'),
  ascot('5', '2026-06-20'),

  // ── The Championships, Wimbledon 2026 — one pin per day, 29 June–12 July ─
  // All England Lawn Tennis & Croquet Club, SW19. Matches run ~11:00–21:00.
  ...wimbledonDays(),

  // ── BBC Proms 2026 at the Royal Albert Hall — 17 July to 12 September ────
  // Proms tickets are sold through the Royal Albert Hall box office / BBC,
  // NOT Ticketmaster, so the entire season is invisible to our Ticketmaster
  // feed (discovered 22 Jul 2026 when the client flagged the Hall showing no
  // events mid-season). Full 72-concert RAH schedule curated from the
  // published BBC Proms 2026 listings. Times are local (BST).
  ...promsEvents(),

  // ── Ascot 2026 marquee race days (client request, 23 Jul 2026) ─────────
  // ascot.com is a client-rendered app with no structured data the
  // venue-site scraper can read, so the headline meetings are curated here.
  // Dates cross-checked against the published 2026 fixture list
  // (ascot.com/racedays) on 23 Jul 2026. Typical raceday: gates ~10:30,
  // first race ~13:50, last race ~17:30.
  raceday('ascot-king-george-fri', 'Ascot — King George Friday Raceday', '2026-07-24'),
  raceday('ascot-king-george-sat', 'Ascot — King George Day', '2026-07-25'),
  raceday('ascot-shergar-cup', 'Ascot — Shergar Cup', '2026-08-08'),
  raceday('ascot-food-wine-fri', 'Ascot — Food & Wine Friday Raceday', '2026-09-04'),
  raceday('ascot-food-wine-sat', 'Ascot — Food & Wine Saturday Raceday', '2026-09-05'),

  // ── Summer park festivals (client request, 23 Jul + 30 Jul 2026) ───────
  // Tens of thousands of guests per day; often sold via RA/DICE/See Tickets,
  // so invisible to Ticketmaster. South Facing (Crystal Palace Bowl) and All
  // Points East (Victoria Park) ARE on Ticketmaster and come through the
  // priority-venue queries — NOT curated here, to avoid double pins.
  //
  // Junction 2 — Boston Manor Park, Brentford. Dates from junction2.london
  // (verified 23 Jul 2026). Typical hours 12:00–22:30. Must stay curated —
  // TM venue exists but listed 0 events for Jul–Sep 2026.
  ...['2026-07-24', '2026-07-25', '2026-07-26', '2026-07-31', '2026-08-01', '2026-08-02'].map(
    (date) =>
      parkEvent('junction2', `Junction 2 Festival`, date, '12:00', '22:30', BOSTON_MANOR),
  ),
  // Burgess Park summer series (Elixar / Columbo) — Boiler Room, Jazz Cafe,
  // Miniteca, Maiden Voyage, Eastern Electrics. Sold via DICE/Skiddle/RA, not
  // Ticketmaster (TM Burgess venue returns 0). Dates from burgessparkevents.com
  // + Southwark Council listings, verified 30 Jul 2026.
  parkEvent('burgess', 'Boiler Room at Burgess Park', '2026-07-31', '14:00', '22:00', BURGESS),
  parkEvent('burgess', 'Boiler Room at Burgess Park', '2026-08-01', '12:00', '22:00', BURGESS),
  parkEvent('burgess', 'Jazz Cafe Festival at Burgess Park', '2026-08-02', '12:00', '22:00', BURGESS),
  parkEvent('burgess', 'South London Miniteca at Burgess Park', '2026-08-07', '12:00', '21:30', BURGESS),
  parkEvent('burgess', 'Maiden Voyage Festival at Burgess Park', '2026-08-08', '12:00', '22:00', BURGESS),
  parkEvent('burgess', 'Eastern Electrics at Burgess Park', '2026-08-09', '12:00', '22:00', BURGESS),
  // Festival Republic residency at Gunnersbury Park — shows verified from
  // festivalrepublic.com event pages, 23 Jul 2026. TM lists 0 for this venue.
  parkEvent('gunnersbury', 'Gospel Garden Festival', '2026-08-02', '12:00', '22:00', GUNNERSBURY),
  parkEvent('gunnersbury', 'Tom Jones live at Gunnersbury Park', '2026-08-05', '16:00', '22:30', GUNNERSBURY),
  parkEvent('gunnersbury', 'Roots Picnic UK — Day 1', '2026-08-08', '12:00', '22:30', GUNNERSBURY),
  parkEvent('gunnersbury', 'Roots Picnic UK — Day 2', '2026-08-09', '12:00', '22:30', GUNNERSBURY),
  parkEvent('gunnersbury', 'Lenny Kravitz live at Gunnersbury Park', '2026-08-15', '15:00', '22:30', GUNNERSBURY),

  // Reggae Land 2026 — National Bowl, Milton Keynes. Fri 31 Jul – Sun 2 Aug
  // (verified reggaeland.co.uk + thenationalbowlmk.co.uk, 1 Aug 2026). Sold
  // out via own site / See Tickets — Ticketmaster venue returns 0 for these
  // dates (only later Bowl shows: Diaspora Calling 7 Aug, Electric Paradise
  // 8 Aug, Prodigy 22 Aug). Must stay curated.
  parkEvent('reggaeland', 'Reggae Land — Day 1 (Burna Boy)', '2026-07-31', '14:00', '23:00', NATIONAL_BOWL),
  parkEvent('reggaeland', 'Reggae Land — Day 2', '2026-08-01', '12:00', '23:00', NATIONAL_BOWL),
  parkEvent('reggaeland', 'Reggae Land — Day 3', '2026-08-02', '12:00', '23:00', NATIONAL_BOWL),

  // ── London Cricket 2026 at Lord's & The Oval ───────────────────────────
  // The Hundred 2026 home fixtures — dates verified against ESPN web cricket
  // calendar (league 19601 / 21376) on 30 Jul 2026. There is no London
  // Hundred match every day; only list confirmed Lord's / Oval home days.
  cricketMatch('hundred-oval-1', 'The Hundred: Oval Invincibles vs Manchester Originals', '2026-07-21', '18:00', '22:00', OVAL, 'The Hundred 2026 at Kennington Oval.'),
  cricketMatch('hundred-lords-1', 'The Hundred: London Spirit vs Manchester Originals', '2026-07-23', '18:00', '22:00', LORDS, 'The Hundred 2026 at Lord\'s Cricket Ground.'),
  cricketMatch('hundred-oval-2', 'The Hundred: Oval Invincibles vs London Spirit (Derby)', '2026-07-29', '18:00', '22:00', OVAL, 'London Derby in The Hundred at The Oval.'),
  cricketMatch('hundred-lords-2', 'The Hundred: London Spirit vs Southern Brave', '2026-08-01', '18:00', '22:00', LORDS, 'The Hundred 2026 at Lord\'s Cricket Ground.'),
  cricketMatch('hundred-oval-3', 'The Hundred: Oval Invincibles vs Manchester Originals', '2026-08-02', '14:30', '21:00', OVAL, 'The Hundred 2026 doubleheader at The Oval.'),
  cricketMatch('hundred-lords-3', 'The Hundred: London Spirit vs Oval Invincibles (Derby)', '2026-08-06', '18:00', '22:00', LORDS, 'London Derby in The Hundred at Lord\'s Cricket Ground.'),
  cricketMatch('hundred-oval-4', 'The Hundred: Oval Invincibles vs Trent Rockets', '2026-08-08', '18:00', '22:00', OVAL, 'The Hundred 2026 at The Oval.'),
  cricketMatch('hundred-lords-4', 'The Hundred: London Spirit vs Birmingham Phoenix', '2026-08-09', '14:30', '21:00', LORDS, 'The Hundred 2026 at Lord\'s Cricket Ground.'),

  parkEvent('gunnersbury', 'Jimmy Eat World live at Gunnersbury Park', '2026-08-16', '15:00', '22:30', GUNNERSBURY),

  // ── Longines Global Champions Tour — Royal Hospital Chelsea ────────────
  // World-championship showjumping in the Royal Hospital's South Grounds.
  // Sold via the tour's own ticketing (tickets.gcglobalchampions.com), so
  // invisible to every API. Dates verified 23 Jul 2026 (gcglobalchampions
  // .com/en-us/schedule/2026/london): Fri 7 – Sun 9 August 2026.
  // NOTE: Chestertons Polo in the Park (Hurlingham Park, Fulham) was
  // 5–7 June 2026 — already past; it IS on Ticketmaster, so 2027 editions
  // arrive automatically via the general TM pull.
  ...recurringDaily({
    idPrefix: 'featured-lgct-chelsea-2026',
    title: (label) => `Longines Global Champions Tour — ${label}`,
    startDate: '2026-08-07',
    endDate: '2026-08-09',
    startLocal: '11:00',
    endLocal: '19:00',
    venue: 'Royal Hospital Chelsea',
    latitude: 51.4866,
    longitude: -0.1588,
    description:
      'International showjumping at the Royal Hospital Chelsea. Crowds concentrate along Chelsea Embankment and Royal Hospital Road; busiest at session changeovers.',
    subCategory: 'Equestrian',
    category: 'sports',
  }),
  ];
}

/** Build a park-festival day entry. */
function parkEvent(
  idSlug: string,
  title: string,
  date: string,
  startLocal: string,
  endLocal: string,
  place: { venue: string; latitude: number; longitude: number; description: string },
): AppEvent {
  return {
    id: `featured-${idSlug}-${date}-${startLocal.replace(':', '')}`,
    source: 'featured',
    category: 'other',
    title,
    startsAt: `${date}T${startLocal}:00${ukOffset(date)}`,
    endsAt: `${date}T${endLocal}:00${ukOffset(date)}`,
    venue: place.venue,
    latitude: place.latitude,
    longitude: place.longitude,
    description: place.description,
    subCategory: 'Music',
  };
}

/** Build a generic Ascot race-day entry (non-Royal-Ascot meetings). */
function raceday(idSlug: string, title: string, date: string): AppEvent {
  return {
    id: `featured-${idSlug}-${date}`,
    source: 'featured',
    category: 'sports',
    title,
    startsAt: `${date}T13:30:00${ukOffset(date)}`,
    endsAt: `${date}T17:45:00${ukOffset(date)}`,
    venue: 'Ascot Racecourse',
    latitude: 51.4106,
    longitude: -0.6785,
    description:
      'Race day at Ascot Racecourse. Gates open ~10:30; racing roughly 13:50–17:30. Expect heavy traffic on the A329/A332 before and after racing.',
    subCategory: 'Horse Racing',
  };
}

/**
 * BBC Proms 2026 — every Royal Albert Hall concert as
 * [date, startLocal, endLocal, title]. End times are the published
 * "c" (circa) finish times. Source: BBC Proms 2026 listings
 * (classical-music.com day-by-day guide, published 21 Apr 2026).
 */
const PROMS_2026: [string, string, string, string][] = [
  ['2026-07-17', '19:00', '21:00', 'First Night of the Proms 2026'],
  ['2026-07-18', '19:30', '21:45', 'Prog Rock: A Fanfare for the Common Man'],
  ['2026-07-19', '11:00', '13:00', 'Black Dyke Band'],
  ['2026-07-19', '19:00', '21:15', 'Boléro: Rhythms of Spain'],
  ['2026-07-20', '19:00', '21:20', "Beethoven's Ninth"],
  ['2026-07-21', '18:00', '20:10', 'Also sprach Zarathustra'],
  ['2026-07-21', '22:15', '23:30', 'Late Night Baroque'],
  ['2026-07-22', '19:00', '21:05', "Mahler's 'Tragic' Sixth"],
  ['2026-07-23', '19:30', '21:35', 'Afterlife: Visions of the Beyond'],
  ['2026-07-24', '19:30', '22:00', "John Wilson Conducts Respighi's 'Roman Trilogy'"],
  ['2026-07-25', '14:00', '16:00', 'Horrible Science: The Big Bang Proms Experiment'],
  ['2026-07-25', '18:00', '20:00', 'Horrible Science: The Big Bang Proms Experiment'],
  ['2026-07-26', '11:00', '12:30', 'Olivier Latry Plays Bach'],
  ['2026-07-26', '19:00', '21:10', 'Poulenc and Adams'],
  ['2026-07-27', '19:00', '21:00', 'From the Alps to the Auvergne'],
  ['2026-07-28', '19:00', '21:20', "Sibelius's Second"],
  ['2026-07-29', '19:00', '21:05', "Elgar's First"],
  ['2026-07-30', '19:00', '21:00', "Korngold's Violin Concerto"],
  ['2026-07-31', '19:30', '21:40', "Bruch's Violin Concerto"],
  ['2026-08-01', '19:00', '21:15', "Mahler's First by Heart"],
  ['2026-08-02', '11:00', '13:15', "Mahler's First by Heart"],
  ['2026-08-02', '19:30', '21:45', 'Kavakos Plays Tchaikovsky'],
  ['2026-08-03', '19:00', '21:05', "Rachmaninov's 'Paganini' Variations"],
  ['2026-08-04', '19:00', '21:05', 'Dvořák and Mendelssohn'],
  ['2026-08-05', '18:00', '20:10', "Rachmaninov's Second"],
  ['2026-08-05', '22:15', '23:30', 'Under African Skies'],
  ['2026-08-06', '19:00', '21:30', "Elder Conducts Weber's 'Oberon'"],
  ['2026-08-07', '19:00', '21:00', "Rossini's 'Stabat mater'"],
  ['2026-08-08', '19:30', '21:40', "Berlioz's 'Symphonie fantastique'"],
  ['2026-08-09', '11:00', '12:00', 'Relaxed Prom'],
  ['2026-08-09', '19:00', '21:00', 'The OAE Plays Mozart and Haydn'],
  ['2026-08-10', '19:00', '21:15', 'Salonen Conducts 20th-Century Classics'],
  ['2026-08-11', '18:00', '20:10', 'Dudamel and the LA Phil: Beethoven and Adès'],
  ['2026-08-11', '22:15', '23:30', 'Evelyn Glennie and the Fantasia Orchestra'],
  ['2026-08-12', '19:00', '21:00', 'Dudamel and the LA Phil: Beethoven and Ortiz'],
  ['2026-08-13', '19:00', '21:15', "Gershwin's Piano Concerto"],
  ['2026-08-14', '19:00', '21:15', 'BBC Concert Orchestra and Edwin Outwater'],
  ['2026-08-15', '19:30', '21:00', "Pappano Conducts Berlioz's 'Requiem'"],
  ['2026-08-16', '11:00', '13:00', 'Swedish Chamber Orchestra: Beethoven and Baroque'],
  ['2026-08-16', '19:30', '21:30', "Elgar's Cello Concerto"],
  ['2026-08-17', '19:00', '21:05', 'Copland and Stravinsky'],
  ['2026-08-18', '19:00', '20:50', "Shostakovich's Tenth"],
  ['2026-08-19', '19:00', '21:35', "'Ariadne auf Naxos' from Glyndebourne"],
  ['2026-08-20', '19:00', '21:15', 'Miles Davis Centenary'],
  ['2026-08-21', '19:00', '21:45', "Mahler's 'Song of the Earth'"],
  ['2026-08-22', '19:30', '21:35', 'Chineke! Orchestra with Angel Blue'],
  ['2026-08-23', '11:00', '13:00', "Mozart's 'Haffner' Symphony"],
  ['2026-08-23', '19:30', '21:45', "Capuçon Plays Dvořák's Cello Concerto"],
  ['2026-08-24', '19:00', '21:30', 'American Classics'],
  ['2026-08-25', '19:00', '21:15', 'Bond and Beyond'],
  ['2026-08-26', '19:00', '21:15', 'The Met Orchestra Plays Strauss'],
  ['2026-08-27', '18:00', '20:10', 'The Met Orchestra Plays Mahler'],
  ['2026-08-27', '22:15', '23:30', 'Ultimate Calm'],
  ['2026-08-28', '19:30', '21:00', 'Altın Gün'],
  ['2026-08-29', '19:30', '21:45', 'Stravinsky and Prokofiev with the Oslo Philharmonic'],
  ['2026-08-30', '19:00', '21:30', "Berlioz's 'The Damnation of Faust'"],
  ['2026-08-31', '19:00', '21:30', "Enchanted: Alan Menken's Music for Disney"],
  ['2026-09-01', '19:30', '21:35', "Rachmaninov's Third Piano Concerto"],
  ['2026-09-02', '18:30', '20:25', 'Berlin Philharmonic Plays Elgar and Tchaikovsky'],
  ['2026-09-02', '22:15', '23:30', 'Steve Reich at 90'],
  ['2026-09-03', '19:00', '21:15', 'Berlin Philharmonic Plays Beethoven and Scriabin'],
  ['2026-09-04', '19:00', '21:15', "Vaughan Williams's 'Fantasia' and Symphony No. 9"],
  ['2026-09-05', '19:00', '21:15', 'Martha Argerich Plays Beethoven'],
  ['2026-09-06', '11:00', '13:00', 'John Wilson Conducts the Sinfonia of London Strings'],
  ['2026-09-06', '19:30', '21:25', "Dvořák's 'New World' Symphony"],
  ['2026-09-07', '19:00', '21:15', 'Rattle Conducts Schumann'],
  ['2026-09-08', '18:30', '20:15', 'Rachmaninov, Bartók and Varèse'],
  ['2026-09-08', '22:15', '23:30', 'Jules Buckley Orchestra'],
  ['2026-09-09', '19:00', '20:55', "Strauss's 'Four Last Songs'"],
  ['2026-09-10', '19:00', '21:30', "Bach's Mass in B minor with Arcangelo"],
  ['2026-09-11', '20:00', '21:30', "Mahler's Ninth with the Mahler Academy Orchestra"],
  ['2026-09-12', '19:15', '22:30', 'Last Night of the Proms 2026'],
];

/** Build AppEvents for every Royal Albert Hall Prom. */
function promsEvents(): AppEvent[] {
  return PROMS_2026.map(([date, startLocal, endLocal, title]) => ({
    id: `featured-proms-2026-${date}-${startLocal.replace(':', '')}`,
    source: 'featured' as const,
    category: 'other' as const,
    title: `BBC Proms: ${title}`,
    startsAt: `${date}T${startLocal}:00${ukOffset(date)}`,
    endsAt: `${date}T${endLocal}:00${ukOffset(date)}`,
    venue: 'Royal Albert Hall',
    latitude: 51.5009,
    longitude: -0.1774,
    description:
      'BBC Proms 2026 at the Royal Albert Hall — the world\'s biggest classical music festival, 17 July to 12 September.',
    subCategory: 'Music',
  }));
}

/** Build a Royal Ascot day entry. */
function ascot(dayLabel: string, date: string): AppEvent {
  return {
    id: `featured-royal-ascot-2026-${date}`,
    source: 'featured',
    category: 'sports',
    title: `Royal Ascot 2026 — Day ${dayLabel}`,
    startsAt: `${date}T14:00:00${ukOffset(date)}`,
    endsAt: `${date}T18:00:00${ukOffset(date)}`,
    venue: 'Ascot Racecourse',
    latitude: 51.4106,
    longitude: -0.6785,
    description:
      'Royal Ascot, the showpiece of the British flat-racing season. Gates 10:30, Royal Procession 14:00, first race 14:30.',
    subCategory: 'Horse Racing',
  };
}

/**
 * Generate one featured entry per day across an inclusive date range. Reusable
 * for any multi-day event where roughly the same daily window applies
 * (Wimbledon fortnight, a cricket Test, a festival run). Times are London
 * wall-clock; the BST/GMT offset is derived per date.
 */
function recurringDaily(opts: {
  idPrefix: string;
  title: (dayLabel: string, date: string, index: number) => string;
  startDate: string; // 'YYYY-MM-DD' inclusive
  endDate: string; // 'YYYY-MM-DD' inclusive
  startLocal: string; // 'HH:MM'
  endLocal: string; // 'HH:MM'
  venue: string;
  latitude: number;
  longitude: number;
  description: string;
  subCategory: string;
  category: AppEvent['category'];
  /** Override only if the source really publishes a fixed offset. */
  offset?: string;
}): AppEvent[] {
  const out: AppEvent[] = [];
  const start = new Date(`${opts.startDate}T00:00:00Z`);
  const end = new Date(`${opts.endDate}T00:00:00Z`);
  let index = 0;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    index += 1;
    const date = d.toISOString().slice(0, 10);
    const dayLabel = `Day ${index}`;
    const off = opts.offset ?? ukOffset(date);
    out.push({
      id: `${opts.idPrefix}-${date}`,
      source: 'featured',
      category: opts.category,
      title: opts.title(dayLabel, date, index),
      startsAt: `${date}T${opts.startLocal}:00${off}`,
      endsAt: `${date}T${opts.endLocal}:00${off}`,
      venue: opts.venue,
      latitude: opts.latitude,
      longitude: opts.longitude,
      description: opts.description,
      subCategory: opts.subCategory,
    });
  }
  return out;
}

/** Wimbledon 2026 — a pin every day of the fortnight. */
function wimbledonDays(): AppEvent[] {
  return recurringDaily({
    idPrefix: 'featured-wimbledon-2026',
    title: (label) => `Wimbledon 2026 — ${label}`,
    startDate: '2026-06-29',
    endDate: '2026-07-12',
    startLocal: '11:00',
    endLocal: '21:00',
    venue: 'All England Lawn Tennis Club',
    latitude: 51.4336,
    longitude: -0.214,
    description:
      'The Championships, Wimbledon. Grand Slam tennis at SW19 — matches across the day, 29 June to 12 July 2026.',
    subCategory: 'Tennis',
    category: 'sports',
  });
}

/**
 * Return curated events that fall inside the requested range. Mirrors the
 * provider fetchers' signature so it slots straight into the events fan-out,
 * even though it's synchronous local data.
 */
export async function fetchFeaturedLondon(range: DateRange): Promise<AppEvent[]> {
  if (featuredCache == null) featuredCache = buildFeatured();
  return featuredCache.filter((e) =>
    eventOverlapsRange(e.startsAt, e.endsAt, range),
  );
}
