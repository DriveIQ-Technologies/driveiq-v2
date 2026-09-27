/**
 * Whether to show "your free Premium week has ended" on this app open.
 *
 * Shown once per account per waitlist week, the next time the user opens the
 * app after the week runs out. The seen marker carries the account and the end
 * date, so a different account on the same phone — or a later waitlist week —
 * still gets its own popup.
 */

export type WaitlistEndedAction = 'show' | 'mark-seen' | 'none';

/** Past this, the popup would be stale news; record it as seen instead. */
export const WAITLIST_ENDED_SHOW_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

export function waitlistEndedMarker(uid: string, endsAt: string): string {
  return `${uid}|${endsAt}`;
}

export function waitlistEndedAction(opts: {
  uid: string | null;
  endsAt: string | null;
  now: number;
  /** From getPremiumSource(): 'none' | 'revenuecat' | 'waitlist' | 'preview' | 'dev_unlock'. */
  premiumSource: string;
  seenMarker: string | null;
}): { action: WaitlistEndedAction; marker?: string } {
  const { uid, endsAt, now, premiumSource, seenMarker } = opts;
  if (!uid || !endsAt) return { action: 'none' };
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends) || ends > now) return { action: 'none' };

  const marker = waitlistEndedMarker(uid, endsAt);
  if (seenMarker === marker) return { action: 'none' };

  // Subscribed since the week ended: nothing to tell them.
  if (premiumSource === 'revenuecat') return { action: 'mark-seen', marker };
  // Test builds and an active week are not the audience.
  if (premiumSource !== 'none') return { action: 'none' };
  // Came back months later: don't open with old news.
  if (now - ends > WAITLIST_ENDED_SHOW_WITHIN_MS) return { action: 'mark-seen', marker };

  return { action: 'show', marker };
}
