/**
 * Disk cache for the merged event catalogue.
 *
 * Cold launch paints last-good pins immediately (stale-while-revalidate),
 * then the live provider fan-out refreshes in the background. Without this
 * the map stays empty until Ticketmaster's multi-page pull finishes (~20–30s).
 */

import type { AppEvent } from '@/types/event';
import { sanitizeEvents } from './eventSanity';
import { getJSON, setJSON } from './storage';

const CACHE_KEY = 'driveiq.events.v2';

/** Keep showing cached pins for up to 24h; always refresh in the background. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CachedEvents {
  savedAt: number;
  events: AppEvent[];
}

export async function loadCachedEvents(): Promise<AppEvent[] | null> {
  const cached = await getJSON<CachedEvents | null>(CACHE_KEY, null);
  if (!cached?.events?.length || typeof cached.savedAt !== 'number') return null;
  if (Date.now() - cached.savedAt > MAX_AGE_MS) return null;
  // Drop anything that already ended (cache can span overnight). Small
  // grace only — launch must not paint yesterday's pins.
  const cutoff = Date.now() - 30 * 60 * 1000;
  const live = sanitizeEvents(cached.events).filter((e) => {
    const end = Date.parse(e.estimatedFinishAt || e.endsAt || e.startsAt);
    return Number.isFinite(end) ? end >= cutoff : true;
  });
  return live.length > 0 ? live : null;
}

export async function saveCachedEvents(events: AppEvent[]): Promise<void> {
  if (!events.length) return;
  const payload: CachedEvents = { savedAt: Date.now(), events };
  await setJSON(CACHE_KEY, payload);
}
