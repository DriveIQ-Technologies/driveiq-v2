'use client';

import Link from 'next/link';

import { Load } from '@/components/Load';
import { Bars, Card, PageHeader, Stat, Table, Td, usd } from '@/components/ui';
import { getAiUsage } from '@/lib/data';

export default function AiPage() {
  return (
    <Load load={() => getAiUsage(14)}>
      {({ perDay, topUsers }) => {
        const cost = perDay.reduce((s, d) => s + d.cost, 0);
        const questions = perDay.reduce((s, d) => s + d.questions, 0);
        const sonnet = perDay.reduce((s, d) => s + d.sonnet, 0);
        return (
          <>
            <PageHeader
              title="AI usage"
              subtitle="The in-app assistant, last 14 days. Estimated from token counts at list prices; your Claude console has the exact bill."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Estimated cost" value={usd(cost)} hint={`${usd(cost / 14)} a day`} />
              <Stat label="Questions" value={questions} hint={`${Math.round(questions / 14)} a day`} />
              <Stat label="On Sonnet" value={questions ? `${Math.round((sonnet / questions) * 100)}%` : '—'} hint="Premium planning questions" />
            </div>
            <Card className="mt-4">
              <h2 className="mb-4 font-semibold">Cost per day</h2>
              <Bars data={perDay.map((d) => ({ label: d.day, value: d.cost }))} format={usd} />
            </Card>
            <h2 className="mb-3 mt-8 font-semibold">Heaviest users</h2>
            <Table head={['Account', 'Questions', 'Estimated cost']}>
              {topUsers.map((u) => (
                <tr key={u.uid}>
                  <Td><Link className="font-mono text-xs text-brand hover:underline" href={`/users/${u.uid}`}>{u.uid}</Link></Td>
                  <Td className="tabular-nums">{u.questions}</Td>
                  <Td className="tabular-nums">{usd(u.cost)}</Td>
                </tr>
              ))}
            </Table>
            <p className="mt-4 text-xs text-slate-500">
              Alert lines and event descriptions written by the server aren&apos;t in this log; they&apos;re counted in the Claude console.
            </p>
          </>
        );
      }}
    </Load>
  );
}
