/** Verify out-of-London TM pins (e.g. Bristol) are dropped. */
import { rangeFor } from '../src/utils/dateFilters.ts';
import { isInDriveIQArea } from '../src/data/londonVenues.ts';

const range = rangeFor('today', new Date('2026-08-01T12:00:00+01:00'));
const { fetchTicketmasterLondon } = await import('../src/services/ticketmaster.ts');
const events = await fetchTicketmasterLondon(range);
const outliers = events.filter((e) => !isInDriveIQArea(e.latitude, e.longitude));
const bristol = events.filter(
  (e) => /bristol/i.test(e.venue + e.title) || e.longitude < -1.5,
);
console.log(`tm today=${events.length} outliers=${outliers.length} bristol=${bristol.length}`);
for (const e of bristol) {
  console.log('BRISTOL STILL PRESENT', e.title, e.venue, e.latitude, e.longitude);
}
console.log(
  'kept sample:',
  events
    .filter((e) => /wembley|o2 arena|albert/i.test(e.venue))
    .slice(0, 5)
    .map((e) => e.venue),
);
