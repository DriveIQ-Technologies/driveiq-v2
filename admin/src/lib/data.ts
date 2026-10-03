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
  type Firestore,
} from 'firebase/firestore';

import { isDemo } from './demo';
import { clientDb } from './firebaseClient';
import {
  ageLabel,
  countBy,
  estimateCostUsd,
  feedHealth,
  lastDays,
  londonDay,
  waitlistStatus,
  subscriptionPlan,
  type Health,
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
  health: Health;
}

const FEEDS: { name: string; path: string; everyMinutes: number; detail: (d: Doc) => string }[] = [
  { name: 'Heathrow board', path: 'airportCache/EGLL', everyMinutes: 10, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'Gatwick board', path: 'airportCache/EGKK', everyMinutes: 10, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'Stansted board', path: 'airportCache/EGSS', everyMinutes: 15, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'Luton board', path: 'airportCache/EGGW', everyMinutes: 15, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'London City board', path: 'airportCache/EGLC', everyMinutes: 15, detail: (d) => `${num(d.flightCount) ?? 0} flights` },
  { name: 'Heathrow all-day board', path: 'airportCacheDay/EGLL-0', everyMinutes: 60, detail: () => 'Premium full-day view' },
  { name: 'National Rail', path: 'railCache/national', everyMinutes: 5, detail: (d) => `${Array.isArray(d.operators) ? d.operators.length : 0} operators` },
  { name: 'Events catalogue', path: 'eventsPublishedMeta/current', everyMinutes: 12 * 60, detail: (d) => `${num(d.count) ?? 0} events published` },
];

export async function getHealth(): Promise<Feed[]> {
  if (isDemo()) return demoHealth();
  const db = clientDb();
  const snaps = await Promise.all(FEEDS.map((f) => getDoc(pathRef(db, f.path))));
  const feeds: Feed[] = FEEDS.map((f, i) => {
    const d = (snaps[i].data() ?? {}) as Doc;
    const updatedAt = str(d.updatedAt);
    return {
      name: f.name,
      detail: snaps[i].exists() ? f.detail(d) : 'no data',
      updatedAt,
      age: ageLabel(updatedAt),
      everyMinutes: f.everyMinutes,
      health: feedHealth(updatedAt, f.everyMinutes),
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
    health: feedHealth(roadAt, 5),
  });
  return feeds;
}

// ── Overview ───────────────────────────────────────────────────────────────

export interface Overview {
  users: { total: number; last7: number; withPush: number; ios: number; android: number };
  signups: { day: string; count: number }[];
  waitlist: { total: number; byStatus: Partial<Record<WaitlistStatus, number>> };
  ai: { questions7: number; cost7: number };
  feedsDown: number;
  feedsLate: number;
}

export async function getOverview(): Promise<Overview> {
  if (isDemo()) return demoOverview();
  const db = clientDb();
  const users = collection(db, 'users');
  const [total, last7, ios, android, recent, tokens, ai, feeds] = await Promise.all([
    getCountFromServer(users),
    getCountFromServer(query(users, where('createdAt', '>=', isoDaysAgo(7)))),
    getCountFromServer(query(users, where('pushPlatform', '==', 'ios'))),
    getCountFromServer(query(users, where('pushPlatform', '==', 'android'))),
    getDocs(query(users, where('createdAt', '>=', isoDaysAgo(14)))),
    getDocs(query(collection(db, 'waitlistTokens'), limit(5000))),
    getDocs(query(collection(db, 'aiCostLog'), where('createdAt', '>=', isoDaysAgo(7)), limit(5000))),
    getHealth(),
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
      withPush: ios.data().count + android.data().count,
      ios: ios.data().count,
      android: android.data().count,
    },
    signups: lastDays(14).map((day) => ({ day, count: perDay[day] ?? 0 })),
    waitlist: { total: tokenRows.length, byStatus: countBy(tokenRows, (t) => waitlistStatus(t)) },
    ai: {
      questions7: ai.size,
      cost7: ai.docs.reduce((sum, d) => sum + estimateCostUsd(d.data()), 0),
    },
    feedsDown: feeds.filter((f) => f.health === 'down').length,
    feedsLate: feeds.filter((f) => f.health === 'late').length,
  };
}

// ── Users ──────────────────────────────────────────────────────────────────

export interface UserRow {
  uid: string;
  email: string | null;
  name: string | null;
  createdAt: string | null;
  provider: string | null;
  push: string | null;
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

// ── Demo data (DEMO_DATA=1 only) ───────────────────────────────────────────

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

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
    health: feedHealth(minsAgo(ago), every),
  }));
}

function demoOverview(): Overview {
  return {
    users: { total: 412, last7: 63, withPush: 297, ios: 241, android: 56 },
    signups: lastDays(14).map((day, i) => ({ day, count: [3, 5, 2, 8, 6, 4, 9, 7, 12, 10, 6, 14, 18, 11][i] ?? 0 })),
    waitlist: { total: 398, byStatus: { 'week-running': 41, 'week-ended': 27, unclaimed: 301, expiring: 18, expired: 11 } },
    ai: { questions7: 184, cost7: 2.37 },
    feedsDown: 0,
    feedsLate: 1,
  };
}

const DEMO_USERS: UserRow[] = [
  { uid: 'demo-u1', email: 'amir.k@example.com', name: 'Amir K', createdAt: minsAgo(40), provider: 'apple', push: 'ios', watchedFlights: 2, savedEvents: 5, planLabel: 'Premium Monthly', planTrial: true },
  { uid: 'demo-u2', email: 'sarah.driver@example.com', name: 'Sarah M', createdAt: minsAgo(300), provider: 'google', push: 'android', watchedFlights: 0, savedEvents: 1, planLabel: 'Free', planTrial: false },
  { uid: 'demo-u3', email: 'tomasz@example.com', name: null, createdAt: minsAgo(1500), provider: 'password', push: null, watchedFlights: 1, savedEvents: 0, planLabel: 'Free', planTrial: false },
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
