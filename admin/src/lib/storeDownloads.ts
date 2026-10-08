import 'server-only';

import { createSign } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { adminDb } from './firebaseAdmin';
import {
  APPLE_APP_ID,
  PLAY_PACKAGE,
  buildStoreDownloads,
  decodeSecret,
  emptyStoreDownloads,
  pacificDays,
  parseAppleSalesTsv,
  parsePlayInstallsCsv,
  type StoreDownloadResponse,
} from './storeReports';

const CACHE_DOC = 'storeStats/downloads';
const FRESH_MS = 6 * 60 * 60 * 1000;
const ERROR_FRESH_MS = 20 * 60 * 1000;
const HISTORY_DAYS = 35;
const CHART_DAYS = 14;

const APPLE_NAMES = ['APPSTORE_ISSUER_ID', 'APPSTORE_KEY_ID', 'APPSTORE_PRIVATE_KEY', 'APPSTORE_VENDOR_NUMBER'] as const;
const PLAY_NAMES = ['PLAY_SERVICE_ACCOUNT', 'PLAY_REPORTS_BUCKET'] as const;

let memory: { at: number; body: StoreDownloadResponse } | null = null;
let appleToken: { value: string; exp: number } | null = null;
let playToken: { value: string; exp: number } | null = null;

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export function missingStoreCredentials(): string[] {
  return [...APPLE_NAMES, ...PLAY_NAMES].filter((name) => !env(name));
}

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signJwt(header: object, payload: object, pem: string, algorithm: 'SHA256' | 'RSA-SHA256', ieee = false): string {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sign = createSign(algorithm);
  sign.update(data);
  const signature = sign.sign(ieee ? { key: pem, dsaEncoding: 'ieee-p1363' } : pem);
  return `${data}.${b64url(signature)}`;
}

async function appStoreToken(): Promise<string> {
  if (appleToken && appleToken.exp > Date.now() + 60_000) return appleToken.value;
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt(
    { alg: 'ES256', kid: env('APPSTORE_KEY_ID'), typ: 'JWT' },
    { iss: env('APPSTORE_ISSUER_ID'), iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' },
    decodeSecret(env('APPSTORE_PRIVATE_KEY')),
    'SHA256',
    true,
  );
  appleToken = { value: token, exp: Date.now() + 10 * 60 * 1000 };
  return token;
}

async function playAccessToken(): Promise<string> {
  if (playToken && playToken.exp > Date.now() + 60_000) return playToken.value;
  const json = JSON.parse(decodeSecret(env('PLAY_SERVICE_ACCOUNT'))) as { client_email?: string; private_key?: string };
  if (!json.client_email || !json.private_key) throw new Error('PLAY_SERVICE_ACCOUNT is not a service-account key');
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: json.client_email,
      scope: 'https://www.googleapis.com/auth/devstorage.read_only',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    json.private_key.replace(/\\n/g, '\n'),
    'RSA-SHA256',
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error('Play sign-in was rejected');
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Play sign-in returned no token');
  playToken = { value: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000 };
  return body.access_token;
}

function playBucket(): string {
  return env('PLAY_REPORTS_BUCKET').replace(/^gs:\/\//, '').split('/')[0];
}

async function appleDay(day: string, token: string): Promise<{ tsv: string | null; fatal: string | null }> {
  for (const version of ['1_0', '1_1']) {
    const url = new URL('https://api.appstoreconnect.apple.com/v1/salesReports');
    url.searchParams.set('filter[frequency]', 'DAILY');
    url.searchParams.set('filter[reportType]', 'SALES');
    url.searchParams.set('filter[reportSubType]', 'SUMMARY');
    url.searchParams.set('filter[version]', version);
    url.searchParams.set('filter[vendorNumber]', env('APPSTORE_VENDOR_NUMBER'));
    url.searchParams.set('filter[reportDate]', day);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' },
    });
    if (res.status === 401 || res.status === 403) return { tsv: null, fatal: 'App Store Connect rejected the API key' };
    if (res.status === 404) return { tsv: null, fatal: null };
    if (res.status === 400 && version === '1_0') continue;
    if (!res.ok) return { tsv: null, fatal: 'App Store Connect rejected the report request' };
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
    return { tsv: text, fatal: null };
  }
  return { tsv: null, fatal: 'App Store Connect rejected the report request' };
}

async function fetchApple(days: string[]): Promise<{ byDay: Map<string, number> | null; error: string | null }> {
  if (APPLE_NAMES.some((name) => !env(name))) return { byDay: null, error: null };
  try {
    const token = await appStoreToken();
    const byDay = new Map<string, number>();
    const queue = [...days];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const day = queue.shift();
        if (!day) return;
        const result = await appleDay(day, token);
        if (result.fatal) throw new Error(result.fatal);
        if (!result.tsv) continue;
        for (const [reportDay, units] of parseAppleSalesTsv(result.tsv, env('APPSTORE_APPLE_ID') || APPLE_APP_ID)) {
          byDay.set(reportDay, (byDay.get(reportDay) ?? 0) + units);
        }
      }
    });
    await Promise.all(workers);
    return { byDay, error: null };
  } catch (e) {
    return { byDay: null, error: e instanceof Error ? e.message : 'App Store Connect failed' };
  }
}

async function fetchPlay(days: string[]): Promise<{ rows: ReturnType<typeof parsePlayInstallsCsv> | null; error: string | null }> {
  if (PLAY_NAMES.some((name) => !env(name))) return { rows: null, error: null };
  try {
    const token = await playAccessToken();
    const months = [...new Set(days.map((day) => day.slice(0, 7).replace('-', '')))];
    const rows: ReturnType<typeof parsePlayInstallsCsv> = [];
    for (const month of months) {
      const object = `stats/installs/installs_${PLAY_PACKAGE}_${month}_overview.csv`;
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(playBucket())}/o/${encodeURIComponent(object)}?alt=media`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 404) continue;
      if (res.status === 401 || res.status === 403) throw new Error('Play reports rejected the service account');
      if (!res.ok) throw new Error('Play install report could not be read');
      rows.push(...parsePlayInstallsCsv(await res.text()));
    }
    return { rows, error: null };
  } catch (e) {
    return { rows: null, error: e instanceof Error ? e.message : 'Google Play failed' };
  }
}

function freshEnough(body: StoreDownloadResponse, at: number): boolean {
  const age = Date.now() - at;
  return body.error ? age < ERROR_FRESH_MS : age < FRESH_MS;
}

async function readCache(): Promise<StoreDownloadResponse | null> {
  if (memory && freshEnough(memory.body, memory.at)) return memory.body;
  try {
    const snap = await adminDb().doc(CACHE_DOC).get();
    const data = snap.data();
    const at = Date.parse(String(data?.fetchedAt ?? ''));
    const body = data?.body as StoreDownloadResponse | undefined;
    if (!body || !Number.isFinite(at) || !freshEnough(body, at)) return null;
    memory = { at, body };
    return body;
  } catch {
    return null;
  }
}

async function writeCache(body: StoreDownloadResponse): Promise<void> {
  memory = { at: Date.now(), body };
  try {
    await adminDb().doc(CACHE_DOC).set({ fetchedAt: new Date().toISOString(), body });
  } catch {
    // The page can still use this response. The next call fetches again.
  }
}

/** First-time downloads from App Store Connect and the Play Console install report. */
export async function loadStoreDownloads(): Promise<StoreDownloadResponse> {
  const missing = missingStoreCredentials();
  if (missing.length === APPLE_NAMES.length + PLAY_NAMES.length) return emptyStoreDownloads(missing);
  const cached = await readCache();
  if (cached && cached.missing.join() === missing.join()) return cached;

  const history = pacificDays(HISTORY_DAYS, Date.now(), 1);
  const [apple, play] = await Promise.all([fetchApple(history), fetchPlay(history)]);
  const error = [apple.error, play.error].filter(Boolean).join(' · ') || null;
  const body = buildStoreDownloads({
    appleByDay: apple.byDay,
    playRows: play.rows,
    chartDays: history.slice(-CHART_DAYS),
    missing,
    error,
  });
  await writeCache(body);
  return body;
}
