import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type CollectionReference,
  type Firestore,
  type QueryFieldFilterConstraint,
} from 'firebase/firestore';

import { isDemo } from './demo';
import { clientDb } from './firebaseClient';
import {
  ageLabel,
  countBy,
  devicePlatform,
  estimateCostUsd,
  feedHealth,
  isAirportNight,
  lastDays,
  londonDay,
  platformCounts,
  waitlistStatus,
  subscriptionPlan,
  type DevicePlatform,
  type Health,
  type PlatformCounts,
  type WaitlistStatus,
  type WaitlistTokenRow,
} from './metrics';

type Doc = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isoDaysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const pathRef = (db: Firestore, path: string) => {
  const [col, ...rest] = path.split('/');
  return doc(db, col, ...rest);
};

// ── System health ──────────────────────────────────────────────────────────

export interface Feed {
  name: string;
  detail: string;
  updatedAt: string | null;
  age: string;
  everyMinutes: number;
  /** Human schedule, including the overnight slowdown when it is in force. */
  schedule: string;
  health: Health;
}

// nightEveryMinutes: the schedule between 01:00 and 04:00 London, when the
// airport jobs slow down (boards every 30 min; the all-day boards pause).
const FEEDS: {
  name: string;
  path: string;
  everyMinutes: number;
  nightEveryMinutes?: number;
  detail: (d: Doc) => string;
}[] = [
  { name: 'Heathrow board', path: 'airportCache/EGLL', everyMinutes: 5, nightEveryMinutes: 30, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'Gatwick board', path: 'airportCache/EGKK', everyMinutes: 5, nightEveryMinutes: 30, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'Stansted board', path: 'airportCache/EGSS', everyMinutes: 15, nightEveryMinutes: 30, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'Luton board', path: 'airportCache/EGGW', everyMinutes: 15, nightEveryMinutes: 30, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'London City board', path: 'airportCache/EGLC', everyMinutes: 15, nightEveryMinutes: 30, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'Heathrow all-day board', path: 'airportCacheDay/EGLL-0', everyMinutes: 60, nightEveryMinutes: 4 * 60, detail: () => 'Premium full-day view' },
  { name: 'National Rail', path: 'railCache/national', everyMinutes: 5, detail: (d) => `${Array.isArray(d.operators) ? d.operators.length : 0} operators` },
  { name: 'Events catalogue', path: 'eventsPublishedMeta/current', everyMinutes: 12 * 60, detail: (d) => `${num(d.count) ?? 0} events published` },
];

export async function getHealth(): Promise<Feed[]> {
  if (isDemo()) return demoHealth();
  const db = clientDb();
  const snaps = await Promise.all(FEEDS.map((f) => getDoc(pathRef(db, f.path))));
  const night = isAirportNight();
  const feeds: Feed[] = FEEDS.map((f, i) => {
    const d = (snaps[i].data() ?? {}) as Doc;
    const updatedAt = str(d.updatedAt);
    const every = f.nightEveryMinutes && night ? f.nightEveryMinutes : f.everyMinutes;
    const schedule =
      f.nightEveryMinutes && night
        ? `every ${f.nightEveryMinutes} min overnight`
        : every >= 60
          ? `every ${every / 60} h`
          : `every ${every} min`;
    return {
      name: f.name,
      detail: snaps[i].exists() ? f.detail(d) : 'no data',
      updatedAt,
      age: ageLabel(updatedAt),
      everyMinutes: every,
      schedule,
      health: feedHealth(updatedAt, every),
    };
  });
  const roads = await getDocs(query(collection(db, 'roadCorridors'), orderBy('updatedAt', 'desc'), limit(1)));
  const roadAt = roads.empty ? null : str(roads.docs[0].data().updatedAt);
  feeds.push({
    name: 'Road corridors',
    detail: 'TfL + Highways incidents',
    updatedAt: roadAt,
    age: ageLabel(roadAt),
    everyMinutes: 5,
    schedule: 'every 5 min',
    health: feedHealth(roadAt, 5),
  });
  return feeds;
}

// ── Overview ───────────────────────────────────────────────────────────────

export interface Overview {
  users: {
    total: number;
    last7: number;
    /** Push token registered (pushPlatform set), split by phone. */
    withPush: number;
    pushIos: number;
    pushAndroid: number;
    /** Every account by phone, push or not. */
    devices: PlatformCounts;
  };
  signups: { day: string; count: number }[];
  waitlist: { total: number; byStatus: Partial<Record<WaitlistStatus, number>> };
  ai: { questions7: number; cost7: number };
  downloads: DownloadStats;
  feedsDown: number;
  feedsLate: number;
}

export interface DownloadStats {
  total: number;
  ios: number;
  android: number;
  withAccount: number;
  last7: number;
}

export async function getOverview(): Promise<Overview> {
  if (isDemo()) return demoOverview();
  const db = clientDb();
  const users = collection(db, 'users');
  const [total, last7, devices, recent, tokens, ai, feeds, downloads] = await Promise.all([
    getCountFromServer(users),
    getCountFromServer(query(users, where('createdAt', '>=', isoDaysAgo(7)))),
    countDevices(users),
    getDocs(query(users, where('createdAt', '>=', isoDaysAgo(14)))),
    getDocs(query(collection(db, 'waitlistTokens'), limit(5000))),
    getDocs(query(collection(db, 'aiCostLog'), where('createdAt', '>=', isoDaysAgo(7)), limit(5000))),
    getHealth(),
    countInstalls(db),
  ]);
  const perDay = countBy(
    recent.docs.map((d) => str(d.data().createdAt)).filter((x): x is string => Boolean(x)),
    (iso) => londonDay(iso),
  );
  const tokenRows = tokens.docs.map((d) => d.data() as WaitlistTokenRow);
  return {
    users: {
      total: total.data().count,
      last7: last7.data().count,
      withPush: devices.pushIos + devices.pushAndroid,
      pushIos: devices.pushIos,
      pushAndroid: devices.pushAndroid,
      devices: platformCounts({ total: total.data().count, ...devices }),
    },
    signups: lastDays(14).map((day) => ({ day, count: perDay[day] ?? 0 })),
    waitlist: { total: tokenRows.length, byStatus: countBy(tokenRows, (t) => waitlistStatus(t)) },
    ai: {
      questions7: ai.size,
      cost7: ai.docs.reduce((sum, d) => sum + estimateCostUsd(d.data()), 0),
    },
    downloads,
    feedsDown: feeds.filter((f) => f.health === 'down').length,
    feedsLate: feeds.filter((f) => f.health === 'late').length,
  };
}

/**
 * Counts behind platformCounts. Equality-only filters, so Firestore serves
 * them from single-field indexes — no composite index to deploy.
 */
async function countDevices(users: CollectionReference) {
  const n = (...filters: QueryFieldFilterConstraint[]) =>
    getCountFromServer(query(users, ...filters)).then((s) => s.data().count);
  const eq = (field: string, value: string) => where(field, '==', value);
  const [platformIos, platformAndroid, pushIos, pushAndroid, pIosOnIos, pIosOnAndroid, pAndOnIos, pAndOnAndroid] =
    await Promise.all([
      n(eq('platform', 'ios')),
      n(eq('platform', 'android')),
      n(eq('pushPlatform', 'ios')),
      n(eq('pushPlatform', 'android')),
      n(eq('pushPlatform', 'ios'), eq('platform', 'ios')),
      n(eq('pushPlatform', 'ios'), eq('platform', 'android')),
      n(eq('pushPlatform', 'android'), eq('platform', 'ios')),
      n(eq('pushPlatform', 'android'), eq('platform', 'android')),
    ]);
  return {
    platformIos,
    platformAndroid,
    pushIos,
    pushAndroid,
    pushIosWithPlatform: pIosOnIos + pIosOnAndroid,
    pushAndroidWithPlatform: pAndOnIos + pAndOnAndroid,
  };
}

async function countInstalls(db: Firestore): Promise<DownloadStats> {
  const empty = { total: 0, ios: 0, android: 0, withAccount: 0, last7: 0 };
  try {
    const installs = collection(db, 'installs');
    const n = (...filters: QueryFieldFilterConstraint[]) =>
      getCountFromServer(query(installs, ...filters)).then((s) => s.data().count);
    const [total, ios, android, withAccount, last7] = await Promise.all([
      n(),
      n(where('platform', '==', 'ios')),
      n(where('platform', '==', 'android')),
      n(where('account', '==', true)),
      n(where('firstSeenAt', '>=', isoDaysAgo(7))),
    ]);
    return { total, ios, android, withAccount, last7 };
  } catch {
    return empty;
  }
}

export interface PlacePin {
  id: string;
  platform: DevicePlatform;
  area: string | null;
  lat: number;
  lng: number;
  lastSeenAt: string | null;
  account: boolean;
}

export async function getDownloadActivity(): Promise<{
  perDay: { day: string; count: number }[];
  places: PlacePin[];
}> {
  if (isDemo()) return demoDownloadActivity();
  const db = clientDb();
  try {
    const [opened, seen] = await Promise.all([
      getDocs(query(collection(db, 'installs'), where('firstSeenAt', '>=', isoDaysAgo(14)), limit(2000))),
      getDocs(query(collection(db, 'installs'), where('lastSeenAt', '>=', isoDaysAgo(2)), limit(500))),
    ]);
    const perDay = countBy(
      opened.docs.map((d) => str(d.data().firstSeenAt)).filter((x): x is string => Boolean(x)),
      (iso) => londonDay(iso),
    );
    const places: PlacePin[] = [];
    for (const d of seen.docs) {
      const data = d.data();
      const lat = num(data.lat);
      const lng = num(data.lng);
      if (lat == null || lng == null) continue;
      places.push({
        id: d.id,
        platform: devicePlatform(data),
        area: str(data.area),
        lat,
        lng,
        lastSeenAt: str(data.lastSeenAt),
        account: data.account === true,
      });
    }
    return {
      perDay: lastDays(14).map((day) => ({ day, count: perDay[day] ?? 0 })),
      places,
    };
  } catch {
    return { perDay: lastDays(14).map((day) => ({ day, count: 0 })), places: [] };
  }
}

export interface AudienceRow {
  email: string;
  name: string | null;
  source: string;
  platform: string;
  joined: string | null;
  marketing: boolean;
}

/** Account emails plus waitlist emails, one row per address, for a Brevo import. */
export async function listAudience(): Promise<AudienceRow[]> {
  if (isDemo()) return demoAudience();
  const db = clientDb();
  const [users, tokens] = await Promise.all([
    getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(2000))),
    getDocs(query(collection(db, 'waitlistTokens'), limit(5000))),
  ]);
  const byEmail = new Map<string, AudienceRow>();
  for (const d of users.docs) {
    const data = d.data();
    const email = str(data.email)?.trim().toLowerCase();
    if (!email) continue;
    byEmail.set(email, {
      email,
      name: str(data.displayName),
      source: 'Account',
      platform: devicePlatform(data) === 'ios' ? 'iPhone' : devicePlatform(data) === 'android' ? 'Android' : '',
      joined: str(data.createdAt),
      marketing: data.marketingConsent === true,
    });
  }
  for (const d of tokens.docs) {
    const email = str(d.data().email)?.trim().toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) {
      existing.source = existing.source.includes('Waitlist') ? existing.source : `${existing.source} + waitlist`;
    } else {
      byEmail.set(email, {
        email,
        name: null,
        source: 'Waitlist',
        platform: '',
        joined: null,
        marketing: false,
      });
    }
  }
  return [...byEmail.values()].sort((a, b) => String(b.joined ?? '').localeCompare(String(a.joined ?? '')));
}

export function audienceCsv(rows: AudienceRow[]): string {
  const header = ['email', 'name', 'source', 'platform', 'joined', 'marketing_opt_in'];
  const lines = rows.map((r) =>
    [r.email, r.name ?? '', r.source, r.platform, r.joined ?? '', r.marketing ? 'yes' : 'no']
      .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

// ── Users ──────────────────────────────────────────────────────────────────

export interface UserRow {
  uid: string;
  email: string | null;
  name: string | null;
  createdAt: string | null;
  provider: string | null;
  push: string | null;
  /** Phone from `platform`, falling back to pushPlatform; 'unknown' until they open the updated app. */
  device: DevicePlatform;
  appVersion: string | null;
  lastSeenAt: string | null;
  watchedFlights: number;
  savedEvents: number;
  planLabel: string;
  planTrial: boolean;
}

function toUserRow(uid: string, d: Doc): UserRow {
  return {
    uid,
    email: str(d.email),
    name: str(d.displayName),
    createdAt: str(d.createdAt),
    provider: str(d.authProvider),
    push: Array.isArray(d.fcmTokens) && d.fcmTokens.length > 0 ? (str(d.pushPlatform) ?? 'yes') : null,
    device: devicePlatform(d),
    appVersion: str(d.appVersion),
    lastSeenAt: str(d.lastSeenAt),
    watchedFlights: Array.isArray(d.savedFlights) ? d.savedFlights.length : 0,
    savedEvents: num(d.savedEventsCount) ?? (Array.isArray(d.savedEvents) ? d.savedEvents.length : 0),
    planLabel: subscriptionPlan(d).label,
    planTrial: subscriptionPlan(d).trial,
  };
}

/** Newest 50, or one user by exact email / user id. */
export async function listUsers(q?: string): Promise<UserRow[]> {
  if (isDemo()) return demoUsers(q);
  const db = clientDb();
  const queryText = (q ?? '').trim();
  if (queryText.includes('@')) {
    const snap = await getDocs(query(collection(db, 'users'), where('email', '==', queryText.toLowerCase()), limit(10)));
    return snap.docs.map((d) => toUserRow(d.id, d.data()));
  }
  if (queryText) {
    const snap = await getDoc(doc(db, 'users', queryText));
    return snap.exists() ? [toUserRow(snap.id, snap.data() ?? {})] : [];
  }
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(50)));
  return snap.docs.map((d) => toUserRow(d.id, d.data()));
}

export interface UserDetail extends UserRow {
  emailVerified: boolean;
  marketingConsent: boolean;
  notificationPrefs: Record<string, boolean>;
  watched: { flightNumber: string; airportId: string; state: string }[];
  waitlist: { email: string | null; status: WaitlistStatus; premiumUntil: string | null; claimedAt: string | null } | null;
  ai: { questions14: number; cost14: number };
  reports: number;
  planNote: string | null;
}

export async function getUser(uid: string): Promise<UserDetail | null> {
  if (isDemo()) return demoUserDetail(uid);
  const db = clientDb();
  const [userSnap, stateSnap, tokenSnap, aiSnap, reportSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDoc(doc(db, 'users', uid, 'notificationState', 'default')),
    getDocs(query(collection(db, 'waitlistTokens'), where('claimedByUid', '==', uid), limit(1))),
    getDocs(query(collection(db, 'aiCostLog'), where('uid', '==', uid), limit(500))),
    getCountFromServer(query(collection(db, 'communityReports'), where('uid', '==', uid))),
  ]);
  if (!userSnap.exists()) return null;
  const d = (userSnap.data() ?? {}) as Doc;
  const state = ((stateSnap.data() ?? {}).flights ?? {}) as Record<string, Doc>;
  const since = isoDaysAgo(14);
  const ai14 = aiSnap.docs.map((x) => x.data()).filter((x) => String(x.createdAt ?? '') >= since);
  const token = tokenSnap.empty ? null : (tokenSnap.docs[0].data() as WaitlistTokenRow);
  const prefs = (d.notificationPrefs ?? {}) as Record<string, unknown>;
  return {
    ...toUserRow(uid, d),
    emailVerified: Boolean(d.emailVerified),
    marketingConsent: Boolean(d.marketingConsent),
    notificationPrefs: Object.fromEntries(Object.entries(prefs).map(([k, v]) => [k, v !== false])),
    watched: (Array.isArray(d.savedFlights) ? (d.savedFlights as Doc[]) : []).map((f) => {
      const s = state[String(f.id)] ?? {};
      const label = s.cancelled
        ? 'cancelled'
        : s.status === 'Arrived' || s.status === 'Departed'
          ? String(s.status).toLowerCase()
          : s.delayed
            ? `+${num(s.delayMinutes) ?? 0} min`
            : s.status
              ? 'on time'
              : 'not checked yet';
      return { flightNumber: String(f.flightNumber ?? f.id), airportId: String(f.airportId ?? ''), state: label };
    }),
    waitlist: token
      ? {
          email: str(token.email),
          status: waitlistStatus(token),
          premiumUntil: str(token.premiumUntil),
          claimedAt: str(token.claimedAt),
        }
      : null,
    ai: { questions14: ai14.length, cost14: ai14.reduce((s, x) => s + estimateCostUsd(x), 0) },
    reports: reportSnap.data().count,
    planNote:
      d.premiumStatus === 'cancelled'
        ? 'Subscription cancelled. They will not be charged for this trial.'
        : null,
  };
}

// ── Waitlist ───────────────────────────────────────────────────────────────

export interface WaitlistRow {
  code: string;
  email: string | null;
  status: WaitlistStatus;
  expiresAt: string | null;
  claimedAt: string | null;
  premiumUntil: string | null;
  claimedByUid: string | null;
}

export async function getWaitlist(): Promise<WaitlistRow[]> {
  if (isDemo()) return demoWaitlist();
  const snap = await getDocs(query(collection(clientDb(), 'waitlistTokens'), limit(5000)));
  return snap.docs
    .map((d) => {
      const t = d.data() as WaitlistTokenRow;
      return {
        code: d.id,
        email: str(t.email),
        status: waitlistStatus(t),
        expiresAt: str(t.expiresAt),
        claimedAt: str(t.claimedAt),
        premiumUntil: str(t.premiumUntil),
        claimedByUid: str(t.claimedByUid),
      };
    })
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));
}

// ── AI usage ───────────────────────────────────────────────────────────────

export interface AiDay {
  day: string;
  questions: number;
  cost: number;
  haiku: number;
  sonnet: number;
}

export async function getAiUsage(days = 14): Promise<{ perDay: AiDay[]; topUsers: { uid: string; questions: number; cost: number }[] }> {
  if (isDemo()) return demoAi(days);
  const snap = await getDocs(query(collection(clientDb(), 'aiCostLog'), where('createdAt', '>=', isoDaysAgo(days)), limit(10000)));
  const rows = snap.docs.map((d) => d.data());
  const byDay = new Map<string, AiDay>(lastDays(days).map((day) => [day, { day, questions: 0, cost: 0, haiku: 0, sonnet: 0 }]));
  const byUser = new Map<string, { uid: string; questions: number; cost: number }>();
  for (const r of rows) {
    const day = londonDay(String(r.createdAt));
    const cost = estimateCostUsd(r);
    const bucket = byDay.get(day);
    if (bucket) {
      bucket.questions += 1;
      bucket.cost += cost;
      if (String(r.model) === 'haiku') bucket.haiku += 1;
      else bucket.sonnet += 1;
    }
    const uid = String(r.uid ?? 'unknown');
    const u = byUser.get(uid) ?? { uid, questions: 0, cost: 0 };
    u.questions += 1;
    u.cost += cost;
    byUser.set(uid, u);
  }
  return {
    perDay: [...byDay.values()],
    topUsers: [...byUser.values()].sort((a, b) => b.cost - a.cost).slice(0, 10),
  };
}

export interface FlightApiDay {
  day: string;
  calls: number;
  failed: number;
}

/** AeroDataBox requests the server actually made. One call is one credit. */
export async function getFlightApiUsage(days = 14): Promise<{
  perDay: FlightApiDay[];
  byAirport: { icao: string; calls: number; failed: number }[];
}> {
  if (isDemo()) return demoFlightApi(days);
  try {
    const snap = await getDocs(
      query(collection(clientDb(), 'flightApiLog'), where('createdAt', '>=', isoDaysAgo(days)), limit(10000)),
    );
    const byDay = new Map<string, FlightApiDay>(
      lastDays(days).map((day) => [day, { day, calls: 0, failed: 0 }]),
    );
    const byAirport = new Map<string, { icao: string; calls: number; failed: number }>();
    for (const d of snap.docs) {
      const r = d.data();
      const day = londonDay(String(r.createdAt ?? ''));
      const bucket = byDay.get(day);
      const failed = r.ok === false;
      if (bucket) {
        bucket.calls += 1;
        if (failed) bucket.failed += 1;
      }
      const icao = String(r.icao ?? 'unknown');
      const airport = byAirport.get(icao) ?? { icao, calls: 0, failed: 0 };
      airport.calls += 1;
      if (failed) airport.failed += 1;
      byAirport.set(icao, airport);
    }
    return {
      perDay: [...byDay.values()],
      byAirport: [...byAirport.values()].sort((a, b) => b.calls - a.calls),
    };
  } catch {
    return { perDay: lastDays(days).map((day) => ({ day, calls: 0, failed: 0 })), byAirport: [] };
  }
}

// ── Demo data (DEMO_DATA=1 only) ───────────────────────────────────────────

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function demoDownloadActivity(): { perDay: { day: string; count: number }[]; places: PlacePin[] } {
  return {
    perDay: lastDays(14).map((day, i) => ({ day, count: [4, 6, 3, 9, 8, 5, 11, 7, 14, 12, 8, 16, 20, 13][i] ?? 0 })),
    places: [
      { id: 'p1', platform: 'ios', area: 'Croydon', lat: 51.37, lng: -0.1, lastSeenAt: minsAgo(20), account: true },
      { id: 'p2', platform: 'android', area: 'Ealing', lat: 51.51, lng: -0.3, lastSeenAt: minsAgo(50), account: false },
    ],
  };
}

function demoAudience(): AudienceRow[] {
  return [
    { email: 'amir.k@example.com', name: 'Amir K', source: 'Account + waitlist', platform: 'iPhone', joined: minsAgo(40), marketing: false },
    { email: 'jo.cab@example.com', name: null, source: 'Waitlist', platform: '', joined: null, marketing: false },
  ];
}

function demoHealth(): Feed[] {
  const rows: [string, string, number, number][] = [
    ['Heathrow board', '453 flights', 10, 4],
    ['Gatwick board', '273 flights', 10, 4],
    ['Stansted board', '229 flights', 15, 9],
    ['Luton board', '133 flights', 15, 9],
    ['London City board', '56 flights', 15, 41],
    ['Heathrow all-day board', 'Premium full-day view', 60, 22],
    ['National Rail', '18 operators', 5, 2],
    ['Events catalogue', '1,186 events published', 720, 300],
    ['Road corridors', 'TfL + Highways incidents', 5, 3],
  ];
  return rows.map(([name, detail, every, ago]) => ({
    name,
    detail,
    updatedAt: minsAgo(ago),
    age: ageLabel(minsAgo(ago)),
    everyMinutes: every,
    schedule: every >= 60 ? `every ${every / 60} h` : `every ${every} min`,
    health: feedHealth(minsAgo(ago), every),
  }));
}

function demoOverview(): Overview {
  return {
    users: {
      total: 412,
      last7: 63,
      withPush: 241,
      pushIos: 241,
      pushAndroid: 0,
      devices: { ios: 288, android: 71, unknown: 53 },
    },
    signups: lastDays(14).map((day, i) => ({ day, count: [3, 5, 2, 8, 6, 4, 9, 7, 12, 10, 6, 14, 18, 11][i] ?? 0 })),
    waitlist: { total: 398, byStatus: { 'week-running': 41, 'week-ended': 27, unclaimed: 301, expiring: 18, expired: 11 } },
    ai: { questions7: 184, cost7: 2.37 },
    downloads: { total: 640, ios: 510, android: 130, withAccount: 412, last7: 88 },
    feedsDown: 0,
    feedsLate: 1,
  };
}

const DEMO_USERS: UserRow[] = [
  { uid: 'demo-u1', email: 'amir.k@example.com', name: 'Amir K', createdAt: minsAgo(40), provider: 'apple', push: 'ios', device: 'ios', appVersion: '6.3.8', lastSeenAt: minsAgo(12), watchedFlights: 2, savedEvents: 5, planLabel: 'Premium Monthly', planTrial: true },
  { uid: 'demo-u2', email: 'sarah.driver@example.com', name: 'Sarah M', createdAt: minsAgo(300), provider: 'google', push: null, device: 'android', appVersion: '6.3.8', lastSeenAt: minsAgo(95), watchedFlights: 0, savedEvents: 1, planLabel: 'Free', planTrial: false },
  { uid: 'demo-u3', email: 'tomasz@example.com', name: null, createdAt: minsAgo(1500), provider: 'password', push: null, device: 'unknown', appVersion: null, lastSeenAt: null, watchedFlights: 1, savedEvents: 0, planLabel: 'Free', planTrial: false },
];

function demoUsers(q?: string): UserRow[] {
  const queryText = (q ?? '').trim().toLowerCase();
  return queryText ? DEMO_USERS.filter((u) => u.email?.includes(queryText) || u.uid === queryText) : DEMO_USERS;
}

function demoUserDetail(uid: string): UserDetail | null {
  const u = DEMO_USERS.find((x) => x.uid === uid);
  if (!u) return null;
  return {
    ...u,
    emailVerified: true,
    marketingConsent: false,
    notificationPrefs: { 'road-accidents': true, 'line-closures': true, 'saved-flights': true },
    watched: [
      { flightNumber: 'U2 8538', airportId: 'lgw', state: 'arrived' },
      { flightNumber: 'BA 544', airportId: 'lhr', state: '+25 min' },
    ].slice(0, u.watchedFlights),
    waitlist: { email: u.email, status: 'week-running', premiumUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(), claimedAt: minsAgo(4 * 1440) },
    ai: { questions14: 23, cost14: 0.31 },
    reports: 2,
    planNote: null,
  };
}

function demoWaitlist(): WaitlistRow[] {
  return [
    { code: 'K7PQ-2M', email: 'amir.k@example.com', status: 'week-running', expiresAt: null, claimedAt: minsAgo(5760), premiumUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(), claimedByUid: 'demo-u1' },
    { code: 'R3XT-9D', email: 'jo.cab@example.com', status: 'expiring', expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), claimedAt: null, premiumUntil: null, claimedByUid: null },
    { code: 'W9LB-4H', email: 'priya@example.com', status: 'unclaimed', expiresAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), claimedAt: null, premiumUntil: null, claimedByUid: null },
    { code: 'B2ZN-7F', email: 'dan.e@example.com', status: 'expired', expiresAt: minsAgo(2880), claimedAt: null, premiumUntil: null, claimedByUid: null },
  ];
}

function demoFlightApi(days: number): { perDay: FlightApiDay[]; byAirport: { icao: string; calls: number; failed: number }[] } {
  return {
    perDay: lastDays(days).map((day, i) => ({ day, calls: 40 + (i % 5) * 8, failed: i % 7 === 0 ? 1 : 0 })),
    byAirport: [
      { icao: 'EGLL', calls: 420, failed: 2 },
      { icao: 'EGKK', calls: 400, failed: 1 },
      { icao: 'EGSS', calls: 140, failed: 0 },
    ],
  };
}

function demoAi(days: number) {
  return {
    perDay: lastDays(days).map((day, i) => {
      const questions = [8, 12, 5, 19, 22, 14, 9, 17, 25, 31, 18, 27, 33, 21][i % 14];
      return { day, questions, cost: questions * 0.012, haiku: Math.round(questions * 0.7), sonnet: Math.round(questions * 0.3) };
    }),
    topUsers: [
      { uid: 'demo-u1', questions: 41, cost: 0.62 },
      { uid: 'demo-u2', questions: 17, cost: 0.19 },
    ],
  };
}
