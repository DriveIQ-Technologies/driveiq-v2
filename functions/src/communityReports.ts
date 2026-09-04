import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { isQuietHours } from './londonTime.js';
import { sendPushToTokens } from './push.js';

export const REPORT_CATEGORIES = [
  'hazard',
  'accident',
  'roadworks',
  'police',
  'closure',
  'event',
  'other',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

const TTL_HOURS: Record<ReportCategory, number> = {
  hazard: 6,
  accident: 6,
  roadworks: 24,
  police: 4,
  closure: 12,
  event: 48,
  other: 6,
};

const LABEL: Record<ReportCategory, string> = {
  hazard: 'a hazard',
  accident: 'an accident',
  roadworks: 'roadworks',
  police: 'police',
  closure: 'a road closure',
  event: 'an event',
  other: 'a problem',
};

const LONDON = {
  minLat: 51.25,
  maxLat: 51.72,
  minLng: -0.55,
  maxLng: 0.35,
};

export function inLondon(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= LONDON.minLat &&
    lat <= LONDON.maxLat &&
    lng >= LONDON.minLng &&
    lng <= LONDON.maxLng
  );
}

export function isReportCategory(v: unknown): v is ReportCategory {
  return typeof v === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(v);
}

export function reportPushCopy(opts: {
  category: ReportCategory;
  placeLabel?: string;
  note?: string;
}): { title: string; body: string } {
  const what = LABEL[opts.category];
  const place = opts.placeLabel?.trim();
  const title = place
    ? `Report of ${what} at ${place}`
    : `Report of ${what} — check the map`;
  const note = opts.note?.trim();
  const body = note
    ? `${note} Tap to open the map.`
    : 'Tap to open the map and see the exact spot.';
  return { title, body };
}

export interface CommunityReportDoc {
  category: ReportCategory;
  note: string | null;
  latitude: number;
  longitude: number;
  placeLabel: string | null;
  createdAt: string;
  createdBy: string;
  confirmCount: number;
  confirms: Record<string, true>;
  expiresAt: string;
}

function parsePrefs(raw: unknown): { communityReports: boolean } {
  if (!raw || typeof raw !== 'object') return { communityReports: true };
  const x = raw as Record<string, unknown>;
  return { communityReports: x['community-reports'] !== false };
}

export async function handleSubmitCommunityReport(opts: {
  db: Firestore;
  uid: string;
  category: unknown;
  note?: unknown;
  latitude: unknown;
  longitude: unknown;
  placeLabel?: unknown;
  nowMs?: number;
}): Promise<{ ok: true; report: CommunityReportDoc & { id: string } }> {
  if (!isReportCategory(opts.category)) {
    throw new Error('invalid_category');
  }
  const lat = typeof opts.latitude === 'number' ? opts.latitude : Number(opts.latitude);
  const lng = typeof opts.longitude === 'number' ? opts.longitude : Number(opts.longitude);
  if (!inLondon(lat, lng)) {
    throw new Error('outside_london');
  }
  const note =
    typeof opts.note === 'string' && opts.note.trim()
      ? opts.note.trim().slice(0, 140)
      : null;
  const placeLabel =
    typeof opts.placeLabel === 'string' && opts.placeLabel.trim()
      ? opts.placeLabel.trim().slice(0, 80)
      : null;

  const now = opts.nowMs ?? Date.now();
  const dayStart = now - 24 * 60 * 60 * 1000;
  const recent = await opts.db
    .collection('communityReports')
    .where('createdBy', '==', opts.uid)
    .limit(20)
    .get();
  const todayCount = recent.docs.filter((d) => {
    const created = Date.parse(String((d.data() as { createdAt?: unknown }).createdAt ?? ''));
    return Number.isFinite(created) && created >= dayStart;
  }).length;
  if (todayCount >= 8) {
    throw new Error('rate_limited');
  }

  const createdAt = new Date(now).toISOString();
  const ttlHours = TTL_HOURS[opts.category];
  const expiresAt = new Date(now + ttlHours * 60 * 60 * 1000).toISOString();
  const doc: CommunityReportDoc = {
    category: opts.category,
    note,
    latitude: lat,
    longitude: lng,
    placeLabel,
    createdAt,
    createdBy: opts.uid,
    confirmCount: 0,
    confirms: {},
    expiresAt,
  };
  const ref = await opts.db.collection('communityReports').add(doc);
  void broadcastReport({
    db: opts.db,
    reportId: ref.id,
    reporterUid: opts.uid,
    category: opts.category,
    placeLabel,
    note,
    latitude: lat,
    longitude: lng,
  }).catch((e) => {
    logger.warn('community_report.broadcast_fail', {
      error: e instanceof Error ? e.message : 'error',
      id: ref.id,
    });
  });
  return { ok: true, report: { id: ref.id, ...doc } };
}

export async function handleConfirmCommunityReport(opts: {
  db: Firestore;
  uid: string;
  reportId: unknown;
}): Promise<{ ok: true; confirmCount: number; already: boolean }> {
  const id = typeof opts.reportId === 'string' ? opts.reportId.trim() : '';
  if (!id) throw new Error('invalid_id');
  const ref = opts.db.doc(`communityReports/${id}`);
  return opts.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('not_found');
    const data = snap.data() as CommunityReportDoc;
    const expires = Date.parse(data.expiresAt);
    if (Number.isFinite(expires) && expires < Date.now()) throw new Error('expired');
    const confirms = { ...(data.confirms ?? {}) };
    if (confirms[opts.uid] || data.createdBy === opts.uid) {
      return {
        ok: true as const,
        confirmCount: Number(data.confirmCount) || Object.keys(confirms).length,
        already: true,
      };
    }
    confirms[opts.uid] = true;
    const confirmCount = Object.keys(confirms).length;
    tx.update(ref, { confirms, confirmCount, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true as const, confirmCount, already: false };
  });
}

async function broadcastReport(opts: {
  db: Firestore;
  reportId: string;
  reporterUid: string;
  category: ReportCategory;
  placeLabel: string | null;
  note: string | null;
  latitude: number;
  longitude: number;
}): Promise<void> {
  if (isQuietHours()) {
    logger.info('community_report.quiet_hours', { id: opts.reportId });
    return;
  }
  const copy = reportPushCopy({
    category: opts.category,
    placeLabel: opts.placeLabel ?? undefined,
    note: opts.note ?? undefined,
  });
  const usersSnap = await opts.db.collection('users').limit(500).get();
  const tokens: string[] = [];
  for (const userDoc of usersSnap.docs) {
    if (userDoc.id === opts.reporterUid) continue;
    const data = userDoc.data();
    const prefs = parsePrefs(data.notificationPrefs);
    if (!prefs.communityReports) continue;
    const raw = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
    for (const t of raw) {
      if (typeof t === 'string' && t.trim().length > 8) tokens.push(t.trim());
    }
  }
  const result = await sendPushToTokens(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      kind: 'community-report',
      reportId: opts.reportId,
      lat: String(opts.latitude),
      lng: String(opts.longitude),
      sentAtMs: String(Date.now()),
    },
  });
  logger.info('community_report.broadcast', {
    id: opts.reportId,
    sent: result.sent,
    failed: result.failed,
  });
}
