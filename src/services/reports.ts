import { colors } from '@/theme/colors';
import { auth, db, fsApi } from './firebase';
import { getJSON, setJSON } from './storage';

/**
 * Community reports — shared pins for hazards, police, closures, etc.
 * Live list comes from Firestore; submit/confirm go through Cloud Functions
 * so every driver can get a push.
 */

export type ReportCategory =
  | 'hazard'
  | 'accident'
  | 'roadworks'
  | 'police'
  | 'closure'
  | 'event'
  | 'other';

export interface UserReport {
  id: string;
  category: ReportCategory;
  note?: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  createdBy?: string;
  placeLabel?: string;
  confirmCount: number;
  confirmedByMe?: boolean;
  expiresAt?: string;
}

export interface ReportMeta {
  label: string;
  icon: string;
  color: string;
  ttlHours: number;
}

export const REPORT_META: Record<ReportCategory, ReportMeta> = {
  hazard: { label: 'Hazard', icon: 'warning', color: '#E8A317', ttlHours: 6 },
  accident: { label: 'Accident', icon: 'car-sport', color: '#DC2626', ttlHours: 6 },
  roadworks: { label: 'Roadworks', icon: 'construct', color: '#F97316', ttlHours: 24 },
  police: { label: 'Police', icon: 'shield', color: '#2563EB', ttlHours: 4 },
  closure: { label: 'Road closed', icon: 'remove-circle', color: '#B91C1C', ttlHours: 12 },
  event: { label: 'Event', icon: 'sparkles', color: colors.primary, ttlHours: 48 },
  other: { label: 'Other', icon: 'flag', color: colors.textSecondary, ttlHours: 6 },
};

export const REPORT_ORDER: ReportCategory[] = [
  'hazard',
  'accident',
  'roadworks',
  'closure',
  'police',
  'event',
  'other',
];

const STORAGE_KEY = 'driveiq.reports.v2';
const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app';
const SUBMIT_URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/submitCommunityReportHttp`;
const CONFIRM_URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/confirmCommunityReportHttp`;

function prune(reports: UserReport[]): UserReport[] {
  const now = Date.now();
  return reports.filter((r) => {
    if (r.expiresAt) {
      const t = Date.parse(r.expiresAt);
      return Number.isFinite(t) && t > now;
    }
    const ttl = (REPORT_META[r.category]?.ttlHours ?? 6) * 60 * 60 * 1000;
    const age = now - Date.parse(r.createdAt);
    return Number.isFinite(age) && age < ttl;
  });
}

function fromDoc(id: string, data: Record<string, unknown>, uid: string | null): UserReport {
  const confirms =
    data.confirms && typeof data.confirms === 'object'
      ? (data.confirms as Record<string, unknown>)
      : {};
  const category = (
    typeof data.category === 'string' && data.category in REPORT_META
      ? data.category
      : 'other'
  ) as ReportCategory;
  return {
    id,
    category,
    note: typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined,
    latitude: Number(data.latitude),
    longitude: Number(data.longitude),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    placeLabel:
      typeof data.placeLabel === 'string' && data.placeLabel.trim()
        ? data.placeLabel.trim()
        : undefined,
    confirmCount: Number(data.confirmCount) || Object.keys(confirms).length,
    confirmedByMe: uid ? confirms[uid] === true : false,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
  };
}

export async function loadReports(): Promise<UserReport[]> {
  const all = await getJSON<UserReport[]>(STORAGE_KEY, []);
  return prune(all);
}

export async function reverseGeocodeLabel(
  latitude: number,
  longitude: number,
): Promise<string | undefined> {
  try {
    const Location = require('expo-location') as typeof import('expo-location');
    const rows = await Location.reverseGeocodeAsync({ latitude, longitude });
    const p = rows[0];
    if (!p) return undefined;
    const bits = [p.name, p.street, p.district, p.city, p.subregion]
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean);
    const unique: string[] = [];
    for (const b of bits) {
      if (!unique.some((u) => u.toLowerCase() === b.toLowerCase())) unique.push(b);
    }
    return unique.slice(0, 2).join(', ') || undefined;
  } catch {
    return undefined;
  }
}

async function authedPost<T>(
  url: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const currentUser = auth?.currentUser;
  if (!currentUser) throw new Error('Sign in to report what you see.');
  const post = async (forceRefresh: boolean): Promise<T> => {
    const token = await currentUser.getIdToken(forceRefresh);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: payload }),
    });
    const raw = await res.text();
    let json: { result?: T; error?: { message?: string } } | null = null;
    try {
      json = raw ? (JSON.parse(raw) as { result?: T; error?: { message?: string } }) : null;
    } catch {
      throw new Error(`Could not reach reports. Try again.`);
    }
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || 'Could not save that report.');
    }
    if (!json?.result) throw new Error('Could not save that report.');
    return json.result;
  };
  try {
    return await post(false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes('sign in')) return post(true);
    throw e;
  }
}

export async function addReport(
  input: Omit<UserReport, 'id' | 'createdAt' | 'confirmCount'>,
): Promise<UserReport[]> {
  const placeLabel =
    input.placeLabel ?? (await reverseGeocodeLabel(input.latitude, input.longitude));
  try {
    const result = await authedPost<{ ok: true; report: Record<string, unknown> & { id: string } }>(
      SUBMIT_URL,
      {
        category: input.category,
        note: input.note ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        placeLabel: placeLabel ?? null,
      },
    );
    const uid = auth?.currentUser?.uid ?? null;
    const report = fromDoc(result.report.id, result.report, uid);
    const current = await loadReports();
    const next = prune([report, ...current.filter((r) => r.id !== report.id)]);
    await setJSON(STORAGE_KEY, next);
    return next;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes('sign in')) throw e;
    console.warn('[reports] submit failed, saving locally', e);
    const report: UserReport = {
      ...input,
      placeLabel,
      id: `report-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      createdAt: new Date().toISOString(),
      createdBy: auth?.currentUser?.uid,
      confirmCount: 0,
    };
    const current = await loadReports();
    const next = [report, ...current];
    await setJSON(STORAGE_KEY, next);
    return next;
  }
}

export async function confirmReport(id: string): Promise<UserReport[]> {
  const result = await authedPost<{ ok: true; confirmCount: number; already: boolean }>(
    CONFIRM_URL,
    { reportId: id },
  );
  const current = await loadReports();
  const next = current.map((r) =>
    r.id === id
      ? { ...r, confirmCount: result.confirmCount, confirmedByMe: true }
      : r,
  );
  await setJSON(STORAGE_KEY, next);
  return next;
}

export async function removeReport(id: string): Promise<UserReport[]> {
  const current = await loadReports();
  const next = current.filter((r) => r.id !== id);
  await setJSON(STORAGE_KEY, next);
  return next;
}

export function subscribeReports(onChange: (reports: UserReport[]) => void): () => void {
  if (!db || !fsApi) {
    void loadReports().then(onChange);
    return () => undefined;
  }
  try {
    const col = fsApi.collection(db, 'communityReports');
    return fsApi.onSnapshot(
      col,
      (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
        const uid = auth?.currentUser?.uid ?? null;
        const rows = prune(
          snap.docs
            .map((d) => fromDoc(d.id, d.data(), uid))
            .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude)),
        ).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        void setJSON(STORAGE_KEY, rows);
        onChange(rows);
      },
      (err: unknown) => {
        console.warn('[reports] snapshot failed', err);
        void loadReports().then(onChange);
      },
    );
  } catch (e) {
    console.warn('[reports] subscribe failed', e);
    void loadReports().then(onChange);
    return () => undefined;
  }
}
