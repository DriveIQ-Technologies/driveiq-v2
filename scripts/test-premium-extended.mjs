#!/usr/bin/env node
/**
 * Live check of the "premium extended" daily job against real data, without
 * emailing users: runs the job as if it were --at (default: the next 09:00
 * London run that is due for someone), sends one example to --to, marks nothing.
 *
 *   cd functions && npm run build
 *   BREVO_API_KEY=… BREVO_SENDER_EMAIL=… node ../scripts/test-premium-extended.mjs --to a@x,b@y [--at 2026-10-09T08:00:00Z]
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const to = (arg('--to') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!to.length) throw new Error('--to is required');

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { handlePremiumExtendedEmails } = require(resolve(ROOT, 'functions/lib/premiumExtendedEmail.js'));
initializeApp({ projectId: 'driveiq-app', credential: applicationDefault() });
const db = getFirestore();
const brevo = { apiKey: process.env.BREVO_API_KEY, senderEmail: process.env.BREVO_SENDER_EMAIL, senderName: process.env.BREVO_SENDER_NAME };

const fmt = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
// Daily runs at 09:00 London over the next 10 days: show who each would email.
const runs = [];
for (let d = 0; d <= 10; d += 1) {
  const day = new Date(Date.now() + d * 86400000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(day);
  const offset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' }).format(day).includes('+1') ? '+01:00' : '+00:00';
  const at = new Date(`${ymd}T09:00:00${offset}`);
  if (at.getTime() > Date.now()) runs.push(at);
}
const noSend = { ...brevo };
let firstDue = null;
for (const at of runs) {
  const r = await handlePremiumExtendedEmails({ db, brevo: noSend, now: () => at, redirectTo: to, testLimit: 0 });
  console.log(`run ${fmt(at)}: ${r.due} due`);
  if (r.due && !firstDue) firstDue = at;
}
const at = arg('--at') ? new Date(arg('--at')) : firstDue;
if (!at) { console.log('Nobody due in the next 10 days.'); process.exit(0); }
const r = await handlePremiumExtendedEmails({ db, brevo, now: () => at, redirectTo: to, testLimit: 1 });
console.log(`\nAs of ${fmt(at)}: ${r.due} due; sent ${r.sent} example(s) to ${to.join(', ')} (nothing marked as sent).`);
