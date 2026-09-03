import { describe, expect, it } from 'vitest';
import {
  generateClaimCode,
  generateCodesForEmails,
  isValidClaimToken,
  normalizeClaimToken,
  normalizeEmail,
} from '../scripts/waitlist-codes.mjs';

describe('waitlist-codes', () => {
  it('normalizes emails and tokens', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com');
    expect(normalizeClaimToken(' ab-12 cd ')).toBe('AB12CD');
  });

  it('generates unique codes for each email', () => {
    const emails = ['a@example.com', 'b@example.com', 'c@example.com'];
    const rows = generateCodesForEmails(emails);
    expect(rows).toHaveLength(3);
    const tokens = new Set(rows.map((r) => r.claimToken));
    expect(tokens.size).toBe(3);
    for (const row of rows) {
      expect(isValidClaimToken(row.claimToken)).toBe(true);
    }
  });

  it('generates 300 unique codes without collision', () => {
    const emails = Array.from({ length: 300 }, (_, i) => `user${i}@example.com`);
    const rows = generateCodesForEmails(emails);
    expect(rows).toHaveLength(300);
    expect(new Set(rows.map((r) => r.claimToken)).size).toBe(300);
  });

  it('produces readable alphanumeric codes', () => {
    const code = generateClaimCode(8);
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect(code).not.toMatch(/[01OI]/);
  });
});
