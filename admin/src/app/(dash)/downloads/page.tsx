'use client';

import { Load } from '@/components/Load';
import { Bars, Card, fmtDate, PageHeader, Stat } from '@/components/ui';
import { getDownloadActivity, getOverview } from '@/lib/data';

export default function DownloadsPage() {
  return (
    <Load
      load={async () => {
        const [overview, activity] = await Promise.all([getOverview(), getDownloadActivity()]);
        return { overview, activity };
      }}
    >
      {({ overview: o, activity }) => {
        const browsing = Math.max(0, o.downloads.total - o.downloads.withAccount);
        return (
          <>
            <PageHeader
              title="Downloads"
              subtitle="Phones that have opened DriveIQ. Separate from accounts, which are people who signed up."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Downloads" value={o.downloads.total.toLocaleString('en-GB')} hint={`+${o.downloads.last7} in the last 7 days`} />
              <Stat label="iPhone" value={o.downloads.ios.toLocaleString('en-GB')} hint="Opened on iPhone" />
              <Stat label="Android" value={o.downloads.android.toLocaleString('en-GB')} hint="Opened on Android" />
              <Stat label="No account yet" value={browsing.toLocaleString('en-GB')} hint={`${o.downloads.withAccount.toLocaleString('en-GB')} of these later signed up`} />
            </div>

            <Card className="mt-4">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-semibold">New downloads per day</h2>
                <span className="text-xs text-slate-500">last 14 days</span>
              </div>
              <Bars data={activity.perDay.map((s) => ({ label: s.day, value: s.count }))} />
            </Card>

            <Card className="mt-4">
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="font-semibold">Where the app was last opened</h2>
                <span className="text-xs text-slate-500">last 2 days · about 1 km</span>
              </div>
              <p className="mb-4 text-sm text-slate-500">
                Each dot is the last place someone used the app, not a live trail. It fills in as phones run the update that reports this.
              </p>
              {activity.places.length === 0 ? (
                <p className="text-sm text-slate-500">No locations yet.</p>
              ) : (
                <PlaceMap places={activity.places} />
              )}
            </Card>
          </>
        );
      }}
    </Load>
  );
}

function PlaceMap({
  places,
}: {
  places: { id: string; lat: number; lng: number; platform: string; area: string | null; lastSeenAt: string | null; account: boolean }[];
}) {
  const lats = places.map((p) => p.lat);
  const lngs = places.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = Math.max(0.15, maxLat - minLat);
  const lngSpan = Math.max(0.15, maxLng - minLng);
  return (
    <div>
      <div className="relative h-80 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-900">
        {places.map((p) => {
          const x = ((p.lng - minLng) / lngSpan) * 100;
          const y = (1 - (p.lat - minLat) / latSpan) * 100;
          const title = `${p.area ?? 'Unknown area'} · ${p.platform === 'ios' ? 'iPhone' : p.platform === 'android' ? 'Android' : 'Phone'} · ${p.account ? 'account' : 'no account'}`;
          return (
            <span
              key={p.id}
              title={title}
              className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${
                p.platform === 'android' ? 'bg-emerald-500' : 'bg-brand'
              }`}
              style={{ left: `${Math.min(98, Math.max(2, x))}%`, top: `${Math.min(98, Math.max(2, y))}%` }}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">Blue is iPhone. Green is Android.</p>
      <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
        {places.slice(0, 40).map((p) => (
          <li key={p.id} className="flex justify-between gap-3 text-slate-600 dark:text-slate-300">
            <span>{p.area ?? `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`}</span>
            <span className="text-slate-400">
              {p.platform === 'ios' ? 'iPhone' : p.platform === 'android' ? 'Android' : 'Phone'}
              {' · '}
              {p.account ? 'account' : 'no account'}
              {' · '}
              {fmtDate(p.lastSeenAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
