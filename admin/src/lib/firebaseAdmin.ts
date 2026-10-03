import 'server-only';

import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import { parseServiceAccount } from './serviceAccount';

/**
 * Server-side Firebase. Credentials, in order:
 *  - FIREBASE_SERVICE_ACCOUNT: the service-account key (required on Vercel)
 *  - Application Default Credentials, for local runs:
 *    `gcloud auth application-default login`
 */
function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID ?? 'driveiq-app';
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw && process.env.VERCEL) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not set in this Vercel environment');
  }
  return initializeApp({
    projectId,
    credential: raw ? cert(parseServiceAccount(raw)) : applicationDefault(),
  });
}

export const adminDb = () => getFirestore(adminApp());
export const adminAuth = () => getAuth(adminApp());
