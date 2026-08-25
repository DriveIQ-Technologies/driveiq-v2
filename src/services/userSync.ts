/**
 * Sync user notification profile to Firestore for server-side FCM dispatch.
 */
import { db, fsApi, auth } from './firebase';
import type { NotificationPrefs } from './notifications';
import type { LineSubscriptions } from './notifications';
import type { SavedFlight } from './savedFlights';

export interface UserProfileSync {
  notificationPrefs?: NotificationPrefs;
  lineSubscriptions?: LineSubscriptions;
  savedFlights?: SavedFlight[];
}

export async function syncUserProfile(patch: UserProfileSync): Promise<void> {
  const uid = auth?.currentUser?.uid;
  if (!uid || !db || !fsApi) return;
  try {
    const doc: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (patch.notificationPrefs) doc.notificationPrefs = patch.notificationPrefs;
    if (patch.lineSubscriptions) doc.lineSubscriptions = patch.lineSubscriptions;
    if (patch.savedFlights) {
      doc.savedFlights = patch.savedFlights.map((f) => ({
        id: f.id,
        airportId: f.airportId,
        flightNumber: f.flightNumber,
        cancelled: f.cancelled,
        delayed: f.delayed,
        delayMinutes: f.delayMinutes,
      }));
    }
    await fsApi.setDoc(fsApi.doc(db, 'users', uid), doc, { merge: true });
  } catch (e) {
    console.warn('[userSync] profile sync failed', e);
  }
}

/** Push full local state after sign-in or prefs change. */
export async function syncUserProfileFromLocal(
  prefs: NotificationPrefs,
  lineSubs: LineSubscriptions,
  flights: SavedFlight[],
): Promise<void> {
  await syncUserProfile({
    notificationPrefs: prefs,
    lineSubscriptions: lineSubs,
    savedFlights: flights,
  });
}
