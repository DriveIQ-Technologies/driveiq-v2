import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { askAgent, type AgentModel } from './anthropic.js';
import { AGENT_SYSTEM_ADDENDUM, AGENT_SYSTEM_PROMPT_VERBATIM } from './agentPrompt.js';

const CHAT_PROMPT_VERSION = 2;

interface AskInput {
  question?: unknown;
  history?: unknown;
  clientEvents?: unknown;
  clientRoads?: unknown;
  clientRails?: unknown;
  premium?: unknown;
  clockLondon?: unknown;
}

interface AskOutput {
  ok: boolean;
  answer: string;
  capped: boolean;
  remaining: number | null;
  limit: number | null;
  model: AgentModel | null;
}

function pickModel(question: string): AgentModel {
  const q = question.toLowerCase();
  const planning =
    q.includes('where should i be') ||
    q.includes('plan') ||
    q.includes('compare') ||
    q.includes('best route') ||
    q.includes('why') ||
    q.includes('big') ||
    q.includes('this week') ||
    q.includes('busiest');
  return planning ? 'sonnet' : 'haiku';
}

function dayKeyLondon(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

async function loadRuntime(db: Firestore): Promise<{
  cap: number;
  prompt: string;
  modelHaiku: string;
  modelSonnet: string;
  maxTokens: number;
}> {
  const snap = await db.doc('config/runtime').get();
  const data = snap.data() ?? {};
  const capRaw = Number(data.aiFreeDailyLimit);
  const cap = Number.isFinite(capRaw) && capRaw >= 1 ? Math.floor(capRaw) : 10;
  const promptVersion = Number(data.aiChatPromptVersion);
  const p = typeof data.aiChatSystemPrompt === 'string' ? data.aiChatSystemPrompt.trim() : '';
  const modelHaiku =
    typeof data.aiModelHaiku === 'string' && data.aiModelHaiku.trim()
      ? data.aiModelHaiku.trim()
      : 'claude-haiku-4-5-20251001';
  const modelSonnet =
    typeof data.aiModelSonnet === 'string' && data.aiModelSonnet.trim()
      ? data.aiModelSonnet.trim()
      : 'claude-sonnet-4-5-20250929';
  const maxTokensRaw = Number(data.aiMaxTokens);
  const maxTokens =
    Number.isFinite(maxTokensRaw) && maxTokensRaw >= 80 && maxTokensRaw <= 800
      ? Math.floor(maxTokensRaw)
      : 500;
  return {
    cap,
    prompt:
      promptVersion >= CHAT_PROMPT_VERSION && p.length >= 40
        ? p
        : AGENT_SYSTEM_PROMPT_VERBATIM,
    modelHaiku,
    modelSonnet,
    maxTokens,
  };
}

export async function ensureAgentRuntimeDefaults(db: Firestore): Promise<void> {
  const ref = db.doc('config/runtime');
  const snap = await ref.get();
  const data = snap.data() ?? {};
  const patch: Record<string, unknown> = {};
  if (
    Number(data.aiChatPromptVersion) < CHAT_PROMPT_VERSION ||
    typeof data.aiChatSystemPrompt !== 'string' ||
    data.aiChatSystemPrompt.trim().length < 40
  ) {
    patch.aiChatSystemPrompt = AGENT_SYSTEM_PROMPT_VERBATIM;
    patch.aiChatPromptVersion = CHAT_PROMPT_VERSION;
  }
  if (typeof data.aiModelHaiku !== 'string' || !data.aiModelHaiku.trim()) {
    patch.aiModelHaiku = 'claude-haiku-4-5-20251001';
  }
  if (typeof data.aiModelSonnet !== 'string' || !data.aiModelSonnet.trim()) {
    patch.aiModelSonnet = 'claude-sonnet-4-5-20250929';
  }
  if (!Number.isFinite(Number(data.aiMaxTokens))) {
    patch.aiMaxTokens = 500;
  }
  if (!Number.isFinite(Number(data.aiFreeDailyLimit))) {
    patch.aiFreeDailyLimit = 10;
  }
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = new Date().toISOString();
    await ref.set(patch, { merge: true });
  }
}

function londonClock(now: Date = new Date()): string {
  return now.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function toIsoOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseClientEvents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const lines: string[] = [];
  for (const row of raw.slice(0, 50)) {
    if (!row || typeof row !== 'object') continue;
    const x = row as Record<string, unknown>;
    const title = typeof x.title === 'string' ? x.title.trim() : '';
    if (!title) continue;
    const venue = typeof x.venue === 'string' ? x.venue.trim() : 'London';
    const start = typeof x.startsAt === 'string' ? x.startsAt : '';
    const finish = typeof x.endsAt === 'string' ? x.endsAt : '';
    const doors = typeof x.doorsAt === 'string' ? x.doorsAt : '';
    const kind = typeof x.kind === 'string' && x.kind.trim() ? x.kind.trim() : '';
    const turnout = typeof x.turnout === 'string' && x.turnout.trim() ? `turnout ${x.turnout.trim()}` : '';
    const featured = x.featured === true ? 'FEATURED' : '';
    const copy = typeof x.copy === 'string' && x.copy.trim() ? x.copy.trim() : '';
    const status = typeof x.status === 'string' && x.status.trim() ? x.status.trim() : '';
    lines.push(
      [
        featured,
        title,
        venue,
        kind,
        status,
        doors ? `doors ${doors}` : '',
        `start ${start || 'n/a'}`,
        `finish ${finish || 'n/a'}`,
        turnout,
        copy,
      ]
        .filter(Boolean)
        .join(' | '),
    );
  }
  return lines;
}

function parseClientLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 24)
    .map((row) => (typeof row === 'string' ? row.trim() : ''))
    .filter(Boolean);
}

function parseHistory(raw: unknown): Array<{ role: 'user' | 'assistant'; text: string }> {
  if (!Array.isArray(raw)) return [];
  const rows: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const row of raw.slice(-8)) {
    if (!row || typeof row !== 'object') continue;
    const x = row as Record<string, unknown>;
    const role = x.role === 'assistant' ? 'assistant' : x.role === 'user' ? 'user' : null;
    const text = typeof x.text === 'string' ? x.text.trim() : '';
    if (!role || !text) continue;
    rows.push({ role, text: text.slice(0, 500) });
  }
  return rows;
}

async function buildContextBlock(opts: {
  db: Firestore;
  uid: string;
  premium: boolean;
  clientEvents?: string[];
  clientRoads?: string[];
  clientRails?: string[];
}): Promise<string> {
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const clock = londonClock(now);
  const tomorrowEnd = new Date(nowMs + 36 * 60 * 60 * 1000);
  const weekEnd = new Date(nowMs + 7 * 24 * 60 * 60 * 1000);
  const liveMap = opts.clientEvents ?? [];
  // Live map already has doors/start/finish after on-device normalisation.
  // Firestore eventRecords is a nightly copy and will contradict (Proms +30,
  // RAH 22:30 clamp). Only use it when the phone sent nothing.
  let events: string[] = [];
  if (liveMap.length === 0) {
    const eventsSnap = await opts.db
      .collection('eventsPublished')
      .orderBy('startsAt', 'asc')
      .limit(opts.premium ? 120 : 60)
      .get()
      .catch((err) => {
        logger.warn('agent.events_query_fail', {
          error: err instanceof Error ? err.message : 'error',
        });
        return null;
      });

    events = (eventsSnap?.docs ?? [])
      .map((d) => d.data() as Record<string, unknown>)
      .filter((e) => {
        const t = Date.parse(
          toIsoOrEmpty(e.startsAt) || toIsoOrEmpty(e.listedStart) || toIsoOrEmpty(e.realStartAt),
        );
        if (!Number.isFinite(t)) return false;
        if (opts.premium) return t >= Date.parse(nowIso) && t <= weekEnd.getTime();
        return t >= Date.parse(nowIso) && t <= tomorrowEnd.getTime();
      })
      .slice(0, opts.premium ? 80 : 35)
      .map((e) => {
        const title = String(e.title ?? 'Event');
        const venue = String(e.venue ?? 'London');
        const start = toIsoOrEmpty(e.realStartAt) || toIsoOrEmpty(e.listedStart);
        const finish = toIsoOrEmpty(e.estimatedFinishAt) || toIsoOrEmpty(e.listedEnd);
        const turnoutMin = Number(e.turnoutMin);
        const turnoutMax = Number(e.turnoutMax);
        const turnout =
          Number.isFinite(turnoutMin) && Number.isFinite(turnoutMax)
            ? `${Math.floor(turnoutMin)}-${Math.floor(turnoutMax)}`
            : 'n/a';
        return `${title} | ${venue} | start ${start || 'n/a'} | finish ${finish || 'n/a'} | turnout ${turnout}`;
      });
  }

  const roadSnap = await opts.db
    .collection('copy')
    .doc('road')
    .collection('lines')
    .orderBy('updatedAt', 'desc')
    .limit(10)
    .get()
    .catch(() => null);
  const roads = (roadSnap?.docs ?? [])
    .map((d) => String((d.data() as Record<string, unknown>).line ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);

  const railSnap = await opts.db
    .collection('copy')
    .doc('rail')
    .collection('lines')
    .orderBy('updatedAt', 'desc')
    .limit(10)
    .get()
    .catch(() => null);
  const rails = (railSnap?.docs ?? [])
    .map((d) => String((d.data() as Record<string, unknown>).line ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);

  const flightSnap = await opts.db
    .collection('copy')
    .doc('flight')
    .collection('lines')
    .orderBy('updatedAt', 'desc')
    .limit(24)
    .get()
    .catch(() => null);
  const flightsRaw = (flightSnap?.docs ?? [])
    .map((d) => d.data() as Record<string, unknown>)
    .filter((x) => {
      if (opts.premium) return true;
      // Free context only includes next 3h flight lines when dueAt exists.
      const dueAt = toIsoOrEmpty(x.dueAt);
      if (!dueAt) return false;
      const t = Date.parse(dueAt);
      return Number.isFinite(t) && t >= Date.parse(nowIso) && t <= Date.parse(nowIso) + 3 * 60 * 60 * 1000;
    })
    .slice(0, opts.premium ? 20 : 8);
  const flights = flightsRaw
    .map((x) => String(x.line ?? '').trim())
    .filter(Boolean);

  let saved: Record<string, unknown> | undefined;
  try {
    const userSnap = await opts.db.doc(`users/${opts.uid}`).get();
    saved = userSnap.data() as Record<string, unknown> | undefined;
  } catch (e) {
    logger.warn('agent.saved_hints_fail', {
      error: e instanceof Error ? e.message : 'error',
      uid: opts.uid,
    });
  }
  const savedHints = [
    `savedEventsCount: ${Number(saved?.savedEventsCount ?? 0) || 0}`,
    `savedFlightsCount: ${Number(saved?.savedFlightsCount ?? 0) || 0}`,
  ];

  return [
    `timestamp_london: ${clock} Europe/London (${nowIso})`,
    `tier_data_window: ${opts.premium ? 'premium_full_context' : 'free_tonight_tomorrow_plus_3h_flights'}`,
    '',
    'LIVE MAP EVENTS (authoritative — use these when present):',
    ...(liveMap.length ? liveMap : ['none from live map']),
    '',
    'FIRESTORE EVENTS:',
    ...(liveMap.length
      ? ['skipped — live map is the source of truth']
      : events.length
        ? events
        : ['none in firestore']),
    '',
    'RAIL STATUS LINES:',
    ...(rails.length ? rails : opts.clientRails?.length ? opts.clientRails : ['none in context']),
    '',
    'ROAD STATUS LINES:',
    ...(roads.length ? roads : opts.clientRoads?.length ? opts.clientRoads : ['none in context']),
    '',
    'FLIGHT STATUS LINES:',
    ...(flights.length ? flights : ['none in context']),
    '',
    'USER SAVED HINTS:',
    ...savedHints,
  ].join('\n');
}

export async function handleAskAgent(opts: {
  db: Firestore;
  apiKey: string | undefined;
  request: {
    auth?: { uid: string } | null;
    data?: AskInput;
  };
}): Promise<AskOutput> {
  const uid = opts.request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

  const question =
    typeof opts.request.data?.question === 'string' ? opts.request.data.question.trim() : '';
  if (!question) throw new HttpsError('invalid-argument', 'Question is required');
  if (question.length > 600) {
    throw new HttpsError('invalid-argument', 'Question is too long');
  }

  const history = parseHistory(opts.request.data?.history);
  const clientEvents = parseClientEvents(opts.request.data?.clientEvents);
  const clientRoads = parseClientLines(opts.request.data?.clientRoads);
  const clientRails = parseClientLines(opts.request.data?.clientRails);
  const clientPremium = opts.request.data?.premium === true;
  const clockLondon =
    typeof opts.request.data?.clockLondon === 'string' && opts.request.data.clockLondon.trim()
      ? opts.request.data.clockLondon.trim()
      : londonClock();

  logger.info('agent.parsed_client_data', {
    uid,
    clientEventCount: clientEvents.length,
    clientEventSample: clientEvents.slice(0, 2),
    clientRoadCount: clientRoads.length,
    clientRoadSample: clientRoads.slice(0, 2),
    clientRailCount: clientRails.length,
    clientRailSample: clientRails.slice(0, 2),
    clientPremium,
    clockLondon,
  });

  let cap = 10;
  let prompt = AGENT_SYSTEM_PROMPT_VERBATIM;
  let modelHaiku = 'claude-haiku-4-5-20251001';
  let modelSonnet = 'claude-sonnet-4-5-20250929';
  let maxTokens = 500;
  try {
    const runtime = await loadRuntime(opts.db);
    cap = runtime.cap;
    prompt = runtime.prompt;
    modelHaiku = runtime.modelHaiku;
    modelSonnet = runtime.modelSonnet;
    maxTokens = runtime.maxTokens;
  } catch (e) {
    logger.warn('agent.runtime_fail', { error: e instanceof Error ? e.message : 'error' });
  }

  let user: Record<string, unknown> = {};
  try {
    const [userSnap, waitlistEntSnap] = await Promise.all([
      opts.db.doc(`users/${uid}`).get(),
      opts.db.doc(`users/${uid}/entitlements/waitlist`).get(),
    ]);
    user = { ...(userSnap.data() ?? {}), ...(waitlistEntSnap.data() ?? {}) };
  } catch (e) {
    logger.warn('agent.user_fail', { error: e instanceof Error ? e.message : 'error', uid });
  }
  const firestorePremium =
    user.tier === 'premium' ||
    user.entitlement === 'premium' ||
    (typeof user.premiumUntil === 'string' && Date.parse(user.premiumUntil) > Date.now());
  // Waitlist / review unlock lives on the device until RevenueCat is wired.
  const premium = firestorePremium || clientPremium;

  const day = dayKeyLondon();
  const usageRef = opts.db.doc(`users/${uid}/usage/ai-${day}`);

  let usedAfter = 0;
  let capped = false;
  try {
    await opts.db.runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const used = Number(snap.data()?.count ?? 0);
      if (!premium && used >= cap) {
        capped = true;
        usedAfter = used;
        return;
      }
      usedAfter = used + 1;
      tx.set(
        usageRef,
        {
          day,
          count: usedAfter,
          uid,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    });
  } catch (e) {
    logger.warn('agent.usage_fail', { error: e instanceof Error ? e.message : 'error', uid });
    usedAfter = 1;
  }

  if (capped) {
    return {
      ok: true,
      answer:
        'You have used your free AI questions for today. They reset at midnight. DriveIQ Premium includes unlimited AI questions.',
      capped: true,
      remaining: 0,
      limit: cap,
      model: null,
    };
  }

  const model: AgentModel = premium ? pickModel(question) : 'haiku';
  let contextBlock = 'EVENTS:\nnone in context';
  try {
    contextBlock = await buildContextBlock({
      db: opts.db,
      uid,
      premium,
      clientEvents,
      clientRoads,
      clientRails,
    });
    logger.info('agent.context_built', {
      uid,
      premium,
      firestorePremium,
      clientPremium,
      contextChars: contextBlock.length,
      hasClientEvents: clientEvents.length > 0,
      hasClientRoads: clientRoads.length > 0,
      hasClientRails: clientRails.length > 0,
      contextPreview: contextBlock.slice(0, 500),
    });
  } catch (e) {
    logger.warn('agent.context_fail', { error: e instanceof Error ? e.message : 'error', uid });
    if (clientEvents.length) {
      contextBlock = [
        'LIVE MAP EVENTS (authoritative — use these when present):',
        ...clientEvents,
        '',
        'RAIL STATUS LINES:',
        ...(clientRails.length ? clientRails : ['none in context']),
        '',
        'ROAD STATUS LINES:',
        ...(clientRoads.length ? clientRoads : ['none in context']),
      ].join('\n');
    }
  }
  const system = `${prompt}\n\n${AGENT_SYSTEM_ADDENDUM}`;
  const tierLine = `USER_TIER: ${premium ? 'premium' : 'free'}`;
  const historyBlock = history.length
    ? `\nRECENT CONVERSATION:\n${history
        .map((h) => `${h.role === 'assistant' ? 'assistant' : 'user'}: ${h.text}`)
        .join('\n')}`
    : '';
  const liveCount = clientEvents.length;
  const combinedPrompt = `${tierLine}
LONDON_CLOCK: ${clockLondon} Europe/London. The driver's phone may show a different time zone. Always say "London HH:mm". Today and tonight mean the London calendar day, not the phone's day.
DATA RULE: LIVE MAP EVENTS has ${liveCount} row(s) from the driver's open map, ranked live and upcoming first, then featured and highest turnout. If ${liveCount} > 0, lead with those. Mark finished events as already done. Do not call a finished small fixture a big night. Never say you have no events. Never say tomorrow is Premium-only.

CONTEXT BLOCK:
${contextBlock}${historyBlock}

CURRENT USER QUESTION:
${question}`;

  let answer = '';
  if (opts.apiKey) {
    const res = await askAgent({
      apiKey: opts.apiKey,
      system,
      prompt: combinedPrompt,
      model,
      modelId: model === 'sonnet' ? modelSonnet : modelHaiku,
      maxTokens,
    });
    answer = res.text?.trim() ?? '';
    try {
      await opts.db.collection('aiCostLog').add({
        uid,
        day,
        premium,
        model,
        inputTokens: res.usage?.input_tokens ?? null,
        outputTokens: res.usage?.output_tokens ?? null,
        questionChars: question.length,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn('agent.costlog_fail', { error: e instanceof Error ? e.message : 'error' });
    }
  }

  if (!answer) {
    answer =
      'I could not reach the live assistant just now. Try again in a moment. You can still use Save, Notifications, and the live map panels meanwhile.';
  }

  const remaining = premium ? null : Math.max(0, cap - usedAfter);
  return {
    ok: true,
    answer,
    capped: false,
    remaining,
    limit: premium ? null : cap,
    model,
  };
}
