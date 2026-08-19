/**
 * Date-range helpers that power the Today / Tomorrow / day-chip filter bar.
 *
 * All day windows are Europe/London calendar days — not the device timezone.
 * DriveIQ is a London product; a tester in UTC+3 (or a US-set simulator)
 * must still see "Today" as London's today, or West End shows vanish from
 * the wrong chip.
 */

import {
  addDaysYmd,
  londonDayBounds,
  londonYmd,
} from '@/utils/ukTime';

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

const LONDON_TZ = 'Europe/London';

/**
 * Build the date range for a given filter, anchored at London's calendar
 * for `now` (defaults to current time).
 *
 * - `today`     — London midnight today → end of today
 * - `tomorrow`  — London tomorrow
 * - `next3`     — today → today+2 (London)
 * - `all`       — today → today+60 (forward-looking only)
 */
export function rangeFor(filter: FilterKey, now: Date = new Date()): DateRange {
  const todayYmd = londonYmd(now);
  if (isDayKey(filter)) {
    const ymd = addDaysYmd(todayYmd, dayOffset(filter));
    return londonDayBounds(ymd);
  }
  switch (filter) {
    case 'today':
      return londonDayBounds(todayYmd);
    case 'tomorrow':
      return londonDayBounds(addDaysYmd(todayYmd, 1));
    case 'next3': {
      const start = londonDayBounds(todayYmd).start;
      const end = londonDayBounds(addDaysYmd(todayYmd, 2)).end;
      return { start, end };
    }
    case 'all': {
      const start = londonDayBounds(todayYmd).start;
      const end = londonDayBounds(addDaysYmd(todayYmd, 60)).end;
      return { start, end };
    }
  }
}

/**
 * Build the ordered list of filter chips: presets plus a scrollable strip of
 * individual future days (starting the day after tomorrow). Day chips are
 * labelled in London time, e.g. "Sat 27".
 */
export function buildFilterChips(
  now: Date = new Date(),
  futureDays: number = FUTURE_DAY_CHIPS,
): FilterChip[] {
  const chips: FilterChip[] = [
    { key: 'all', label: FILTER_LABELS.all },
    { key: 'today', label: FILTER_LABELS.today },
    { key: 'tomorrow', label: FILTER_LABELS.tomorrow },
  ];
  const todayYmd = londonYmd(now);
  for (let n = 2; n <= futureDays; n++) {
    const ymd = addDaysYmd(todayYmd, n);
    // Format from a fixed London noon instant so the weekday/day match London.
    const noon = new Date(`${ymd}T12:00:00Z`);
    const weekday = noon.toLocaleDateString('en-GB', {
      weekday: 'short',
      timeZone: LONDON_TZ,
    });
    const day = noon.toLocaleDateString('en-GB', {
      day: 'numeric',
      timeZone: LONDON_TZ,
    });
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
 * Minimum duration for an event to be treated as genuinely multi-day and
 * allowed to span onto other day chips (cricket Tests, festivals). Below
 * this, a late show whose end crosses midnight — or an event with an
 * inflated provider end time — must NOT bleed onto the wrong day.
 */
const MULTI_DAY_MS = 20 * 60 * 60 * 1000;

/**
 * Returns true if an event should appear for a date filter. Single-day
 * events match on `startsAt` only; genuinely multi-day fixtures (Tests,
 * county championship) also match on any day their [startsAt, endsAt]
 * window overlaps the range.
 */
export function eventOverlapsRange(
  startsAt: string,
  endsAt: string | undefined | null,
  range: DateRange,
): boolean {
  if (isInRange(startsAt, range)) return true;
  if (!endsAt) return false;
  const s = new Date(startsAt).getTime();
  const e = new Date(endsAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  if (e - s < MULTI_DAY_MS) return false;
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

/** Format an ISO date for display in London time: "Tue 5 May · 19:30". */
export function formatEventDate(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: LONDON_TZ,
  });
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: LONDON_TZ,
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: LONDON_TZ,
  });
  return `${day} ${date} · ${time}`;
}

/** London wall-clock time only: "19:30". */
export function formatLondonHhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: LONDON_TZ,
  });
}

/**
 * Format an event's end time in London time, omitting the date when it falls
 * on the same London calendar day as the start.
 */
export function formatEventEndTime(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = londonYmd(start) === londonYmd(end);
  const time = end.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: LONDON_TZ,
  });
  if (sameDay) return time;
  return formatEventDate(endIso);
}
