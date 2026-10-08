'use client';

import Link from 'next/link';

import { Load } from '@/components/Load';
import { Bars, Card, PageHeader, Stat, usd, WAITLIST_LABEL } from '@/components/ui';
import { getOverview, type Overview } from '@/lib/data';
import type { WaitlistStatus } from '@/lib/metrics';
import { fetchStoreDownloads } from '@/lib/storeClient';
import { storeSetupNote, type StoreDownloadResponse } from '@/lib/storeReports';

const ORDER: WaitlistStatus[] = ['week-running', 'week-ended', 'unclaimed', 'expiring', 'expired', 'disabled'];

export default function OverviewPage() {
  return (
    <Load load={async () => ({ o: await getOverview(), store: await fetchStoreDownloads() })}>
      {({ o, store }) => <OverviewView o={o} store={store} />}
    </Load>
  );
}

function downloadValue(store: StoreDownloadResponse, o: Overview): number {
  if (store.ios == null && store.android == null) return o.downloads.total;
  return (store.ios ?? 0) + (store.android ?? 0);
}

function downloadHint(store: StoreDownloadResponse): string {
  if (store.ios == null && store.android == null) {
    return storeSetupNote(store.missing) ?? store.error ?? 'App Store and Play figures land here';
  }
  const parts = [
    store.ios != null ? `${store.ios.toLocaleString('en-GB')} iPhone` : null,
    store.android != null ? `${store.android.toLocaleString('en-GB')} Android` : null,
    'App Store and Play',
  ].filter((part): part is string => Boolean(part));
  if (store.ios == null || store.android == null) {
    const gap = storeSetupNote(store.missing);
    if (gap) parts.push(gap.replace(/\.$/, ''));
  }
  return parts.join(' · ');
}

function OverviewView({ o, store }: { o: Overview; store: StoreDownloadResponse }) {
  const claimed = (o.waitlist.byStatus['week-running'] ?? 0) + (o.waitlist.byStatus['week-ended'] ?? 0);
  const pushPct = o.users.total ? Math.round((o.users.withPush / o.users.total) * 100) : 0;

  return (
    <>
      <PageHeader title="Overview" subtitle="Live from the app's database." />

      {o.feedsDown + o.feedsLate > 0 ? (
        <Link
          href="/health"
          className={`mb-6 block rounded-xl border px-4 py-3 text-sm font-medium ${
            o.feedsDown
              ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
              : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
          }`}
        >
          {o.feedsDown ? `${o.feedsDown} data feed${o.feedsDown === 1 ? '' : 's'} down` : ''}
          {o.feedsDown && o.feedsLate ? ' · ' : ''}
          {o.feedsLate ? `${o.feedsLate} running late` : ''} — see System health →
        </Link>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Accounts"
          value={o.users.total.toLocaleString('en-GB')}
          hint={
            o.users.devices.unknown
              ? `+${o.users.last7} this week · ${o.users.devices.unknown} still on an older build`
              : `+${o.users.last7} this week · people who signed up`
          }
        />
        <Stat label="iPhone accounts" value={o.users.devices.ios.toLocaleString('en-GB')} hint="Signed-in iPhones" />
        <Stat label="Android accounts" value={o.users.devices.android.toLocaleString('en-GB')} hint="Signed-in Android phones" />
        <Stat label="Downloads" value={downloadValue(store, o).toLocaleString('en-GB')} hint={downloadHint(store)} />
        <Stat label="Notifications on" value={`${pushPct}%`} hint={`${o.users.pushIos} iPhone · ${o.users.pushAndroid} Android`} />
        <Stat label="Waitlist claimed" value={`${claimed} / ${o.waitlist.total}`} hint={`${o.waitlist.byStatus['week-running'] ?? 0} in their free week`} />
        <Stat label="AI, last 7 days" value={usd(o.ai.cost7)} hint={`${o.ai.questions7} questions`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-semibold">New accounts per day</h2>
            <span className="text-xs text-slate-500">last 14 days</span>
          </div>
          <Bars data={o.signups.map((s) => ({ label: s.day, value: s.count }))} />
        </Card>
        <Card>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-semibold">Waitlist codes</h2>
            <Link href="/waitlist" className="text-xs text-brand hover:underline">
              View all
            </Link>
          </div>
          <ul className="space-y-2 text-sm">
            {ORDER.filter((k) => o.waitlist.byStatus[k]).map((k) => (
              <li key={k} className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">{WAITLIST_LABEL[k]}</span>
                <span className="font-semibold tabular-nums">{o.waitlist.byStatus[k]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
