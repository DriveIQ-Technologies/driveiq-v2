/**
 * Free vs Premium calendar horizon (work order Part E3).
 *
 * Free: tonight + tomorrow. Premium: full browse window.
 */

import type { AppEvent } from '@/types/event';
import type { DateRange, FilterKey } from '@/utils/dateFilters';
import { rangeFor } from '@/utils/dateFilters';
import {
  addDaysYmd,
  londonDayBounds,
  londonYmd,
} from '@/utils/ukTime';

/** End of tomorrow, London time. */
export function freeEventHorizonEnd(now: Date = new Date()): Date {
  const tomorrowYmd = addDaysYmd(londonYmd(now), 1);
  return londonDayBounds(tomorrowYmd).end;
}

export function isEventBeyondFreeHorizon(
  startsAt: string,
  now: Date = new Date(),
): boolean {
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  return t > freeEventHorizonEnd(now).getTime();
}

export function isPremiumDayFilter(key: FilterKey): boolean {
  if (key === 'all' || key === 'next3') return true;
  if (key.startsWith('day:')) {
    const n = Number.parseInt(key.slice(4), 10);
    return Number.isFinite(n) && n >= 2;
  }
  return false;
}

/** Range free users actually see on the map for a given chip. */
export function rangeForTier(
  filter: FilterKey,
  isPremium: boolean,
  now: Date = new Date(),
): DateRange {
  if (isPremium) return rangeFor(filter, now);
  if (filter === 'today' || filter === 'tomorrow') return rangeFor(filter, now);
  if (filter.startsWith('day:')) {
    const n = Number.parseInt(filter.slice(4), 10);
    if (n <= 1) return rangeFor(filter, now);
  }
  // Free on All / Next3 / day:2+ still uses chip range for counts; map uses split.
  return rangeFor(filter, now);
}

export function splitEventsByPremium(
  events: AppEvent[],
  isPremium: boolean,
  now: Date = new Date(),
): { open: AppEvent[]; locked: AppEvent[] } {
  if (isPremium) return { open: events, locked: [] };
  const end = freeEventHorizonEnd(now).getTime();
  const open: AppEvent[] = [];
  const locked: AppEvent[] = [];
  for (const e of events) {
    const t = Date.parse(e.startsAt);
    if (Number.isFinite(t) && t > end) locked.push(e);
    else open.push(e);
  }
  return { open, locked };
}

export function formatStaleLabel(fetchedAtMs: number | null | undefined): string | null {
  if (fetchedAtMs == null || !Number.isFinite(fetchedAtMs)) return null;
  const ageSec = Math.max(0, Math.round((Date.now() - fetchedAtMs) / 1000));
  if (ageSec < 45) return 'Updated just now';
  if (ageSec < 120) return `Updated ${ageSec}s ago`;
  const mins = Math.round(ageSec / 60);
  if (mins < 60) return `Updated ${mins}m ago`;
  return `Updated ${Math.round(mins / 60)}h ago`;
}
