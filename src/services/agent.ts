import { auth } from './firebase';

export interface AgentAnswer {
  ok: boolean;
  answer: string;
  capped: boolean;
  remaining: number | null;
  limit: number | null;
  model: 'haiku' | 'sonnet' | null;
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
  kind?: string;
  turnout?: string;
  featured?: boolean;
  copy?: string;
  status?: 'live' | 'upcoming' | 'finished';
}

export interface AgentLiveContext {
  events?: AgentEventHint[];
  roads?: string[];
  rails?: string[];
  premium?: boolean;
  clockLondon?: string;
}

export async function askDriveiqAgent(
  question: string,
  history?: AgentTurn[],
  live?: AgentLiveContext,
): Promise<AgentAnswer> {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    console.warn('[agent] no currentUser — cannot call backend');
    throw new Error('agent/unavailable');
  }

  const payload = {
    question,
    history: history?.length ? history : undefined,
    clientEvents: live?.events?.length ? live.events.slice(0, 50) : undefined,
    clientRoads: live?.roads?.length ? live.roads.slice(0, 20) : undefined,
    clientRails: live?.rails?.length ? live.rails.slice(0, 20) : undefined,
    premium: live?.premium === true,
    clockLondon: live?.clockLondon,
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
    console.log('[agent] http request', {
      ...logBase,
      url: HTTP_URL,
      forceRefresh,
      hasToken: Boolean(token),
      tokenChars: token.length,
    });
    const res = await fetch(HTTP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: payload }),
    });
    const raw = await res.text();
    console.log('[agent] http response', {
      status: res.status,
      ok: res.ok,
      bodyChars: raw.length,
      bodyPreview: preview(raw, 240),
    });
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
    console.warn('[agent] http path failed', httpMsg);
    if (httpMsg.includes('401') || httpMsg.toLowerCase().includes('unauth') || httpMsg.includes('Sign in required')) {
      return await viaHttp(true);
    }
    throw httpErr;
  }
}
