'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { Load } from '@/components/Load';
import { Card, fmtDate, PageHeader, Pill, usd, WaitlistBadge } from '@/components/ui';
import { getUser, type UserDetail } from '@/lib/data';

const PREF_LABEL: Record<string, string> = {
  'road-accidents': 'Road alerts',
  'line-closures': 'Rail & Tube alerts',
  'saved-flights': 'Flight alerts',
  'saved-events': 'Event reminders',
  'community-reports': 'Community reports',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-t border-slate-100 py-2.5 text-sm first:border-t-0 dark:border-slate-800">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export default function UserPage() {
  const uid = String(useParams().uid ?? '');
  return (
    <Load key={uid} load={() => getUser(uid)}>
      {(u) => (u ? <UserView u={u} /> : <p className="text-sm text-slate-500">No matching account.</p>)}
    </Load>
  );
}

function UserView({ u }: { u: UserDetail }) {
  return (
    <>
      <Link href="/users" className="text-sm text-brand hover:underline">
        ← Users
      </Link>
      <div className="mt-2">
        <PageHeader title={u.email ?? u.uid} subtitle={u.name ?? undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Account</h2>
          <Row label="User ID"><span className="font-mono text-xs">{u.uid}</span></Row>
          <Row label="Plan">{u.planLabel}{u.planTrial ? ' · trial' : ''}</Row>
          {u.planNote ? <p className="py-2 text-sm text-slate-500">{u.planNote}</p> : null}
          <Row label="Joined">{fmtDate(u.createdAt)}</Row>
          <Row label="Sign-in">{u.provider ?? '—'}</Row>
          <Row label="Email verified">{u.emailVerified ? 'Yes' : 'No'}</Row>
          <Row label="Marketing emails">{u.marketingConsent ? 'Opted in' : 'No'}</Row>
          <Row label="Community reports">{u.reports}</Row>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Waitlist week</h2>
          {u.waitlist ? (
            <>
              <Row label="Status"><WaitlistBadge status={u.waitlist.status} /></Row>
              <Row label="Waitlist email">{u.waitlist.email ?? '—'}</Row>
              <Row label="Claimed">{fmtDate(u.waitlist.claimedAt)}</Row>
              <Row label="Week ends">{fmtDate(u.waitlist.premiumUntil)}</Row>
            </>
          ) : (
            <p className="text-sm text-slate-500">No waitlist week on this account. A waitlist week is not a paid plan.</p>
          )}
          <h2 className="mb-2 mt-5 font-semibold">AI assistant</h2>
          <Row label="Questions, 14 days">{u.ai.questions14}</Row>
          <Row label="Estimated cost">{usd(u.ai.cost14)}</Row>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Notifications</h2>
          <Row label="Push">{u.push ? <Pill className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">On · {u.push}</Pill> : 'Off — no device registered'}</Row>
          {Object.entries(PREF_LABEL).map(([key, label]) => (
            <Row key={key} label={label}>{u.notificationPrefs[key] === false ? 'Off' : 'On'}</Row>
          ))}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Watched flights</h2>
          {u.watched.length ? (
            u.watched.map((f) => (
              <Row key={f.flightNumber + f.airportId} label={`${f.flightNumber} · ${f.airportId.toUpperCase()}`}>{f.state}</Row>
            ))
          ) : (
            <p className="text-sm text-slate-500">Not watching any flights.</p>
          )}
          <Row label="Saved events">{u.savedEvents}</Row>
        </Card>
      </div>
    </>
  );
}
