'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { Load } from '@/components/Load';
import { fmtDate, PageHeader, Table, Td, WaitlistBadge, WAITLIST_LABEL } from '@/components/ui';
import { getWaitlist } from '@/lib/data';
import { countBy, type WaitlistStatus } from '@/lib/metrics';

const FILTERS: WaitlistStatus[] = ['unclaimed', 'expiring', 'expired', 'week-running', 'week-ended'];

export default function WaitlistPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <WaitlistInner />
    </Suspense>
  );
}

function WaitlistInner() {
  const raw = useSearchParams().get('status');
  const filter = raw && (FILTERS as string[]).includes(raw) ? (raw as WaitlistStatus) : null;
  return (
    <Load load={getWaitlist}>
      {(all) => {
        const counts = countBy(all, (r) => r.status);
        const rows = filter ? all.filter((r) => r.status === filter) : all;
        return (
          <>
            <PageHeader title="Waitlist" subtitle={`${all.length} invite codes. Claimed weeks link to the account.`} />
            <div className="mb-4 flex flex-wrap gap-2 text-sm">
              <Link href="/waitlist" className={`rounded-full px-3 py-1 ${!filter ? 'bg-brand text-white' : 'bg-white ring-1 ring-slate-200 dark:bg-night-2 dark:ring-slate-800'}`}>
                All {all.length}
              </Link>
              {FILTERS.map((f) => (
                <Link
                  key={f}
                  href={`/waitlist?status=${f}`}
                  className={`rounded-full px-3 py-1 ${filter === f ? 'bg-brand text-white' : 'bg-white ring-1 ring-slate-200 dark:bg-night-2 dark:ring-slate-800'}`}
                >
                  {WAITLIST_LABEL[f]} {counts[f] ?? 0}
                </Link>
              ))}
            </div>
            {(counts.expired ?? 0) + (counts.expiring ?? 0) > 0 ? (
              <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                {(counts.expired ?? 0) + (counts.expiring ?? 0)} unclaimed codes have expired or expire within 3 days. Extend them before the launch email goes out.
              </p>
            ) : null}
            <Table head={['Email', 'Status', 'Code', 'Code expires', 'Claimed', 'Premium until', 'Account']}>
              {rows.map((r) => (
                <tr key={r.code}>
                  <Td className="font-medium">{r.email ?? '—'}</Td>
                  <Td><WaitlistBadge status={r.status} /></Td>
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td className="text-slate-500">{fmtDate(r.expiresAt)}</Td>
                  <Td className="text-slate-500">{fmtDate(r.claimedAt)}</Td>
                  <Td className="text-slate-500">{fmtDate(r.premiumUntil)}</Td>
                  <Td>{r.claimedByUid ? <Link className="text-brand hover:underline" href={`/users/${r.claimedByUid}`}>Open</Link> : '—'}</Td>
                </tr>
              ))}
            </Table>
          </>
        );
      }}
    </Load>
  );
}
