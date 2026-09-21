/**
 * Register this device's EXPO push token on users/{uid}.fcmTokens so the
 * backend can reach it while the app is closed.
 *
 * This used to store `getDevicePushTokenAsync()`, which on iOS is the raw APNs
 * device token. The backend sends through FCM, which rejects those outright —
 * so every road, rail, flight and community-report push silently failed, and
 * only local event reminders ever arrived. The backend now sends via the Expo
 * Push Service, so the device has to supply the matching `ExponentPushToken[…]`.
 *
 * The field name stays `fcmTokens` so no data migration is needed; the values
 * in it change shape. Legacy APNs values are pruned on the next registration
 * and ignored by the sender.
 */
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { auth, db, fsApi } from './firebase';

/** `ExponentPushToken[...]` / `ExpoPushToken[...]`. Anything else is stale. */
function isExpoPushToken(token: unknown): token is string {
  return (
    typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim())
  );
}

/**
 * EAS project id, required by getExpoPushTokenAsync in a bare/prebuilt app.
 * Without it the call throws and no token is ever registered.
 */
function easProjectId(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } })?.eas
    ?.projectId;
  const fromEas = (
    Constants as unknown as { easConfig?: { projectId?: string } }
  ).easConfig?.projectId;
  return fromExtra ?? fromEas;
}

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
  // `auth?.` above, then bare `auth.` — TS was right to complain. Same guard,
  // narrowed properly.
  if (!uid || auth?.currentUser?.isAnonymous || !db || !fsApi) return false;

  const N = getNotificationsModule();
  if (!N) return false;

  try {
    const perm = await N.getPermissionsAsync();
    if (perm.status !== 'granted') return false;

    const projectId = easProjectId();
    const tokenResult = await N.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token =
      typeof tokenResult?.data === 'string' ? tokenResult.data.trim() : '';
    if (!isExpoPushToken(token)) return false;
    if (token === registeredToken && uid === registeredUid) return true;

    const userRef = fsApi.doc(db, 'users', uid);
    const snap = await fsApi.getDoc(userRef);
    const existing = snap.exists()
      ? ((snap.data()?.fcmTokens as string[] | undefined) ?? [])
      : [];
    // Drop anything that isn't an Expo token: raw APNs values written by the
    // previous implementation are dead weight the sender would only reject.
    const next = [
      ...new Set([token, ...existing.filter((t) => t !== token && isExpoPushToken(t))]),
    ].slice(0, 5);

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
    return true;
  } catch (e) {
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
