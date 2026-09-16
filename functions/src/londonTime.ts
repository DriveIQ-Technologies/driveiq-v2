/** London quiet hours 02:00–05:00 — no push pings. */
export function isQuietHours(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const mins = hour * 60 + minute;
  return mins >= 2 * 60 && mins < 5 * 60;
}

/** True between 05:00 and 01:00 London (airport poll window). */
export function isAirportPollWindow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  return hour >= 5 || hour < 1;
}

export function londonYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

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

export function addMinutesIso(iso: string, minutes: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + minutes * 60_000).toISOString();
}

/**
 * "Wed 16 Sep 19:30" in Europe/London, or '' when the input is unusable.
 *
 * Event rows used to reach the agent as raw UTC ISO strings while the prompt
 * told the model to "always say London HH:mm" — leaving it to do the timezone
 * arithmetic. Through BST that is a systematic one-hour error on every time it
 * quotes, and models are unreliable at DST boundaries even when they try. Do
 * the conversion here, where `Intl` gets it right, and hand the model a string
 * it only has to copy.
 */
export function londonStamp(iso: string | undefined | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** London stamp, or the given fallback when the input can't be parsed. */
export function londonStampOr(iso: string | undefined | null, fallback = 'n/a'): string {
  return londonStamp(iso) || fallback;
}
