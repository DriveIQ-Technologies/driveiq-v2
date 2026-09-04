#!/usr/bin/env node
/**
 * Reset waitlist claims so deleted Auth accounts can re-claim.
 * Usage: node scripts/reset-waitlist-claim.mjs email1@x.com email2@x.com
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = resolve(ROOT, 'functions/serviceAccountKey.json');
if (!existsSync(keyPath)) {
  console.error('Missing functions/serviceAccountKey.json');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
  projectId: 'driveiq-app',
});
const db = admin.firestore();
const auth = admin.auth();
const FieldValue = admin.firestore.FieldValue;

const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
if (!emails.length) {
  console.error('Pass one or more emails');
  process.exit(1);
}

function log(...args) {
  console.log(...args);
}

async function resetEmail(email) {
  log('---', email);
  const waitlistRef = db.doc(`waitlist/${email}`);
  const waitlistSnap = await waitlistRef.get();
  const code = String(waitlistSnap.data()?.claimToken ?? '').trim().toUpperCase();
  log('waitlist claimToken:', code || '(none)');
  if (!code) return;

  const tokenRef = db.doc(`waitlistTokens/${code}`);
  const tokenSnap = await tokenRef.get();
  const token = tokenSnap.data() ?? {};
  log('before:', {
    claimedByUid: token.claimedByUid ?? null,
    usedCount: token.usedCount ?? 0,
    premiumUntil: token.premiumUntil ?? null,
  });

  const oldUid = token.claimedByUid;
  await tokenRef.set(
    {
      claimedByUid: FieldValue.delete(),
      claimedAt: FieldValue.delete(),
      premiumUntil: FieldValue.delete(),
      usedCount: 0,
      active: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  if (oldUid) {
    await db.doc(`users/${oldUid}`).set(
      {
        waitlistToken: FieldValue.delete(),
        waitlistClaimedAt: FieldValue.delete(),
        waitlistEmail: FieldValue.delete(),
        premiumUntil: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    await db.doc(`users/${oldUid}/entitlements/waitlist`).delete().catch(() => {});
    await db.doc(`waitlistClaims/${code}`).delete().catch(() => {});
  }

  try {
    const user = await auth.getUserByEmail(email);
    log('current auth uid:', user.uid);
    await db.doc(`users/${user.uid}`).set(
      {
        waitlistToken: FieldValue.delete(),
        waitlistClaimedAt: FieldValue.delete(),
        premiumUntil: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    await db.doc(`users/${user.uid}/entitlements/waitlist`).delete().catch(() => {});
  } catch (e) {
    log('no live auth user for this email:', e.code ?? e.message);
  }

  const after = await tokenRef.get();
  log('after:', {
    claimedByUid: after.data()?.claimedByUid ?? null,
    usedCount: after.data()?.usedCount ?? 0,
    email: after.data()?.email,
    active: after.data()?.active,
  });
}

for (const email of emails) {
  await resetEmail(email);
}
log('Done. New accounts using these emails can auto-claim again.');
process.exit(0);
