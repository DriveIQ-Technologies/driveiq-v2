/**
 * Last-line filters for listings that look like London events but aren't.
 * Cached rows and every provider go through this so a bad feed cannot
 * survive a refresh.
 */

import type { AppEvent } from '@/types/event';

const LONDON_CRICKET_SIDE =
  /\b(surrey|middlesex|essex|kent|oval invincibles|london spirit|england lions|england|mcc)\b/i;

/** Australia / NZ / SA A-team and state sides that ESPN pins on "The Oval". */
const OVERSEAS_CRICKET =
  /\b(nz-a|nz a|as-a|aus-a|australia a|act\b|nts\b|hh-a|sa-a|ban-a|bangladesh a|south africa a|new zealand a|hobart|manuka|adelaide|perth|brisbane heat)\b/i;

const SCOREBOARD_TITLE =
  /\d+\/\d+|\d+\s*ov\b|target\s+\d+| \(\d+\.\d+\/\d+/i;

function isCricket(event: AppEvent): boolean {
  return /cricket/i.test(`${event.subCategory ?? ''} ${event.title}`);
}

export function looksLikeScoreboardTitle(title: string): boolean {
  return SCOREBOARD_TITLE.test(title);
}

export function isPlausibleLondonEvent(event: AppEvent): boolean {
  if (!isCricket(event)) return true;
  if (looksLikeScoreboardTitle(event.title)) return false;
  if (OVERSEAS_CRICKET.test(event.title)) return false;

  const hour = new Date(event.startsAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
  const h = Number.parseInt(hour, 10);
  if (Number.isFinite(h) && (h < 9 || h > 19)) return false;

  return LONDON_CRICKET_SIDE.test(event.title);
}

export function sanitizeEvents(events: AppEvent[]): AppEvent[] {
  return events.filter(isPlausibleLondonEvent);
}
