/**
 * Smoke-test FotMob free football backbone (no SportsDB key).
 *
 *   npx tsx scripts/test-fotmob.mjs
 */
import { rangeFor } from '../src/utils/dateFilters.ts';
import { fetchFotmobLondon } from '../src/services/fotmobCalendars.ts';

const range = rangeFor('all', new Date('2026-07-30T12:00:00+01:00'));
const events = await fetchFotmobLondon(range);

const den = events.filter((e) => e.venue === 'The Den');
const vicarage = events.filter((e) => e.venue === 'Vicarage Road');
const antwerp = den.find(
  (e) => e.startsAt.startsWith('2026-08-01') && /antwerp/i.test(e.title),
);

console.log(`Total FotMob home fixtures: ${events.length}`);
console.log(`The Den: ${den.length}, Vicarage Road: ${vicarage.length}`);
console.log(
  antwerp
    ? `OK Antwerp friendly: ${antwerp.title}`
    : 'FAIL missing Millwall vs Antwerp',
);

const byVenue = new Map();
for (const e of events) byVenue.set(e.venue, (byVenue.get(e.venue) ?? 0) + 1);
console.log('Per venue:', [...byVenue.entries()].sort((a, b) => b[1] - a[1]));

process.exit(antwerp && events.length > 50 ? 0 : 1);
