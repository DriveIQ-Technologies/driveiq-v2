import { getItem, setItem } from './storage';

/**
 * First-launch product tour flag. Separate from the notification-permission
 * popup (services/notifications.ts) so the two can be sequenced: tour first,
 * then the notifications ask.
 */

const KEY_TOUR_SEEN = 'driveiq.tour.seen.v1';
const KEY_SIGNUP_INVITE_SEEN = 'driveiq.signupInvite.seen.v1';

export async function hasSeenTour(): Promise<boolean> {
  return (await getItem(KEY_TOUR_SEEN)) === '1';
}

export async function markTourSeen(): Promise<void> {
  await setItem(KEY_TOUR_SEEN, '1');
}

/** Post-walkthrough Create account screen (task 09). Skip or complete counts as seen. */
export async function hasSeenSignupInvite(): Promise<boolean> {
  return (await getItem(KEY_SIGNUP_INVITE_SEEN)) === '1';
}

export async function markSignupInviteSeen(): Promise<void> {
  await setItem(KEY_SIGNUP_INVITE_SEEN, '1');
}
