'use client';

import { Load } from '@/components/Load';
import { Bars, Card, fmtDate, PageHeader, Stat } from '@/components/ui';
import { getDownloadActivity } from '@/lib/data';
import { fetchStoreDownloads } from '@/lib/storeClient';
import { storeSetupNote } from '@/lib/storeReports';

export default function DownloadsPage() {
  return (
    <Load
      load={async () => {
        const [store, activity] = await Promise.all([fetchStoreDownloads(), getDownloadActivity()]);
        return { store, activity };
      }}
    >
      {({ store, activity }) => {
        const note = storeSetupNote(store.missing);
        const ios = store.ios ?? 0;
        const android = store.android ?? 0;
        return (
          <>
            <PageHeader
              title="Downloads"
              subtitle="First downloads from the App Store and Google Play. Reports usually land a day or two after the day itself."
            />
            {note ? <p className="mb-4 text-sm text-slate-500">{note}</p> : null}
            {store.error ? <p className="mb-4 text-sm text-slate-500">{store.error}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Downloads" value={(store.ios == null && store.android == null ? 0 : ios + android).toLocaleString('en-GB')} hint="App Store first downloads plus Play installs" />
              <Stat label="iPhone" value={store.ios == null ? '—' : ios.toLocaleString('en-GB')} hint="App Store, last 35 days" />
              <Stat label="Android" value={store.android == null ? '—' : android.toLocaleString('en-GB')} hint="Play, total user installs" />
              <Stat label="Last 7 days" value={store.last7.toLocaleString('en-GB')} hint={store.through ? `Through ${store.through}` : 'Store reporting days'} />
            </div>

            <Card className="mt-4">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-semibold">New downloads per day</h2>
                <span className="text-xs text-slate-500">last 14 store days</span>
              </div>
              {store.perDay.length ? (
                <Bars data={store.perDay.map((s) => ({ label: s.day, value: s.count }))} />
              ) : (
                <p className="text-sm text-slate-500">No store days yet.</p>
              )}
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
