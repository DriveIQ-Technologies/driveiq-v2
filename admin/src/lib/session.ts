import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { adminAuth, adminDb } from './firebaseAdmin';
import { isDemo } from './demo';
import { parseAdminEmails } from './metrics';

/**
 * `__session` also survives Firebase Hosting, which strips every other cookie,
 * should the dashboard ever move there from Vercel.
 */
export const SESSION_COOKIE = '__session';
export const SESSION_DAYS = 5;

/** Always allowed in, on top of ADMIN_EMAILS and Firestore `adminUsers`. */
const BUILT_IN_ADMINS = [
  'waiswadonnie@gmail.com',
  'donniewaiswa.dev@gmail.com',
  'waiswa.dev@driveiq.app',
];

export function adminEmails(): Set<string> {
  const list = parseAdminEmails(process.env.ADMIN_EMAILS);
  for (const e of BUILT_IN_ADMINS) list.add(e);
  return list;
}

export function isCompanyAdminEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith('@driveiq.app');
}

/**
 * Admins: @driveiq.app, the built-in list, ADMIN_EMAILS, or a Firestore doc at
 * `adminUsers/{email}` (lowercase email as the id; `disabled: true` removes
 * access). That collection is server-only: the app's rules deny all clients.
 */
export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return false;
  if (isCompanyAdminEmail(e) || adminEmails().has(e)) return true;
  try {
    const snap = await adminDb().collection('adminUsers').doc(e).get();
    return snap.exists && snap.get('disabled') !== true;
  } catch {
    return false;
  }
}

export interface AdminSession {
  uid: string;
  email: string;
}

/**
 * The signed-in admin, or null. Checked on every server render and server
 * action — the proxy only does a quick cookie-present check.
 */
export const getSession = cache(async (): Promise<AdminSession | null> => {
  if (isDemo()) return { uid: 'demo', email: 'demo@driveiq.app' };
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    // checkRevoked: signing out elsewhere (or removing an admin) takes effect.
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    if (!(await isAdminEmail(decoded.email))) return null;
    return { uid: decoded.uid, email: String(decoded.email) };
  } catch {
    return null;
  }
});

/** For pages and actions: the admin session, or off to /login. */
export async function requireAdmin(): Promise<AdminSession> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
