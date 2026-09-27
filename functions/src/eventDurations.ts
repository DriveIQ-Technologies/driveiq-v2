/**
 * Realistic finish times for events whose source gives no end time.
 *
 * Most sources publish a start and nothing else. We used to fill the gap with
 * one blunt number per source — kick-off + 2h30 for every football match,
 * start + 3h for every Ticketmaster listing — and the "crowds leaving" alert,
 * which fires 25 minutes before the end, was built on it. A Premier League
 * crowd leaves about 1h55 after kick-off, so that alert landed after the final
 * whistle; a comedy show was an hour out; a County Championship day was
 * treated as a 2h30 event when play runs for seven hours.
 *
 * Every figure here is the time from the published start (kick-off, curtain)
 * to when the audience actually starts coming out.
 */

import { londonYmd, ukOffset } from './londonTime.js';

export type EventKind = 'sports' | 'music' | 'theatre' | 'film' | 'other';

export interface DurationHints {
  kind: EventKind;
  subCategory?: string;
  title?: string;
  /** League or series name, e.g. "The Hundred", "County Championship". */
  description?: string;
}

const MIN = 60 * 1000;

/** First match wins, so the specific rules sit above the general ones. */
const SPORT_RULES: Array<[RegExp, number]> = [
  // Rugby before cricket: rugby lists "International Test Match".
  [/rugby/, 105], // 80 min + half-time + stoppages
  [/hundred/, 150],
  [/t20|twenty20|blast/, 200],
  [/cricket/, 420], // a full day's play (County Championship, one-day)
  [/american football|\bnfl\b/, 195],
  [/basketball|\bnba\b|\bwnba\b/, 135],
  [/ice hockey|\bnhl\b/, 150],
  [/boxing|\bmma\b|\bufc\b|fight night/, 240], // a full card, main event last
  [/darts/, 240],
  [/wrestling|\bwwe\b|\baew\b/, 180],
  [/tennis/, 180],
  [/football|soccer/, 115], // 90 + 15 half-time + ~10 stoppage
];
const SPORT_DEFAULT = 150;

const ARTS_RULES: Array<[RegExp, number]> = [
  [/opera/, 195],
  [/children|kids|family show/, 90],
  [/classical|orchestra|symphony|philharmonic|\bproms?\b|concerto|chamber|choral|requiem|oratorio/, 120],
  [/ballet|contemporary dance/, 135],
  [/comedy|stand-?up|comedian/, 120],
  [/musical|theatre|theater|\bplay\b|drama|panto/, 160], // West End incl. interval
  [/magic|illusion|circus|variety|spectacular|cabaret/, 120],
  [/film|cinema|screening|premiere/, 135],
];
const OTHER_DEFAULT = 150;

/** Club nights run into the small hours; a gig is done by the curfew. */
const CLUB_NIGHT = /dance\/electronic|electronic|techno|\bhouse\b|club night|\bdj\b|rave/;
const CLUB_NIGHT_MIN = 300;
/** London venues broadly curfew at 23:00; the crowd is out around 22:45. */
const GIG_CURFEW_HHMM = '22:45';
const GIG_MIN = 150;

function hay(h: DurationHints): string {
  return `${h.subCategory ?? ''} | ${h.description ?? ''} | ${h.title ?? ''}`.toLowerCase();
}

function londonHour(iso: string): number {
  const h = new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
  return Number.parseInt(h, 10);
}

function atLondonTime(iso: string, hhmm: string): number {
  const ymd = londonYmd(new Date(iso));
  return Date.parse(`${ymd}T${hhmm}:00${ukOffset(ymd)}`);
}

/** Minutes from start to finish, ignoring time of day. */
export function typicalDurationMin(h: DurationHints): number {
  const text = hay(h);
  if (h.kind === 'sports') {
    for (const [re, min] of SPORT_RULES) if (re.test(text)) return min;
    return SPORT_DEFAULT;
  }
  for (const [re, min] of ARTS_RULES) if (re.test(text)) return min;
  if (h.kind === 'music') return GIG_MIN;
  return OTHER_DEFAULT;
}

/** When the audience comes out, as an ISO string. */
export function typicalFinishAt(startIso: string, h: DurationHints): string {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return startIso;
  const text = hay(h);

  if (h.kind === 'music' && !ARTS_RULES.some(([re]) => re.test(text))) {
    const hour = londonHour(startIso);
    // A late club night empties at 3am, not 11pm.
    if (CLUB_NIGHT.test(text) && (hour >= 21 || hour < 5)) {
      return new Date(start + CLUB_NIGHT_MIN * MIN).toISOString();
    }
    // An evening gig ends at the curfew however early the listing starts —
    // the listed time is often doors, with the headliner on hours later.
    if (hour >= 16 && hour < 21) {
      const curfew = atLondonTime(startIso, GIG_CURFEW_HHMM);
      return new Date(Math.max(start + GIG_MIN * MIN, curfew)).toISOString();
    }
  }

  return new Date(start + typicalDurationMin(h) * MIN).toISOString();
}
