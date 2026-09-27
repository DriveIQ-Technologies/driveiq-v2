/**
 * When a watched flight stops counting as watched.
 *
 * Watched flights used to be kept forever. A free user whose one watched flight
 * landed last week was still "at the limit", and anyone dropping back from
 * Premium or the waitlist week kept every flight they had watched — permanently
 * over the free allowance, and told to "stop watching your current one" when
 * that flight had long since landed, often at a different airport.
 */

/** A flight stops counting this long after its (revised) time. */
export const WATCH_EXPIRES_AFTER_MS = 6 * 60 * 60 * 1000;
/** Flights the feed gave no usable time expire this long after being watched. */
export const UNTIMED_WATCH_EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000;

export interface WatchTiming {
  effectiveMs?: number;
  scheduledMs?: number;
  savedAt?: number;
}

export function isWatchActive(f: WatchTiming, now: number = Date.now()): boolean {
  const effective = Number(f.effectiveMs);
  const scheduled = Number(f.scheduledMs);
  const at = effective > 0 ? effective : scheduled;
  if (Number.isFinite(at) && at > 0) return now - at <= WATCH_EXPIRES_AFTER_MS;
  return now - Number(f.savedAt ?? 0) <= UNTIMED_WATCH_EXPIRES_AFTER_MS;
}
