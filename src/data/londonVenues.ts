/**
 * Curated map of London sports venues + the teams that play in them, with
 * coordinates good enough for map pins. Used to strictly filter events down
 * to "actually happening in London" — TheSportsDB doesn't return lat/lng on
 * its events, so we resolve a venue or home-team name to a known location.
 *
 * The map is keyed by *normalised* lower-case names (no "FC", no punctuation)
 * so we can match resilient variants like "Tottenham Hotspur Women" or
 * "Surrey CCC" against a single canonical entry.
 */

export interface LondonPlace {
  /** Display venue name. */
  venue: string;
  latitude: number;
  longitude: number;
  /**
   * TheSportsDB `idVenue` for this place. When populated, the new sportsdb
   * service queries `/api/v2/json/schedule/next/venue/{id}` for upcoming
   * events of any sport at this venue — that's how we surface fixtures
   * without enumerating every league.
   *
   * Run `node scripts/resolve-venue-ids.mjs` once with your Premium key to
   * auto-fill these. Any venue left as `null` is silently skipped by the
   * fetch loop (it still works as a coordinate-resolution fallback).
   */
  sportsdbVenueId?: number | null;
}

const VENUES = {
  // ── Football ────────────────────────────────────────────────────────
  emirates: {
    venue: 'Emirates Stadium',
    latitude: 51.5549,
    longitude: -0.1084,
    sportsdbVenueId: null,
  },
  stamfordBridge: {
    venue: 'Stamford Bridge',
    latitude: 51.4816,
    longitude: -0.1909,
    sportsdbVenueId: null,
  },
  tottenham: {
    venue: 'Tottenham Hotspur Stadium',
    latitude: 51.6043,
    longitude: -0.0664,
    sportsdbVenueId: null,
  },
  londonStadium: {
    venue: 'London Stadium',
    latitude: 51.5386,
    longitude: -0.0166,
    sportsdbVenueId: null,
  },
  selhurst: {
    venue: 'Selhurst Park',
    latitude: 51.3983,
    longitude: -0.0855,
    sportsdbVenueId: null,
  },
  cravenCottage: {
    venue: 'Craven Cottage',
    latitude: 51.475,
    longitude: -0.2216,
    sportsdbVenueId: null,
  },
  brentford: {
    venue: 'Gtech Community Stadium',
    latitude: 51.4906,
    longitude: -0.2885,
    sportsdbVenueId: null,
  },
  qpr: {
    venue: 'Loftus Road',
    latitude: 51.5093,
    longitude: -0.2326,
    sportsdbVenueId: null,
  },
  millwall: {
    venue: 'The Den',
    latitude: 51.4859,
    longitude: -0.0509,
    // Verified: thesportsdb.com/venue/16366-the-den (Millwall vs Antwerp 1 Aug 2026).
    sportsdbVenueId: 16366,
  },
  // Outside Greater London but traffic-relevant for drivers (client request
  // Jul 2026 — pre-season friendlies at Vicarage Road were invisible).
  watford: {
    venue: 'Vicarage Road',
    latitude: 51.6498,
    longitude: -0.4017,
    // Verified: thesportsdb.com/venue/16117-vicarage-road
    sportsdbVenueId: 16117,
  },
  // Luton + Milton Keynes corridor (client Aug 2026 — Kenilworth Road
  // friendlies + National Bowl summer festivals were invisible because the
  // London market pull and geo box stopped short of these grounds).
  kenilworthRoad: {
    venue: 'Kenilworth Road',
    latitude: 51.8842,
    longitude: -0.4317,
    sportsdbVenueId: null,
  },
  stadiumMk: {
    venue: 'Stadium MK',
    latitude: 52.0093,
    longitude: -0.7345,
    sportsdbVenueId: null,
  },
  nationalBowl: {
    venue: 'The National Bowl',
    latitude: 52.0148,
    longitude: -0.7562,
    sportsdbVenueId: null,
  },
  campbellPark: {
    venue: 'Campbell Park',
    latitude: 52.0499,
    longitude: -0.7367,
    sportsdbVenueId: null,
  },
  charlton: {
    venue: 'The Valley',
    latitude: 51.4865,
    longitude: 0.0364,
    sportsdbVenueId: null,
  },
  leytonOrient: {
    venue: 'Brisbane Road',
    latitude: 51.5601,
    longitude: -0.0125,
    sportsdbVenueId: null,
  },
  afcWimbledon: {
    venue: 'Plough Lane',
    latitude: 51.4318,
    longitude: -0.1996,
    sportsdbVenueId: null,
  },
  barnet: {
    venue: 'The Hive Stadium',
    latitude: 51.6057,
    longitude: -0.2942,
    sportsdbVenueId: null,
  },
  suttonUnited: {
    venue: 'Gander Green Lane',
    latitude: 51.3669,
    longitude: -0.2017,
    sportsdbVenueId: null,
  },
  daghamRedbridge: {
    venue: 'Victoria Road',
    latitude: 51.5453,
    longitude: 0.1357,
    sportsdbVenueId: null,
  },
  bromley: {
    venue: 'Hayes Lane',
    latitude: 51.3999,
    longitude: 0.0148,
    sportsdbVenueId: null,
  },
  woking: {
    venue: 'Kingfield Stadium',
    latitude: 51.3102,
    longitude: -0.5528,
    sportsdbVenueId: null,
  },
  // Isthmian/National League clubs that host pre-season friendlies
  // vs Championship sides and attract meaningful traffic.
  hemel: {
    venue: 'Vauxhall Road',
    latitude: 51.7396,
    longitude: -0.4654,
    sportsdbVenueId: null,
  },

  // ── Cricket ─────────────────────────────────────────────────────────
  lords: {
    venue: "Lord's Cricket Ground",
    latitude: 51.5294,
    longitude: -0.1727,
    // No reliable SportsDB venue id found — resolved at runtime via search.
    sportsdbVenueId: null,
  },
  oval: {
    venue: 'The Oval',
    latitude: 51.4837,
    longitude: -0.1145,
    // Verified: thesportsdb.com/venue/18141-the-oval (Kennington, London).
    sportsdbVenueId: 18141,
  },

  // ── Rugby Union ─────────────────────────────────────────────────────
  twickenham: {
    venue: 'Twickenham Stadium',
    latitude: 51.4561,
    longitude: -0.3415,
    sportsdbVenueId: null,
  },
  saracens: {
    venue: 'StoneX Stadium',
    latitude: 51.6191,
    longitude: -0.2244,
    sportsdbVenueId: null,
  },
  harlequins: {
    venue: 'The Stoop',
    latitude: 51.4538,
    longitude: -0.346,
    sportsdbVenueId: null,
  },

  // ── Tennis ──────────────────────────────────────────────────────────
  wimbledon: {
    venue: 'All England Lawn Tennis Club',
    latitude: 51.4348,
    longitude: -0.2138,
    sportsdbVenueId: null,
  },
  queens: {
    venue: "The Queen's Club",
    latitude: 51.4886,
    longitude: -0.2122,
    sportsdbVenueId: null,
  },

  // ── Horse racing (client request 23 Jul 2026 — race days are big
  //    driver-demand events invisible to Ticketmaster/football APIs) ────
  ascot: {
    venue: 'Ascot Racecourse',
    latitude: 51.4139,
    longitude: -0.6796,
    sportsdbVenueId: null,
  },
  epsom: {
    venue: 'Epsom Downs Racecourse',
    latitude: 51.311,
    longitude: -0.2577,
    sportsdbVenueId: null,
  },
  sandown: {
    venue: 'Sandown Park Racecourse',
    latitude: 51.3745,
    longitude: -0.3643,
    sportsdbVenueId: null,
  },
  kempton: {
    venue: 'Kempton Park Racecourse',
    latitude: 51.4194,
    longitude: -0.4106,
    sportsdbVenueId: null,
  },
  windsorRaces: {
    venue: 'Royal Windsor Racecourse',
    latitude: 51.4903,
    longitude: -0.6224,
    sportsdbVenueId: null,
  },

  // ── Multi-sport / arenas ────────────────────────────────────────────
  wembley: {
    venue: 'Wembley Stadium',
    latitude: 51.556,
    longitude: -0.2796,
    // Pre-filled — verified against TheSportsDB lookupvenue.php?id=16163
    sportsdbVenueId: 16163,
  },
  o2: {
    venue: 'The O2 Arena',
    latitude: 51.503,
    longitude: 0.003,
    sportsdbVenueId: null,
  },
  copperBox: {
    venue: 'Copper Box Arena',
    latitude: 51.5462,
    longitude: -0.0153,
    sportsdbVenueId: null,
  },
  ovoWembley: {
    venue: 'OVO Arena Wembley',
    latitude: 51.5586,
    longitude: -0.2826,
    sportsdbVenueId: null,
  },
  // Theatre next to the stadium. Ticketmaster listings say "Wembley" and
  // were snapping onto the 90,000-seat bowl (Dinosaur World, Chaka Khan).
  troubadourWembley: {
    venue: 'Troubadour Wembley Park Theatre',
    latitude: 51.5578,
    longitude: -0.2833,
    sportsdbVenueId: null,
  },
  crystalPalaceSC: {
    venue: 'Crystal Palace National Sports Centre',
    latitude: 51.418,
    longitude: -0.0735,
    sportsdbVenueId: null,
  },
  royalAlbertHall: {
    venue: 'Royal Albert Hall',
    latitude: 51.5009,
    longitude: -0.1773,
    sportsdbVenueId: null,
  },
  leeValleyVeloPark: {
    venue: 'Lee Valley VeloPark',
    latitude: 51.5471,
    longitude: -0.0124,
    sportsdbVenueId: null,
  },
  alexandraPalace: {
    venue: 'Alexandra Palace',
    latitude: 51.5963,
    longitude: -0.1107,
    sportsdbVenueId: null,
  },
  excel: {
    venue: 'ExCeL London',
    latitude: 51.5079,
    longitude: 0.0297,
    sportsdbVenueId: null,
  },

  // ── Parks / festival grounds (client Jul 2026 — summer festivals) ────
  // Many sell via RA/DICE/See Tickets so TM is empty; coords still needed so
  // any TM hit (or featured curation) can pin. Burgess Park has no lat/lng
  // on Ticketmaster — without this entry those events were dropped.
  bostonManorPark: {
    venue: 'Boston Manor Park',
    latitude: 51.4936,
    longitude: -0.3247,
    sportsdbVenueId: null,
  },
  burgessPark: {
    venue: 'Burgess Park',
    latitude: 51.4855,
    longitude: -0.0765,
    sportsdbVenueId: null,
  },
  gunnersburyPark: {
    venue: 'Gunnersbury Park',
    latitude: 51.4997,
    longitude: -0.2875,
    sportsdbVenueId: null,
  },
  crystalPalaceBowl: {
    venue: 'Crystal Palace Bowl',
    latitude: 51.4209,
    longitude: -0.0674,
    sportsdbVenueId: null,
  },
  victoriaPark: {
    venue: 'Victoria Park',
    latitude: 51.5393,
    longitude: -0.0405,
    sportsdbVenueId: null,
  },
  finsburyPark: {
    venue: 'Finsbury Park',
    latitude: 51.5646,
    longitude: -0.1059,
    sportsdbVenueId: null,
  },
  claphamCommon: {
    venue: 'Clapham Common',
    latitude: 51.4616,
    longitude: -0.1378,
    sportsdbVenueId: null,
  },
  brockwellPark: {
    venue: 'Brockwell Park',
    latitude: 51.4501,
    longitude: -0.1073,
    sportsdbVenueId: null,
  },
  southwarkPark: {
    venue: 'Southwark Park',
    latitude: 51.4921,
    longitude: -0.0605,
    sportsdbVenueId: null,
  },
  hydePark: {
    venue: 'Hyde Park',
    latitude: 51.5073,
    longitude: -0.1657,
    sportsdbVenueId: null,
  },
} satisfies Record<string, LondonPlace>;

/**
 * Flat array of every distinct London venue, used by the sportsdb fetch loop
 * to iterate. Deduped against the keyed lookup table above so the same venue
 * isn't queried twice.
 */
export const LONDON_VENUE_LIST: LondonPlace[] = Object.values(VENUES);

/**
 * DriveIQ map area: Greater London plus agreed traffic-relevant outskirts
 * (Watford, Ascot, Epsom, Windsor, Sandown, Kempton, Woking, Luton,
 * Milton Keynes / National Bowl).
 *
 * Ticketmaster `marketId=202` still leaks venues outside this box (e.g.
 * Electric Bristol — Martin Kemp DJ set, Aug 2026). Always drop pins that
 * fall outside these bounds, regardless of market/city labels.
 */
export const DRIVEIQ_AREA = {
  minLat: 51.25,
  maxLat: 52.1,
  minLon: -0.9,
  maxLon: 0.35,
} as const;

/** True when coords are usable and inside the DriveIQ coverage box. */
export function isInDriveIQArea(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  // Ticketmaster sometimes returns 0,0 when geo is missing.
  if (lat === 0 && lon === 0) return false;
  return (
    lat >= DRIVEIQ_AREA.minLat &&
    lat <= DRIVEIQ_AREA.maxLat &&
    lon >= DRIVEIQ_AREA.minLon &&
    lon <= DRIVEIQ_AREA.maxLon
  );
}

/**
 * Lookup table keyed by lower-case names. Includes both team names and
 * venue names so we can match either the `strHomeTeam` or `strVenue` field
 * coming back from TheSportsDB. Multiple keys can resolve to the same venue
 * (e.g. "spurs" and "tottenham hotspur stadium" both → VENUES.tottenham).
 */
const PLACES: Record<string, LondonPlace> = {
  // Football clubs (men's & women's; "fc"/"afc" stripped before matching)
  arsenal: VENUES.emirates,
  chelsea: VENUES.stamfordBridge,
  tottenham: VENUES.tottenham,
  'tottenham hotspur': VENUES.tottenham,
  spurs: VENUES.tottenham,
  'west ham': VENUES.londonStadium,
  'west ham united': VENUES.londonStadium,
  'crystal palace': VENUES.selhurst,
  fulham: VENUES.cravenCottage,
  brentford: VENUES.brentford,
  qpr: VENUES.qpr,
  'queens park rangers': VENUES.qpr,
  millwall: VENUES.millwall,
  watford: VENUES.watford,
  'luton town': VENUES.kenilworthRoad,
  'milton keynes dons': VENUES.stadiumMk,
  'mk dons': VENUES.stadiumMk,
  charlton: VENUES.charlton,
  'charlton athletic': VENUES.charlton,
  'leyton orient': VENUES.leytonOrient,
  orient: VENUES.leytonOrient,
  'afc wimbledon': VENUES.afcWimbledon,
  wimbledon: VENUES.afcWimbledon,
  barnet: VENUES.barnet,
  'sutton united': VENUES.suttonUnited,
  sutton: VENUES.suttonUnited,
  'dagenham and redbridge': VENUES.daghamRedbridge,
  'dagenham & redbridge': VENUES.daghamRedbridge,

  // Championship & lower-league London clubs — aliases ESPN uses
  // (with and without "FC"/"AFC", long vs short names)
  'queens park rangers fc': VENUES.qpr,
  'millwall fc': VENUES.millwall,
  'watford fc': VENUES.watford,
  'luton town fc': VENUES.kenilworthRoad,
  'milton keynes dons fc': VENUES.stadiumMk,
  'mk dons fc': VENUES.stadiumMk,
  'charlton athletic fc': VENUES.charlton,
  'leyton orient fc': VENUES.leytonOrient,
  'afc wimbledon fc': VENUES.afcWimbledon,
  'barnet fc': VENUES.barnet,
  'sutton united fc': VENUES.suttonUnited,
  'dagenham redbridge': VENUES.daghamRedbridge,
  'dag and red': VENUES.daghamRedbridge,
  bromley: VENUES.bromley,
  'bromley fc': VENUES.bromley,
  woking: VENUES.woking,
  'woking fc': VENUES.woking,

  // Cricket
  surrey: VENUES.oval,
  'surrey ccc': VENUES.oval,
  middlesex: VENUES.lords,
  'middlesex ccc': VENUES.lords,
  'london spirit': VENUES.lords,
  'oval invincibles': VENUES.oval,
  england: VENUES.wembley,

  // Rugby Union
  saracens: VENUES.saracens,
  harlequins: VENUES.harlequins,
  'london irish': VENUES.twickenham, // historical — exiled but still a London badge

  // Horse racing
  'ascot racecourse': VENUES.ascot,
  ascot: VENUES.ascot,
  'epsom downs racecourse': VENUES.epsom,
  'epsom downs': VENUES.epsom,
  epsom: VENUES.epsom,
  'sandown park racecourse': VENUES.sandown,
  'sandown park': VENUES.sandown,
  sandown: VENUES.sandown,
  'kempton park racecourse': VENUES.kempton,
  'kempton park': VENUES.kempton,
  kempton: VENUES.kempton,
  'royal windsor racecourse': VENUES.windsorRaces,
  'windsor racecourse': VENUES.windsorRaces,

  // Venue names
  'emirates stadium': VENUES.emirates,
  emirates: VENUES.emirates,
  'stamford bridge': VENUES.stamfordBridge,
  'tottenham hotspur stadium': VENUES.tottenham,
  'london stadium': VENUES.londonStadium,
  'selhurst park': VENUES.selhurst,
  'craven cottage': VENUES.cravenCottage,
  'gtech community stadium': VENUES.brentford,
  'brentford community stadium': VENUES.brentford,
  'kiyan prince foundation stadium': VENUES.qpr,
  'loftus road': VENUES.qpr,
  'the den': VENUES.millwall,
  'vicarage road': VENUES.watford,
  'vicarage road stadium': VENUES.watford,
  'kenilworth road': VENUES.kenilworthRoad,
  'kenilworth road stadium': VENUES.kenilworthRoad,
  'stadium mk': VENUES.stadiumMk,
  'stadium:mk': VENUES.stadiumMk,
  'the national bowl': VENUES.nationalBowl,
  'national bowl': VENUES.nationalBowl,
  'milton keynes bowl': VENUES.nationalBowl,
  'milton keynes national bowl': VENUES.nationalBowl,
  'campbell park': VENUES.campbellPark,
  'the valley': VENUES.charlton,
  'brisbane road': VENUES.leytonOrient,
  'breyer group stadium': VENUES.leytonOrient,
  'plough lane': VENUES.afcWimbledon,
  'cherry red records stadium': VENUES.afcWimbledon,
  'the hive stadium': VENUES.barnet,
  "lord's": VENUES.lords,
  "lord's cricket ground": VENUES.lords,
  lords: VENUES.lords,
  'the oval': VENUES.oval,
  'kia oval': VENUES.oval,
  'kennington oval': VENUES.oval,
  oval: VENUES.oval,
  twickenham: VENUES.twickenham,
  'twickenham stadium': VENUES.twickenham,
  'stonex stadium': VENUES.saracens,
  'allianz park': VENUES.saracens,
  'the stoop': VENUES.harlequins,
  'twickenham stoop': VENUES.harlequins,
  'all england club': VENUES.wimbledon,
  'all england lawn tennis club': VENUES.wimbledon,
  // Without these, "Wimbledon Championships" fell through to the bare
  // `wimbledon` alias and pinned tennis at AFC Wimbledon's ground.
  'wimbledon championships': VENUES.wimbledon,
  'the championships wimbledon': VENUES.wimbledon,
  'centre court': VENUES.wimbledon,
  aeltc: VENUES.wimbledon,
  "queen's club": VENUES.queens,
  'queens club': VENUES.queens,
  wembley: VENUES.wembley,
  'wembley stadium': VENUES.wembley,
  'troubadour wembley park theatre': VENUES.troubadourWembley,
  'troubadour theatre': VENUES.troubadourWembley,
  'wembley park theatre': VENUES.troubadourWembley,
  'troubadour wembley': VENUES.troubadourWembley,
  'o2 arena': VENUES.o2,
  'the o2 arena': VENUES.o2,
  'the o2': VENUES.o2,
  'copper box arena': VENUES.copperBox,
  'copper box': VENUES.copperBox,
  'ovo arena wembley': VENUES.ovoWembley,
  'wembley arena': VENUES.ovoWembley,
  'crystal palace national sports centre': VENUES.crystalPalaceSC,
  'lee valley velopark': VENUES.leeValleyVeloPark,
  'alexandra palace': VENUES.alexandraPalace,
  'ally pally': VENUES.alexandraPalace,
  'royal albert hall': VENUES.royalAlbertHall,
  'albert hall': VENUES.royalAlbertHall,
  'excel london': VENUES.excel,
  excel: VENUES.excel,
  // Parks / festival grounds
  'boston manor park': VENUES.bostonManorPark,
  'boston manor': VENUES.bostonManorPark,
  'burgess park': VENUES.burgessPark,
  'gunnersbury park': VENUES.gunnersburyPark,
  gunnersbury: VENUES.gunnersburyPark,
  'crystal palace bowl': VENUES.crystalPalaceBowl,
  'victoria park': VENUES.victoriaPark,
  'victoria park london': VENUES.victoriaPark,
  'finsbury park': VENUES.finsburyPark,
  'clapham common': VENUES.claphamCommon,
  'brockwell park': VENUES.brockwellPark,
  'southwark park': VENUES.southwarkPark,
  'hyde park': VENUES.hydePark,
  // New grounds
  'hayes lane': VENUES.bromley,
  'kingfield stadium': VENUES.woking,
  'gander green lane': VENUES.suttonUnited,
  'vauxhall road': VENUES.hemel,
};

/**
 * Longest alias first. The substring pass used to run in object order, so a
 * short generic key could win over a specific one and pin an event at the
 * wrong place: "Wembley Arena" matched `wembley` (the stadium), "Wimbledon
 * Championships" matched `wimbledon` (AFC Wimbledon's ground), "Kennington
 * Oval" matched `oval`. Checking the most specific alias first fixes all of
 * that class of bug at once.
 */
const PLACE_KEYS = Object.keys(PLACES).sort((a, b) => b.length - a.length);

/**
 * Aliases that are only safe as a whole-string match. "England" as a home team
 * means a Wembley football fixture, but as part of any longer name (an England
 * cricket or rugby side) it would have pinned the event at Wembley instead of
 * Lord's, The Oval or Twickenham.
 */
const EXACT_ONLY_KEYS = new Set([
  'england',
  // Short tokens that appear inside other venues worldwide / next door.
  // "Karen Rolton Oval" / "Adelaide Oval" used to pin at Kennington;
  // "Troubadour Wembley Park Theatre" used to pin at the stadium.
  'oval',
  'wembley',
  'emirates',
  'excel',
]);

/**
 * Strip the noise common to team / venue names before matching:
 *   "Arsenal F.C. (W)"        →  "arsenal"
 *   "Tottenham Hotspur Women" →  "tottenham hotspur women"
 *   "Surrey CCC"              →  "surrey"
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // drop parenthesised qualifiers
    .replace(/\b(fc|afc|cf|ccc|rfc)\b/g, ' ')
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve any of `candidates` (venue name, home team, …) to a London place,
 * or `null` if none of them are recognised. Tries exact match first, then
 * word-boundary contains, so "Arsenal Women" still resolves to Emirates.
 */
export function findLondonPlace(
  ...candidates: (string | undefined | null)[]
): LondonPlace | null {
  for (const raw of candidates) {
    if (!raw) continue;
    const norm = normalize(raw);
    if (!norm) continue;

    if (PLACES[norm]) return PLACES[norm];

    for (const key of PLACE_KEYS) {
      if (EXACT_ONLY_KEYS.has(key)) continue;
      // word-boundary match — avoids "watford" matching "wat" etc.
      const re = new RegExp(`(^|\\s)${escapeRegExp(key)}(\\s|$)`);
      if (re.test(norm)) return PLACES[key];
    }
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pin an event by its actual venue. Never fall back to the home club when a
 * venue string is present but unrecognised — that is how Arsenal away days
 * were landing on Emirates, and why two copies of the same match appeared
 * at two grounds.
 */
export function resolveEventPlace(
  venue?: string | null,
  homeTeam?: string | null,
): LondonPlace | null {
  const named = venue?.trim();
  if (named) return findLondonPlace(named);
  const home = homeTeam?.trim();
  if (home) return findLondonPlace(home);
  return null;
}
