/**
 * Firebase bootstrap for DriveIQ — crash-proofed.
 *
 * The Firebase JS SDK is loaded with `require()` inside a try/catch rather
 * than a top-level `import`. Why: under some Metro/React-Native resolutions
 * the firebase ESM bundle can throw *while the module is being evaluated*,
 * which a try/catch around `initializeAuth` cannot catch — the app simply
 * crashes on launch. By requiring firebase lazily and trapping everything,
 * a Firebase problem degrades to "auth unavailable" instead of taking the
 * whole app down. The map must always open.
 *
 * `import type` below is erased at build time, so it gives us full typing
 * WITHOUT triggering the runtime module evaluation that a value-import would.
 *
 * Config values are public by design (Firebase web config is safe in the
 * client — access is gated by Auth + Security Rules). They're read from
 * EXPO_PUBLIC_FIREBASE_* when set, else fall back to the `driveiq-app`
 * project.
 */
import type { Auth } from 'firebase/auth';
import type * as FirebaseAuthModule from 'firebase/auth';

const firebaseConfig = {
  apiKey:
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY ??
    'AIzaSyC9pJGmUuNqkb_tF_F-cPV2YXXxm8D0luM',
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    'driveiq-app.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app',
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    'driveiq-app.firebasestorage.app',
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '327546397871',
  appId:
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID ??
    '1:327546397871:web:43d18eaf32d0eab2f3205a',
  measurementId:
    process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? 'G-773PM468TY',
};

/** The whole `firebase/auth` module surface, or null if Firebase failed. */
export type FirebaseAuthApi = typeof FirebaseAuthModule;

let _auth: Auth | null = null;
let _authApi: FirebaseAuthApi | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appMod = require('firebase/app') as typeof import('firebase/app');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const authMod = require('firebase/auth') as FirebaseAuthApi;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require('@react-native-async-storage/async-storage')
    .default;

  const app = appMod.getApps().length
    ? appMod.getApp()
    : appMod.initializeApp(firebaseConfig);

  const getRNPersistence = (
    authMod as unknown as {
      getReactNativePersistence?: (s: unknown) => unknown;
    }
  ).getReactNativePersistence;

  try {
    _auth = authMod.initializeAuth(app, {
      persistence: getRNPersistence
        ? (getRNPersistence(AsyncStorage) as never)
        : undefined,
    });
  } catch {
    // Already initialised (Fast Refresh) — reuse the existing instance.
    _auth = authMod.getAuth(app);
  }
  _authApi = authMod;
} catch (e) {
  console.warn('[firebase] initialisation failed — auth disabled', e);
  _auth = null;
  _authApi = null;
}

/** Firebase Auth instance, or null when Firebase is unavailable. */
export const auth = _auth;

/** The `firebase/auth` function surface, or null when unavailable. */
export const authApi = _authApi;
