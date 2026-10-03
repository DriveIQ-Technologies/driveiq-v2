import type { ReactNode } from 'react';

import type { Health, WaitlistStatus } from '@/lib/metrics';

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-night-2 ${className}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-600 dark:text-red-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : '';
  return (
    <Card>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-sm text-slate-500">{hint}</div> : null}
    </Card>
  );
}

const HEALTH_STYLE: Record<Health, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  late: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  down: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  unknown: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
};
const HEALTH_LABEL: Record<Health, string> = { ok: 'Healthy', late: 'Late', down: 'Down', unknown: 'No data' };

export function HealthBadge({ health }: { health: Health }) {
  return <Pill className={HEALTH_STYLE[health]}>{HEALTH_LABEL[health]}</Pill>;
}

export const WAITLIST_LABEL: Record<WaitlistStatus, string> = {
  'week-running': 'Week running',
  'week-ended': 'Week used',
  unclaimed: 'Not claimed',
  expiring: 'Expires soon',
  expired: 'Code expired',
  disabled: 'Disabled',
};
const WAITLIST_STYLE: Record<WaitlistStatus, string> = {
  'week-running': HEALTH_STYLE.ok,
  'week-ended': 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  unclaimed: HEALTH_STYLE.unknown,
  expiring: HEALTH_STYLE.late,
  expired: HEALTH_STYLE.down,
  disabled: HEALTH_STYLE.unknown,
};

export function WaitlistBadge({ status }: { status: WaitlistStatus }) {
  return <Pill className={WAITLIST_STYLE[status]}>{WAITLIST_LABEL[status]}</Pill>;
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-night-2">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800">
          <tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-4 py-3 ${className}`}>{children}</td>;
}

/** Simple vertical bars; values over max are capped. */
export function Bars({ data, format = (n: number) => String(n) }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-40 gap-1.5">
      {data.map((d) => (
        // Each column is full height so the bar's % height has something to
        // be a percentage of.
        <div key={d.label} className="group flex h-full flex-1 flex-col items-center" title={`${d.label}: ${format(d.value)}`}>
          <div className="text-[10px] tabular-nums text-slate-500 opacity-0 group-hover:opacity-100">{format(d.value)}</div>
          <div className="flex w-full flex-1 items-end">
            <div className="w-full rounded-t bg-brand/80" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
          </div>
          <div className="mt-1 text-[10px] text-slate-400">{d.label.slice(8)}</div>
        </div>
      ))}
    </div>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(t));
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
