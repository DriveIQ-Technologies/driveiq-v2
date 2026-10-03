'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { Load } from '@/components/Load';
import { fmtDate, PageHeader, Pill, Table, Td } from '@/components/ui';
import { listUsers } from '@/lib/data';

export default function UsersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <UsersInner />
    </Suspense>
  );
}

function UsersInner() {
  const q = useSearchParams().get('q') ?? '';
  return (
    <Load key={q} load={() => listUsers(q)}>
      {(users) => (
        <>
          <PageHeader title="Users" subtitle={q ? `Search: ${q}` : 'Newest 50 accounts. Search by exact email or user ID.'} />
          <form className="mb-4 flex gap-2" action="/users">
            <input
              name="q"
              defaultValue={q}
              placeholder="name@example.com or user ID"
              className="w-full max-w-md rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand dark:border-slate-700 dark:bg-night-2"
            />
            <button className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Search</button>
            {q ? (
              <Link href="/users" className="rounded-xl px-3 py-2 text-sm text-slate-500 hover:underline">
                Clear
              </Link>
            ) : null}
          </form>

          {users.length === 0 ? (
            <p className="text-sm text-slate-500">No matching account.</p>
          ) : (
            <Table head={['Account', 'Plan', 'Joined', 'Sign-in', 'Notifications', 'Watched flights', 'Saved events']}>
              {users.map((u) => (
                <tr key={u.uid} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <Td>
                    <Link href={`/users/${u.uid}`} className="font-medium text-brand hover:underline">
                      {u.email ?? u.uid}
                    </Link>
                    {u.name ? <div className="text-xs text-slate-500">{u.name}</div> : null}
                  </Td>
                  <Td>
                    <Pill className={u.planLabel === 'Free' ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300'}>
                      {u.planLabel}{u.planTrial ? ' · trial' : ''}
                    </Pill>
                  </Td>
                  <Td className="text-slate-500">{fmtDate(u.createdAt)}</Td>
                  <Td className="capitalize">{u.provider ?? '—'}</Td>
                  <Td>{u.push ? <Pill className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">{u.push}</Pill> : <span className="text-slate-400">off</span>}</Td>
                  <Td className="tabular-nums">{u.watchedFlights}</Td>
                  <Td className="tabular-nums">{u.savedEvents}</Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </Load>
  );
}
