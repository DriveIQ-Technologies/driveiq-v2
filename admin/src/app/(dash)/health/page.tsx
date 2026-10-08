'use client';

import { fmtDate, HealthBadge, PageHeader, Table, Td } from '@/components/ui';
import { Load } from '@/components/Load';
import { getHealth } from '@/lib/data';

export default function HealthPage() {
  return (
    <Load load={getHealth}>
      {(feeds) => (
        <>
          <PageHeader
            title="System health"
            subtitle="When each data feed last updated. Late = missed a run; Down = missed several."
          />
          <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-night-2 dark:text-slate-300">
            Heathrow and Gatwick refresh every 5 minutes until 01:00 London, then every 30 minutes until 04:15.
            A half-hour gap overnight is that schedule, not a fault. The board turns Late only when it misses the night run, and Healthy again as soon as the next one lands.
          </p>
          <Table head={['Feed', 'Status', 'Last update', 'Schedule', 'Detail']}>
            {feeds.map((f) => (
              <tr key={f.name}>
                <Td className="font-medium">{f.name}</Td>
                <Td><HealthBadge health={f.health} /></Td>
                <Td>
                  {f.age}
                  <div className="text-xs text-slate-500">{fmtDate(f.updatedAt)}</div>
                </Td>
                <Td className="text-slate-500">{f.schedule}</Td>
                <Td className="text-slate-500">{f.detail}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Load>
  );
}
