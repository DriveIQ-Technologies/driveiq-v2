/**
 * Record which phone platform and app version each account is on.
 *
 * Until this existed the platform only reached users/{uid} as `pushPlatform`,
 * written when a push token registered. Android never registers one (FCM is
 * not set up there yet), so Android users were invisible to the dashboard.
 * This is written for every signed-in account, independent of notifications:
 * on sign-in and on each app start with a restored session. Anonymous browse
 * sessions are skipped so they do not show up as users.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { auth, db, fsApi } from './firebase';

export interface UserDeviceFields {
  platform: string;
  appVersion: string | null;
  lastSeenAt: string;
}

export function userDeviceFields(now: Date = new Date()): UserDeviceFields {
  return {
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version ?? null,
    lastSeenAt: now.toISOString(),
  };
}

/** One write per account per app session is enough for "last seen". */
let recordedUid: string | null = null;
/** One install row per Firebase uid per session, including anonymous browse. */
let recordedInstallUid: string | null = null;
/** Last coarse cell written, so a moving map does not rewrite on every tick. */
let lastPlaceCell: string | null = null;

/** ~1 km. Precise coordinates never leave the phone. */
export function coarsePlace(lat: number, lng: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

async function writeInstall(extra: Record<string, unknown> = {}): Promise<void> {
  const user = auth?.currentUser;
  const uid = user?.uid;
  if (!uid || !db || !fsApi) return;
  const platform = Platform.OS;
  if (platform !== 'ios' && platform !== 'android') return;
  const ref = fsApi.doc(db, 'installs', uid);
  const snap = await fsApi.getDoc(ref);
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    platform,
    appVersion: Constants.expoConfig?.version ?? null,
    lastSeenAt: now,
    account: !user.isAnonymous,
    email: user.email ?? null,
    ...extra,
  };
  if (!snap.exists()) payload.firstSeenAt = now;
  await fsApi.setDoc(ref, payload, { merge: true });
}

/**
 * A download: every phone that opens the app, before or after an account.
 * Anonymous browse and a real signup share this row (same uid when the
 * anonymous session is upgraded in place).
 */
export async function recordInstall(): Promise<void> {
  const uid = auth?.currentUser?.uid;
  if (!uid || uid === recordedInstallUid) return;
  recordedInstallUid = uid;
  try {
    await writeInstall();
  } catch {
    recordedInstallUid = null;
  }
}

/**
 * Last place the app was opened, rounded to about a kilometre, plus a
 * neighbourhood name. Written on the install row (and the account, once
 * there is one) so the dashboard can show where people use DriveIQ.
 */
export async function recordUsagePlace(coord: { latitude: number; longitude: number }): Promise<void> {
  const user = auth?.currentUser;
  const uid = user?.uid;
  if (!uid || !db || !fsApi) return;
  const place = coarsePlace(coord.latitude, coord.longitude);
  if (!place) return;
  const cell = `${place.lat},${place.lng}`;
  if (cell === lastPlaceCell) return;
  lastPlaceCell = cell;
  try {
    let area: string | null = null;
    try {
      const { areaLabelFor } = await import('./deviceLocation');
      area = await areaLabelFor({ latitude: place.lat, longitude: place.lng });
    } catch {
      area = null;
    }
    const patch = {
      lat: place.lat,
      lng: place.lng,
      area,
      lastSeenAt: new Date().toISOString(),
    };
    await writeInstall(patch);
    if (!user.isAnonymous) {
      await fsApi.setDoc(fsApi.doc(db, 'users', uid), patch, { merge: true });
    }
  } catch {
    lastPlaceCell = null;
  }
}

/** Best-effort: never throws, never blocks sign-in. */
export async function recordUserDevice(): Promise<void> {
  const user = auth?.currentUser;
  const uid = user?.uid;
  if (!uid || user.isAnonymous || uid === recordedUid || !db || !fsApi) return;
  recordedUid = uid;
  try {
    await fsApi.setDoc(fsApi.doc(db, 'users', uid), userDeviceFields(), { merge: true });
  } catch {
    // Retried on the next sign-in or app start.
    recordedUid = null;
  }
}
