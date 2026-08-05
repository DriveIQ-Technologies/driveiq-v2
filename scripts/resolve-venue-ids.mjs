#!/usr/bin/env node
/**
 * resolve-venue-ids.mjs
 *
 * One-shot helper: hits TheSportsDB's `searchvenues.php` for every London
 * venue in `src/data/londonVenues.ts` and prints back the resolved
 * `idVenue` for each. Paste the printed values into the `sportsdbVenueId`
 * fields of the corresponding entry.
 *
 * Why: the new sportsdb service queries `/api/v2/json/schedule/next/venue/{id}`,
 * which needs the numeric venue id — not the name. Doing this lookup once at
 * build-time rather than every app start saves rate-limit budget and means
 * a name-string change at TheSportsDB never breaks your venue mapping.
 *
 * Usage:
 *
 *   # With the free key (limited to 1 result per query but works for testing):
 *   node scripts/resolve-venue-ids.mjs
 *
 *   # With your Premium key (recommended — fewer ambiguous matches):
 *   SPORTSDB_KEY=your_premium_key node scripts/resolve-venue-ids.mjs
 *
 * Output is printed as a copy-pasteable diff: each line looks like
 *
 *   emirates: sportsdbVenueId: 16795
 *
 * which you map onto the corresponding entry in `src/data/londonVenues.ts`.
 */

const KEY = process.env.SPORTSDB_KEY || '123';
const BASE = `https://www.thesportsdb.com/api/v1/json/${KEY}`;

// Keep this list in sync with `LONDON_VENUE_LIST` in src/data/londonVenues.ts.
// First field is the lookup key shown in the output, second is the search
// string we send to TheSportsDB (sometimes a shorter / cleaner alias matches
// better than the official long-form name).
const VENUES = [
  ['emirates',          'Emirates Stadium'],
  ['stamfordBridge',    'Stamford Bridge'],
  ['tottenham',         'Tottenham Hotspur Stadium'],
  ['londonStadium',     'London Stadium'],
  ['selhurst',          'Selhurst Park'],
  ['cravenCottage',     'Craven Cottage'],
  ['brentford',         'Gtech Community Stadium'],
  ['qpr',               'Loftus Road'],
  ['millwall',          'The Den'],
  ['watford',           'Vicarage Road'],
  ['charlton',          'The Valley'],
  ['leytonOrient',      'Brisbane Road'],
  ['afcWimbledon',      'Plough Lane'],
  ['barnet',            'The Hive Stadium'],
  ['suttonUnited',      'Gander Green Lane'],
  ['daghamRedbridge',   'Victoria Road'],
  ['lords',             "Lord's Cricket Ground"],
  ['oval',              'The Oval'],
  ['twickenham',        'Twickenham Stadium'],
  ['saracens',          'StoneX Stadium'],
  ['harlequins',        'Twickenham Stoop'],
  ['wimbledon',         'All England Lawn Tennis Club'],
  ['queens',            "The Queen's Club"],
  ['wembley',           'Wembley Stadium'],
  ['o2',                'The O2 Arena'],
  ['copperBox',         'Copper Box Arena'],
  ['ovoWembley',        'OVO Arena Wembley'],
  ['crystalPalaceSC',   'Crystal Palace National Sports Centre'],
  ['leeValleyVeloPark', 'Lee Valley VeloPark'],
  ['alexandraPalace',   'Alexandra Palace'],
  ['excel',             'ExCeL London'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchVenue(name) {
  const url = `${BASE}/searchvenues.php?v=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const json = await res.json().catch(() => null);
  if (!json) return { error: 'invalid JSON' };
  const list = json.venues ?? [];
  if (!list.length) return { error: 'no match' };

  // Prefer venues whose strLocation contains "London" — guards against
  // matches on, e.g., a stadium of the same name elsewhere in the world.
  const london = list.find((v) =>
    (v.strLocation ?? '').toLowerCase().includes('london'),
  );
  const chosen = london ?? list[0];
  return {
    id: chosen.idVenue,
    matchedName: chosen.strVenue,
    location: chosen.strLocation,
    candidatesIfMany: list.length > 1 ? list.length : undefined,
  };
}

(async () => {
  console.log(`\n# Resolving ${VENUES.length} London venue IDs from TheSportsDB`);
  console.log(`# Using key: ${KEY === '123' ? 'free tier (123)' : '***premium***'}\n`);

  const results = [];
  for (const [key, search] of VENUES) {
    const r = await searchVenue(search);
    if (r.error) {
      console.log(`# ${key.padEnd(22)} → ❌ ${r.error}  (searched: "${search}")`);
    } else {
      const extra = r.candidatesIfMany ? ` (1 of ${r.candidatesIfMany} matches)` : '';
      console.log(
        `${key.padEnd(22)} sportsdbVenueId: ${r.id},   // ${r.matchedName} — ${r.location}${extra}`,
      );
    }
    results.push({ key, ...r });
    // Stay under the free-tier rate limit (30/min).
    await sleep(KEY === '123' ? 2500 : 700);
  }

  const found = results.filter((r) => r.id).length;
  console.log(
    `\n# Done — ${found}/${VENUES.length} resolved. Paste the ids above into ` +
      `src/data/londonVenues.ts on the matching VENUES.<key> entries.\n`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
