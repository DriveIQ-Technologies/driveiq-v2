#!/usr/bin/env node
/**
 * Read-only: every account in a store free trial, checked against the
 * waitlist. Says who had their waitlist week added after the trial (the
 * "premium extended" email list), who claimed before the trial, and who is
 * a waitlister in a trial still waiting for the week.
 *
 *   cd functions && npm run waitlist:audit-trials [-- --out report.csv]
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp({ projectId: 'driveiq-app', credential: applicationDefault() });
const db = getFirestore();
const auth = getAuth();
const outIdx = process.argv.indexOf('--out');
const out = outIdx > 0 ? process.argv[outIdx + 1] : null;
const now = Date.now();
const mask = (e) => e.replace(/^(.{2}).*(@.*)$/, '$1…$2');
const day = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }).format(new Date(iso)) : '—');

const users = await db.collection('users').get();
const buckets = { extended: [], claimedFirst: [], waiting: [], notWaitlisted: 0, trialOverWaitlister: [] };
let trials = 0;
for (const doc of users.docs) {
  const u = doc.data();
  const status = String(u.premiumStatus ?? '');
  const trialEnd = typeof u.premiumTrialEndsAt === 'string' ? u.premiumTrialEndsAt : null;
  const inTrial = (status === 'trial' || status === 'cancelled') && trialEnd && Date.parse(trialEnd) > now;
  const authUser = await auth.getUser(doc.id).catch(() => null);
  const emails = [...new Set([u.email, authUser?.email, u.waitlistEmail].filter(Boolean).map((e) => String(e).trim().toLowerCase()))];
  let waitlistEmail = null;
  for (const e of emails) if ((await db.doc(`waitlist/${e}`).get()).exists) { waitlistEmail = e; break; }

  if (!inTrial) {
    if (waitlistEmail && status && !u.waitlistToken) buckets.trialOverWaitlister.push({ email: waitlistEmail, status });
    continue;
  }
  trials += 1;
  if (!waitlistEmail && !u.waitlistToken) { buckets.notWaitlisted += 1; continue; }
  const row = {
    uid: doc.id, email: authUser?.email ?? waitlistEmail, firstName: (authUser?.displayName ?? '').split(/\s+/)[0] ?? '',
    status, trialEnd, premiumUntil: u.premiumUntil ?? null, startsAt: u.waitlistStartsAt ?? null, claimedAt: u.waitlistClaimedAt ?? null,
  };
  if (!u.waitlistToken) buckets.waiting.push(row);
  else if (row.startsAt && Date.parse(row.startsAt) >= Date.parse(trialEnd) - 60_000) buckets.extended.push(row);
  else buckets.claimedFirst.push(row);
}

console.log(`Accounts in a running store trial: ${trials}`);
console.log(`  not on the waitlist                         ${buckets.notWaitlisted}`);
console.log(`  waitlisters, week claimed BEFORE the trial  ${buckets.claimedFirst.length}`);
console.log(`  waitlisters, week ADDED AFTER the trial     ${buckets.extended.length}   ← "premium extended" email`);
console.log(`  waitlisters in a trial, week not added yet  ${buckets.waiting.length}${buckets.waiting.length ? '   ← run waitlist:after-trial -- --apply' : ''}`);
if (buckets.trialOverWaitlister.length) console.log(`  (waitlisters past their trial, unclaimed: ${buckets.trialOverWaitlister.length})`);
console.log('\nEmail list:');
for (const r of buckets.extended) {
  console.log(`  ${mask(r.email).padEnd(28)} ${r.status.padEnd(9)} trial ends ${day(r.trialEnd).padEnd(7)} Premium until ${day(r.premiumUntil)}${r.firstName ? '' : '  (no first name)'}`);
}
if (out) {
  writeFileSync(out, ['UID,EMAIL,FIRSTNAME,STATUS,TRIAL_END,PREMIUM_UNTIL', ...buckets.extended.map((r) => [r.uid, r.email, r.firstName, r.status, r.trialEnd, r.premiumUntil].join(','))].join('\n') + '\n');
  console.log(`\nWrote ${out}`);
}
