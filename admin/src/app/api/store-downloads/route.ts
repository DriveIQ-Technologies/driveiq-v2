import { NextResponse, type NextRequest } from 'next/server';

import { emptyStoreDownloads } from '@/lib/storeReports';

export const runtime = 'nodejs';

/** Store download totals for a signed-in admin. */
export async function GET(request: NextRequest) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return NextResponse.json(emptyStoreDownloads([], 'Not signed in'), { status: 401 });

  try {
    const { adminAuth } = await import('@/lib/firebaseAdmin');
    const { isAdminEmail } = await import('@/lib/session');
    const decoded = await adminAuth().verifyIdToken(token);
    if (!(await isAdminEmail(decoded.email))) {
      return NextResponse.json(emptyStoreDownloads([], 'Not an admin'), { status: 403 });
    }
    const { loadStoreDownloads } = await import('@/lib/storeDownloads');
    return NextResponse.json(await loadStoreDownloads());
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Store reports failed';
    const code = String((e as { code?: unknown }).code ?? '');
    if (code.startsWith('auth/') || /id token/i.test(message)) {
      return NextResponse.json(emptyStoreDownloads([], 'Not signed in'), { status: 401 });
    }
    console.error('store-downloads.failed', message.slice(0, 200));
    if (/default credentials|FIREBASE_SERVICE_ACCOUNT|Could not load/i.test(message)) {
      const { missingStoreCredentials } = await import('@/lib/storeDownloads');
      return NextResponse.json(
        emptyStoreDownloads(missingStoreCredentials(), 'The admin server is not signed in to Firebase yet.'),
      );
    }
    return NextResponse.json(emptyStoreDownloads([], 'Store reports are unavailable'));
  }
}
