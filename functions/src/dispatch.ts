/**
 * Server-side FCM dispatch when the app is closed.
 * Mirrors client diff rules in src/services/notifications.ts.
 */
import { logger } from 'firebase-functions';

import { isUsableCopyLine } from './copy.js';
import type { Firestore } from 'firebase-admin/firestore';
import { isQuietHours } from './londonTime.js';
import { sendPushToTokens } from './push.js';
import type { CachedFlight } from './airports.js';
import { evaluateWatchedFlight, type WatchedFlightState } from './flightAlerts.js';
import type { TrafficIncident } from './corridors.js';

export interface NotificationPrefs {
  'road-accidents': boolean;
  'line-closures': boolean;
  'saved-events': boolean;
  'saved-flights': boolean;
  'community-reports': boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  'road-accidents': true,
  'line-closures': true,
  'saved-events': true,
  'saved-flights': true,
  'community-reports': true,
};

interface SavedFlight {
  id: string;
  airportId: string;
  flightNumber: string;
  cancelled?: boolean;
  delayed?: boolean;
  delayMinutes?: number;
}

interface LineStatus {
  id: string;
  name: string;
  severityBucket: string;
  statusDescription: string;
  /** 'nsi' when the status comes from National Rail rather than TfL. */
  source?: 'nsi';
}

/**
 * Bumped when a source's baseline in notificationState can no longer be
 * trusted. TfL reported every National Rail operator as a permanent "Special
 * Service", which bucketed as 'closed'. Once National Rail's own feed took
 * over, a real "severe" looked like an improvement from 'closed', so South
 * Western's genuine disruption never alerted. Baselines from before this
 * version are ignored for National Rail lines, once.
 */
export const RAIL_BASELINE = 'nsi-v1';

/** Did a line get worse in a way worth a push? */
export function lineEscalated(before: string | undefined, after: string): boolean {
  if (before === after) return false;
  return (
    (after === 'closed' && before !== 'closed') ||
    (after === 'severe' && before !== 'severe' && before !== 'closed')
  );
}

/**
 * The previous bucket to compare against. National Rail baselines written
 * before RAIL_BASELINE came from TfL's meaningless 'closed' and are ignored.
 */
export function lineBaseline(
  line: { id: string; source?: 'nsi' },
  prevLines: Record<string, string>,
  railBaselineVersion: unknown,
): string | undefined {
  if (line.source === 'nsi' && railBaselineVersion !== RAIL_BASELINE) return undefined;
  return prevLines[line.id];
}

/** Lower sends first: the per-run cap must never be spent on roads alone. */
const ALERT_PRIORITY: Record<string, number> = {
  'line-closure': 0,
  'saved-flight': 1,
  'road-accident': 2,
};

type IncidentSnapshot = {
  severity: string;
  category: string;
  hasClosures: boolean;
};

function incidentFingerprint(inc: TrafficIncident): IncidentSnapshot {
  return {
    severity: inc.severity,
    category: String(inc.category),
    hasClosures: !!inc.hasClosures,
  };
}

function materialChange(
  prev: IncidentSnapshot | undefined,
  inc: TrafficIncident,
): boolean {
  if (!prev) return true;
  const next = incidentFingerprint(inc);
  return (
    prev.severity !== next.severity ||
    prev.category !== next.category ||
    prev.hasClosures !== next.hasClosures
  );
}

const KEY_ROAD_RE =
  /\b(M25|M23|M20|M11|M40|M4|M3|M2|M1|A406|A205|A1\(M\)|A3\(M\)|A40|A41|A13|A12|A10|A20|A102|A1|A2|A3|A4)\b/i;

function matchKeyRoad(inc: TrafficIncident): string | null {
  const hay = `${inc.location ?? ''} ${inc.comments ?? ''}`;
  const m = hay.match(KEY_ROAD_RE);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Several serious-delay alerts discovered in one poll become one notification.
 * They used to leave the phone as 4–5 banners at the same moment, which is
 * also how a late batch feels: the feed had been holding them.
 */
export function collapseRoadBursts<
  T extends { title: string; body: string; data: Record<string, string> },
>(payloads: T[]): T[] {
  const roads = payloads.filter((p) => p.data.kind === 'road-accident');
  const rest = payloads.filter((p) => p.data.kind !== 'road-accident');
  if (roads.length <= 1) return payloads;
  const named = [
    ...new Set(
      roads
        .map((p) => p.title.match(/\bon the ([A-Z0-9()]+)/i)?.[1]?.toUpperCase())
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const extra = Math.max(named.length, roads.length) - 1;
  const title =
    named.length >= 1
      ? `Serious delays on the ${named[0]} and ${extra} other route${extra === 1 ? '' : 's'}`
      : `Serious delays on ${roads.length} routes`;
  const first = roads[0];
  return [
    {
      ...first,
      title,
      body: 'A few roads changed together. Tap the map to see them and route around it.',
    },
    ...rest,
  ];
}

function isMajorIncident(inc: TrafficIncident): boolean {
  const keyRoad = matchKeyRoad(inc);
  const isAccident = String(inc.category).toLowerCase() === 'accident';
  const isMajor =
    inc.severity === 'Severe' || inc.severity === 'Serious' || !!inc.hasClosures;
  const isKeyRoadClosure =
    keyRoad != null &&
    (!!inc.hasClosures || String(inc.category).toLowerCase() === 'closure');
  return isMajor || isAccident || isKeyRoadClosure;
}

function parsePrefs(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const x = raw as Record<string, unknown>;
  return {
    'road-accidents': x['road-accidents'] !== false,
    'line-closures': x['line-closures'] !== false,
    'saved-events': x['saved-events'] !== false,
    'saved-flights': x['saved-flights'] !== false,
    'community-reports': x['community-reports'] !== false,
  };
}

function parseLineSubs(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true) out[k] = true;
  }
  return out;
}

function isLineSubscribed(lineId: string, subs: Record<string, boolean>): boolean {
  const explicit = Object.values(subs).some(Boolean);
  if (!explicit) return true;
  return subs[lineId] === true;
}

async function loadCopyLine(
  db: Firestore,
  kind: 'road' | 'rail' | 'flight',
  id: string,
  fallback: string,
): Promise<string> {
  const snap = await db.doc(`copy/${kind}/lines/${id}`).get();
  const line = snap.data()?.line;
  // Checked on read as well as on write: refusals stored before the write-side
  // guard existed are still sitting in Firestore, and one of them reached a
  // real phone as the body of a rail alert.
  if (typeof line === 'string' && isUsableCopyLine(line)) return line.trim();
  return fallback;
}

/** Users scanned per Firestore page while sweeping for push tokens. */
const DISPATCH_PAGE_SIZE = 500;
/** Hard bound on pages per run so a sweep cannot outlive the function timeout. */
const MAX_DISPATCH_PAGES = 40;

export async function dispatchPushNotifications(opts: {
  db: Firestore;
  incidents: TrafficIncident[];
  lines: LineStatus[];
  flightsByAirport: Record<string, CachedFlight[]>;
}): Promise<void> {
  // Quiet hours still record what the roads look like, so 05:00 does not
  // replay every overnight change as a burst of stale alerts.
  const quiet = isQuietHours();
  if (quiet) logger.info('dispatch.quiet_hours');

  // Page through EVERY user. This used to be a bare .limit(500) with no
  // cursor: past 500 accounts the same first 500 were served on every run and
  // everyone after them silently never received a notification again. Ordered
  // by document id so the cursor is stable across pages.
  const userDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  // Bound the sweep so one run cannot outlive the function timeout.
  for (let page = 0; page < MAX_DISPATCH_PAGES; page += 1) {
    let q = opts.db.collection('users').orderBy('__name__').limit(DISPATCH_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const tokens = d.data().fcmTokens;
      if (Array.isArray(tokens) && tokens.some((t) => typeof t === 'string' && t.length > 8)) {
        userDocs.push(d);
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < DISPATCH_PAGE_SIZE) break;
    if (page === MAX_DISPATCH_PAGES - 1) {
      logger.warn('dispatch.page_cap_reached', { scanned: (page + 1) * DISPATCH_PAGE_SIZE });
    }
  }

  if (userDocs.length === 0) {
    logger.info('dispatch.no_tokens');
    return;
  }
  logger.info('dispatch.users_with_tokens', { count: userDocs.length });

  for (const userDoc of userDocs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const tokens = Array.isArray(data.fcmTokens)
      ? (data.fcmTokens as string[]).filter(Boolean)
      : [];
    if (tokens.length === 0) continue;

    const prefs = parsePrefs(data.notificationPrefs);
    const lineSubs = parseLineSubs(data.lineSubscriptions);
    const watched = Array.isArray(data.savedFlights)
      ? (data.savedFlights as SavedFlight[])
      : [];

    const stateRef = opts.db.doc(`users/${uid}/notificationState/default`);
    const stateSnap = await stateRef.get();
    const state = (stateSnap.data() ?? {}) as Record<string, unknown>;

    const prevIncidents = (state.incidents ?? {}) as Record<string, IncidentSnapshot>;
    const prevLines = (state.lines ?? {}) as Record<string, string>;
    const prevFlights = (state.flights ?? {}) as Record<string, WatchedFlightState>;
    const isFirstRun =
      Object.keys(prevIncidents).length === 0 && Object.keys(prevLines).length === 0;

    const payloads: Array<{ title: string; body: string; data: Record<string, string> }> = [];

    if (!quiet && prefs['road-accidents']) {
      for (const inc of opts.incidents) {
        if (!isMajorIncident(inc)) continue;
        if (!materialChange(prevIncidents[inc.id], inc)) continue;
        if (isFirstRun) continue;
        const keyRoad = matchKeyRoad(inc);
        const where = inc.location ?? keyRoad ?? 'a major route';
        const title =
          inc.hasClosures || String(inc.category).toLowerCase() === 'closure'
            ? keyRoad
              ? `${keyRoad} closure, plan around it`
              : `Road closed: ${where}`
            : String(inc.category).toLowerCase() === 'accident'
              ? keyRoad
                ? `Accident on the ${keyRoad}`
                : `Accident: ${where}`
              : keyRoad
                ? `${inc.severity} delays on the ${keyRoad}`
                : `${inc.severity} incident: ${where}`;
        const body = await loadCopyLine(
          opts.db,
          'road',
          `tfl-road-${inc.id}`,
          `${where}. Tap the map to route around it.`,
        );
        payloads.push({
          title,
          body,
          // The app matches incidentId against the incidents it already holds
          // (which carry coordinates) to focus the map on tap.
          data: { kind: 'road-accident', incidentId: inc.id },
        });
      }
    }

    if (!quiet && prefs['line-closures']) {
      for (const l of opts.lines) {
        const before = lineBaseline(l, prevLines, state.railBaseline);
        const after = l.severityBucket;
        if (!lineEscalated(before, after)) continue;
        if (isFirstRun) continue;
        if (!isLineSubscribed(l.id, lineSubs)) continue;
        const title =
          after === 'closed' ? `${l.name} is down. Take a look` : `${l.name}: ${l.statusDescription}`;
        // A severe title already carries the status text; don't repeat it as the body.
        const fallback =
          after === 'closed' ? l.statusDescription : 'Tap to see what is affected and plan around it.';
        const body = await loadCopyLine(opts.db, 'rail', `tfl-rail-${l.id}`, fallback);
        payloads.push({
          title,
          body,
          data: { kind: 'line-closure', lineId: l.id },
        });
      }
    }

    // Watched flights: evaluated once here; the result feeds both the alerts
    // and the state written below.
    const nextFlightState: Record<string, WatchedFlightState> = {};
    if (!quiet && prefs['saved-flights'] && watched.length > 0) {
      const liveById: Record<string, CachedFlight> = {};
      for (const flights of Object.values(opts.flightsByAirport)) {
        for (const f of flights) liveById[f.id] = f;
      }
      let onBoard = 0;
      let flightAlerts = 0;
      for (const saved of watched) {
        const live = liveById[saved.id];
        if (!live) continue;
        onBoard += 1;
        const { alert, next } = evaluateWatchedFlight(saved, prevFlights[saved.id], live);
        nextFlightState[saved.id] = next;
        if (!alert) continue;
        flightAlerts += 1;
        payloads.push({
          title: alert.title,
          body: alert.body,
          // airportId so the tap opens the right airport's flight list.
          data: {
            kind: 'saved-flight',
            flightId: live.id,
            airportId: saved.airportId,
            event: alert.kind,
          },
        });
      }
      // Why a watcher did or didn't get a flight alert this run: a watched
      // flight that's not on the board (wrong id / outside the window) can't
      // alert, and one that's on the board only alerts when it changes.
      logger.info('dispatch.flights', {
        uid,
        watched: watched.length,
        onBoard,
        alerts: flightAlerts,
        states: watched
          .map((w) => {
            const live = liveById[w.id];
            if (!live) return `${w.flightNumber}:not on board`;
            const state = live.cancelled
              ? 'cancelled'
              : live.status === 'Arrived' || live.status === 'Departed'
                ? live.status.toLowerCase()
                : live.delayed
                  ? `+${live.delayMinutes ?? 0}m`
                  : 'on time';
            return `${live.flightNumber}:${state}`;
          })
          .slice(0, 5),
      });
    } else if (!quiet && watched.length > 0) {
      logger.info('dispatch.flights', { uid, watched: watched.length, prefOff: true });
    }

    const deadTokens = new Set<string>();
    payloads.sort(
      (a, b) => (ALERT_PRIORITY[a.data.kind] ?? 9) - (ALERT_PRIORITY[b.data.kind] ?? 9),
    );
    for (const p of collapseRoadBursts(payloads).slice(0, 5)) {
      const result = await sendPushToTokens(tokens, p);
      for (const t of result.invalidTokens) deadTokens.add(t);
    }
    // Expo told us these devices are gone (app deleted, token rotated). Drop
    // them so we stop sending into the void on every cycle.
    if (deadTokens.size > 0) {
      const keep = tokens.filter((t) => !deadTokens.has(t));
      await userDoc.ref
        .set({ fcmTokens: keep }, { merge: true })
        .catch(() => undefined);
      logger.info('dispatch.pruned_dead_tokens', { uid, removed: deadTokens.size });
    }

    const nextIncidents: Record<string, IncidentSnapshot> = {};
    for (const inc of opts.incidents) nextIncidents[inc.id] = incidentFingerprint(inc);
    const nextLines: Record<string, string> = {};
    for (const l of opts.lines) nextLines[l.id] = l.severityBucket;
    const nextFlights: Record<string, WatchedFlightState> = { ...prevFlights, ...nextFlightState };

    await stateRef.set(
      {
        incidents: nextIncidents,
        lines: nextLines,
        railBaseline: RAIL_BASELINE,
        flights: nextFlights,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  logger.info('dispatch.done', { users: userDocs.length });
}

interface SavedEventRow {
  id: string;
  title: string;
  venue?: string;
  startsAt?: string;
  endsAt?: string;
  realStartAt?: string;
  estimatedFinishAt?: string;
}

const PRE_START_MS = 60 * 60 * 1000;
const PRE_END_MS = 25 * 60 * 1000;
const REMINDER_WINDOW_MS = 6 * 60 * 1000;

/**
 * FCM for saved-event reminders. Reads users/{uid}.savedEvents + fcmTokens.
 * Not a Firestore listener — the 5-minute scheduler calls this.
 */
export async function dispatchSavedEventReminders(opts: { db: Firestore }): Promise<void> {
  if (isQuietHours()) return;

  const usersSnap = await opts.db.collection('users').limit(500).get();
  let sent = 0;

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const tokens = Array.isArray(data.fcmTokens)
      ? (data.fcmTokens as string[]).filter((t) => typeof t === 'string' && t.length > 8)
      : [];
    if (tokens.length === 0) continue;

    const prefs = parsePrefs(data.notificationPrefs);
    if (!prefs['saved-events']) continue;

    const events = Array.isArray(data.savedEvents) ? (data.savedEvents as SavedEventRow[]) : [];
    if (events.length === 0) continue;

    const stateRef = opts.db.doc(`users/${userDoc.id}/notificationState/reminders`);
    const stateSnap = await stateRef.get();
    const sentMap = { ...((stateSnap.data()?.sent as Record<string, string> | undefined) ?? {}) };
    const now = Date.now();
    let changed = false;

    for (const e of events) {
      const start = Date.parse(e.realStartAt || e.startsAt || '');
      const end = Date.parse(e.estimatedFinishAt || e.endsAt || '');
      const venue = e.venue?.trim() || 'the venue';

      const trySend = async (key: string, at: number, title: string, body: string) => {
        if (!Number.isFinite(at) || sentMap[key]) return;
        if (now < at || now > at + REMINDER_WINDOW_MS) return;
        await sendPushToTokens(tokens, {
          title,
          body,
          data: { kind: key.endsWith('end') ? 'saved-event-end' : 'saved-event', eventId: e.id },
        });
        sentMap[key] = new Date().toISOString();
        changed = true;
        sent += 1;
      };

      if (Number.isFinite(start)) {
        await trySend(
          `${e.id}:preStart`,
          start - PRE_START_MS,
          `${e.title} starts in 1 hour`,
          venue !== 'the venue'
            ? `Time to head to ${venue}. Tap for the fastest route with live traffic.`
            : 'Time to head out. Tap for the fastest route with live traffic.',
        );
      }
      if (Number.isFinite(end)) {
        await trySend(
          `${e.id}:preEnd`,
          end - PRE_END_MS,
          `${e.title} is about to end`,
          `Wrapping up in about 25 minutes. Expect traffic around ${venue} as crowds leave.`,
        );
      }
    }

    if (changed) {
      await stateRef.set({ sent: sentMap, updatedAt: new Date().toISOString() }, { merge: true });
    }
  }

  logger.info('dispatch.event_reminders', { sent });
}

export function parseLineStatuses(rows: unknown[]): LineStatus[] {
  return rows
    .map((row) => {
      const l = row as {
        id?: string;
        name?: string;
        lineStatuses?: Array<{
          statusSeverity?: number;
          statusSeverityDescription?: string;
        }>;
      };
      const worst = (l.lineStatuses ?? []).sort(
        (a, b) => (a.statusSeverity ?? 99) - (b.statusSeverity ?? 99),
      )[0];
      const sev = worst?.statusSeverity ?? 10;
      const bucket =
        sev <= 4 ? 'closed' : sev <= 6 ? 'severe' : sev <= 8 ? 'minor' : 'good';
      return {
        id: String(l.id ?? l.name ?? ''),
        name: String(l.name ?? 'Line'),
        severityBucket: bucket,
        statusDescription: String(worst?.statusSeverityDescription ?? 'Good Service'),
      };
    })
    .filter((l) => l.id);
}

export async function loadFlightsByAirport(db: Firestore): Promise<Record<string, CachedFlight[]>> {
  const out: Record<string, CachedFlight[]> = {};
  const snaps = await db.collection('airportCache').limit(10).get();
  for (const doc of snaps.docs) {
    const airportId = String(doc.data().airportId ?? '');
    const flights = doc.data().flights;
    if (airportId && Array.isArray(flights)) {
      out[airportId] = flights as CachedFlight[];
    }
  }
  return out;
}
