/**
 * Register the device FCM/APNs token on users/{uid}.fcmTokens so the
 * backend can send push while the app is closed.
 */
import { AppState, Platform } from 'react-native';

import { auth, db, fsApi } from './firebase';

let registeredToken: string | null = null;
let registeredUid: string | null = null;
let appStateBound = false;

function getNotificationsModule(): typeof import('expo-notifications') | null {
  try {
    return require('expo-notifications') as typeof import('expo-notifications');
  } catch {
    return null;
  }
}

export async function registerPushToken(): Promise<boolean> {
  const uid = auth?.currentUser?.uid;
  if (!uid || auth.currentUser?.isAnonymous || !db || !fsApi) return false;

  const N = getNotificationsModule();
  if (!N) return false;

  try {
    const perm = await N.getPermissionsAsync();
    if (perm.status !== 'granted') return false;

    const tokenResult = await N.getDevicePushTokenAsync();
    const token =
      typeof tokenResult?.data === 'string' ? tokenResult.data.trim() : '';
    if (!token) return false;
    if (token === registeredToken && uid === registeredUid) return true;

    const userRef = fsApi.doc(db, 'users', uid);
    const snap = await fsApi.getDoc(userRef);
    const existing = snap.exists()
      ? ((snap.data()?.fcmTokens as string[] | undefined) ?? [])
      : [];
    const next = [...new Set([token, ...existing.filter((t) => t !== token)])].slice(
      0,
      5,
    );

    await fsApi.setDoc(
      userRef,
      {
        fcmTokens: next,
        pushPlatform: Platform.OS,
        pushUpdatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    registeredToken = token;
    registeredUid = uid;
    console.log('[push] token saved on users/' + uid);
    return true;
  } catch (e) {
    console.warn('[push] token registration failed', e);
    return false;
  }
}

export async function clearPushTokenOnLogout(): Promise<void> {
  const uid = registeredUid ?? auth?.currentUser?.uid;
  const token = registeredToken;
  registeredToken = null;
  registeredUid = null;
  if (!uid || !token || !db || !fsApi) return;
  try {
    const userRef = fsApi.doc(db, 'users', uid);
    const snap = await fsApi.getDoc(userRef);
    const existing = snap.exists()
      ? ((snap.data()?.fcmTokens as string[] | undefined) ?? [])
      : [];
    await fsApi.setDoc(
      userRef,
      {
        fcmTokens: existing.filter((t) => t !== token),
        pushUpdatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch {
    /* best-effort */
  }
}

/** Re-save the token when the app comes back — iOS can rotate it. */
export function startPushTokenRefresh(): void {
  if (appStateBound) return;
  appStateBound = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void registerPushToken();
  });
}
