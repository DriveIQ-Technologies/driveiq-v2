#!/usr/bin/env node
/**
 * Import a Brevo waitlist export (EMAIL,FIRSTNAME,...) into Firestore so every
 * listed email can claim its Premium week — safely, against what's already there.
 *
 * Per email:
 *   - claimed already        → left alone
 *   - valid unclaimed code   → left alone (the code people were sent keeps working)
 *   - expired unclaimed code → expiry pushed out (--days), same code
 *   - code exists, no email mapping → mapping added, same code
 *   - nothing                → new code + waitlist/{email} mapping
 *   - disabled code (active: false) → reported only, never re-enabled
 *
 * Dry run by default; --apply writes. Always writes a report CSV
 * (EMAIL,FIRSTNAME,CLAIM_CODE,ACTION) that can go back into Brevo.
 *
 *   cd functions
 *   npm run waitlist:import -- --file "../DRIVEIQ APP WAITLIST.csv"            # dry run
 *   npm run waitlist:import -- --file "../DRIVEIQ APP WAITLIST.csv" --apply
 *
 * Credentials: gcloud application-default login, or --key serviceAccount.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateClaimCode, normalizeClaimToken, normalizeEmail } from './waitlist-codes.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'driveiq-app';
const PREMIUM_DAYS = 7;
const EMAIL_RE = /^[^\s@.][^\s@]*@[^\s@]+\.[a-z]{2,}$/i;

function parseArgs(argv) {
  const flags = { file: null, apply: false, days: 30, key: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') flags.file = argv[++i];
    else if (a === '--apply') flags.apply = true;
    else if (a === '--days') flags.days = Number(argv[++i]);
    else if (a === '--key') flags.key = argv[++i];
    else if (a === '--out') flags.out = argv[++i];
  }
  if (!flags.file) throw new Error('Pass --file path/to/waitlist.csv');
  if (!Number.isFinite(flags.days) || flags.days < 1) throw new Error('--days must be a positive number');
  return flags;
}

/** Minimal CSV: header row, comma separated, optional double quotes. */
export function parseWaitlistCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = (lines.shift() ?? '').split(',').map((h) => h.trim().replace(/^"|"$/g, '').toUpperCase());
  const iEmail = header.indexOf('EMAIL');
  const iName = header.indexOf('FIRSTNAME');
  if (iEmail < 0) throw new Error('CSV has no EMAIL column');
  const rows = [];
  const invalid = [];
  const seen = new Set();
  for (const line of lines) {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const email = normalizeEmail(cells[iEmail]);
    const firstName = iName >= 0 ? (cells[iName] ?? '') : '';
    if (!EMAIL_RE.test(email) || email.includes('.@') || email.includes('..')) {
      invalid.push(email || line);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    rows.push({ email, firstName });
  }
  return { rows, invalid };
}

function getDb(flags) {
  const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const keyPath = flags.key ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential =
    keyPath && existsSync(resolve(keyPath))
      ? cert(JSON.parse(readFileSync(resolve(keyPath), 'utf8')))
      : applicationDefault();
  return getFirestore(initializeApp({ projectId: PROJECT_ID, credential }));
}

async function getAllChunked(db, refs, size = 100) {
  const out = [];
  for (let i = 0; i < refs.length; i += size) out.push(...(await db.getAll(...refs.slice(i, i + size))));
  return out;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const { rows, invalid } = parseWaitlistCsv(readFileSync(resolve(flags.file), 'utf8'));
  console.log(`${rows.length} valid emails in the file${invalid.length ? `, ${invalid.length} skipped as invalid: ${invalid.join(', ')}` : ''}.`);

  const db = getDb(flags);
  const now = new Date();
  const nowIso = now.toISOString();
  const newExpiry = new Date(now.getTime() + flags.days * 24 * 60 * 60 * 1000).toISOString();

  // What exists today.
  const mapSnaps = await getAllChunked(db, rows.map((r) => db.doc(`waitlist/${r.email}`)));
  for (let i = 0; i < rows.length; i += 1) {
    const s = mapSnaps[i];
    rows[i].mappedToken = s.exists ? normalizeClaimToken(s.data()?.claimToken ?? '') : '';
  }
  for (const r of rows.filter((x) => !x.mappedToken)) {
    const q = await db.collection('waitlistTokens').where('email', '==', r.email).limit(5).get();
    const best = q.docs.find((d) => d.data()?.claimedByUid) ?? q.docs[0];
    r.foundToken = best ? best.id : '';
  }
  const tokenIds = [...new Set(rows.map((r) => r.mappedToken || r.foundToken).filter(Boolean))];
  const tokenSnaps = tokenIds.length ? await getAllChunked(db, tokenIds.map((t) => db.doc(`waitlistTokens/${t}`))) : [];
  const tokens = new Map(tokenSnaps.map((s) => [s.id, s.exists ? s.data() : null]));

  // Decide.
  const taken = new Set(tokens.keys());
  for (const r of rows) {
    const id = r.mappedToken || r.foundToken;
    const t = id ? tokens.get(id) : null;
    if (!t) {
      let code;
      do code = generateClaimCode(); while (taken.has(code));
      taken.add(code);
      r.code = code;
      r.action = 'create';
      continue;
    }
    r.code = id;
    const used = Boolean(t.claimedByUid) || (Number(t.usedCount) || 0) >= Math.max(1, Number(t.maxUses) || 1);
    const expired = typeof t.expiresAt === 'string' && Date.parse(t.expiresAt) <= now.getTime();
    if (used) r.action = 'claimed';
    else if (t.active === false) r.action = 'disabled';
    else if (expired) r.action = 'extend';
    else r.action = 'ok';
    if (!r.mappedToken && r.action !== 'disabled') r.addMapping = true;
  }

  // Codes that only exist in a new, unwritten state must not collide with real ones.
  const fresh = rows.filter((r) => r.action === 'create');
  if (fresh.length) {
    const clash = await getAllChunked(db, fresh.map((r) => db.doc(`waitlistTokens/${r.code}`)));
    for (let i = 0; i < fresh.length; i += 1) {
      if (clash[i].exists) throw new Error(`Generated code ${fresh[i].code} already exists; re-run.`);
    }
  }

  const count = (a) => rows.filter((r) => r.action === a).length;
  const mappings = rows.filter((r) => r.addMapping).length;
  console.log(`
  already claimed (left alone)   ${count('claimed')}
  valid code (left alone)        ${count('ok')}
  expired code → extended        ${count('extend')}
  no code → created              ${count('create')}
  disabled (reported only)       ${count('disabled')}
  email mapping added            ${mappings}
  new / extended codes expire    ${newExpiry}`);

  const outPath = resolve(flags.out ?? resolve(ROOT, `waitlist-import-${nowIso.slice(0, 10)}.csv`));
  writeFileSync(
    outPath,
    ['EMAIL,FIRSTNAME,CLAIM_CODE,ACTION', ...rows.map((r) => `${r.email},${r.firstName.replace(/,/g, ' ')},${r.code},${r.action}`)].join('\n') + '\n',
  );
  console.log(`\nReport: ${outPath}`);

  if (!flags.apply) {
    console.log('\nDry run: nothing written. Add --apply to write.');
    return;
  }

  const writes = [];
  for (const r of rows) {
    if (r.action === 'create') {
      writes.push([`waitlistTokens/${r.code}`, {
        email: r.email, active: true, premiumDays: PREMIUM_DAYS, maxUses: 1, usedCount: 0,
        expiresAt: newExpiry, source: 'waitlist-csv-import', createdAt: nowIso, updatedAt: nowIso,
      }]);
      writes.push([`waitlist/${r.email}`, { claimToken: r.code, email: r.email, updatedAt: nowIso }]);
      continue;
    }
    if (r.action === 'extend') writes.push([`waitlistTokens/${r.code}`, { expiresAt: newExpiry, updatedAt: nowIso }]);
    if (r.addMapping) writes.push([`waitlist/${r.email}`, { claimToken: r.code, email: r.email, updatedAt: nowIso }]);
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [path, data] of writes.slice(i, i + 400)) batch.set(db.doc(path), data, { merge: true });
    await batch.commit();
  }
  console.log(`\nWrote ${writes.length} document update(s).`);

  // Read back: every email must now resolve to a claimable or claimed code.
  const after = await getAllChunked(db, rows.map((r) => db.doc(`waitlist/${r.email}`)));
  const codes = [...new Set(rows.map((r) => r.code))];
  const afterSnaps = await getAllChunked(db, codes.map((c) => db.doc(`waitlistTokens/${c}`)));
  const afterByCode = new Map(afterSnaps.map((s) => [s.id, s.exists ? s.data() : null]));
  const bad = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.action === 'disabled') continue;
    const mapped = after[i].exists ? normalizeClaimToken(after[i].data()?.claimToken ?? '') : '';
    const t = afterByCode.get(r.code);
    const claimable = t && (t.claimedByUid || (t.active !== false && Date.parse(t.expiresAt) > Date.now()));
    if (mapped !== r.code || t?.email !== r.email || !claimable) bad.push(r.email);
  }
  if (bad.length) {
    console.error(`✗ ${bad.length} email(s) still not claimable: ${bad.slice(0, 10).join(', ')}`);
    process.exit(1);
  }
  console.log(`✓ Verified: all ${rows.length - count('disabled')} emails resolve to a working code.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
