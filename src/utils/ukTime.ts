/**
 * UK timezone offset for a given calendar date.
 *
 * Several providers (SportsDB, ICS feeds, date-only fixtures) give London
 * wall-clock times with no offset. Tagging them `Z` shifts everything +1h
 * during BST, and hardcoding `+01:00` breaks after clocks go back — so we
 * compute the correct offset from the UK DST rule instead of relying on the
 * device timezone (which may not be Europe/London).
 */

/** BST runs from the last Sunday of March to the last Sunday of October. */
const lastSundayUtcDay = (year: number, monthIndex: number): number => {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
};

/** Offset suffix ('+01:00' in BST, '+00:00' in GMT) for a YYYY-MM-DD date. */
export function ukOffset(dateStr: string): '+01:00' | '+00:00' {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '+00:00';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month > 3 && month < 10) return '+01:00';
  if (month === 3) return day >= lastSundayUtcDay(year, 2) ? '+01:00' : '+00:00';
  if (month === 10) return day < lastSundayUtcDay(year, 9) ? '+01:00' : '+00:00';
  return '+00:00';
}

/**
 * Parse a London wall-clock time (`YYYY-MM-DD` + `HH:mm[:ss]`) to epoch ms,
 * applying the correct BST/GMT offset for that date.
 */
export function parseLondonTime(dateStr: string, timeStr: string): number {
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return Date.parse(`${dateStr}T${time}${ukOffset(dateStr)}`);
}

/** Calendar date in Europe/London as `YYYY-MM-DD` (DriveIQ's "day"). */
export function londonYmd(d: Date = new Date()): string {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Add `days` to a YYYY-MM-DD string (calendar arithmetic in UTC noon to avoid DST edges). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Inclusive London-midnight → London-end-of-day bounds as absolute Date instants. */
export function londonDayBounds(ymd: string): { start: Date; end: Date } {
  const off = ukOffset(ymd);
  return {
    start: new Date(`${ymd}T00:00:00${off}`),
    end: new Date(`${ymd}T23:59:59.999${off}`),
  };
}
