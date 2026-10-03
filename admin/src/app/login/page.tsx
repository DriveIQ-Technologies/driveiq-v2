'use client';

import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientAuth, clientDb } from '@/lib/firebaseClient';

const AUTH_MESSAGES: Record<string, string> = {
  'auth/unauthorized-domain':
    'This site is not allowed for Google sign-in yet. In Firebase Console → Authentication → Settings → Authorized domains, add admin-driveiq.vercel.app.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/cancelled-popup-request': 'Google sign-in was cancelled.',
  'auth/popup-blocked': 'The Google popup was blocked. Allow popups for this site and try again.',
  'auth/operation-not-allowed': 'Google sign-in is turned off in Firebase Authentication.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/invalid-email': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
};

function messageFor(e: unknown): string {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (e instanceof Error && e.message) return e.message;
  return 'Could not sign in.';
}

async function assertAdmin(email: string | null) {
  const id = String(email ?? '').trim().toLowerCase();
  if (!id) throw new Error("That account isn't on the admin list.");
  const snap = await getDoc(doc(clientDb(), 'adminUsers', id));
  if (!snap.exists()) {
    await signOut(clientAuth()).catch(() => undefined);
    throw new Error("That account isn't on the admin list.");
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ email: string | null }>) {
    setBusy(true);
    setError(null);
    try {
      const user = await fn();
      await assertAdmin(user.email);
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-[#060B14]">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-[#0C1422]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2D7DF6] text-lg font-bold text-white">D</div>
          <div>
            <div className="font-bold text-slate-900 dark:text-slate-100">DriveIQ Admin</div>
            <div className="text-xs text-slate-500">Team access only</div>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => (await signInWithPopup(clientAuth(), new GoogleAuthProvider())).user)
          }
          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /> or <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => (await signInWithEmailAndPassword(clientAuth(), email.trim(), password)).user);
          }}
          className="space-y-3"
        >
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#2D7DF6] dark:border-slate-700 dark:text-slate-100"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#2D7DF6] dark:border-slate-700 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[#2D7DF6] py-2.5 text-sm font-semibold text-white hover:bg-[#1F62C9] disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    </main>
  );
}
