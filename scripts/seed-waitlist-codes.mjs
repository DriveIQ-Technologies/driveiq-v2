#!/usr/bin/env node
/**
 * Generate and seed waitlist claim codes for DriveIQ.
 *
 * Usage:
 *   # Generate codes for emails (prints CSV — paste into Firestore or use seed)
 *   node scripts/seed-waitlist-codes.mjs generate donniewaiswa.dev@gmail.com other@example.com
 *   node scripts/seed-waitlist-codes.mjs generate --file waitlist-emails.txt
 *
 *   # Write codes to Firestore (needs Firebase login or service account)
 *   node scripts/seed-waitlist-codes.mjs seed --file waitlist-codes.csv
 *   node scripts/seed-waitlist-codes.mjs seed donniewaiswa.dev@gmail.com:DRIVE7K2
 *
 *   # Check codes in Firestore (duplicates, missing tokens)
 *   node scripts/seed-waitlist-codes.mjs verify
 *
 * CSV format: email,claimToken
 * Firestore doc: waitlist/{email} field claimToken (uppercase)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  generateCodesForEmails,
  isValidClaimToken,
  normalizeClaimToken,
  normalizeEmail,
} from './waitlist-codes.mjs';

const require = createRequire(import.meta.url);
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'driveiq-app';

function usage() {
  console.log(`DriveIQ waitlist claim codes (project: ${PROJECT_ID})

  generate [emails...] [--file emails.txt] [--out codes.csv]
  seed [email:CODE ...] [--file codes.csv]
  verify

Examples:
  node scripts/seed-waitlist-codes.mjs generate donniewaiswa.dev@gmail.com
  node scripts/seed-waitlist-codes.mjs seed --file waitlist-codes.csv
  node scripts/seed-waitlist-codes.mjs verify
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const cmd = args.shift() ?? 'help';
  const flags = { file: null, out: null };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--file') {
      flags.file = args[++i];
    } else if (args[i] === '--out') {
      flags.out = args[++i];
    } else {
      positional.push(args[i]);
    }
  }
  return { cmd, flags, positional };
}

function readEmails(flags, positional) {
  const emails = [];
  if (flags.file) {
    const text = readFileSync(flags.file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const bit = line.split(/[,;\t]/)[0]?.trim();
      if (bit && bit.includes('@')) emails.push(bit);
    }
  }
  for (const p of positional) {
    if (p.includes('@')) emails.push(p);
  }
  return [...new Set(emails.map(normalizeEmail).filter(Boolean))];
}

function readSeedRows(flags, positional) {
  const rows = [];
  if (flags.file) {
    const text = readFileSync(flags.file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.toLowerCase().startsWith('email')) continue;
      const [emailRaw, tokenRaw] = trimmed.split(/[,;\t:]/);
      const email = normalizeEmail(emailRaw);
      const claimToken = normalizeClaimToken(tokenRaw);
      if (email && claimToken) rows.push({ email, claimToken });
    }
  }
  for (const p of positional) {
    const [emailRaw, tokenRaw] = p.split(':');
    const email = normalizeEmail(emailRaw);
    const claimToken = normalizeClaimToken(tokenRaw);
    if (email && claimToken) rows.push({ email, claimToken });
  }
  return rows;
}

function toCsv(rows) {
  return ['email,claimToken', ...rows.map((r) => `${r.email},${r.claimToken}`)].join('\n');
}

async function getDb() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin.firestore();
}

async function cmdGenerate(flags, positional) {
  const emails = readEmails(flags, positional);
  if (!emails.length) {
    console.error('No emails. Pass emails on the command line or use --file emails.txt');
    process.exit(1);
  }
  const rows = generateCodesForEmails(emails);
  const csv = toCsv(rows);
  if (flags.out) {
    writeFileSync(flags.out, `${csv}\n`, 'utf8');
    console.log(`Wrote ${rows.length} codes to ${flags.out}`);
  } else {
    console.log(csv);
  }
  console.log('\nNext: seed to Firestore with:');
  console.log(`  node scripts/seed-waitlist-codes.mjs seed --file ${flags.out ?? 'waitlist-codes.csv'}`);
}

async function cmdSeed(flags, positional) {
  const rows = readSeedRows(flags, positional);
  if (!rows.length) {
    console.error('No rows. Use email:CODE or --file codes.csv');
    process.exit(1);
  }
  for (const row of rows) {
    if (!isValidClaimToken(row.claimToken)) {
      console.error(`Invalid code for ${row.email}: ${row.claimToken}`);
      process.exit(1);
    }
  }
  const db = await getDb();
  const batch = db.batch();
  for (const { email, claimToken } of rows) {
    batch.set(
      db.doc(`waitlist/${email}`),
      {
        claimToken,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }
  await batch.commit();
  console.log(`Seeded ${rows.length} waitlist doc(s) in ${PROJECT_ID}.`);
  for (const { email, claimToken } of rows) {
    console.log(`  ${email} → ${claimToken}`);
  }
}

async function cmdVerify() {
  const db = await getDb();
  const snap = await db.collection('waitlist').get();
  const byToken = new Map();
  let missing = 0;
  let invalid = 0;

  console.log(`Checking ${snap.size} waitlist doc(s) in ${PROJECT_ID}...\n`);

  for (const doc of snap.docs) {
    const email = doc.id;
    const token = doc.data()?.claimToken;
    if (!token) {
      missing += 1;
      console.log(`⚠ ${email} — no claimToken (email-only claim still works)`);
      continue;
    }
    const normalized = normalizeClaimToken(token);
    if (!isValidClaimToken(normalized)) {
      invalid += 1;
      console.log(`✗ ${email} — invalid claimToken: ${token}`);
      continue;
    }
    if (byToken.has(normalized)) {
      console.log(`✗ DUPLICATE ${normalized} — ${email} and ${byToken.get(normalized)}`);
    } else {
      byToken.set(normalized, email);
      console.log(`✓ ${email} → ${normalized}`);
    }
  }

  console.log(`\nSummary: ${byToken.size} valid unique codes, ${missing} without code, ${invalid} invalid`);
  if (missing + invalid === 0 && byToken.size > 0) {
    console.log('All coded entries look good. Test in app: Claim waitlist week → Claim code.');
  }
}

async function main() {
  const { cmd, flags, positional } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case 'generate':
      await cmdGenerate(flags, positional);
      break;
    case 'seed':
      await cmdSeed(flags, positional);
      break;
    case 'verify':
      await cmdVerify();
      break;
    default:
      usage();
      process.exit(cmd === 'help' ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
