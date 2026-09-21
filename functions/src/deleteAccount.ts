/**
 * Account deletion for App Store guideline 5.1.1(v).
 * Authenticated user can wipe their DriveIQ server data and Auth record.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';

import { deleteBrevoContact } from './brevo.js';

async function deleteCollectionDocs(
  db: Firestore,
  path: string,
  batchSize = 100,
): Promise<number> {
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection(path).limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) break;
  }
  return deleted;
}

export async function handleDeleteAccount(opts: {
  db: Firestore;
  uid: string;
  /** Brevo key, when available, so the marketing contact goes too. */
  brevoApiKey?: string;
}): Promise<{ ok: true }> {
  const { db, uid } = opts;
  if (!uid) throw new Error('missing_uid');

  // Read the address before the user doc goes, so the Brevo copy of the
  // contact does not outlive the account it belongs to.
  let contactEmail: string | null = null;
  try {
    const snap = await db.doc(`users/${uid}`).get();
    const stored = snap.data()?.email;
    if (typeof stored === 'string' && stored.trim()) contactEmail = stored.trim();
  } catch (e) {
    logger.warn('delete_account.email_lookup_fail', {
      uid,
      message: e instanceof Error ? e.message : 'error',
    });
  }

  const subpaths = [
    `users/${uid}/entitlements`,
    `users/${uid}/usageDaily`,
    `users/${uid}/notificationState`,
  ];
  for (const path of subpaths) {
    const n = await deleteCollectionDocs(db, path);
    logger.info('delete_account.subcollection', { uid, path, deleted: n });
  }

  await db.doc(`users/${uid}`).delete().catch(() => undefined);

  // Anonymise community reports so pins can stay for other drivers.
  try {
    const reports = await db
      .collection('communityReports')
      .where('createdBy', '==', uid)
      .limit(200)
      .get();
    if (!reports.empty) {
      const batch = db.batch();
      for (const doc of reports.docs) {
        batch.update(doc.ref, { createdBy: 'deleted' });
      }
      await batch.commit();
    }
  } catch (e) {
    logger.warn('delete_account.reports_anon_fail', {
      uid,
      message: e instanceof Error ? e.message : 'error',
    });
  }

  if (contactEmail && opts.brevoApiKey) {
    try {
      await deleteBrevoContact({ apiKey: opts.brevoApiKey, email: contactEmail });
    } catch (e) {
      // Non-fatal: never leave the Auth record behind because Brevo was down.
      logger.warn('delete_account.brevo_delete_fail', {
        uid,
        message: e instanceof Error ? e.message : 'error',
      });
    }
  }

  await getAuth().deleteUser(uid);
  logger.info('delete_account.done', { uid, brevoContactRemoved: Boolean(contactEmail) });
  return { ok: true };
}
