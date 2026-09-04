import { turnoutRange, venueProfileFor, VENUE_PROFILES } from '@/data/venueProfiles';
import type { AppEvent } from '@/types/event';
import { formatEventDate, formatEventEndTime } from '@/utils/dateFilters';
import { categoryFilterFor, CATEGORY_FILTERS } from '@/utils/eventIcons';
import { londonYmd } from '@/utils/ukTime';

export type EventLifeStatus = 'live' | 'upcoming' | 'finished';

export function eventStartMs(e: AppEvent): number {
  const t = Date.parse(e.realStartAt || e.startsAt);
  return Number.isFinite(t) ? t : 0;
}

export function eventEndMs(e: AppEvent): number {
  const t = Date.parse(e.estimatedFinishAt || e.endsAt || e.realStartAt || e.startsAt);
  return Number.isFinite(t) ? t : eventStartMs(e);
}

export function eventLifeStatus(e: AppEvent, now = Date.now()): EventLifeStatus {
  const start = eventStartMs(e);
  const end = eventEndMs(e);
  if (end < now - 15 * 60 * 1000) return 'finished';
  if (start <= now) return 'live';
  return 'upcoming';
}

export function demandScore(e: AppEvent): number {
  const crowd = Math.max(
    e.turnoutMax ?? 0,
    e.turnoutMin ?? 0,
    venueProfileFor(e.venue)?.capacity ?? 0,
  );
  return (e.source === 'featured' ? 1_000_000 : 0) + crowd;
}

export function crowdLabel(e: AppEvent): string | undefined {
  if (e.turnoutMin && e.turnoutMax) {
    return `${formatCrowd(e.turnoutMin)}–${formatCrowd(e.turnoutMax)} expected`;
  }
  const cap = venueProfileFor(e.venue)?.capacity;
  if (!cap) return undefined;
  const range = turnoutRange(cap, { low: 0.75, high: 1 });
  return `${formatCrowd(range.min)}–${formatCrowd(range.max)} estimated`;
}

function formatCrowd(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function categoryMeta(e: AppEvent) {
  const key = categoryFilterFor(e);
  return CATEGORY_FILTERS.find((c) => c.key === key) ?? CATEGORY_FILTERS[6];
}

/** Curtain / kick-off. Never doors. */
export function eventDisplayStart(e: AppEvent): string {
  return e.realStartAt || e.startsAt;
}

export function eventDisplayEnd(e: AppEvent): string | undefined {
  return e.estimatedFinishAt || e.endsAt || undefined;
}

export function formatTimeRange(e: AppEvent): string {
  const start = eventDisplayStart(e);
  const end = eventDisplayEnd(e);
  if (end) return `${formatEventDate(start)} – ${formatEventEndTime(start, end)}`;
  return formatEventDate(start);
}

export function sourceLabel(e: AppEvent): string {
  if (e.source === 'featured') return 'DriveIQ curated';
  if (e.source === 'ticketmaster') return 'Ticketmaster';
  if (e.source === 'thesportsdb' || e.source === 'football-data' || e.source === 'espn') {
    return 'Sports feed';
  }
  return 'Live map';
}

export interface EventDaySection {
  key: string;
  label: string;
  sublabel: string;
  events: AppEvent[];
  featured?: AppEvent;
}

function dayHeading(ymd: string, now = new Date()): { label: string; sublabel: string } {
  const today = londonYmd(now);
  const tomorrowYmd = (() => {
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1, 12));
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  })();

  const noon = new Date(`${ymd}T12:00:00Z`);
  const sublabel = noon.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  });

  if (ymd === today) return { label: 'TODAY', sublabel };
  if (ymd === tomorrowYmd) return { label: 'TOMORROW', sublabel };
  return {
    label: noon
      .toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' })
      .toUpperCase(),
    sublabel,
  };
}

function normKeyPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Collapse the same show appearing twice (featured + feed, slight title drift). */
export function dedupeEvents(events: AppEvent[]): AppEvent[] {
  const best = new Map<string, AppEvent>();
  for (const e of events) {
    const ymd = londonYmd(new Date(e.realStartAt || e.startsAt));
    const title = normKeyPart(e.title).slice(0, 48);
    const venue = normKeyPart(e.venue).slice(0, 32);
    const key = `${ymd}|${venue}|${title}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, e);
      continue;
    }
    const prefer =
      (e.source === 'featured' && prev.source !== 'featured') ||
      demandScore(e) > demandScore(prev) ||
      Boolean(e.copyLine && !prev.copyLine);
    if (prefer) best.set(key, e);
  }
  return [...best.values()];
}

/**
 * Short place tokens from the question (wembley, o2, tottenham…).
 * Empty when the user is asking generally about what's on.
 */
export function placeHintsFromQuestion(question: string): string[] {
  const q = question.toLowerCase();
  const hints = new Set<string>();

  const aliases: Array<[string, string[]]> = [
    ['wembley', ['wembley']],
    ['tottenham', ['tottenham', 'spurs']],
    ['o2', ['the o2', 'o2 arena', ' o2 ', 'o2 one', 'o2 event']],
    ['albert hall', ['albert hall', 'proms']],
    ['ascot', ['ascot']],
    ['emirates', ['emirates', 'arsenal']],
    ['stamford', ['stamford bridge', 'chelsea']],
    ['craven cottage', ['craven cottage', 'fulham']],
    ['twickenham', ['twickenham']],
    ['excel', ['excel']],
    ['olympia', ['olympia']],
  ];

  for (const [canonical, needles] of aliases) {
    if (needles.some((n) => q.includes(n.trim()))) hints.add(canonical);
  }

  for (const profile of VENUE_PROFILES) {
    for (const name of profile.names) {
      if (name.length >= 5 && q.includes(name)) {
        hints.add(name.split(' ')[0]!);
      }
    }
  }

  return [...hints];
}

export function eventMatchesPlaceHints(e: AppEvent, hints: string[]): boolean {
  if (!hints.length) return true;
  const hay = `${e.title} ${e.venue}`.toLowerCase();
  return hints.some((h) => {
    if (h === 'o2') {
      return /\bo2\b/.test(hay) || hay.includes('o2 arena') || hay.includes('the o2');
    }
    return hay.includes(h);
  });
}

/** How many cards to show for this question — keep the chat short. */
export function cardLimitForQuestion(question: string): number {
  const q = question.toLowerCase();
  const numbered =
    q.match(/\b(?:top|biggest|best)?\s*(\d{1,2})\b/) ??
    q.match(/\b(\d{1,2})\s+(?:biggest|best|top|events?)\b/);
  if (numbered) {
    const n = Number(numbered[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 8) return n;
  }
  if (/\b(three|3)\b/.test(q) && /\b(big|biggest|best|events?)\b/.test(q)) return 3;
  if (placeHintsFromQuestion(q).length > 0) return 6;
  if (/\b(big|biggest|major|demand|busiest)\b/.test(q)) return 4;
  return 5;
}

/** Group events by London calendar day, biggest first within each day. */
export function groupEventsByDay(events: AppEvent[], limit = 5): EventDaySection[] {
  const unique = dedupeEvents(events);
  const active = unique.filter((e) => eventLifeStatus(e) !== 'finished');
  const pool = active.length ? active : unique;
  const byDay = new Map<string, AppEvent[]>();

  for (const e of pool) {
    const ymd = londonYmd(new Date(e.realStartAt || e.startsAt));
    const list = byDay.get(ymd) ?? [];
    list.push(e);
    byDay.set(ymd, list);
  }

  const sections: EventDaySection[] = [];
  let remaining = limit;
  for (const [ymd, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (remaining <= 0) break;
    const sorted = [...list].sort(
      (a, b) => demandScore(b) - demandScore(a) || eventStartMs(a) - eventStartMs(b),
    );
    const slice = sorted.slice(0, remaining);
    remaining -= slice.length;
    const featured =
      slice.find((e) => e.source === 'featured') ??
      (demandScore(slice[0] ?? sorted[0]) >= 15000 ? slice[0] : undefined);
    const { label, sublabel } = dayHeading(ymd);
    sections.push({
      key: ymd,
      label,
      sublabel,
      events: slice,
      featured,
    });
  }
  return sections;
}

export function buildEventSummary(sections: EventDaySection[]): string {
  const total = sections.reduce((n, s) => n + s.events.length, 0);
  if (total === 0) return 'Nothing matched that search on the live map right now.';
  const names = sections.flatMap((s) => s.events.slice(0, 2).map((e) => e.title));
  const head =
    total === 1 ? 'I found 1 matching event.' : `I found ${total} matching events.`;
  const hint = names.length ? ` Highlights: ${names.slice(0, 3).join(', ')}.` : '';
  return `${head}${hint}`;
}
