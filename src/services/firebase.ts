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
import type { Firestore } from 'firebase/firestore';
import type * as FirebaseFirestoreModule from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type * as FirebaseFunctionsModule from 'firebase/functions';

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

/** The whole `firebase/firestore` module surface, or null if Firestore failed. */
export type FirebaseFirestoreApi = typeof FirebaseFirestoreModule;
/** The whole `firebase/functions` module surface, or null if Functions failed. */
export type FirebaseFunctionsApi = typeof FirebaseFunctionsModule;

let _auth: Auth | null = null;
let _authApi: FirebaseAuthApi | null = null;
let _db: Firestore | null = null;
let _fsApi: FirebaseFirestoreApi | null = null;
let _functions: Functions | null = null;
let _functionsApi: FirebaseFunctionsApi | null = null;

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

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsMod = require('firebase/firestore') as FirebaseFirestoreApi;
    _db = fsMod.getFirestore(app);
    _fsApi = fsMod;
  } catch (fsErr) {
    console.warn('[firebase] Firestore unavailable', fsErr);
    _db = null;
    _fsApi = null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fnMod = require('firebase/functions') as FirebaseFunctionsApi;
    _functions = fnMod.getFunctions(app, 'europe-west2');
    _functionsApi = fnMod;
  } catch (fnErr) {
    console.warn('[firebase] Functions unavailable', fnErr);
    _functions = null;
    _functionsApi = null;
  }
} catch (e) {
  console.warn('[firebase] initialisation failed — auth disabled', e);
  _auth = null;
  _authApi = null;
  _db = null;
  _fsApi = null;
  _functions = null;
  _functionsApi = null;
}

/** Firebase Auth instance, or null when Firebase is unavailable. */
export const auth = _auth;

/** The `firebase/auth` function surface, or null when Firebase is unavailable. */
export const authApi = _authApi;

/** Firestore instance, or null when Firebase is unavailable. */
export const db = _db;

/** The `firebase/firestore` function surface, or null when unavailable. */
export const fsApi = _fsApi;
/** Firebase Functions instance, or null when unavailable. */
export const functions = _functions;
/** The `firebase/functions` function surface, or null when unavailable. */
export const functionsApi = _functionsApi;
