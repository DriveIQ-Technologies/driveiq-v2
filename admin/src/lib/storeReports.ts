/**
 * Pure parsing for App Store Connect sales reports and Play Console install
 * reports. The network calls live in storeDownloads.ts.
 *
 * A download here is a first install: Apple product types 1 / 1F / 1T, and
 * Play's "Daily User Installs". Updates and re-downloads are left out.
 */

export const APPLE_APP_ID = '6795638906';
export const PLAY_PACKAGE = 'driveiq.app';

/** First-time app downloads. Type 3 is a re-download, type 7 is an update. */
const FIRST_DOWNLOAD_TYPES = new Set(['1', '1F', '1T', '1E', '1EP', '1EU', '1-B']);

export interface DayCount {
  day: string;
  count: number;
}

export interface PlayInstallRow {
  day: string;
  daily: number;
  total: number;
}

export interface StoreDownloadResponse {
  /** Null when that store is not connected. Zero means connected and empty. */
  ios: number | null;
  android: number | null;
  total: number;
  last7: number;
  perDay: DayCount[];
  /** Latest store day included, YYYY-MM-DD in Pacific time (how both stores date reports). */
  through: string | null;
  missing: string[];
  error: string | null;
}

export function pacificDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Calendar days in Pacific time, oldest first. `lag` skips the most recent days. */
export function pacificDays(count: number, now = Date.now(), lag = 0): string[] {
  const end = Date.parse(`${pacificDay(now)}T20:00:00Z`);
  const out: string[] = [];
  for (let i = count + lag - 1; i >= lag; i -= 1) out.push(pacificDay(end - i * 86_400_000));
  return out;
}

/** Apple Begin Date is MM/DD/YYYY. */
export function appleReportDay(raw: string): string | null {
  const s = raw.trim();
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export function decodeSecret(raw: string): string {
  const trimmed = raw.trim();
  const text =
    trimmed.startsWith('-----') || trimmed.startsWith('{')
      ? trimmed
      : Buffer.from(trimmed, 'base64').toString('utf8');
  return text.replace(/\\n/g, '\n');
}

export function parseAppleSalesTsv(tsv: string, appleId = APPLE_APP_ID): Map<string, number> {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return new Map();
  const header = lines[0].split('\t').map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const typeI = col('Product Type Identifier');
  const unitsI = col('Units');
  const dateI = col('Begin Date');
  const appleI = col('Apple Identifier');
  const skuI = col('SKU');
  const titleI = col('Title');
  if (typeI < 0 || unitsI < 0 || dateI < 0) return new Map();

  const downloads = lines
    .slice(1)
    .map((line) => line.split('\t'))
    .filter((fields) => FIRST_DOWNLOAD_TYPES.has((fields[typeI] ?? '').trim()));

  const ours = downloads.filter((fields) => rowIsDriveIq(fields, appleI, skuI, titleI, appleId));
  const ids = new Set(downloads.map((fields) => (fields[appleI] ?? '').trim()).filter(Boolean));
  const chosen = ours.length > 0 ? ours : ids.size <= 1 ? downloads : [];

  const out = new Map<string, number>();
  for (const fields of chosen) {
    const day = appleReportDay(fields[dateI] ?? '');
    if (!day) continue;
    const units = Math.round(Number(fields[unitsI] ?? 0));
    if (!Number.isFinite(units)) continue;
    out.set(day, (out.get(day) ?? 0) + units);
  }
  return out;
}

function rowIsDriveIq(fields: string[], appleI: number, skuI: number, titleI: number, appleId: string): boolean {
  const id = appleI >= 0 ? (fields[appleI] ?? '').trim() : '';
  const sku = skuI >= 0 ? (fields[skuI] ?? '').trim().toLowerCase() : '';
  const title = titleI >= 0 ? (fields[titleI] ?? '').trim().toLowerCase() : '';
  return id === appleId || sku === PLAY_PACKAGE || sku.includes('driveiq') || title === 'driveiq';
}

export function parsePlayInstallsCsv(csv: string): PlayInstallRow[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h === name);
  const dateI = col('date');
  const dailyI = col('daily user installs');
  const totalI = col('total user installs');
  if (dateI < 0 || dailyI < 0) return [];
  const out: PlayInstallRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    const day = appleReportDay(fields[dateI] ?? '') ?? (/^\d{4}-\d{2}-\d{2}/.exec(fields[dateI] ?? '')?.[0] ?? null);
    if (!day) continue;
    const daily = Math.round(Number(fields[dailyI] ?? 0));
    const total = totalI >= 0 ? Math.round(Number(fields[totalI] ?? 0)) : 0;
    out.push({
      day,
      daily: Number.isFinite(daily) ? daily : 0,
      total: Number.isFinite(total) ? total : 0,
    });
  }
  return out;
}

export function dedupePlay(rows: PlayInstallRow[]): PlayInstallRow[] {
  const byDay = new Map<string, PlayInstallRow>();
  for (const row of rows) {
    const prev = byDay.get(row.day);
    if (!prev || row.total >= prev.total) byDay.set(row.day, row);
  }
  return [...byDay.values()];
}

export function buildStoreDownloads(opts: {
  appleByDay: Map<string, number> | null;
  playRows: PlayInstallRow[] | null;
  chartDays: string[];
  missing?: string[];
  error?: string | null;
}): StoreDownloadResponse {
  const play = opts.playRows ? dedupePlay(opts.playRows) : null;
  const playByDay = new Map(play?.map((row) => [row.day, row.daily]) ?? []);
  const perDay = opts.chartDays.map((day) => ({
    day,
    count: (opts.appleByDay?.get(day) ?? 0) + (playByDay.get(day) ?? 0),
  }));
  const last7Days = opts.chartDays.slice(-7);
  const last7 = last7Days.reduce(
    (sum, day) => sum + (opts.appleByDay?.get(day) ?? 0) + (playByDay.get(day) ?? 0),
    0,
  );
  const ios = opts.appleByDay ? [...opts.appleByDay.values()].reduce((sum, n) => sum + n, 0) : null;
  let android: number | null = null;
  if (play) {
    const latest = [...play].sort((a, b) => a.day.localeCompare(b.day)).at(-1);
    android = latest && latest.total > 0 ? latest.total : play.reduce((sum, row) => sum + row.daily, 0);
  }
  const through = [...(opts.appleByDay?.keys() ?? []), ...(play?.map((row) => row.day) ?? [])].sort().at(-1) ?? null;
  return {
    ios,
    android,
    total: (ios ?? 0) + (android ?? 0),
    last7,
    perDay,
    through,
    missing: opts.missing ?? [],
    error: opts.error ?? null,
  };
}

export function storeSetupNote(missing: string[]): string | null {
  const apple = missing.some((name) => name.startsWith('APPSTORE_'));
  const play = missing.some((name) => name.startsWith('PLAY_'));
  if (apple && play) return 'App Store Connect and Google Play are not connected on the admin server yet.';
  if (apple) return 'App Store Connect is not connected on the admin server yet.';
  if (play) return 'Google Play reports are not connected on the admin server yet.';
  return null;
}

export function emptyStoreDownloads(missing: string[], error: string | null = null): StoreDownloadResponse {
  return { ios: null, android: null, total: 0, last7: 0, perDay: [], through: null, missing, error };
}
