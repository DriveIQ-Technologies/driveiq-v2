import { auth, authApi } from './firebase';
import type { AppEvent } from '@/types/event';

export interface AgentDiscoveredEvent {
  id: string;
  source: string;
  category: 'sports' | 'other';
  title: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  latitude: number;
  longitude: number;
  subCategory?: string;
  doorsAt?: string;
  realStartAt?: string;
  estimatedFinishAt?: string;
  turnoutMin?: number;
  turnoutMax?: number;
  copyLine?: string;
}

export interface AgentAnswer {
  ok: boolean;
  answer: string;
  capped: boolean;
  remaining: number | null;
  limit: number | null;
  model: 'haiku' | 'sonnet' | null;
  discoveredEvents?: AgentDiscoveredEvent[];
}

export interface AgentTurn {
  role: 'user' | 'assistant';
  text: string;
}

const PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'driveiq-app';
const HTTP_URL = `https://europe-west2-${PROJECT_ID}.cloudfunctions.net/askDriveiqAgentHttp`;

function preview(text: string, max = 120): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

type AgentHttpBody = {
  result?: AgentAnswer;
  error?: { message?: string; status?: string };
};

export interface AgentEventHint {
  title: string;
  venue: string;
  startsAt: string;
  endsAt?: string;
  doorsAt?: string;
  kind?: string;
  turnout?: string;
  featured?: boolean;
  copy?: string;
  status?: 'live' | 'upcoming' | 'finished';
  latitude?: number;
  longitude?: number;
  kmAway?: number;
}

export interface AgentLiveContext {
  events?: AgentEventHint[];
  roads?: string[];
  rails?: string[];
  premium?: boolean;
  clockLondon?: string;
  location?: { latitude: number; longitude: number; label?: string | null };
}

export async function askDriveiqAgent(
  question: string,
  history?: AgentTurn[],
  live?: AgentLiveContext,
): Promise<AgentAnswer> {
  let currentUser = auth?.currentUser;
  if (!currentUser && auth && authApi) {
    try {
      const cred = await authApi.signInAnonymously(auth);
      currentUser = cred.user;
    } catch (e) {
    }
  }
  if (!currentUser) {
    throw new Error('agent/unavailable');
  }

  const payload = {
    question,
    history: history?.length ? history : undefined,
    clientEvents: live?.events?.length ? live.events.slice(0, 80) : undefined,
    clientRoads: live?.roads?.length ? live.roads.slice(0, 24) : undefined,
    clientRails: live?.rails?.length ? live.rails.slice(0, 24) : undefined,
    premium: live?.premium === true,
    clockLondon: live?.clockLondon,
    location: live?.location,
  };

  const logBase = {
    uid: currentUser.uid,
    email: currentUser.email,
    anonymous: currentUser.isAnonymous,
    question,
    questionChars: question.length,
    historyCount: payload.history?.length ?? 0,
    clientEventCount: payload.clientEvents?.length ?? 0,
    clientEventTitles: (payload.clientEvents ?? []).slice(0, 8).map((e) => e.title),
    clientRoadCount: payload.clientRoads?.length ?? 0,
    clientRailCount: payload.clientRails?.length ?? 0,
    premium: payload.premium,
    clockLondon: payload.clockLondon,
    history: (payload.history ?? []).map((h) => ({
      role: h.role,
      text: h.text,
      textChars: h.text.length,
    })),
  };

  const viaHttp = async (forceRefresh: boolean): Promise<AgentAnswer> => {
    const token = await currentUser.getIdToken(forceRefresh);
    const res = await fetch(HTTP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: payload }),
    });
    const raw = await res.text();
    let json: AgentHttpBody | null = null;
    try {
      json = raw ? (JSON.parse(raw) as AgentHttpBody) : null;
    } catch {
      throw new Error(`agent/bad-json http/${res.status}`);
    }
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || `http/${res.status}`);
    }
    if (!json?.result?.answer) throw new Error('agent/empty');
    return json.result;
  };

  try {
    return await viaHttp(false);
  } catch (httpErr) {
    const httpMsg = httpErr instanceof Error ? httpErr.message : String(httpErr);
    if (httpMsg.includes('401') || httpMsg.toLowerCase().includes('unauth') || httpMsg.includes('Sign in required')) {
      return await viaHttp(true);
    }
    throw httpErr;
  }
}

const APP_SOURCES = new Set<AppEvent['source']>([
  'thesportsdb',
  'football-data',
  'espn',
  'fotmob',
  'ticketmaster',
  'venue-site',
  'sample',
  'featured',
]);

export function discoveredEventToAppEvent(row: AgentDiscoveredEvent): AppEvent | null {
  if (!row.id || !row.title || !row.startsAt) return null;
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return null;
  const source = APP_SOURCES.has(row.source as AppEvent['source'])
    ? (row.source as AppEvent['source'])
    : 'ticketmaster';
  return {
    id: row.id,
    source,
    category: row.category === 'sports' ? 'sports' : 'other',
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt || row.startsAt,
    venue: row.venue || 'London',
    latitude: row.latitude,
    longitude: row.longitude,
    subCategory: row.subCategory,
    doorsAt: row.doorsAt,
    realStartAt: row.realStartAt,
    estimatedFinishAt: row.estimatedFinishAt,
    turnoutMin: row.turnoutMin,
    turnoutMax: row.turnoutMax,
    copyLine: row.copyLine,
  };
}
