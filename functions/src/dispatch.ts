/**
 * Server-side FCM dispatch when the app is closed.
 * Mirrors client diff rules in src/services/notifications.ts.
 */
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { isQuietHours } from './londonTime.js';
import { sendPushToTokens } from './push.js';
import type { CachedFlight } from './airports.js';
import type { TrafficIncident } from './corridors.js';

export interface NotificationPrefs {
  'road-accidents': boolean;
  'line-closures': boolean;
  'saved-events': boolean;
  'saved-flights': boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  'road-accidents': true,
  'line-closures': true,
  'saved-events': true,
  'saved-flights': true,
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
}

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
  return typeof line === 'string' && line.trim() ? line.trim() : fallback;
}

export async function dispatchPushNotifications(opts: {
  db: Firestore;
  incidents: TrafficIncident[];
  lines: LineStatus[];
  flightsByAirport: Record<string, CachedFlight[]>;
}): Promise<void> {
  if (isQuietHours()) {
    logger.info('dispatch.quiet_hours');
    return;
  }

  const usersSnap = await opts.db.collection('users').limit(500).get();
  const userDocs = usersSnap.docs.filter((d) => {
    const tokens = d.data().fcmTokens;
    return Array.isArray(tokens) && tokens.some((t) => typeof t === 'string' && t.length > 8);
  });

  if (userDocs.length === 0) {
    logger.info('dispatch.no_tokens');
    return;
  }

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
    const prevFlights = (state.flights ?? {}) as Record<string, SavedFlight>;
    const isFirstRun =
      Object.keys(prevIncidents).length === 0 && Object.keys(prevLines).length === 0;

    const payloads: Array<{ title: string; body: string; data: Record<string, string> }> = [];

    if (prefs['road-accidents']) {
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
          data: { kind: 'road-accident', incidentId: inc.id },
        });
      }
    }

    if (prefs['line-closures']) {
      for (const l of opts.lines) {
        const before = prevLines[l.id];
        const after = l.severityBucket;
        if (before === after) continue;
        const escalated =
          (after === 'closed' && before !== 'closed') ||
          (after === 'severe' && before !== 'severe' && before !== 'closed');
        if (!escalated) continue;
        if (isFirstRun) continue;
        if (!isLineSubscribed(l.id, lineSubs)) continue;
        const title =
          after === 'closed' ? `${l.name} is down. Take a look` : `${l.name}: ${l.statusDescription}`;
        const body = await loadCopyLine(
          opts.db,
          'rail',
          `tfl-rail-${l.id}`,
          l.statusDescription,
        );
        payloads.push({
          title,
          body,
          data: { kind: 'line-closure', lineId: l.id },
        });
      }
    }

    if (prefs['saved-flights'] && watched.length > 0) {
      const liveById: Record<string, CachedFlight> = {};
      for (const flights of Object.values(opts.flightsByAirport)) {
        for (const f of flights) liveById[f.id] = f;
      }
      for (const prev of watched) {
        const next = liveById[prev.id];
        if (!next) continue;
        const before = prevFlights[prev.id] ?? prev;
        const becameCancelled = !before.cancelled && next.cancelled;
        const becameDelayed = !before.delayed && next.delayed;
        const delayWorse =
          before.delayed &&
          next.delayed &&
          (next.delayMinutes ?? 0) >= (before.delayMinutes ?? 0) + 15;
        if (!becameCancelled && !becameDelayed && !delayWorse) continue;
        const title = becameCancelled
          ? `${next.flightNumber} cancelled`
          : `${next.flightNumber} delayed`;
        const body = await loadCopyLine(
          opts.db,
          'flight',
          `flight-${next.id}`,
          becameCancelled
            ? `${next.flightNumber} to/from ${next.counterpart} is cancelled.`
            : `${next.flightNumber} is now delayed${next.delayMinutes ? ` by ${next.delayMinutes}m` : ''}.`,
        );
        payloads.push({
          title,
          body,
          data: { kind: 'saved-flight', flightId: next.id },
        });
      }
    }

    for (const p of payloads.slice(0, 5)) {
      await sendPushToTokens(tokens, p);
    }

    const nextIncidents: Record<string, IncidentSnapshot> = {};
    for (const inc of opts.incidents) nextIncidents[inc.id] = incidentFingerprint(inc);
    const nextLines: Record<string, string> = {};
    for (const l of opts.lines) nextLines[l.id] = l.severityBucket;
    const nextFlights: Record<string, SavedFlight> = { ...prevFlights };
    if (prefs['saved-flights']) {
      const liveById: Record<string, CachedFlight> = {};
      for (const flights of Object.values(opts.flightsByAirport)) {
        for (const f of flights) liveById[f.id] = f;
      }
      for (const w of watched) {
        const live = liveById[w.id];
        if (live) {
          nextFlights[w.id] = {
            id: live.id,
            airportId: w.airportId,
            flightNumber: live.flightNumber,
            cancelled: live.cancelled,
            delayed: live.delayed,
            delayMinutes: live.delayMinutes,
          };
        }
      }
    }

    await stateRef.set(
      {
        incidents: nextIncidents,
        lines: nextLines,
        flights: nextFlights,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  logger.info('dispatch.done', { users: userDocs.length });
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
