/**
 * DriveIQ background copy + nightly event normalisation.
 *
 * Task 07: Cloud Scheduler → this code → Anthropic (Secret Manager) → Firestore.
 * The app never calls Anthropic. If the key is missing, template copy is
 * written anyway so alerts still go out.
 *
 * Zak: put Anthropic-API-key-Production in Secret Manager, grant this service account
 * secret-accessor, then `firebase deploy --only functions,firestore:rules`.
 * Ping Zak on Slack for the key. Do not paste it into .env or the repo.
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as v1 from 'firebase-functions/v1';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { phraseAndStore, loadSystemPrompt } from './copy.js';
import { ingestLiveFeeds } from './ingest.js';
import { normaliseTomorrow, type RawEvent } from './events.js';
import { ensureAgentRuntimeDefaults, handleAskAgent } from './agent.js';

initializeApp();
const db = getFirestore();
const anthropicKey = defineSecret('Anthropic-API-key-Production');

const london = { timeZone: 'Europe/London' };

async function keyOrEmpty(): Promise<string | undefined> {
  try {
    const v = anthropicKey.value();
    return v && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

export const seedCopyPrompt = onSchedule(
  { schedule: 'every 24 hours', timeoutSeconds: 120, ...london },
  async () => {
    await loadSystemPrompt(db);
    await ensureAgentRuntimeDefaults(db);
  },
);

/**
 * Roads, rail and flights: phrase whatever raw records were queued by the
 * ingest jobs into `copyQueue/{kind}`. Until those pollers live on the
 * server, this still no-ops cleanly and logs the queue size.
 */
export const writeQueuedCopy = onSchedule(
  { schedule: 'every 5 minutes', timeoutSeconds: 120, ...london, secrets: [anthropicKey] },
  async () => {
    try {
      await ingestLiveFeeds(db);
    } catch (e) {
      logger.warn('ingest.live_fail', { error: e instanceof Error ? e.message : 'error' });
    }
    const apiKey = await keyOrEmpty();
    const snap = await db.collection('copyQueue').limit(80).get();
    if (snap.empty) {
      logger.info('copy.queue_empty');
      return;
    }
    for (const doc of snap.docs) {
      const data = doc.data() as {
        kind?: 'road' | 'rail' | 'flight' | 'event';
        rawRecord?: string;
        model?: 'haiku' | 'sonnet';
        collection?: string;
      };
      const kind = data.kind ?? 'road';
      const raw = data.rawRecord ?? '';
      if (!raw) {
        await doc.ref.delete();
        continue;
      }
      await phraseAndStore({
        db,
        apiKey,
        collection: data.collection ?? kind,
        id: doc.id,
        kind,
        rawRecord: raw,
        model: data.model ?? (kind === 'event' ? 'sonnet' : 'haiku'),
      });
      await doc.ref.delete();
    }
  },
);

/**
 * Nightly pass over tomorrow's events in `eventsRaw`.
 * Ingest should write that collection once per night before 02:00 London.
 */
export const normaliseEventsNightly = onSchedule(
  { schedule: '0 2 * * *', timeoutSeconds: 300, ...london, secrets: [anthropicKey] },
  async () => {
    const apiKey = await keyOrEmpty();
    const snap = await db.collection('eventsRaw').limit(80).get();
    const events: RawEvent[] = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: String(x.id ?? d.id),
        title: String(x.title ?? 'Event'),
        venue: String(x.venue ?? 'London'),
        subCategory: typeof x.subCategory === 'string' ? x.subCategory : undefined,
        category: typeof x.category === 'string' ? x.category : undefined,
        startsAt: String(x.startsAt ?? ''),
        endsAt: typeof x.endsAt === 'string' ? x.endsAt : undefined,
      };
    }).filter((e) => e.startsAt);
    await normaliseTomorrow({ db, apiKey, events });
  },
);

/**
 * AI support endpoint (callable, kept for compatibility).
 * Cloud Run IAM can reject Firebase ID tokens on this path; the app uses
 * `askDriveiqAgentHttp` instead.
 */
export const askDriveiqAgent = onCall(
  {
    region: 'europe-west2',
    timeoutSeconds: 120,
    secrets: [anthropicKey],
    enforceAppCheck: false,
    invoker: 'public',
  },
  async (request) => {
    logger.info('agent.callable_in', {
      uid: request.auth?.uid ?? null,
      hasAuth: Boolean(request.auth?.uid),
      questionChars:
        typeof request.data?.question === 'string' ? request.data.question.length : 0,
    });
    const apiKey = await keyOrEmpty();
    return handleAskAgent({ db, apiKey, request });
  },
);

/**
 * Primary AI endpoint for the app. Public Cloud Run invoker; we verify the
 * Firebase ID token ourselves so IAM never blocks signed-in drivers.
 */
export const askDriveiqAgentHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 120,
    secrets: [anthropicKey],
    cors: true,
    invoker: 'public',
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: { message: 'POST required', status: 'INVALID_ARGUMENT' } });
      return;
    }

    const authHeader = String(req.get('authorization') ?? '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const body = (req.body ?? {}) as {
      data?: {
        question?: unknown;
        history?: unknown;
        clientEvents?: unknown;
        clientRoads?: unknown;
        clientRails?: unknown;
        premium?: unknown;
        clockLondon?: unknown;
      };
      question?: unknown;
      history?: unknown;
      clientEvents?: unknown;
      clientRoads?: unknown;
      clientRails?: unknown;
      premium?: unknown;
      clockLondon?: unknown;
    };
    const data = body.data ?? body;
    const question = typeof data.question === 'string' ? data.question : '';
    const history = Array.isArray(data.history) ? data.history : [];
    const clientEvents = Array.isArray(data.clientEvents) ? data.clientEvents : [];
    const clientRoads = Array.isArray(data.clientRoads) ? data.clientRoads : [];
    const clientRails = Array.isArray(data.clientRails) ? data.clientRails : [];

    logger.info('agent.http_in', {
      hasBearer: token.length > 0,
      tokenChars: token.length,
      question,
      questionChars: question.length,
      historyCount: history.length,
      clientEventCount: clientEvents.length,
      clientEventTitles: clientEvents
        .slice(0, 8)
        .map((row) =>
          row && typeof row === 'object' && 'title' in row
            ? String((row as { title?: unknown }).title ?? '')
            : '',
        )
        .filter(Boolean),
      clientPremium: data.premium === true,
      clientRoadCount: clientRoads.length,
      clientRoadSample: clientRoads.slice(0, 2),
      clientRailCount: clientRails.length,
      clientRailSample: clientRails.slice(0, 2),
      history: history.map((row) => {
        const x = row as { role?: unknown; text?: unknown };
        const text = typeof x.text === 'string' ? x.text : '';
        return {
          role: typeof x.role === 'string' ? x.role : null,
          text,
          textChars: text.length,
        };
      }),
    });

    if (!token) {
      logger.warn('agent.http_no_token');
      res.status(401).json({ error: { message: 'Sign in required', status: 'UNAUTHENTICATED' } });
      return;
    }

    let uid = '';
    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
      logger.info('agent.auth_ok', {
        uid,
        email: decoded.email ?? null,
        provider: decoded.firebase?.sign_in_provider ?? null,
      });
    } catch (e) {
      logger.warn('agent.auth_fail', {
        message: e instanceof Error ? e.message : 'verify_failed',
      });
      res.status(401).json({ error: { message: 'Sign in required', status: 'UNAUTHENTICATED' } });
      return;
    }

    try {
      const apiKey = await keyOrEmpty();
      const result = await handleAskAgent({
        db,
        apiKey,
        request: {
          auth: { uid },
          data: {
            question: data.question,
            history: data.history,
            clientEvents: data.clientEvents,
            clientRoads: data.clientRoads,
            clientRails: data.clientRails,
            premium: data.premium,
            clockLondon: data.clockLondon,
          },
        },
      });
      logger.info('agent.http_out', {
        uid,
        ok: result.ok,
        capped: result.capped,
        model: result.model,
        remaining: result.remaining,
        answerChars: result.answer.length,
        answerPreview: result.answer.slice(0, 160),
      });
      res.status(200).json({ result });
    } catch (e) {
      if (e instanceof HttpsError) {
        logger.warn('agent.https_error', { code: e.code, message: e.message, uid });
        res.status(e.httpErrorCode.status).json({
          error: { message: e.message, status: e.code },
        });
        return;
      }
      logger.error('agent.http_fail', {
        uid,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : null,
      });
      res.status(500).json({
        error: {
          message: e instanceof Error ? e.message : 'Agent failed',
          status: 'INTERNAL',
        },
      });
    }
  },
);

/**
 * 1st-gen callable. Firebase Auth tokens work here without Cloud Run allUsers.
 * This is the path the app uses when 2nd-gen IAM blocks invocation.
 */
export const askDriveiqAgentV1 = v1
  .region('europe-west2')
  .runWith({
    timeoutSeconds: 120,
    memory: '256MB',
    secrets: [anthropicKey],
    serviceAccount: '327546397871-compute@developer.gserviceaccount.com',
  })
  .https.onCall(async (data: { question?: unknown; history?: unknown }, context) => {
    logger.info('agent.v1_in', {
      uid: context.auth?.uid ?? null,
      hasAuth: Boolean(context.auth?.uid),
      question: typeof data?.question === 'string' ? data.question : null,
      questionChars: typeof data?.question === 'string' ? data.question.length : 0,
      historyCount: Array.isArray(data?.history) ? data.history.length : 0,
    });
    if (!context.auth?.uid) {
      throw new v1.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const apiKey = await keyOrEmpty();
    const result = await handleAskAgent({
      db,
      apiKey,
      request: {
        auth: { uid: context.auth.uid },
        data: { question: data?.question, history: data?.history },
      },
    });
    logger.info('agent.v1_out', {
      uid: context.auth.uid,
      ok: result.ok,
      capped: result.capped,
      model: result.model,
      answerChars: result.answer.length,
    });
    return result;
  });
