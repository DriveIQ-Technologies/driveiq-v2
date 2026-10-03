'use client';

import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/** Same Firebase project as the app. These values are public by design. */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyC9pJGmUuNqkb_tF_F-cPV2YXXxm8D0luM',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'driveiq-app.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '1:327546397871:web:43d18eaf32d0eab2f3205a',
};

function app() {
  return getApps()[0] ?? initializeApp(config);
}

export function clientAuth() {
  return getAuth(app());
}

export function clientDb() {
  return getFirestore(app());
}
