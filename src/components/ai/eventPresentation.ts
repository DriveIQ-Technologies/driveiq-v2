import { turnoutRange, venueProfileFor } from '@/data/venueProfiles';
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

export function formatTimeRange(e: AppEvent): string {
  const start = e.realStartAt || e.startsAt;
  const end = e.estimatedFinishAt || e.endsAt;
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
    label: noon.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' }).toUpperCase(),
    sublabel,
  };
}

/** Group events by London calendar day, biggest first within each day. */
export function groupEventsByDay(events: AppEvent[], limit = 12): EventDaySection[] {
  const active = events.filter((e) => eventLifeStatus(e) !== 'finished');
  const pool = active.length ? active : events;
  const byDay = new Map<string, AppEvent[]>();

  for (const e of pool) {
    const ymd = londonYmd(new Date(e.realStartAt || e.startsAt));
    const list = byDay.get(ymd) ?? [];
    list.push(e);
    byDay.set(ymd, list);
  }

  const sections: EventDaySection[] = [];
  for (const [ymd, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort(
      (a, b) => demandScore(b) - demandScore(a) || eventStartMs(a) - eventStartMs(b),
    );
    const slice = sorted.slice(0, limit);
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
    total === 1
      ? 'I found 1 event on the map.'
      : `I found ${total} events across London.`;
  const hint = names.length ? ` Highlights include ${names.slice(0, 3).join(', ')}.` : '';
  return `${head}${hint}`;
}
