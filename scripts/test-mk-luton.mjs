/** Verify Luton + Milton Keynes coverage — run: npx tsx scripts/test-mk-luton.mjs */
import { isInDriveIQArea } from '../src/data/londonVenues.ts';
import { rangeFor } from '../src/utils/dateFilters.ts';

const now = new Date('2026-08-01T12:00:00+01:00');
const all = rangeFor('all', now);
const tomorrow = rangeFor('tomorrow', now);

const { fetchFotmobLondon } = await import('../src/services/fotmobCalendars.ts');
const { fetchTicketmasterLondon } = await import('../src/services/ticketmaster.ts');

const [fotmob, tm] = await Promise.all([
  fetchFotmobLondon(all),
  fetchTicketmasterLondon(all),
]);

const luton = fotmob.filter((e) => /kenilworth/i.test(e.venue));
const mkFoot = fotmob.filter((e) => /stadium mk/i.test(e.venue));
const bowl = tm.filter((e) => /national bowl|campbell park/i.test(e.venue));

console.log(`FotMob Luton (Kenilworth): ${luton.length}`);
luton.slice(0, 6).forEach((e) =>
  console.log(`  ${e.startsAt.slice(0, 10)} ${e.title} @ ${e.venue} inArea=${isInDriveIQArea(e.latitude, e.longitude)}`),
);

console.log(`FotMob Stadium MK: ${mkFoot.length}`);
mkFoot.slice(0, 6).forEach((e) =>
  console.log(`  ${e.startsAt.slice(0, 10)} ${e.title}`),
);

console.log(`TM National Bowl / Campbell Park: ${bowl.length}`);
bowl.forEach((e) =>
  console.log(`  ${e.startsAt.slice(0, 10)} ${e.title} @ ${e.venue}`),
);

const fotTomorrow = await fetchFotmobLondon(tomorrow);
const lutonTmr = fotTomorrow.filter((e) => /kenilworth/i.test(e.venue));
console.log(`\nTomorrow Luton home: ${lutonTmr.length}`);
lutonTmr.forEach((e) => console.log(`  ${e.title}`));
