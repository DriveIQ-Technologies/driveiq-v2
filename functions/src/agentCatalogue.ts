/**
 * Verified event lookup for the chat agent.
 *
 * The model must never invent a fixture from training memory. When a driver
 * names a club or venue that is missing from the open-map slice, we search
 * the published DriveIQ catalogue (Ticketmaster + sports ingest) and return
 * those rows so the app can pin them.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { londonStampOr } from './londonTime.js';
import { logger } from 'firebase-functions';

const STOP = new Set([
  'what',
  'whats',
  'tonight',
  'today',
  'tomorrow',
  'weekend',
  'week',
  'events',
  'event',
  'this',
  'that',
  'with',
  'from',
  'near',
  'around',
  'london',
  'please',
  'show',
  'shows',
  'match',
  'matches',
  'game',
  'games',
  'fixture',
  'there',
  'going',
  'anything',
  'biggest',
  'major',
  'kick',
  'time',
  'when',
  'where',
  'does',
  'start',
]);

export interface CatalogueEvent {
  id: string;
  source: string;
  category: 'sports' | 'other';
  title: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  latitude: number;
  longitude: number;
  subCategory?: string;
  doorsAt?: string;
  realStartAt?: string;
  estimatedFinishAt?: string;
  turnoutMin?: number;
  turnoutMax?: number;
  copyLine?: string;
}

function tokensFromQuestion(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

function hay(title: string, venue: string): string {
  return `${title} ${venue}`.toLowerCase();
}

function asCatalogueEvent(raw: Record<string, unknown>): CatalogueEvent | null {
  const id = typeof raw.id === 'string' ? raw.id : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const startsAt = typeof raw.startsAt === 'string' ? raw.startsAt : '';
  const venue = typeof raw.venue === 'string' ? raw.venue : 'London';
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (!id || !title || !startsAt || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const endsAt =
    typeof raw.endsAt === 'string'
      ? raw.endsAt
      : typeof raw.estimatedFinishAt === 'string'
        ? raw.estimatedFinishAt
        : startsAt;
  return {
    id,
    source: typeof raw.source === 'string' ? raw.source : 'ticketmaster',
    category: raw.category === 'sports' ? 'sports' : 'other',
    title,
    startsAt,
    endsAt,
    venue,
    latitude,
    longitude,
    subCategory: typeof raw.subCategory === 'string' ? raw.subCategory : undefined,
    doorsAt: typeof raw.doorsAt === 'string' ? raw.doorsAt : undefined,
    realStartAt: typeof raw.realStartAt === 'string' ? raw.realStartAt : undefined,
    estimatedFinishAt:
      typeof raw.estimatedFinishAt === 'string' ? raw.estimatedFinishAt : undefined,
    turnoutMin: Number.isFinite(Number(raw.turnoutMin)) ? Number(raw.turnoutMin) : undefined,
    turnoutMax: Number.isFinite(Number(raw.turnoutMax)) ? Number(raw.turnoutMax) : undefined,
    copyLine: typeof raw.copyLine === 'string' ? raw.copyLine : undefined,
  };
}

function formatLine(e: CatalogueEvent): string {
  // These rows are presented to the model as verified DriveIQ feeds, so their
  // times have to be right: London-local, never raw UTC. See londonTime.ts.
  const start = londonStampOr(e.realStartAt || e.startsAt);
  const finish = londonStampOr(e.estimatedFinishAt || e.endsAt, '');
  const turnout =
    e.turnoutMin != null && e.turnoutMax != null ? `turnout ${e.turnoutMin}-${e.turnoutMax}` : '';
  return [
    e.title,
    e.venue,
    e.subCategory,
    `start ${start} London`,
    finish ? `finish ${finish} London` : '',
    turnout,
  ]
    .filter(Boolean)
    .join(' | ');
}

function onLiveMap(e: CatalogueEvent, liveHay: string[]): boolean {
  const key = hay(e.title, e.venue);
  const titleBit = e.title.toLowerCase().slice(0, 18);
  return liveHay.some((row) => row.includes(titleBit) || (key.length >= 12 && row.includes(e.venue.toLowerCase().slice(0, 14))));
}

export async function lookupCatalogueMatches(opts: {
  db: Firestore;
  question: string;
  liveEventLines: string[];
}): Promise<{
  tokens: string[];
  lines: string[];
  events: CatalogueEvent[];
  validation: string[];
}> {
  const tokens = tokensFromQuestion(opts.question);
  if (tokens.length === 0) {
    return {
      tokens,
      lines: [],
      events: [],
      validation: ['No named club or venue in the question. Use LIVE MAP EVENTS.'],
    };
  }

  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  try {
    const snap = await opts.db
      .collection('eventsPublished')
      .where('startsAt', '>=', cutoff)
      .orderBy('startsAt', 'asc')
      .limit(500)
      .get();

    const liveHay = opts.liveEventLines.map((row) => row.toLowerCase());
    const matched: CatalogueEvent[] = [];
    for (const doc of snap.docs) {
      const e = asCatalogueEvent(doc.data() as Record<string, unknown>);
      if (!e) continue;
      const blob = hay(e.title, e.venue);
      if (!tokens.some((t) => blob.includes(t))) continue;
      matched.push(e);
      if (matched.length >= 12) break;
    }

    const discovered = matched.filter((e) => !onLiveMap(e, liveHay));
    const alreadyOnMap = matched.filter((e) => onLiveMap(e, liveHay));

    const validation: string[] = [
      `Named tokens: ${tokens.join(', ')}`,
      `Catalogue hits: ${matched.length}`,
      `Already on the open map: ${alreadyOnMap.length}`,
      `Missing from the open map (pin these): ${discovered.length}`,
    ];
    if (matched.length === 0) {
      validation.push(
        'Not in the DriveIQ catalogue either. Say you do not have that fixture. Never invent a time from memory.',
      );
    }

    return {
      tokens,
      lines: matched.map(formatLine),
      events: discovered,
      validation,
    };
  } catch (e) {
    logger.warn('agent.catalogue_query_fail', {
      message: e instanceof Error ? e.message : 'error',
    });
    return {
      tokens,
      lines: [],
      events: [],
      validation: ['Catalogue lookup failed. Answer only from LIVE MAP EVENTS. Do not invent fixtures.'],
    };
  }
}
