/**
 * Cross-provider event de-duplication.
 *
 * Eight providers are merged into one map. Until now the merge only removed
 * exact `id` collisions, and every provider prefixes its own ids
 * (`espn-…`, `fd-…`, `tsdb-…`, `fotmob-…`), so one real fixture could show up
 * four or five times at the same venue. That is the "multiple same football
 * games in one location" the client reported.
 *
 * This module collapses records that describe the same real-world event:
 *
 *   • Sports fixtures are keyed on the *team pair* + London day, not the venue
 *     string or the exact clock time. Providers disagree on both (one may
 *     synthesise a 15:00 kick-off, another may name the ground differently),
 *     and a fixture between two teams on one day is one fixture.
 *   • Everything else is keyed on title + venue + London day, then split into
 *     clusters so a matinee and an evening performance of the same show stay
 *     as two events.
 *
 * The surviving record is the one from the most trustworthy provider for its
 * category, and anything it is missing is filled in from the duplicates.
 */

import type { AppEvent } from '@/types/event';
import { londonYmd } from '@/utils/ukTime';
import { findLondonPlace } from '@/data/londonVenues';

/**
 * Same title + venue + day, but starts this far apart, means separate
 * performances (theatre matinee vs evening) rather than a duplicate feed.
 */
const PERFORMANCE_GAP_MS = 150 * 60 * 1000;

/**
 * Provider trust for kick-off times and naming, best first. `featured` is
 * hand-curated so it wins outright; after that it depends on the category —
 * football-data is the official fixture list, Ticketmaster owns ticketed music.
 */
const SPORTS_PRIORITY: AppEvent['source'][] = [
  'featured',
  'football-data',
  'espn',
  'fotmob',
  'thesportsdb',
  'venue-site',
  'ticketmaster',
  'sample',
];

const OTHER_PRIORITY: AppEvent['source'][] = [
  'featured',
  'venue-site',
  'ticketmaster',
  'espn',
  'football-data',
  'fotmob',
  'thesportsdb',
  'sample',
];

function priorityOf(event: AppEvent): number {
  const table = event.category === 'sports' ? SPORTS_PRIORITY : OTHER_PRIORITY;
  const i = table.indexOf(event.source);
  return i === -1 ? table.length : i;
}

/** Lowercase, drop punctuation and club-name noise, collapse whitespace. */
function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(fc|afc|cf|ccc|rfc|utd)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Provider titles disagree: "West Ham United" vs "West Ham", "Spurs" vs
 * "Tottenham Hotspur". Same club must produce the same identity key or the
 * match appears twice on the map.
 */
const CLUB_CANON: Record<string, string> = {
  'west ham united': 'west ham',
  'tottenham hotspur': 'tottenham',
  spurs: 'tottenham',
  'manchester united': 'man united',
  'man utd': 'man united',
  'manchester city': 'man city',
  'queens park rangers': 'qpr',
  'nottingham forest': 'nottm forest',
  'brighton and hove albion': 'brighton',
  'brighton hove albion': 'brighton',
  'wolverhampton wanderers': 'wolves',
  'newcastle united': 'newcastle',
  'leicester city': 'leicester',
  'leeds united': 'leeds',
  'afc bournemouth': 'bournemouth',
  'sheffield united': 'sheffield united',
  'sheffield wednesday': 'sheffield wednesday',
  'crystal palace': 'crystal palace',
  'leyton orient': 'leyton orient',
  'milton keynes dons': 'mk dons',
  'mk dons': 'mk dons',
  'luton town': 'luton',
  'charlton athletic': 'charlton',
};

function canonicalizeClub(raw: string): string {
  const stripped = normaliseName(raw)
    .replace(/\b(women|womens|ladies|men|mens)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CLUB_CANON[stripped] ?? stripped;
}

function venueKey(venue: string): string {
  return normaliseName(venue).replace(/\b(stadium|ground|arena|park|the)\b/g, '').trim();
}

/**
 * Men's and women's fixtures between the same clubs are often played at the
 * same ground on the same day (and The Hundred runs double-headers), so the
 * competition's gender has to stay part of the identity.
 */
function squadTag(event: AppEvent): string {
  const haystack = `${event.title} ${event.subCategory ?? ''}`.toLowerCase();
  if (/\bwomen|\bwsl\b|ladies|\(w\)/.test(haystack)) return 'w';
  return 'm';
}

const SEPARATORS = /\s(?:v|vs|versus|@|-|–)\.?\s/;

/** `"Arsenal vs Chelsea"` → `["arsenal", "chelsea"]` (sorted), else null. */
export function teamPair(title: string): [string, string] | null {
  const cleaned = title.replace(/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/g, ' vs ');
  const parts = cleaned.split(SEPARATORS);
  if (parts.length !== 2) return null;
  const a = canonicalizeClub(parts[0]);
  const b = canonicalizeClub(parts[1]);
  if (!a || !b) return null;
  // Very short fragments are usually a hyphenated title, not two teams.
  if (a.length < 3 || b.length < 3) return null;
  return a < b ? [a, b] : [b, a];
}

/**
 * Fixture keys (a recognised team pair) identify one match on one day, so they
 * are collapsed whatever the venue string or clock time says. Every other key
 * is additionally split by start time, because one title at one venue on one
 * day can legitimately be two performances.
 */
const FIXTURE_PREFIX = 'fixture|';

/** Identity used to group records that describe the same real event. */
export function identityKey(event: AppEvent): string {
  const day = londonYmd(new Date(event.startsAt));
  if (event.category === 'sports') {
    const teams = teamPair(event.title);
    if (teams) {
      return `${FIXTURE_PREFIX}${teams[0]}|${teams[1]}|${day}|${squadTag(event)}`;
    }
    return `sport|${normaliseName(event.title)}|${venueKey(event.venue)}|${day}`;
  }
  return `other|${normaliseName(event.title)}|${venueKey(event.venue)}|${day}`;
}

const startMs = (e: AppEvent): number => {
  const t = Date.parse(e.realStartAt ?? e.startsAt);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Kick-off times we synthesise when a provider gives a date but no clock
 * (SportsDB → 12:00, FotMob date-only → 15:00). If a rival record has a real
 * time for the same fixture, that one is more trustworthy.
 */
const PLACEHOLDER_HOURS = new Set([12, 15]);

function londonHourMinute(iso: string): { hour: number; minute: number } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(t));
  const [h, m] = parts.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return { hour: h, minute: m };
}

function looksLikePlaceholderStart(event: AppEvent): boolean {
  if (event.category !== 'sports') return false;
  const hm = londonHourMinute(event.startsAt);
  if (!hm) return false;
  return hm.minute === 0 && PLACEHOLDER_HOURS.has(hm.hour);
}

/** Split a same-key group into separate performances by start-time gaps. */
function splitByPerformance(group: AppEvent[]): AppEvent[][] {
  if (group.length < 2) return [group];
  const sorted = [...group].sort((a, b) => startMs(a) - startMs(b));
  const clusters: AppEvent[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = clusters[clusters.length - 1];
    const gap = startMs(sorted[i]) - startMs(prev[prev.length - 1]);
    if (gap > PERFORMANCE_GAP_MS) clusters.push([sorted[i]]);
    else prev.push(sorted[i]);
  }
  return clusters;
}

/** Prefer the provider we trust most; break ties on how complete the record is. */
function completeness(e: AppEvent): number {
  let score = 0;
  if (e.realStartAt) score += 2;
  if (e.estimatedFinishAt || e.endsAt) score += 1;
  if (e.description) score += 1;
  if (e.copyLine) score += 1;
  if (e.turnoutMin != null) score += 1;
  if (e.url) score += 1;
  return score;
}

function pickWinner(group: AppEvent[]): AppEvent {
  return [...group].sort((a, b) => {
    const p = priorityOf(a) - priorityOf(b);
    if (p !== 0) return p;
    const c = completeness(b) - completeness(a);
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  })[0];
}

/** Fill gaps in the winner from the records we are about to drop. */
function mergeGroup(group: AppEvent[]): AppEvent {
  const winner = pickWinner(group);
  if (group.length === 1) return winner;

  const others = group.filter((e) => e.id !== winner.id);
  const merged: AppEvent = { ...winner };

  // A synthesised kick-off loses to any provider that reported a real one.
  if (looksLikePlaceholderStart(merged)) {
    const better = others.find(
      (o) => !looksLikePlaceholderStart(o) && Number.isFinite(Date.parse(o.startsAt)),
    );
    if (better) {
      merged.startsAt = better.startsAt;
      merged.endsAt = better.endsAt;
      merged.realStartAt = better.realStartAt ?? merged.realStartAt;
      merged.doorsAt = better.doorsAt ?? merged.doorsAt;
      merged.estimatedFinishAt =
        better.estimatedFinishAt ?? merged.estimatedFinishAt;
    }
  }

  for (const other of others) {
    merged.description = merged.description ?? other.description;
    merged.copyLine = merged.copyLine ?? other.copyLine;
    merged.url = merged.url ?? other.url;
    merged.doorsAt = merged.doorsAt ?? other.doorsAt;
    merged.realStartAt = merged.realStartAt ?? other.realStartAt;
    merged.estimatedFinishAt = merged.estimatedFinishAt ?? other.estimatedFinishAt;
    merged.subCategory = merged.subCategory ?? other.subCategory;
    if (merged.turnoutMin == null) merged.turnoutMin = other.turnoutMin;
    if (merged.turnoutMax == null) merged.turnoutMax = other.turnoutMax;
  }

  const place = findLondonPlace(merged.venue);
  if (place) {
    merged.venue = place.venue;
    merged.latitude = place.latitude;
    merged.longitude = place.longitude;
  }

  return merged;
}

export interface DedupeResult {
  events: AppEvent[];
  /** How many records were collapsed into another. */
  removed: number;
  /** Sample of collapsed groups, for the launch-time console tripwire. */
  samples: { kept: string; dropped: string[] }[];
}

/**
 * Collapse duplicate records across providers. Input order does not matter;
 * output keeps the original start-time ordering applied by the caller.
 */
export function dedupeEvents(events: AppEvent[]): DedupeResult {
  const byId = new Map<string, AppEvent>();
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);

  const groups = new Map<string, AppEvent[]>();
  for (const e of byId.values()) {
    const key = identityKey(e);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  const out: AppEvent[] = [];
  const samples: DedupeResult['samples'] = [];
  let removed = 0;

  for (const [key, group] of groups) {
    const clusters = key.startsWith(FIXTURE_PREFIX)
      ? [group]
      : splitByPerformance(group);
    for (const cluster of clusters) {
      const merged = mergeGroup(cluster);
      out.push(merged);
      if (cluster.length > 1) {
        removed += cluster.length - 1;
        if (samples.length < 8) {
          samples.push({
            kept: `${merged.title} @ ${merged.venue} (${merged.source})`,
            dropped: cluster
              .filter((e) => e.id !== merged.id)
              .map((e) => `${e.title} @ ${e.venue} (${e.source})`),
          });
        }
      }
    }
  }

  return { events: out, removed, samples };
}
