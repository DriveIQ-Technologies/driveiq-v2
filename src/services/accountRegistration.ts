/**
 * Tell the server a real account now exists.
 *
 * The app signs in anonymously on first open and upgrades that uid in place
 * with linkWithCredential, so no Firebase auth-create trigger fires at signup.
 * This call is the moment the server learns the address, name and provider —
 * it writes users/{uid}, syncs the Brevo contact and sends the welcome email.
 *
 * Fire-and-forget and idempotent: the server sends the welcome once, so
 * calling this on every sign-in is safe and self-healing if a call is lost.
 */
import { auth } from '@/services/firebase';

const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app';
const REGISTER_URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/registerAccountHttp`;

type RegisterHttpBody = {
  result?: { ok: true; created: boolean; welcomeSent: boolean; authProvider: string };
  error?: { message?: string; status?: string };
};

/**
 * Never throws: registration failing must not block a successful sign-in.
 * Returns true when the server confirmed it.
 */
export async function registerAccount(opts?: { isNewAccount?: boolean }): Promise<boolean> {
  const currentUser = auth?.currentUser;
  if (!currentUser || currentUser.isAnonymous) return false;

  try {
    const token = await currentUser.getIdToken(false);
    const res = await fetch(REGISTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { isNewAccount: opts?.isNewAccount === true } }),
    });
    const raw = await res.text();
    const json = raw ? (JSON.parse(raw) as RegisterHttpBody) : null;
    return Boolean(json?.result?.ok);
  } catch {
    // Retried on the next sign-in; the server call is idempotent.
    return false;
  }
}
