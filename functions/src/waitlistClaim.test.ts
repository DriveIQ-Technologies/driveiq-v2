import { describe, expect, it } from 'vitest';

import {
  WAITLIST_WEEK_MS,
  buildGrantEnds,
  evaluateExistingClaim,
  isPremiumUntilActive,
  normalizeClaimToken,
  normalizeEmail,
  resolveClaimTarget,
  userMessageForStatus,
} from './waitlistClaim.js';

describe('waitlistClaim helpers', () => {
  it('normalizes emails and claim tokens', () => {
    expect(normalizeEmail('  Zak@Example.COM ')).toBe('zak@example.com');
    expect(normalizeClaimToken(' ab-12 cd ')).toBe('AB12CD');
  });

  it('resolves auto mode from account email', () => {
    expect(resolveClaimTarget('auto', 'me@test.com')).toEqual({ email: 'me@test.com' });
    expect(resolveClaimTarget('auto', '  ').status).toBe('invalid_email');
  });

  it('prefers claim token over email in manual mode', () => {
    expect(
      resolveClaimTarget('manual', null, 'other@test.com', 'week-01'),
    ).toEqual({ token: 'WEEK01' });
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
    expect(result?.status).toBe('already_claimed');
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
  });
});
