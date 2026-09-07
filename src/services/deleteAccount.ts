/**
 * Permanently delete the signed-in Firebase account and server-side profile.
 * App Store guideline 5.1.1(v) requires an in-app path to delete the account.
 */
import { auth } from '@/services/firebase';
import { removeItem } from '@/services/storage';

const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app';
const DELETE_URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/deleteAccountHttp`;

/** Local keys tied to the signed-in account (not shared public caches). */
const ACCOUNT_LOCAL_KEYS = [
  'driveiq.savedEvents.v1',
  'driveiq.savedFlights.v1',
  'driveiq.savedStations.v1',
  'driveiq.freeStationSlot.v1',
  'driveiq.aiQuota.v1',
  'driveiq.pro.unlock',
  'driveiq.premium.trialEnds',
  'driveiq.premium.trialEmail',
  'driveiq.premium.trialUid',
  'driveiq.waitlist.pendingToken',
  'driveiq.waitlist.trialEndSeen',
];

type DeleteHttpBody = {
  result?: { ok: true };
  error?: { message?: string; status?: string };
};

export async function clearAccountLocalData(): Promise<void> {
  await Promise.all(ACCOUNT_LOCAL_KEYS.map((key) => removeItem(key)));
}

export async function requestAccountDeletion(): Promise<void> {
  const currentUser = auth?.currentUser;
  if (!currentUser || currentUser.isAnonymous) {
    throw new Error('Sign in required to delete your account.');
  }

  const post = async (forceRefresh: boolean): Promise<void> => {
    const token = await currentUser.getIdToken(forceRefresh);
    const res = await fetch(DELETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: {} }),
    });
    const raw = await res.text();
    let json: DeleteHttpBody | null = null;
    try {
      json = raw ? (JSON.parse(raw) as DeleteHttpBody) : null;
    } catch {
      throw new Error(`Could not delete account (http/${res.status}).`);
    }
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || `Could not delete account (http/${res.status}).`);
    }
    if (!json?.result?.ok) throw new Error('Could not delete account. Try again.');
  };

  try {
    await post(false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('401') || msg.toLowerCase().includes('sign in')) {
      await post(true);
      return;
    }
    throw err;
  }
}
