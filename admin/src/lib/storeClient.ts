import { clientAuth } from './firebaseClient';
import { emptyStoreDownloads, type StoreDownloadResponse } from './storeReports';

/** Asks the admin server for App Store and Play download totals. */
export async function fetchStoreDownloads(): Promise<StoreDownloadResponse> {
  try {
    const user = clientAuth().currentUser;
    if (!user) return emptyStoreDownloads([], 'Not signed in');
    const token = await user.getIdToken();
    const res = await fetch('/api/store-downloads', { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as StoreDownloadResponse;
    if (!res.ok && !body.error) return emptyStoreDownloads([], 'Store reports are unavailable');
    return body;
  } catch {
    return emptyStoreDownloads([], 'Store reports are unavailable');
  }
}
