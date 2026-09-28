/**
 * Tell the server a Premium trial just started so it can send the
 * welcome email once. Fire-and-forget: a failed call must not block unlock.
 */
import { auth } from '@/services/firebase';

const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app';
const URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/notifyPremiumStartedHttp`;

export async function notifyPremiumStarted(opts: {
  plan: 'annual' | 'monthly';
  trialStarted: boolean;
}): Promise<void> {
  const currentUser = auth?.currentUser;
  if (!currentUser || currentUser.isAnonymous) return;
  if (!opts.trialStarted) return;

  try {
    const token = await currentUser.getIdToken(false);
    await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { plan: opts.plan, trialStarted: true } }),
    });
  } catch {
    // Retried if they open the paywall path again; the server is idempotent.
  }
}
