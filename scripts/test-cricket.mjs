/** Verify London cricket fetch — run: node scripts/test-cricket.mjs */
import { rangeFor } from '../src/utils/dateFilters.ts';

const now = new Date('2026-07-30T12:00:00+03:00');
const range = rangeFor('all', now);

const { fetchCricinfoLondon } = await import('../src/services/cricinfo.ts');
const events = await fetchCricinfoLondon(range);
console.log(`London cricket fixtures (${events.length} total):`);
for (const e of events) {
  console.log(`  ${e.startsAt.slice(0, 10)} ${e.title} @ ${e.venue}`);
}

const lordsOval = events.filter((e) =>
  /lord|oval/i.test(e.venue),
);
console.log(`\nLord's / Oval: ${lordsOval.length} fixtures`);
