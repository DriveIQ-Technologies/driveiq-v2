/**
 * Grant dashboard access: create adminUsers/{email} (lowercase).
 * Usage: node scripts/grant-admin.mjs waiswa.dev@driveiq.app
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const email = String(process.argv[2] ?? '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Usage: node scripts/grant-admin.mjs you@driveiq.app');
  process.exit(1);
}

if (!getApps()[0]) {
  initializeApp({ credential: applicationDefault(), projectId: 'driveiq-app' });
}

await getFirestore().doc(`adminUsers/${email}`).set({
  role: 'admin',
  email,
  createdAt: new Date().toISOString(),
});
console.log(`granted ${email}`);
