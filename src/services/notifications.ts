/**
 * Push / local notifications for DriveIQ.
 *
 * Three channels — user-toggleable in Settings:
 *   1. road-accidents — Severe/Serious incidents or new closures on London
 *      and surrounding motorways (M1, M25, M3, M4 etc.).
 *   2. line-closures — Tube / National Rail / Elizabeth / DLR / tram lines
 *      moving into the "Closed" or "Severe" status bucket.
 *   3. saved-events — pings the day-of and an hour before each event the
 *      user has saved or followed.
 *   4. saved-flights — delay / cancel changes on flights the user is watching.
 *
 * Implementation strategy: we run all of this with `expo-notifications`
 * scheduling **local** notifications from the foreground/background poll
 * (no Anthropic-side push server needed). The fetcher already runs every
 * 5 minutes; we diff the latest snapshot against the previous one and
 * schedule a notification whenever something escalates into a category
 * the user opted into.
 *
 * `expo-notifications` and `AsyncStorage` are loaded lazily via require()
 * so the bundle keeps compiling before the packages are installed; the
 * functions degrade to no-ops if the modules are missing.
 */

import type { TrafficIncident } from './tflTraffic';
import type { LineStatus } from './tflLines';
import type { AppEvent } from '@/types/event';
import type { AirportFlight } from './aerodatabox';
import type { SavedFlight } from './savedFlights';

export type NotificationChannel =
  | 'road-accidents'
  | 'line-closures'
  | 'saved-events'
  | 'saved-flights';

export interface NotificationPrefs {
  'road-accidents': boolean;
  'line-closures': boolean;
  'saved-events': boolean;
  'saved-flights': boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  'road-accidents': true,
  'line-closures': true,
  'saved-events': true,
  'saved-flights': true,
};

const STORAGE_KEY_PREFS = 'driveiq.notif.prefs.v1';
const STORAGE_KEY_INCIDENTS = 'driveiq.notif.lastIncidents.v1';
const STORAGE_KEY_LINES = 'driveiq.notif.lastLines.v1';
const STORAGE_KEY_ONBOARDING_SEEN = 'driveiq.notif.onboardingSeen.v1';

// Lazy module loaders — the require() lives behind a try so a missing
// package never crashes startup. The package is wired up at build time
// once the user runs `bun add expo-notifications @react-native-async-storage/async-storage`.
let _Notifications: any = null;
let _Storage: any = null;

/**
 * True when the expo-notifications NATIVE module is compiled into this app
 * binary. expo-notifications throws "Cannot find native module
 * 'ExpoPushTokenManager'" at import time when the JS package is installed
 * but the iOS/Android native side wasn't rebuilt (pods not reinstalled) —
 * and that throw escapes an ordinary try/catch around require() in Expo
 * SDK 53+. So we probe Expo's native-module registry FIRST and skip the
 * import entirely when the module is absent.
 */
const hasNativeNotificationsModule = (): boolean => {
  try {
    const mods = (globalThis as { expo?: { modules?: Record<string, unknown> } })
      .expo?.modules;
    return !!mods && 'ExpoPushTokenManager' in mods;
  } catch {
    return false;
  }
};

const getNotifications = (): any => {
  if (_Notifications !== null) return _Notifications;
  if (!hasNativeNotificationsModule()) {
    console.warn(
      '[notif] expo-notifications native module is not in this build — ' +
        'notifications disabled. Run `npx pod-install ios` and rebuild to enable.',
    );
    _Notifications = false;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Notifications = require('expo-notifications');
  } catch {
    _Notifications = false;
  }
  return _Notifications || null;
};

const getStorage = (): any => {
  if (_Storage !== null) return _Storage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Storage = require('@react-native-async-storage/async-storage').default;
  } catch {
    _Storage = false;
  }
  return _Storage || null;
};

const safeGet = async (key: string): Promise<string | null> => {
  const s = getStorage();
  if (!s) return null;
  try {
    return (await s.getItem(key)) as string | null;
  } catch {
    return null;
  }
};

const safeSet = async (key: string, value: string): Promise<void> => {
  const s = getStorage();
  if (!s) return;
  try {
    await s.setItem(key, value);
  } catch {
    /* ignore */
  }
};

/** Read user prefs from disk, falling back to defaults. */
export async function loadPrefs(): Promise<NotificationPrefs> {
  const raw = await safeGet(STORAGE_KEY_PREFS);
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: NotificationPrefs): Promise<void> {
  await safeSet(STORAGE_KEY_PREFS, JSON.stringify(prefs));
}

/**
 * Has the first-launch onboarding popup already been shown? Returned as a
 * boolean so the caller can simply skip the modal when true.
 */
export async function hasSeenOnboarding(): Promise<boolean> {
  const v = await safeGet(STORAGE_KEY_ONBOARDING_SEEN);
  return v === '1';
}

export async function markOnboardingSeen(): Promise<void> {
  await safeSet(STORAGE_KEY_ONBOARDING_SEEN, '1');
}

// ─── Per-line subscriptions ─────────────────────────────────────────────

/**
 * Which specific transit lines the user wants to be pinged about. The map
 * is keyed by TfL `lineId` (e.g. "victoria", "elizabeth", "thameslink").
 *
 * Two flavours of consumer:
 *   - Empty map → subscribed to ALL lines (default; matches v1 behaviour).
 *   - Non-empty map → only lines with `true` here trigger notifications.
 */
export type LineSubscriptions = Record<string, boolean>;
const STORAGE_KEY_LINE_SUBS = 'driveiq.notif.lineSubs.v1';

export async function loadLineSubscriptions(): Promise<LineSubscriptions> {
  const raw = await safeGet(STORAGE_KEY_LINE_SUBS);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as LineSubscriptions;
  } catch {
    return {};
  }
}

export async function saveLineSubscriptions(subs: LineSubscriptions): Promise<void> {
  await safeSet(STORAGE_KEY_LINE_SUBS, JSON.stringify(subs));
}

/** True if the user is subscribed to this line (or has no specific subs). */
const isLineSubscribed = (lineId: string, subs: LineSubscriptions): boolean => {
  const explicit = Object.values(subs).some(Boolean);
  if (!explicit) return true; // default = all lines
  return subs[lineId] === true;
};

/**
 * Ask for permission to show local notifications. Call once at app start
 * (idempotent — returns true if already granted).
 */
export async function ensurePermission(): Promise<boolean> {
  const N = getNotifications();
  if (!N) return false;
  try {
    const existing = await N.getPermissionsAsync();
    if (existing?.status === 'granted') return true;
    const req = await N.requestPermissionsAsync();
    return req?.status === 'granted';
  } catch {
    return false;
  }
}

/** "2026-06-26 08:05+01:00" | "2026-06-26T08:05+01:00" → "08:05". */
const localHhmm = (local: string): string => {
  const sep = local.includes('T') ? 'T' : ' ';
  return (local.split(sep)[1] ?? '').slice(0, 5);
};

const fire = async (
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> => {
  const N = getNotifications();
  if (!N) {
    console.log('[notif] (no-op)', title, body);
    return;
  }
  try {
    await N.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: null, // fire immediately
    });
  } catch (e) {
    console.warn('[notif] schedule failed', e);
  }
};

// ─── Key London corridors ────────────────────────────────────────────────
// The big motorways / A-roads that connect London and are usually busy or
// under roadworks — closures on these ALWAYS warrant a ping, even below the
// Severe/Serious threshold (client, 8 Aug 2026).
const KEY_ROAD_RE =
  /\b(M25|M23|M20|M11|M40|M4|M3|M2|M1|A406|A205|A1\(M\)|A3\(M\)|A40|A41|A13|A12|A10|A20|A102|A1|A2|A3|A4)\b/i;

/** Pull the headline road (e.g. "M25") out of an incident's text, if any. */
const matchKeyRoad = (inc: TrafficIncident): string | null => {
  const hay = `${inc.location ?? ''} ${inc.comments ?? ''}`;
  const m = hay.match(KEY_ROAD_RE);
  return m ? m[1].toUpperCase() : null;
};

/** Trim incident copy to one clean notification line. */
const cleanIncidentText = (s: string | undefined): string =>
  (s ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Compare a fresh traffic snapshot against the last one we saw and ping
 * the user about anything new and meaningful: severe/serious incidents,
 * accidents, and ANY closure on the key London corridors (M25, M4, A40…).
 */
export async function diffAndNotifyIncidents(
  next: TrafficIncident[],
  prefs: NotificationPrefs,
): Promise<void> {
  if (!prefs['road-accidents']) {
    await safeSet(STORAGE_KEY_INCIDENTS, JSON.stringify(next.map((i) => i.id)));
    return;
  }

  const raw = await safeGet(STORAGE_KEY_INCIDENTS);
  let prevIds = new Set<string>();
  if (raw) {
    try {
      prevIds = new Set(JSON.parse(raw) as string[]);
    } catch {
      prevIds = new Set();
    }
  }

  // First-run guard — don't ping on initial population.
  const isFirstRun = prevIds.size === 0;

  for (const inc of next) {
    if (prevIds.has(inc.id)) continue;
    const keyRoad = matchKeyRoad(inc);
    const isAccident = String(inc.category).toLowerCase() === 'accident';
    const isMajor =
      inc.severity === 'Severe' || inc.severity === 'Serious' || inc.hasClosures;
    // Closures / roadworks on the key corridors ping even at lower severity.
    const isKeyRoadClosure =
      keyRoad != null &&
      (inc.hasClosures || String(inc.category).toLowerCase() === 'closure');
    if (!isMajor && !isAccident && !isKeyRoadClosure) continue;
    if (isFirstRun) continue;

    const where = inc.location ?? keyRoad ?? 'a major route';
    const detail = cleanIncidentText(inc.comments);
    let title: string;
    if (inc.hasClosures || isKeyRoadClosure) {
      title = keyRoad ? `${keyRoad} closure — plan around it` : `Road closed: ${where}`;
    } else if (isAccident) {
      title = keyRoad ? `Accident on the ${keyRoad}` : `Accident: ${where}`;
    } else {
      title = keyRoad
        ? `${inc.severity} delays on the ${keyRoad}`
        : `${inc.severity} incident: ${where}`;
    }
    const body =
      (detail ? `${detail} ` : `${inc.category} at ${where}. `) +
      'Tap to see it on the DriveIQ map and route around it.';
    await fire(title, body, { kind: 'road-accident', incidentId: inc.id });
  }

  await safeSet(STORAGE_KEY_INCIDENTS, JSON.stringify(next.map((i) => i.id)));
}

/**
 * Compare a fresh line-status snapshot and ping when any line drops into
 * the Closed or Severe disruption bucket since last poll.
 */
export async function diffAndNotifyLines(
  next: LineStatus[],
  prefs: NotificationPrefs,
): Promise<void> {
  const snapshot: Record<string, string> = {};
  for (const l of next) snapshot[l.id] = l.severityBucket;

  if (!prefs['line-closures']) {
    await safeSet(STORAGE_KEY_LINES, JSON.stringify(snapshot));
    return;
  }

  // Read per-line subscriptions so we only ping for the lines the user
  // actually cares about (with the "no explicit subs = all lines" default).
  const lineSubs = await loadLineSubscriptions();

  const raw = await safeGet(STORAGE_KEY_LINES);
  let prev: Record<string, string> = {};
  if (raw) {
    try {
      prev = JSON.parse(raw) as Record<string, string>;
    } catch {
      prev = {};
    }
  }

  const isFirstRun = Object.keys(prev).length === 0;

  for (const l of next) {
    const before = prev[l.id];
    const after = l.severityBucket;
    if (before === after) continue;

    // Only ping for transitions INTO closed/severe — recoveries stay quiet.
    const escalated =
      (after === 'closed' && before !== 'closed') ||
      (after === 'severe' && before !== 'severe' && before !== 'closed');
    if (!escalated) continue;
    if (isFirstRun) continue;
    if (!isLineSubscribed(l.id, lineSubs)) continue;

    const reason = l.reason?.replace(/https?:\/\/\S+/gi, '').trim();
    await fire(
      after === 'closed'
        ? `${l.name} is down — take a look`
        : `${l.name}: ${l.statusDescription}`,
      (reason ? `${reason} ` : '') +
        'Check Connections in DriveIQ before you set off.',
      { kind: 'line-closure', lineId: l.id },
    );
  }

  await safeSet(STORAGE_KEY_LINES, JSON.stringify(snapshot));
}

/**
 * Schedule reminders for a saved event:
 *   - 1 hour before the start ("time to plan your route"), and
 *   - ~25 minutes before the end ("crowds leaving — heading off?"), so
 *     drivers get out ahead of the post-event traffic surge.
 * No-ops if `saved-events` is disabled or the times are already past.
 */
export async function scheduleEventReminder(
  event: AppEvent,
  prefs: NotificationPrefs,
): Promise<void> {
  if (!prefs['saved-events']) return;
  const N = getNotifications();
  if (!N) return;

  const startMs = Date.parse(event.startsAt);
  if (Number.isFinite(startMs)) {
    const fireAt = startMs - 60 * 60 * 1000;
    if (fireAt >= Date.now() + 30_000) {
      try {
        await N.scheduleNotificationAsync({
          content: {
            title: `${event.title} starts in 1 hour`,
            body:
              (event.venue ? `Doors at ${event.venue}. ` : '') +
              'Tap for the fastest route with live traffic.',
            data: { kind: 'saved-event', eventId: event.id },
            sound: 'default',
          },
          trigger: { date: new Date(fireAt) },
        });
      } catch (e) {
        console.warn('[notif] event reminder failed', e);
      }
    }
  }

  const endMs = Date.parse(event.endsAt ?? '');
  if (Number.isFinite(endMs)) {
    const fireAt = endMs - 25 * 60 * 1000;
    if (fireAt >= Date.now() + 30_000) {
      try {
        await N.scheduleNotificationAsync({
          content: {
            title: `${event.title} is about to end`,
            body:
              `Wrapping up in about 25 minutes — expect traffic around ` +
              `${event.venue ?? 'the venue'} as crowds leave. Heading off? ` +
              'Tap for the quickest way out.',
            data: { kind: 'saved-event-end', eventId: event.id },
            sound: 'default',
          },
          trigger: { date: new Date(fireAt) },
        });
      } catch (e) {
        console.warn('[notif] event end reminder failed', e);
      }
    }
  }
}

/**
 * Diff live FIDS rows against the user's watched flights and ping on
 * cancel / new delay / delay worsened by ≥15 minutes.
 * Call after refreshing boards for airports that have saved flights.
 */
export async function diffAndNotifyFlights(
  liveById: Record<string, AirportFlight>,
  watched: SavedFlight[],
  prefs: NotificationPrefs,
): Promise<SavedFlight[]> {
  if (!prefs['saved-flights'] || watched.length === 0) return watched;

  const updated: SavedFlight[] = [];
  for (const prev of watched) {
    const next = liveById[prev.id];
    if (!next) {
      updated.push(prev);
      continue;
    }

    const becameCancelled = !prev.cancelled && next.cancelled;
    const becameDelayed = !prev.delayed && next.delayed;
    const delayWorsened =
      prev.delayed &&
      next.delayed &&
      (next.delayMinutes ?? 0) >= (prev.delayMinutes ?? 0) + 15;

    const routeText = `${next.direction === 'departure' ? 'to' : 'from'} ${next.counterpart}`;
    if (becameCancelled) {
      await fire(
        `${next.flightNumber} has been cancelled`,
        `Your watched flight ${routeText} was cancelled` +
          (next.airline ? ` — check with ${next.airline} for rebooking.` : '.') +
          ' Tap for the live board.',
        { kind: 'saved-flight', flightId: next.id },
      );
    } else if (becameDelayed || delayWorsened) {
      const mins =
        next.delayMinutes != null ? ` by ${next.delayMinutes} min` : '';
      await fire(
        `${next.flightNumber} is running late${mins}`,
        `Your watched flight ${routeText}` +
          (next.revisedLocal
            ? ` is now estimated ${localHhmm(next.revisedLocal)}.`
            : ' has a new delay.') +
          " We'll keep an eye on it for you.",
        { kind: 'saved-flight', flightId: next.id },
      );
    }

    updated.push({
      ...prev,
      ...next,
      airportId: prev.airportId,
      savedAt: prev.savedAt,
    });
  }
  return updated;
}
