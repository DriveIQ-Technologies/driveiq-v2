'use client';

import { fmtDate, HealthBadge, PageHeader, Table, Td } from '@/components/ui';
import { Load } from '@/components/Load';
import { getHealth } from '@/lib/data';

function every(min: number) {
  return min >= 60 ? `every ${min / 60} h` : `every ${min} min`;
}

export default function HealthPage() {
  return (
    <Load load={getHealth}>
      {(feeds) => (
        <>
          <PageHeader
            title="System health"
            subtitle="When each data feed last updated. Late = missed a run; Down = missed several."
          />
          <Table head={['Feed', 'Status', 'Last update', 'Schedule', 'Detail']}>
            {feeds.map((f) => (
              <tr key={f.name}>
                <Td className="font-medium">{f.name}</Td>
                <Td><HealthBadge health={f.health} /></Td>
                <Td>
                  {f.age}
                  <div className="text-xs text-slate-500">{fmtDate(f.updatedAt)}</div>
                </Td>
                <Td className="text-slate-500">{every(f.everyMinutes)}</Td>
                <Td className="text-slate-500">{f.detail}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Load>
  );
}
