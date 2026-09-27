/**
 * "Your free Premium week has ended" — shown once, the next time the user
 * opens the app after their waitlist week runs out.
 *
 * The sheet itself is WaitlistTrialEndSheet. Its old trigger rarely fired:
 * it only looked within 48h of the week ending, only on a cold start (not on
 * returning to an app still in memory, which is most iPhone opens), could run
 * before waitlist state had loaded and never retry, would have shown to
 * someone who had since subscribed, and shared one "seen" flag across every
 * account on the phone. This replaces that trigger.
 */
import { auth } from './firebase';
import { getPremiumSource } from './subscription';
import {
  getWaitlistTrialEnds,
  getWaitlistTrialEndSeenMarker,
  setWaitlistTrialEndSeenMarker,
} from './waitlist';
import { track } from './analytics';
import { waitlistEndedAction } from '@/utils/waitlistEnded';

type Host = () => void;
let host: Host | null = null;
/** A popup that came due before the host mounted, shown once it does. */
let pending = false;
let checking = false;

export function registerWaitlistEndedHost(fn: Host | null): void {
  host = fn;
  if (fn && pending) {
    pending = false;
    fn();
  }
}

/** Safe to call often (app open, foreground, sign-in): it shows at most once. */
export async function presentWaitlistEndedIfDue(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const user = auth?.currentUser;
    const uid = user && !user.isAnonymous ? user.uid : null;
    if (!uid) return;

    const [endsAt, premiumSource, seenMarker] = await Promise.all([
      getWaitlistTrialEnds(),
      getPremiumSource(),
      getWaitlistTrialEndSeenMarker(),
    ]);
    const { action, marker } = waitlistEndedAction({
      uid,
      endsAt,
      now: Date.now(),
      premiumSource,
      seenMarker,
    });
    if (action === 'none' || !marker) return;

    // Record first, so a crash or a second call can never show it twice.
    await setWaitlistTrialEndSeenMarker(marker);
    if (action !== 'show') return;

    track('waitlist_ended_shown');
    if (host) host();
    else pending = true;
  } catch (e) {
    // Never block app start on this.
  } finally {
    checking = false;
  }
}
