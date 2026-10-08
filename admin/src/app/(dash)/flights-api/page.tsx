'use client';

import { Load } from '@/components/Load';
import { Bars, Card, PageHeader, Stat, Table, Td } from '@/components/ui';
import { getFlightApiUsage } from '@/lib/data';

export default function FlightApiPage() {
  return (
    <Load load={() => getFlightApiUsage(14)}>
      {({ perDay, byAirport }) => {
        const calls = perDay.reduce((s, d) => s + d.calls, 0);
        const failed = perDay.reduce((s, d) => s + d.failed, 0);
        return (
          <>
            <PageHeader
              title="Flight API"
              subtitle="AeroDataBox requests from the server, last 14 days. One request is one credit. RapidAPI is the exact bill."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Credits" value={calls.toLocaleString('en-GB')} hint={`${Math.round(calls / 14)} a day`} />
              <Stat label="Airports" value={byAirport.length.toLocaleString('en-GB')} hint="Near-term boards and full-day boards" />
              <Stat label="Failed" value={failed.toLocaleString('en-GB')} hint="A failed call still uses a credit" tone={failed ? 'warn' : undefined} />
            </div>
            <Card className="mt-4">
              <h2 className="mb-4 font-semibold">Credits per day</h2>
              <Bars data={perDay.map((d) => ({ label: d.day, value: d.calls }))} />
            </Card>
            <h2 className="mb-3 mt-8 font-semibold">By airport</h2>
            {byAirport.length === 0 ? (
              <p className="text-sm text-slate-500">No requests logged yet. The count starts once this version of the airport jobs is deployed.</p>
            ) : (
              <Table head={['Airport', 'Requests', 'Failed']}>
                {byAirport.map((a) => (
                  <tr key={a.icao}>
                    <Td className="font-medium">{a.icao}</Td>
                    <Td className="tabular-nums">{a.calls.toLocaleString('en-GB')}</Td>
                    <Td className="tabular-nums">{a.failed.toLocaleString('en-GB')}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        );
      }}
    </Load>
  );
}
