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
import { track } from './analytics';
import { templateRailLine, templateRoadLine } from './copyTemplates';
import { eventReminderPlan, PRE_END_MINUTES } from './eventReminders';

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

/**
 * Every channel off. Notifications are an account feature (doc task 09), so a
 * signed-out or anonymous session must never show enabled switches or deliver
 * pings — including when local storage still holds a previous account's prefs.
 */
export const PREFS_ALL_OFF: NotificationPrefs = {
  'road-accidents': false,
  'line-closures': false,
  'saved-events': false,
  'saved-flights': false,
};

/** Stored prefs for account holders; all-off for everyone else. */
export function effectivePrefs(
  prefs: NotificationPrefs | null,
  hasAccount: boolean,
): NotificationPrefs {
  if (!hasAccount) return { ...PREFS_ALL_OFF };
  return prefs ? { ...prefs } : { ...DEFAULT_PREFS };
}

const STORAGE_KEY_PREFS = 'driveiq.notif.prefs.v1';
const STORAGE_KEY_INCIDENTS = 'driveiq.notif.lastIncidents.v2';
const STORAGE_KEY_LINES = 'driveiq.notif.lastLines.v1';
const STORAGE_KEY_ONBOARDING_SEEN = 'driveiq.notif.onboardingSeen.v1';

// Lazy module loaders — the require() lives behind a try so a missing
// package never crashes startup. The package is wired up at build time
// once the user runs `bun add expo-notifications @react-native-async-storage/async-storage`.
let _Notifications: any = null;
let _Storage: any = null;
let _responseSub: { remove: () => void } | null = null;

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

/** London quiet hours 02:00–05:00 — no pings (Part D). */
const isQuietHours = (now: Date = new Date()): boolean => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const mins = hour * 60 + minute;
  return mins >= 2 * 60 && mins < 5 * 60;
};

type IncidentSnapshot = {
  severity: string;
  category: string;
  hasClosures: boolean;
};

const incidentFingerprint = (inc: TrafficIncident): IncidentSnapshot => ({
  severity: inc.severity,
  category: String(inc.category),
  hasClosures: !!inc.hasClosures,
});

const incidentMaterialChange = (
  prev: IncidentSnapshot | undefined,
  inc: TrafficIncident,
): boolean => {
  if (!prev) return true;
  const next = incidentFingerprint(inc);
  return (
    prev.severity !== next.severity ||
    prev.category !== next.category ||
    prev.hasClosures !== next.hasClosures
  );
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
  if (isQuietHours()) {
    console.log('[notif] quiet hours, skipped', title);
    return;
  }
  try {
    const payload = { ...data, sentAtMs: Date.now() };
    await N.scheduleNotificationAsync({
      content: { title, body, data: payload, sound: 'default' },
      trigger: null, // fire immediately
    });
    const kind = typeof data.kind === 'string' ? data.kind : 'unknown';
    track('notification_dispatched', {
      kind,
    });
    track('alert_received', {
      type: alertTypeFromKind(kind),
    });
  } catch (e) {
    console.warn('[notif] schedule failed', e);
    track('notification_dispatch_failed');
  }
};

const alertTypeFromKind = (kind: string): string => {
  if (kind === 'road-accident') return 'road';
  if (kind === 'line-closure') return 'rail';
  if (kind === 'saved-flight') return 'airport';
  if (kind === 'saved-event' || kind === 'saved-event-end') return 'event';
  return kind || 'unknown';
};

/**
 * Track alert-open events from OS notification taps.
 * Safe to call repeatedly; listener is attached once.
 */
export function startNotificationOpenTracking(): void {
  const N = getNotifications();
  if (!N || _responseSub) return;
  try {
    _responseSub = N.addNotificationResponseReceivedListener((response: any) => {
      const data = (response?.notification?.request?.content?.data ?? {}) as Record<
        string,
        unknown
      >;
      const kind = typeof data.kind === 'string' ? data.kind : 'unknown';
      const sentAt = Number(data.sentAtMs);
      const minutesSinceSent =
        Number.isFinite(sentAt) && sentAt > 0
          ? Math.max(0, Math.round((Date.now() - sentAt) / 60000))
          : undefined;
      track('alert_opened', {
        type: alertTypeFromKind(kind),
        minutes_since_sent: minutesSinceSent,
      });
    });
  } catch (e) {
    console.warn('[notif] response listener setup failed', e);
  }
}

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
    const snap: Record<string, IncidentSnapshot> = {};
    for (const inc of next) snap[inc.id] = incidentFingerprint(inc);
    await safeSet(STORAGE_KEY_INCIDENTS, JSON.stringify(snap));
    return;
  }

  const raw = await safeGet(STORAGE_KEY_INCIDENTS);
  let prev: Record<string, IncidentSnapshot> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        // v1 id list — treat as first run after upgrade.
        prev = {};
      } else {
        prev = parsed as Record<string, IncidentSnapshot>;
      }
    } catch {
      prev = {};
    }
  }

  // First-run guard — don't ping on initial population.
  const isFirstRun = Object.keys(prev).length === 0;

  for (const inc of next) {
    const before = prev[inc.id];
    if (!incidentMaterialChange(before, inc)) continue;
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
    const title = inc.hasClosures || isKeyRoadClosure
      ? keyRoad
        ? `${keyRoad} closure, plan around it`
        : `Road closed: ${where}`
      : isAccident
        ? keyRoad
          ? `Accident on the ${keyRoad}`
          : `Accident: ${where}`
        : keyRoad
          ? `${inc.severity} delays on the ${keyRoad}`
          : `${inc.severity} incident: ${where}`;
    const body = `${templateRoadLine(inc, keyRoad ?? 'Road')} Tap the map to route around it.`;
    await fire(title, body, { kind: 'road-accident', incidentId: inc.id });
  }

  const snap: Record<string, IncidentSnapshot> = {};
  for (const inc of next) snap[inc.id] = incidentFingerprint(inc);
  await safeSet(STORAGE_KEY_INCIDENTS, JSON.stringify(snap));
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

    await fire(
      after === 'closed'
        ? `${l.name} is down. Take a look`
        : `${l.name}: ${l.statusDescription}`,
      templateRailLine(l),
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

  const plan = eventReminderPlan(event);

  if (plan.preStartAtMs != null) {
    try {
      await N.scheduleNotificationAsync({
        content: {
          title: `${event.title} starts in 1 hour`,
          body:
            (event.venue ? `Time to head to ${event.venue}. ` : '') +
            'Tap for the fastest route with live traffic.',
          data: { kind: 'saved-event', eventId: event.id },
          sound: 'default',
        },
        trigger: { date: new Date(plan.preStartAtMs) },
      });
      track('event_reminder_scheduled', { phase: 'pre_start', event_id: event.id });
    } catch (e) {
      console.warn('[notif] event reminder failed', e);
    }
  }

  if (plan.preEndAtMs != null) {
    try {
      await N.scheduleNotificationAsync({
        content: {
          title: `${event.title} is about to end`,
          body:
            `Wrapping up in about ${PRE_END_MINUTES} minutes. Expect traffic around ` +
            `${plan.venue} as crowds leave. Heading off? ` +
            'Tap for the quickest way out.',
          data: { kind: 'saved-event-end', eventId: event.id },
          sound: 'default',
        },
        trigger: { date: new Date(plan.preEndAtMs) },
      });
      track('event_reminder_scheduled', { phase: 'pre_end', event_id: event.id });
    } catch (e) {
      console.warn('[notif] event end reminder failed', e);
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
          (next.airline ? `. Check with ${next.airline} for rebooking.` : '.') +
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
