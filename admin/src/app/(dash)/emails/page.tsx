'use client';

import { Load } from '@/components/Load';
import { fmtDate, PageHeader, Table, Td } from '@/components/ui';
import { audienceCsv, listAudience, type AudienceRow } from '@/lib/data';

function download(rows: AudienceRow[]) {
  const blob = new Blob([audienceCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'driveiq-emails.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function EmailsPage() {
  return (
    <Load load={listAudience}>
      {(rows) => {
        const optedIn = rows.filter((r) => r.marketing).length;
        return (
          <>
            <PageHeader
              title="Emails"
              subtitle={`${rows.length} addresses from accounts and the waitlist. Download the CSV and import it into Brevo.`}
              right={
                <button
                  type="button"
                  onClick={() => download(rows)}
                  className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  Download CSV
                </button>
              }
            />
            <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-night-2 dark:text-slate-300">
              Marketing is opt-in. {optedIn === 0 ? 'Nobody has opted in yet, so this list is for reference until the signup opt-in is on.' : `${optedIn} opted in.`}
              {' '}The marketing_opt_in column in the CSV is the one to use for a send.
            </p>
            <Table head={['Email', 'Name', 'Source', 'Phone', 'Joined', 'Marketing']}>
              {rows.map((r) => (
                <tr key={r.email}>
                  <Td className="font-medium">{r.email}</Td>
                  <Td>{r.name ?? '—'}</Td>
                  <Td>{r.source}</Td>
                  <Td>{r.platform || '—'}</Td>
                  <Td className="text-slate-500">{fmtDate(r.joined)}</Td>
                  <Td>{r.marketing ? 'Opted in' : 'No'}</Td>
                </tr>
              ))}
            </Table>
          </>
        );
      }}
    </Load>
  );
}
