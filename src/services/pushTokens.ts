/**
 * Register the device FCM token for server-side push when the app is closed.
 */
import { Platform } from 'react-native';

import { auth, db, fsApi } from './firebase';

let registeredToken: string | null = null;

function getNotificationsModule(): typeof import('expo-notifications') | null {
  try {
    return require('expo-notifications') as typeof import('expo-notifications');
  } catch {
    return null;
  }
}

export async function registerPushToken(): Promise<boolean> {
  const uid = auth?.currentUser?.uid;
  if (!uid || !db || !fsApi) return false;

  const N = getNotificationsModule();
  if (!N) return false;

  try {
    const perm = await N.getPermissionsAsync();
    if (perm.status !== 'granted') return false;

    const tokenResult = await N.getDevicePushTokenAsync();
    const token =
      typeof tokenResult?.data === 'string' ? tokenResult.data.trim() : '';
    if (!token || token === registeredToken) return Boolean(token);

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
    return true;
  } catch (e) {
    console.warn('[push] token registration failed', e);
    return false;
  }
}

export async function clearPushTokenOnLogout(): Promise<void> {
  registeredToken = null;
}
