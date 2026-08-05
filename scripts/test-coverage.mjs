/**
 * Coverage smoke test — venue-first redundancy for Den / Vicarage / Lord's / Oval.
 *
 *   npx tsx scripts/test-coverage.mjs
 *
 * Asserts FotMob ICS home calendars surface Millwall Antwerp + Watford home
 * games, and that cricket calendar still returns Lord's/Oval fixtures.
 */
import { rangeFor } from '../src/utils/dateFilters.ts';
import { fetchVenueSiteEvents } from '../src/services/venueSites.ts';
import { fetchCricinfoLondon } from '../src/services/cricinfo.ts';
import { findLondonPlace } from '../src/data/londonVenues.ts';

const now = new Date('2026-07-30T12:00:00+01:00');
const range = rangeFor('all', now);

console.log('Venue resolve checks:');
for (const name of ['The Den', 'Vicarage Road', 'Watford', "Lord's", 'Kennington Oval']) {
  const p = findLondonPlace(name);
  console.log(`  ${name} → ${p?.venue ?? 'MISS'} (sportsdb=${p?.sportsdbVenueId ?? 'null'})`);
}

console.log('\nFetching venue-site ICS / feeds…');
const sites = await fetchVenueSiteEvents(range);
const den = sites.filter((e) => e.venue === 'The Den');
const vicarage = sites.filter((e) => e.venue === 'Vicarage Road');
console.log(`The Den ICS events: ${den.length}`);
den.slice(0, 6).forEach((e) =>
  console.log(`  ${e.startsAt.slice(0, 10)} ${e.title}`),
);
console.log(`Vicarage Road ICS events: ${vicarage.length}`);
vicarage.slice(0, 6).forEach((e) =>
  console.log(`  ${e.startsAt.slice(0, 10)} ${e.title}`),
);

const antwerp = den.find(
  (e) =>
    e.startsAt.startsWith('2026-08-01') &&
    /antwerp/i.test(e.title),
);
console.log(
  antwerp
    ? `\nOK Millwall vs Antwerp present: ${antwerp.title} @ ${antwerp.venue}`
    : '\nFAIL Millwall vs Antwerp missing from The Den ICS',
);

console.log('\nFetching cricket calendar…');
const cricket = await fetchCricinfoLondon(range);
const lordsOval = cricket.filter((e) => /lord|oval/i.test(e.venue));
console.log(`Lord's / Oval cricket: ${lordsOval.length}`);
lordsOval.slice(0, 8).forEach((e) =>
  console.log(`  ${e.startsAt.slice(0, 10)} ${e.title} @ ${e.venue}`),
);

const ok =
  !!antwerp &&
  den.length > 0 &&
  vicarage.length > 0 &&
  lordsOval.length > 0;
console.log(ok ? '\nCOVERAGE SMOKE: PASS' : '\nCOVERAGE SMOKE: FAIL');
process.exit(ok ? 0 : 1);
