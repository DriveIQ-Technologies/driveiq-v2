/**
 * Date-range helpers that power the Today / Tomorrow / Next 3 Days / This Week filter bar.
 *
 * Each filter returns an inclusive [start, end] window in local time so the API services
 * can request only the relevant slice of data.
 */

/**
 * Filter chips come in two flavours:
 *   - the fixed presets ('all' | 'today' | 'tomorrow' | 'next3')
 *   - a specific future day, encoded as `day:N` where N is the number of days
 *     from today (e.g. `day:2` = the day after tomorrow). These power the
 *     scrollable future-day strip so users can browse ahead and save/calendar
 *     events further out.
 */
export type PresetKey = 'today' | 'tomorrow' | 'next3' | 'all';
export type DayKey = `day:${number}`;
export type FilterKey = PresetKey | DayKey;

export interface DateRange {
  start: Date;
  end: Date;
}

/** A single filter chip: its key plus the human label to render. */
export interface FilterChip {
  key: FilterKey;
  label: string;
}

export const FILTER_LABELS: Record<PresetKey, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  next3: 'Next 3 Days',
  all: 'All',
};

/** How many individual future-day chips to show beyond the presets. */
export const FUTURE_DAY_CHIPS = 14;

const isDayKey = (k: FilterKey): k is DayKey => k.startsWith('day:');

/** Parse the day offset out of a `day:N` key. Returns 0 for malformed keys. */
const dayOffset = (k: DayKey): number => {
  const n = parseInt(k.slice(4), 10);
  return Number.isFinite(n) ? n : 0;
};

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const addDays = (d: Date, days: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

/**
 * Build the date range for a given filter, anchored at `now` (defaults to current time).
 *
 * - `today`     — start of today → end of today
 * - `tomorrow`  — start of tomorrow → end of tomorrow
 * - `next3`     — start of today → end of (today + 2)  (today + next 2 days = 3 days total)
 * - `all`       — start of today → end of (today + 60). Forward-looking
 *                 only — past events are never surfaced. Wider than the
 *                 other filters so new-season fixture lists get caught
 *                 the moment they're published (Premier League drops
 *                 their next season ~6 weeks before kickoff).
 */
export function rangeFor(filter: FilterKey, now: Date = new Date()): DateRange {
  const today = startOfDay(now);
  // Specific future day picked from the scrollable strip.
  if (isDayKey(filter)) {
    const d = addDays(today, dayOffset(filter));
    return { start: d, end: endOfDay(d) };
  }
  switch (filter) {
    case 'today':
      return { start: today, end: endOfDay(today) };
    case 'tomorrow': {
      const t = addDays(today, 1);
      return { start: t, end: endOfDay(t) };
    }
    case 'next3':
      return { start: today, end: endOfDay(addDays(today, 2)) };
    case 'all':
      return { start: today, end: endOfDay(addDays(today, 60)) };
  }
}

/**
 * Build the ordered list of filter chips: the four presets followed by an
 * individual chip for each of the next `futureDays` days (starting the day
 * after tomorrow, since Today/Tomorrow already have their own presets).
 * Day chips are labelled like "Sat 27".
 */
export function buildFilterChips(
  now: Date = new Date(),
  futureDays: number = FUTURE_DAY_CHIPS,
): FilterChip[] {
  const chips: FilterChip[] = [
    { key: 'all', label: FILTER_LABELS.all },
    { key: 'today', label: FILTER_LABELS.today },
    { key: 'tomorrow', label: FILTER_LABELS.tomorrow },
    // "Next 3 Days" removed — individual day chips below cover that range.
  ];
  const today = startOfDay(now);
  for (let n = 2; n <= futureDays; n++) {
    const d = addDays(today, n);
    const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
    const day = d.toLocaleDateString(undefined, { day: 'numeric' });
    chips.push({ key: `day:${n}`, label: `${weekday} ${day}` });
  }
  return chips;
}

/** Returns true if `iso` falls inside `range` (inclusive on both ends). */
export function isInRange(iso: string, range: DateRange): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/**
 * Returns true if an event should appear for a date filter. Single-day
 * events match on `startsAt`; multi-day fixtures (Tests, county championship)
 * also match on any day their [startsAt, endsAt] window overlaps the range.
 */
export function eventOverlapsRange(
  startsAt: string,
  endsAt: string | undefined | null,
  range: DateRange,
): boolean {
  if (isInRange(startsAt, range)) return true;
  if (!endsAt) return false;
  return isSpanningRange(startsAt, endsAt, range);
}

/**
 * Returns true if an event whose play spans [startIso, endIso] overlaps
 * the requested date range at all. Used for multi-day events (cricket Tests,
 * county championship) so they appear in the day-filter on every day of
 * play, not just the day they start.
 *
 * Overlap condition: event starts before range ends AND event ends after
 * range starts.
 */
export function isSpanningRange(
  startIso: string,
  endIso: string,
  range: DateRange,
): boolean {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  return s <= range.end.getTime() && e >= range.start.getTime();
}

/** Format an ISO date for display: "Tue 5 May · 19:30". */
export function formatEventDate(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day} ${date} · ${time}`;
}

/**
 * Format an event's end time, omitting the date when it falls on the same
 * calendar day as the start (e.g. "21:30") and including a date when the
 * event spans days (e.g. "Wed 6 May · 18:30" for a multi-day cricket Test).
 */
export function formatEventEndTime(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const time = end.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  if (sameDay) return time;
  return formatEventDate(endIso);
}
