import { describe, expect, it } from 'vitest';

import {
  TOKEN_WINDOW_MS,
  WAITLIST_WEEK_MS,
  buildGrantEnds,
  evaluateExistingClaim,
  isPremiumUntilActive,
  normalizeClaimToken,
  normalizeEmail,
  userMessageForCodeRequest,
  userMessageForStatus,
} from './waitlistClaim.js';

describe('waitlistClaim helpers', () => {
  it('normalizes emails and claim tokens', () => {
    expect(normalizeEmail('  Zak@Example.COM ')).toBe('zak@example.com');
    expect(normalizeClaimToken(' ab-12 cd ')).toBe('AB12CD');
  });

  it('detects active premium windows', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isPremiumUntilActive(future)).toBe(true);
    expect(isPremiumUntilActive('2020-01-01T00:00:00.000Z')).toBe(false);
  });

  it('builds a seven-day grant', () => {
    const now = Date.parse('2026-08-30T12:00:00.000Z');
    expect(buildGrantEnds(now)).toBe(new Date(now + WAITLIST_WEEK_MS).toISOString());
  });

  it('supports custom premium window', () => {
    const now = Date.parse('2026-08-30T12:00:00.000Z');
    expect(buildGrantEnds(now, 3)).toBe(
      new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('returns already_active for same uid with active week', () => {
    const premiumUntil = new Date(Date.now() + 86_400_000).toISOString();
    const result = evaluateExistingClaim(
      { claimedByUid: 'uid-a', premiumUntil },
      'uid-a',
    );
    expect(result?.status).toBe('already_active');
    expect(result?.premiumUntil).toBe(premiumUntil);
  });

  it('blocks reclaim after week expired for same uid', () => {
    const result = evaluateExistingClaim(
      {
        claimedByUid: 'uid-a',
        premiumUntil: '2020-01-01T00:00:00.000Z',
      },
      'uid-a',
    );
    expect(result?.status).toBe('already_used');
    expect(result?.ok).toBe(false);
  });

  it('blocks a different uid when already claimed', () => {
    const premiumUntil = new Date(Date.now() + 86_400_000).toISOString();
    const result = evaluateExistingClaim(
      { claimedByUid: 'uid-a', premiumUntil },
      'uid-b',
    );
    expect(result?.status).toBe('already_claimed');
  });

  it('allows first claim when unclaimed', () => {
    expect(evaluateExistingClaim({}, 'uid-a')).toBeNull();
  });

  it('maps user-facing messages', () => {
    expect(userMessageForStatus('granted')).toMatch(/free waitlist week/i);
    expect(userMessageForStatus('invalid_token')).toMatch(/claim code/i);
    expect(userMessageForStatus('expired')).toMatch(/expired/i);
    expect(userMessageForStatus('already_used')).toMatch(/already used/i);
    expect(userMessageForStatus('already_subscribed')).toMatch(/already has premium/i);
  });

  it('maps code-request messages', () => {
    expect(userMessageForCodeRequest('sent')).toMatch(/sent your claim code/i);
    expect(userMessageForCodeRequest('invalid_email')).toMatch(/valid waitlist email/i);
    expect(userMessageForCodeRequest('not_found')).toMatch(/if your waitlist email is registered/i);
  });

  it('uses 14-day token window constant', () => {
    expect(TOKEN_WINDOW_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
