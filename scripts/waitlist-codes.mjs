/**
 * Waitlist claim code helpers — keep in sync with functions/src/waitlistClaim.ts
 */

/** Uppercase alphanumeric; strips spaces and hyphens. */
export function normalizeClaimToken(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

export function normalizeEmail(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Generate a readable 8-char code (e.g. DRIVE7K2). */
export function generateClaimCode(length = 8) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Generate unique codes for a list of emails (no duplicate tokens). */
export function generateCodesForEmails(emails, { length = 8 } = {}) {
  const used = new Set();
  const rows = [];
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    let code;
    do {
      code = generateClaimCode(length);
    } while (used.has(code));
    used.add(code);
    rows.push({ email, claimToken: code });
  }
  return rows;
}

export function isValidClaimToken(raw) {
  const token = normalizeClaimToken(raw);
  return token.length >= 6 && /^[A-Z0-9]+$/.test(token);
}
