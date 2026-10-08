'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';

import { clientAuth } from '@/lib/firebaseClient';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/users', label: 'Users' },
  { href: '/downloads', label: 'Downloads' },
  { href: '/emails', label: 'Emails' },
  { href: '/waitlist', label: 'Waitlist' },
  { href: '/health', label: 'System health' },
  { href: '/ai', label: 'AI usage' },
];

async function leave() {
  await signOut(clientAuth()).catch(() => undefined);
}

export function Sidebar({ email }: { email: string }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white px-4 py-4 md:h-screen md:w-56 md:border-b-0 md:border-r md:py-6 dark:border-slate-800 dark:bg-night-2">
      <div className="mb-4 flex items-center gap-2.5 px-2 md:mb-8">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">D</div>
        <span className="font-bold">DriveIQ Admin</span>
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {NAV.map((n) => {
          const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                active ? 'bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {n.label}
            </Link>
          );
        })}
        <a
          href="https://europe-west2-driveiq-app.cloudfunctions.net/eventsAdminHttp"
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Add events ↗
        </a>
        <button
          type="button"
          className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-brand md:hidden"
          onClick={async () => {
            await leave();
            router.replace('/login');
          }}
        >
          Sign out
        </button>
      </nav>
      <div className="mt-auto hidden px-2 pt-6 text-xs text-slate-500 md:block">
        <div className="truncate">{email}</div>
        <button
          type="button"
          className="mt-2 text-brand hover:underline"
          onClick={async () => {
            await leave();
            router.replace('/login');
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
