import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Exchange a fresh Firebase ID token for an admin session cookie. */
export async function POST(request: NextRequest) {
  let idToken = '';
  try {
    idToken = String(((await request.json()) as { idToken?: unknown }).idToken ?? '');
  } catch {
    return fail('bad_request', 400);
  }
  if (!idToken) return fail('bad_request', 400);

  try {
    const { adminAuth } = await import('@/lib/firebaseAdmin');
    const { isAdminEmail, SESSION_COOKIE, SESSION_DAYS } = await import('@/lib/session');
    const decoded = await adminAuth().verifyIdToken(idToken, true);
    // Only a sign-in from the last 5 minutes can start a session.
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) {
      return fail('stale_sign_in', 401);
    }
    if (decoded.email_verified === false || !(await isAdminEmail(decoded.email))) {
      return fail('not_admin', 403);
    }
    const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
    const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: expiresIn / 1000,
    });
    return res;
  } catch (e) {
    const code = String((e as { code?: unknown }).code ?? '');
    const message = e instanceof Error ? e.message : String(e);
    if (code.startsWith('auth/')) return fail('invalid_token', 401);
    console.error('session.create_failed', code, message.slice(0, 300));
    if (/FIREBASE_SERVICE_ACCOUNT|default credentials|Could not load/i.test(message)) {
      return fail('server_credentials', 500);
    }
    return fail('session_failed', 500);
  }
}

/** Sign out. */
export async function DELETE() {
  const { SESSION_COOKIE } = await import('@/lib/session');
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
