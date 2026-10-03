'use client';

import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Sidebar } from '@/components/Sidebar';
import { clientAuth, clientDb } from '@/lib/firebaseClient';

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(clientAuth(), async (user) => {
      const id = user?.email?.trim().toLowerCase() ?? '';
      if (!id) {
        router.replace('/login');
        return;
      }
      const snap = await getDoc(doc(clientDb(), 'adminUsers', id));
      if (!snap.exists()) {
        await signOut(clientAuth()).catch(() => undefined);
        router.replace('/login');
        return;
      }
      setEmail(id);
    });
  }, [router]);

  if (!email) {
    return <div className="p-8 text-sm text-slate-500">Checking access…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar email={email} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
