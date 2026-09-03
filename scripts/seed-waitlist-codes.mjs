#!/usr/bin/env node
/**
 * DriveIQ waitlist bulk seeding — generate codes, write Firestore, export CSV for Brevo.
 *
 * One-time setup (pick one):
 *   A) Save Firebase service account JSON to functions/serviceAccountKey.json (gitignored)
 *   B) export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
 *   C) gcloud auth application-default login --project driveiq-app
 *
 * Bulk launch (300+ emails):
 *   cd functions
 *   npm run waitlist:bulk -- --file ../waitlist-emails.txt --out ../waitlist-brevo.csv
 *
 * Commands:
 *   bulk      Generate codes + seed Firestore + write Brevo CSV (recommended)
 *   self-test Run local validation (350 emails) + optional Firestore auth check
 *   auth      Test Firestore credentials only
 *   generate  Codes only (no Firestore)
 *   seed      Seed existing email,code CSV
 *   verify    Audit all waitlistTokens in Firestore
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  generateCodesForEmails,
  isValidClaimToken,
  normalizeClaimToken,
  normalizeEmail,
} from './waitlist-codes.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_KEY_PATHS = [
  resolve(ROOT, 'functions/serviceAccountKey.json'),
  resolve(ROOT, 'serviceAccountKey.json'),
];

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'driveiq-app';
const TOKEN_WINDOW_DAYS = Number(process.env.WAITLIST_TOKEN_DAYS ?? 14);
const PREMIUM_DAYS = Number(process.env.WAITLIST_PREMIUM_DAYS ?? 7);
/** Firestore batch max 500 ops; 2 writes per email → 200 emails per batch (safe margin). */
const EMAILS_PER_BATCH = 200;

function usage() {
  console.log(`DriveIQ waitlist codes (project: ${PROJECT_ID})

  bulk       --file emails.txt [--out brevo.csv] [--key key.json] [--dry-run]
  self-test  [--count 350] [--key key.json] [--skip-auth]
  auth       [--key key.json]
  generate [emails...] [--file emails.txt] [--out codes.csv]
  seed   [email:CODE ...] [--file codes.csv] [--key key.json]
  verify [--key key.json]

Examples:
  cd functions && npm run waitlist:bulk -- --file ../waitlist-emails.txt --out ../brevo.csv
  cd functions && npm run waitlist:auth
  cd functions && npm run waitlist:verify
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const cmd = args.shift() ?? 'help';
  const flags = {
    file: null,
    out: null,
    key: null,
    dryRun: false,
    skipAuth: false,
    count: Number(process.env.WAITLIST_SELF_TEST_COUNT ?? 350),
    expiresDays: TOKEN_WINDOW_DAYS,
  };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--file') flags.file = args[++i];
    else if (arg === '--out') flags.out = args[++i];
    else if (arg === '--key') flags.key = args[++i];
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--skip-auth') flags.skipAuth = true;
    else if (arg === '--count') flags.count = Number(args[++i]);
    else if (arg === '--expires-days') flags.expiresDays = Number(args[++i]);
    else positional.push(arg);
  }
  return { cmd, flags, positional };
}

function resolveKeyPath(flags) {
  const candidates = [
    flags.key,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.FIREBASE_SERVICE_ACCOUNT,
    ...DEFAULT_KEY_PATHS,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (existsSync(abs)) return abs;
  }
  return null;
}

function readEmails(flags, positional) {
  const emails = [];
  if (flags.file) {
    const filePath = resolve(flags.file);
    if (!existsSync(filePath)) {
      throw new Error(`Email file not found: ${filePath}\nCreate it with one email per line, or use waitlist-emails.example.txt as a template.`);
    }
    const text = readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const bit = trimmed.split(/[,;\t]/)[0]?.trim().replace(/^"|"$/g, '');
      if (bit && bit.includes('@')) emails.push(bit);
    }
  }
  for (const p of positional) {
    if (p.includes('@')) emails.push(p);
  }
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  return normalized;
}

function readSeedRows(flags, positional) {
  const rows = [];
  if (flags.file) {
    const text = readFileSync(resolve(flags.file), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.toLowerCase().startsWith('email')) continue;
      const parts = trimmed.split(/[,;\t:]/);
      const email = normalizeEmail(parts[0]?.replace(/^"|"$/g, '') ?? '');
      const claimToken = normalizeClaimToken(parts[1]?.replace(/^"|"$/g, '') ?? '');
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
  return ['EMAIL,CLAIM_CODE', ...rows.map((r) => `${r.email},${r.claimToken}`)].join('\n');
}

function parseCsvText(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.toLowerCase().startsWith('email')) continue;
    const parts = trimmed.split(',');
    const email = normalizeEmail(parts[0]?.replace(/^"|"$/g, '') ?? '');
    const claimToken = normalizeClaimToken(parts[1]?.replace(/^"|"$/g, '') ?? '');
    if (email && claimToken) rows.push({ email, claimToken });
  }
  return rows;
}

function tokenExpiresAt(days = TOKEN_WINDOW_DAYS) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function printCredentialHelp() {
  console.error(`
Could not authenticate to Firestore for project "${PROJECT_ID}".

ONE-TIME SETUP — pick the easiest option:

  Option A (recommended): Firebase service account key
    1. Firebase Console → Project settings → Service accounts
    2. "Generate new private key" → save the JSON file
    3. Move it to:  functions/serviceAccountKey.json
       (this path is gitignored — never commit the key)
    4. Re-run the command

  Option B: Environment variable
    export GOOGLE_APPLICATION_CREDENTIALS="/full/path/to/serviceAccountKey.json"

  Option C: gcloud (if installed)
    gcloud auth application-default login --project ${PROJECT_ID}

Then test:
  cd functions && npm run waitlist:auth
`);
}

async function getDb(flags = {}) {
  const admin = require('firebase-admin');
  if (admin.apps.length) return admin.firestore();

  const keyPath = resolveKeyPath(flags);
  try {
    if (keyPath) {
      const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: PROJECT_ID,
      });
      return admin.firestore();
    }
    admin.initializeApp({ projectId: PROJECT_ID });
    const db = admin.firestore();
    // Prove credentials work before bulk writes.
    await db.collection('waitlistTokens').limit(1).get();
    return db;
  } catch (e) {
    printCredentialHelp();
    const err = new Error(`Firestore auth failed: ${e?.message ?? e}`);
    err.credentialHelpShown = true;
    throw err;
  }
}

function validateRows(rows) {
  const emails = new Set();
  const tokens = new Set();
  for (const row of rows) {
    if (!isValidClaimToken(row.claimToken)) {
      throw new Error(`Invalid claim code for ${row.email}: ${row.claimToken}`);
    }
    if (emails.has(row.email)) {
      throw new Error(`Duplicate email in input: ${row.email}`);
    }
    if (tokens.has(row.claimToken)) {
      throw new Error(`Duplicate claim code generated: ${row.claimToken}`);
    }
    emails.add(row.email);
    tokens.add(row.claimToken);
  }
}

async function writeRowsToFirestore(db, rows, expiresDays) {
  const expiresAt = tokenExpiresAt(expiresDays);
  const now = new Date().toISOString();
  let written = 0;

  for (let i = 0; i < rows.length; i += EMAILS_PER_BATCH) {
    const chunk = rows.slice(i, i + EMAILS_PER_BATCH);
    const batch = db.batch();
    for (const { email, claimToken } of chunk) {
      batch.set(
        db.doc(`waitlistTokens/${claimToken}`),
        {
          email,
          active: true,
          premiumDays: PREMIUM_DAYS,
          maxUses: 1,
          usedCount: 0,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      batch.set(
        db.doc(`waitlist/${email}`),
        { claimToken, email, updatedAt: now },
        { merge: true },
      );
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  ✓ Batch ${Math.floor(i / EMAILS_PER_BATCH) + 1}: ${chunk.length} emails (${written}/${rows.length})`);
  }
  return { written, expiresAt };
}

async function verifyRowsInFirestore(db, rows, { label = 'rows' } = {}) {
  let ok = 0;
  const failures = [];
  const chunkSize = 100;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const refs = chunk.flatMap(({ email, claimToken }) => [
      db.doc(`waitlistTokens/${claimToken}`),
      db.doc(`waitlist/${email}`),
    ]);
    const snaps = await db.getAll(...refs);
    for (let j = 0; j < chunk.length; j += 1) {
      const { email, claimToken } = chunk[j];
      const tokenSnap = snaps[j * 2];
      const waitlistSnap = snaps[j * 2 + 1];
      const tokenEmail = tokenSnap.exists ? tokenSnap.data()?.email : null;
      const waitlistToken = waitlistSnap.exists ? waitlistSnap.data()?.claimToken : null;
      if (tokenEmail === email && waitlistToken === claimToken) {
        ok += 1;
      } else {
        failures.push({ email, claimToken, tokenEmail, waitlistToken });
      }
    }
    if (rows.length > chunkSize) {
      console.log(`  ✓ Verified ${Math.min(i + chunkSize, rows.length)}/${rows.length} ${label}`);
    }
  }
  return { ok, failures };
}

async function cmdAuth(flags) {
  console.log(`Checking Firestore access for ${PROJECT_ID}...`);
  const keyPath = resolveKeyPath(flags);
  if (keyPath) console.log(`Using service account: ${keyPath}`);
  else console.log('Using application default credentials');
  const db = await getDb(flags);
  const snap = await db.collection('waitlistTokens').limit(1).get();
  console.log(`✓ Connected. waitlistTokens collection readable (${snap.size} doc sampled).`);
}

async function cmdGenerate(flags, positional) {
  const emails = readEmails(flags, positional);
  if (!emails.length) {
    console.error('No emails. Use --file waitlist-emails.txt or pass emails on the command line.');
    process.exit(1);
  }
  const rows = generateCodesForEmails(emails);
  validateRows(rows);
  const csv = toCsv(rows);
  const outPath = flags.out ? resolve(flags.out) : resolve(ROOT, 'waitlist-codes.csv');
  writeFileSync(outPath, `${csv}\n`, 'utf8');
  console.log(`Generated ${rows.length} unique codes → ${outPath}`);
  console.log('\nNext: seed to Firestore:');
  console.log(`  cd functions && npm run waitlist:seed -- --file ${outPath}`);
}

async function cmdSeed(flags, positional) {
  const rows = readSeedRows(flags, positional);
  if (!rows.length) {
    console.error('No rows. Use --file codes.csv or email:CODE');
    process.exit(1);
  }
  validateRows(rows);
  if (flags.dryRun) {
    console.log(`[dry-run] Would seed ${rows.length} row(s).`);
    return;
  }
  const db = await getDb(flags);
  console.log(`Seeding ${rows.length} waitlist row(s) to ${PROJECT_ID}...`);
  const { written, expiresAt } = await writeRowsToFirestore(db, rows, flags.expiresDays);
  console.log(`\n✓ Seeded ${written} email(s). Token expiry: ${expiresAt}`);
  console.log('Verifying writes...');
  const { ok, failures } = await verifyRowsInFirestore(db, rows);
  if (failures.length) {
    console.error(`✗ Verification failed for ${failures.length} row(s):`, failures.slice(0, 5));
    process.exit(1);
  }
  console.log(`✓ Verified ${ok}/${rows.length} row(s) in Firestore.`);
}

async function cmdBulk(flags, positional) {
  const emails = readEmails(flags, positional);
  if (!emails.length) {
    console.error('No emails. Use: npm run waitlist:bulk -- --file ../waitlist-emails.txt');
    process.exit(1);
  }
  const rows = generateCodesForEmails(emails);
  validateRows(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = flags.out
    ? resolve(flags.out)
    : resolve(ROOT, `waitlist-brevo-${stamp}.csv`);
  writeFileSync(outPath, `${toCsv(rows)}\n`, 'utf8');
  console.log(`Generated ${rows.length} codes → ${outPath}`);

  if (flags.dryRun) {
    console.log('[dry-run] Skipping Firestore writes.');
    return;
  }

  const db = await getDb(flags);
  console.log(`\nSeeding ${rows.length} email(s) to ${PROJECT_ID}...`);
  const { written, expiresAt } = await writeRowsToFirestore(db, rows, flags.expiresDays);
  console.log(`\n✓ Seeded ${written} email(s). Token expiry: ${expiresAt}`);
  console.log('Verifying all seeded rows in Firestore...');
  const { ok, failures } = await verifyRowsInFirestore(db, rows, { label: 'emails' });
  if (failures.length) {
    console.error(`✗ Verification failed for ${failures.length} row(s):`, failures.slice(0, 5));
    process.exit(1);
  }
  console.log(`✓ Verified ${ok}/${rows.length} email(s) in Firestore.`);
  console.log(`\nImport ${outPath} into Brevo as EMAIL + CLAIM_CODE attributes.`);
}

async function cmdSelfTest(flags) {
  const count = Number.isFinite(flags.count) && flags.count > 0 ? flags.count : 350;
  console.log(`Self-test: ${count} emails (code generation + CSV round-trip)`);
  const emails = Array.from({ length: count }, (_, i) => `selftest-${i}@example.com`);
  const rows = generateCodesForEmails(emails);
  validateRows(rows);

  const csv = toCsv(rows);
  const parsed = parseCsvText(csv);
  if (parsed.length !== rows.length) {
    throw new Error(`CSV round-trip failed: expected ${rows.length} rows, got ${parsed.length}`);
  }
  for (let i = 0; i < rows.length; i += 1) {
    if (parsed[i].email !== rows[i].email || parsed[i].claimToken !== rows[i].claimToken) {
      throw new Error(`CSV round-trip mismatch at row ${i + 1}`);
    }
  }
  console.log(`✓ Generated ${rows.length} unique codes`);
  console.log(`✓ CSV round-trip OK (${rows.length} rows)`);

  if (flags.skipAuth) {
    console.log('✓ Self-test passed (Firestore auth skipped).');
    return;
  }

  const keyPath = resolveKeyPath(flags);
  if (!keyPath) {
    console.log('\n⚠ No service account key found — skipping live Firestore check.');
    console.log('  Place key at functions/serviceAccountKey.json then re-run without --skip-auth');
    console.log('✓ Self-test passed (local checks only).');
    return;
  }

  console.log(`\nChecking Firestore auth (${keyPath})...`);
  const db = await getDb(flags);
  await db.collection('waitlistTokens').limit(1).get();
  console.log('✓ Firestore credentials OK');
  console.log('✓ Self-test passed (local + Firestore auth).');
}

async function cmdVerify(flags) {
  const db = await getDb(flags);
  const snap = await db.collection('waitlistTokens').get();
  const byToken = new Map();
  let expired = 0;
  let invalid = 0;
  let inactive = 0;
  let claimed = 0;

  console.log(`Checking ${snap.size} waitlist token(s) in ${PROJECT_ID}...\n`);

  for (const doc of snap.docs) {
    const token = doc.id;
    const data = doc.data() ?? {};
    const email = data.email ?? '(none)';
    const active = data.active !== false;
    const expiresAt = data.expiresAt;
    const normalized = normalizeClaimToken(token);
    if (data.claimedByUid || (Number(data.usedCount) || 0) > 0) claimed += 1;
    if (!isValidClaimToken(normalized)) {
      invalid += 1;
      console.log(`✗ ${email} — invalid token id: ${token}`);
      continue;
    }
    if (!active) {
      inactive += 1;
      console.log(`⚠ ${email} — ${normalized} inactive`);
      continue;
    }
    if (typeof expiresAt === 'string' && Date.parse(expiresAt) <= Date.now()) {
      expired += 1;
      console.log(`⚠ ${email} — ${normalized} expired at ${expiresAt}`);
      continue;
    }
    if (byToken.has(normalized)) {
      console.log(`✗ DUPLICATE ${normalized} — ${email} and ${byToken.get(normalized)}`);
    } else {
      byToken.set(normalized, email);
    }
  }

  console.log(
    `\nSummary: ${byToken.size} valid active, ${claimed} claimed, ${expired} expired, ${inactive} inactive, ${invalid} invalid`,
  );
}

async function main() {
  const { cmd, flags, positional } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case 'bulk':
      await cmdBulk(flags, positional);
      break;
    case 'self-test':
      await cmdSelfTest(flags);
      break;
    case 'auth':
      await cmdAuth(flags);
      break;
    case 'generate':
      await cmdGenerate(flags, positional);
      break;
    case 'seed':
      await cmdSeed(flags, positional);
      break;
    case 'verify':
      await cmdVerify(flags);
      break;
    default:
      usage();
      process.exit(cmd === 'help' ? 0 : 1);
  }
}

main().catch((e) => {
  const msg = String(e?.message ?? e);
  const needsCreds =
    msg.includes('Could not load the default credentials') ||
    msg.includes('Firestore auth failed');
  if (needsCreds && !e?.credentialHelpShown) {
    printCredentialHelp();
  } else if (!needsCreds) {
    console.error(e);
  }
  process.exit(1);
});
