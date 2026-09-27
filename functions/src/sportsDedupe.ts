/**
 * Collapse duplicate sports listings into one event per fixture.
 *
 * Ticketmaster sport is now kept (it used to be dropped wholesale), so a match
 * can arrive twice: once from a league feed (FotMob / ESPN) and once from
 * Ticketmaster — and Ticketmaster itself lists big games twice, the match and
 * a "Premium" hospitality package. Two sports listings are the same fixture
 * when they are at the same ground and start within a few minutes of each
 * other; two different fixtures at one stadium are never that close together.
 */

import type { PublishedEvent } from './eventNormalise.js';

/** Same ground: stadium coordinates from different sources differ slightly. */
const SAME_PLACE_M = 600;
/**
 * Same kick-off. Tight on purpose: a double-header (women's game at 12:00,
 * men's at 15:00) is two real fixtures and must stay two.
 */
const SAME_START_MS = 90 * 60 * 1000;

const HOSPITALITY = /premium|hospitality|package|\bvip\b|lounge|suite|dining/i;

function metres(a: PublishedEvent, b: PublishedEvent): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function sameFixture(a: PublishedEvent, b: PublishedEvent): boolean {
  const dt = Math.abs(Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return Number.isFinite(dt) && dt <= SAME_START_MS && metres(a, b) <= SAME_PLACE_M;
}

/**
 * Which of two listings for one fixture to keep. A hand-added event wins;
 * then league feeds (accurate kick-off, clean team names); then a plain match
 * listing beats a hospitality package; then the shorter, plainer title.
 */
function better(a: PublishedEvent, b: PublishedEvent): PublishedEvent {
  // Added by hand from the admin page: someone checked it, so it wins.
  const manual = (e: PublishedEvent) => e.source === 'manual';
  if (manual(a) !== manual(b)) return manual(a) ? a : b;
  const feed = (e: PublishedEvent) => e.source !== 'ticketmaster';
  if (feed(a) !== feed(b)) return feed(a) ? a : b;
  const hosp = (e: PublishedEvent) => HOSPITALITY.test(e.title);
  if (hosp(a) !== hosp(b)) return hosp(a) ? b : a;
  return a.title.length <= b.title.length ? a : b;
}

export function dedupeSportsEvents(events: PublishedEvent[]): PublishedEvent[] {
  const others = events.filter((e) => e.category !== 'sports');
  const kept: PublishedEvent[] = [];

  for (const e of events.filter((x) => x.category === 'sports')) {
    const i = kept.findIndex((k) => sameFixture(k, e));
    if (i === -1) {
      kept.push(e);
      continue;
    }
    const winner = better(kept[i], e);
    const loser = winner === kept[i] ? e : kept[i];
    // Keep the ticket link even when the league feed's listing wins.
    kept[i] = winner.url || !loser.url ? winner : { ...winner, url: loser.url };
  }
  return [...others, ...kept];
}
