import { describe, expect, it } from 'vitest';

import {
  waitlistEndedAction,
  waitlistEndedMarker,
  WAITLIST_ENDED_SHOW_WITHIN_MS,
} from '@/utils/waitlistEnded';

const now = Date.parse('2026-09-25T09:00:00+01:00');
const endedYesterday = '2026-09-24T09:00:00.000Z';
const base = { uid: 'u1', endsAt: endedYesterday, now, premiumSource: 'none', seenMarker: null };

describe('waitlistEndedAction', () => {
  it('shows once the week has ended, for a free user who has not seen it', () => {
    expect(waitlistEndedAction(base)).toEqual({
      action: 'show',
      marker: waitlistEndedMarker('u1', endedYesterday),
    });
  });

  it('does not show while the week is still running', () => {
    expect(waitlistEndedAction({ ...base, endsAt: '2026-09-30T09:00:00.000Z' }).action).toBe('none');
  });

  it('does not show twice for the same account and week', () => {
    const seenMarker = waitlistEndedMarker('u1', endedYesterday);
    expect(waitlistEndedAction({ ...base, seenMarker }).action).toBe('none');
  });

  it('still shows for a different account on the same phone', () => {
    const seenMarker = waitlistEndedMarker('someone-else', endedYesterday);
    expect(waitlistEndedAction({ ...base, seenMarker }).action).toBe('show');
  });

  it('stays quiet for someone who has subscribed since, but records it', () => {
    expect(waitlistEndedAction({ ...base, premiumSource: 'revenuecat' }).action).toBe('mark-seen');
  });

  it('never shows to signed-out users or accounts without a waitlist week', () => {
    expect(waitlistEndedAction({ ...base, uid: null }).action).toBe('none');
    expect(waitlistEndedAction({ ...base, endsAt: null }).action).toBe('none');
  });

  it('does not open with months-old news', () => {
    const longAgo = new Date(now - WAITLIST_ENDED_SHOW_WITHIN_MS - 1000).toISOString();
    expect(waitlistEndedAction({ ...base, endsAt: longAgo }).action).toBe('mark-seen');
  });
});
