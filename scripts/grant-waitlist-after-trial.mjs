#!/usr/bin/env node
/**
 * One-off: waitlisters who started a store free trial before claiming their
 * waitlist week get the week added after the trial (trial end + 7 days).
 * Uses the same claim logic as the app (functions/lib/waitlistClaim.js), so
 * a code is only ever used once and claimed weeks are left alone.
 *
 *   cd functions && npm run build
 *   npm run waitlist:after-trial            # dry run
 *   npm run waitlist:after-trial -- --apply
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { handleClaimWaitlistPremium, waitlistGrantStartMs } = require(resolve(ROOT, 'functions/lib/waitlistClaim.js'));

const apply = process.argv.includes('--apply');
initializeApp({ projectId: 'driveiq-app', credential: applicationDefault() });
const db = getFirestore();
const auth = getAuth();
const mask = (e) => e.replace(/^(.{2}).*(@.*)$/, '$1…$2');
const fmt = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const now = Date.now();
const users = await db.collection('users').get();
const rows = [];
let paidWaitlisters = 0;
for (const doc of users.docs) {
  const u = doc.data();
  let email = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
  if (!email) email = (await auth.getUser(doc.id).catch(() => null))?.email?.toLowerCase() ?? '';
  if (!email) continue;
  const map = await db.doc(`waitlist/${email}`).get();
  if (!map.exists) continue;
  const token = String(map.data()?.claimToken ?? '');
  const t = token ? (await db.doc(`waitlistTokens/${token}`).get()).data() : null;
  if (!t || t.claimedByUid || u.waitlistToken) continue; // already claimed
  const start = waitlistGrantStartMs(u, now);
  if (start <= now) {
    if (u.premiumStatus === 'active') paidWaitlisters += 1;
    continue; // not in a running trial: claims normally from the app
  }
  rows.push({ uid: doc.id, email, trialEnd: new Date(start).toISOString() });
}

console.log(`${rows.length} waitlister(s) in a store trial without their waitlist week:`);
for (const r of rows) {
  const until = new Date(Date.parse(r.trialEnd) + 7 * 86400000).toISOString();
  console.log(`  ${mask(r.email).padEnd(28)} trial ends ${fmt(r.trialEnd)}  → Premium until ${fmt(until)}`);
}
if (paidWaitlisters) console.log(`(${paidWaitlisters} waitlister(s) already past their trial and paying: not changed.)`);
if (!apply) { console.log('\nDry run: nothing written. Add --apply to grant.'); process.exit(0); }

let ok = 0;
for (const r of rows) {
  const res = await handleClaimWaitlistPremium({ db, uid: r.uid, waitlistEmail: r.email });
  console.log(`  ${mask(r.email).padEnd(28)} ${res.status}${res.premiumUntil ? ` until ${fmt(res.premiumUntil)}` : ''}`);
  if (res.status === 'granted') ok += 1;
}
console.log(`\nGranted ${ok}/${rows.length}.`);
