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
import { publishLondonEvents } from './events.js';
import { ensureAgentRuntimeDefaults, handleAskAgent } from './agent.js';
import { ingestAirports } from './airports.js';
import { ingestEventsRaw } from './eventsIngest.js';
import { isAirportPollWindow } from './londonTime.js';
import {
  dispatchPushNotifications,
  loadFlightsByAirport,
  parseLineStatuses,
} from './dispatch.js';
import {
  claimWaitlistPremiumCallable,
  requestWaitlistCodeByEmail,
} from './waitlistClaim.js';
import { buildWaitlistClaimCodeEmail } from './waitlistEmail.js';

initializeApp();
const db = getFirestore();
const anthropicKey = defineSecret('Anthropic-API-key-Production');
const aerodataboxKey = defineSecret('AERODATABOX_RAPIDAPI_KEY');
const ticketmasterKey = defineSecret('TICKETMASTER_API_KEY');
const brevoApiKey = defineSecret('BREVO_API_KEY');
const brevoSenderEmail = defineSecret('BREVO_SENDER_EMAIL');
const brevoSenderName = defineSecret('BREVO_SENDER_NAME');

const WAITLIST_FN_SA = 'firebase-adminsdk-fbsvc@driveiq-app.iam.gserviceaccount.com';
const london = { timeZone: 'Europe/London' };

async function keyOrEmpty(secret: ReturnType<typeof defineSecret>): Promise<string | undefined> {
  try {
    const v = secret.value();
    return v && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function sendWaitlistCodeByBrevo(opts: {
  apiKey: string;
  toEmail: string;
  claimToken: string;
  senderEmail: string;
  senderName?: string;
}): Promise<void> {
  const email = buildWaitlistClaimCodeEmail({ claimToken: opts.claimToken });

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': opts.apiKey,
    },
    body: JSON.stringify({
      sender: {
        email: opts.senderEmail,
        name: opts.senderName || 'DriveIQ',
      },
      to: [{ email: opts.toEmail }],
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`brevo/http/${res.status}: ${body.slice(0, 220)}`);
  }
}

async function processCopyQueue(apiKey: string | undefined): Promise<void> {
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
}

export const seedCopyPrompt = onSchedule(
  { schedule: 'every 24 hours', timeoutSeconds: 120, ...london },
  async () => {
    await loadSystemPrompt(db);
    await ensureAgentRuntimeDefaults(db);
  },
);

/**
 * Every 5 minutes: TfL + Highways ingest, corridor cache, airport cache
 * (LHR/LGW), copy queue drain, FCM push dispatch.
 */
export const writeQueuedCopy = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 300,
    ...london,
    secrets: [anthropicKey, aerodataboxKey],
  },
  async () => {
    let incidents = [] as Awaited<ReturnType<typeof ingestLiveFeeds>>;
    try {
      incidents = await ingestLiveFeeds(db);
    } catch (e) {
      logger.warn('ingest.live_fail', { error: e instanceof Error ? e.message : 'error' });
    }

    const apiKey = await keyOrEmpty(anthropicKey);
    await processCopyQueue(apiKey);

    if (isAirportPollWindow()) {
      try {
        await ingestAirports(db, await keyOrEmpty(aerodataboxKey), {
          major: true,
          regional: false,
        });
      } catch (e) {
        logger.warn('ingest.airports_major_fail', {
          error: e instanceof Error ? e.message : 'error',
        });
      }
    }

    try {
      const lineRes = await fetch(
        'https://api.tfl.gov.uk/Line/Mode/tube,overground,dlr,elizabeth-line,tram,national-rail/Status',
      );
      const lineRows = lineRes.ok ? ((await lineRes.json()) as unknown[]) : [];
      const lines = parseLineStatuses(lineRows);
      const flightsByAirport = await loadFlightsByAirport(db);
      await dispatchPushNotifications({
        db,
        incidents,
        lines,
        flightsByAirport,
      });
    } catch (e) {
      logger.warn('dispatch.fail', { error: e instanceof Error ? e.message : 'error' });
    }
  },
);

/** STN / LTN / LCY every 15 minutes during the airport poll window. */
export const ingestRegionalAirports = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeoutSeconds: 180,
    ...london,
    secrets: [aerodataboxKey],
  },
  async () => {
    if (!isAirportPollWindow()) return;
    try {
      await ingestAirports(db, await keyOrEmpty(aerodataboxKey), {
        major: false,
        regional: true,
      });
    } catch (e) {
      logger.warn('ingest.airports_regional_fail', {
        error: e instanceof Error ? e.message : 'error',
      });
    }
  },
);

/** Ticketmaster + Proms + FotMob/ESPN sports → eventsRaw, then eventsPublished. */
export const ingestEventsNightly = onSchedule(
  {
    schedule: '20 1,13 * * *',
    timeoutSeconds: 540,
    memory: '512MiB',
    ...london,
    secrets: [ticketmasterKey, anthropicKey],
  },
  async () => {
    try {
      const events = await ingestEventsRaw(db, await keyOrEmpty(ticketmasterKey));
      await publishLondonEvents({
        db,
        apiKey: await keyOrEmpty(anthropicKey),
        events,
      });
    } catch (e) {
      logger.warn('events.ingest_fail', { error: e instanceof Error ? e.message : 'error' });
    }
  },
);

/**
 * Second pass if ingest wrote eventsRaw but publish failed.
 * Safe to run on its own: reads eventsRaw and republishes.
 */
export const normaliseEventsNightly = onSchedule(
  {
    schedule: '40 1,13 * * *',
    timeoutSeconds: 540,
    memory: '512MiB',
    ...london,
    secrets: [anthropicKey],
  },
  async () => {
    try {
      const snap = await db.collection('eventsRaw').limit(1500).get();
      const events = snap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .filter((x) => typeof x.id === 'string' && typeof x.startsAt === 'string')
        .map((x) => ({
          id: String(x.id),
          source: String(x.source ?? 'ticketmaster'),
          category: x.category === 'sports' ? ('sports' as const) : ('other' as const),
          title: String(x.title ?? 'Event'),
          startsAt: String(x.startsAt),
          endsAt: String(x.endsAt ?? x.startsAt),
          venue: String(x.venue ?? 'London'),
          latitude: Number(x.latitude),
          longitude: Number(x.longitude),
          description: typeof x.description === 'string' ? x.description : undefined,
          subCategory: typeof x.subCategory === 'string' ? x.subCategory : undefined,
          url: typeof x.url === 'string' ? x.url : undefined,
        }))
        .filter((e) => Number.isFinite(e.latitude) && Number.isFinite(e.longitude));
      await publishLondonEvents({
        db,
        apiKey: await keyOrEmpty(anthropicKey),
        events,
      });
    } catch (e) {
      logger.warn('events.publish_fail', { error: e instanceof Error ? e.message : 'error' });
    }
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
    const apiKey = await keyOrEmpty(anthropicKey);
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
      const apiKey = await keyOrEmpty(anthropicKey);
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
    const apiKey = await keyOrEmpty(anthropicKey);
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

/**
 * Grant the one-time waitlist free week. Callable only — clients cannot
 * write tier / premiumUntil on `users/{uid}` (see firestore.rules).
 */
export const claimWaitlistPremium = onCall(
  {
    region: 'europe-west2',
    timeoutSeconds: 30,
    enforceAppCheck: false,
    invoker: 'public',
    serviceAccount: WAITLIST_FN_SA,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in to claim your waitlist week.');
    }
    const data = (request.data ?? {}) as {
      waitlistEmail?: unknown;
      claimToken?: unknown;
    };
    const waitlistEmail =
      typeof data.waitlistEmail === 'string' ? data.waitlistEmail : undefined;
    const claimToken = typeof data.claimToken === 'string' ? data.claimToken : undefined;

    const result = await claimWaitlistPremiumCallable({
      db,
      uid,
      waitlistEmail,
      claimToken,
    });

    logger.info('waitlist.claim', {
      uid,
      mode: 'token',
      status: result.status,
      ok: result.ok,
      token: result.token,
      waitlistEmail: result.waitlistEmail,
    });

    return result;
  },
);

/**
 * Primary waitlist claim endpoint for the app. Same pattern as askDriveiqAgentHttp —
 * public invoker with Firebase ID token verified in code.
 */
export const claimWaitlistPremiumHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 30,
    cors: true,
    invoker: 'public',
    serviceAccount: WAITLIST_FN_SA,
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
    if (!token) {
      res.status(401).json({
        error: { message: 'Sign in to claim your waitlist week.', status: 'UNAUTHENTICATED' },
      });
      return;
    }

    let uid = '';
    try {
      const decoded = await getAuth().verifyIdToken(token);
      uid = decoded.uid;
    } catch (e) {
      logger.warn('waitlist.http_auth_fail', {
        error: e instanceof Error ? e.message : String(e),
      });
      res.status(401).json({
        error: { message: 'Sign in again to claim your waitlist week.', status: 'UNAUTHENTICATED' },
      });
      return;
    }

    const body = (req.body ?? {}) as {
      data?: {
        waitlistEmail?: unknown;
        claimToken?: unknown;
      };
      waitlistEmail?: unknown;
      claimToken?: unknown;
    };
    const data = body.data ?? body;
    const waitlistEmail =
      typeof data.waitlistEmail === 'string' ? data.waitlistEmail : undefined;
    const claimToken = typeof data.claimToken === 'string' ? data.claimToken : undefined;

    try {
      const result = await claimWaitlistPremiumCallable({
        db,
        uid,
        waitlistEmail,
        claimToken,
      });
      logger.info('waitlist.http_claim', {
        uid,
        mode: 'token',
        status: result.status,
        ok: result.ok,
        token: result.token,
        waitlistEmail: result.waitlistEmail,
      });
      res.status(200).json({ result });
    } catch (e) {
      logger.error('waitlist.http_fail', {
        uid,
        error: e instanceof Error ? e.message : String(e),
      });
      res.status(500).json({
        error: {
          message: e instanceof Error ? e.message : 'Claim failed',
          status: 'INTERNAL',
        },
      });
    }
  },
);

/**
 * Waitlist fallback: user enters waitlist email, we resend their one-time code.
 * Response is privacy-safe and does not reveal whether the email is listed.
 */
export const requestWaitlistCodeHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 30,
    cors: true,
    invoker: 'public',
    secrets: [brevoApiKey, brevoSenderEmail, brevoSenderName],
    serviceAccount: WAITLIST_FN_SA,
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: { message: 'POST required', status: 'INVALID_ARGUMENT' } });
      return;
    }

    const generic = {
      ok: true,
      status: 'sent' as const,
      message: 'If your waitlist email is registered, we have sent your claim code.',
    };

    try {
      const body = (req.body ?? {}) as {
        data?: { waitlistEmail?: unknown };
        waitlistEmail?: unknown;
      };
      const data = body.data ?? body;
      const waitlistEmail =
        typeof data.waitlistEmail === 'string' ? data.waitlistEmail : undefined;
      const lookup = await requestWaitlistCodeByEmail({ db, waitlistEmail });

      if (lookup.status === 'invalid_email') {
        res.status(200).json({ result: lookup });
        return;
      }

      const apiKey = await keyOrEmpty(brevoApiKey);
      const senderEmail = await keyOrEmpty(brevoSenderEmail);
      const senderName = await keyOrEmpty(brevoSenderName);
      if (!apiKey || !senderEmail || !lookup.token || !lookup.waitlistEmail) {
        logger.warn('waitlist.code_request_skipped', {
          reason: !apiKey || !senderEmail ? 'missing_brevo_secrets' : 'missing_token',
          status: lookup.status,
          email: lookup.waitlistEmail,
        });
        res.status(200).json({ result: generic });
        return;
      }
      await sendWaitlistCodeByBrevo({
        apiKey,
        senderEmail,
        senderName,
        toEmail: lookup.waitlistEmail,
        claimToken: lookup.token,
      });
      logger.info('waitlist.code_request_sent', { email: lookup.waitlistEmail });
      res.status(200).json({ result: generic });
    } catch (e) {
      logger.error('waitlist.code_request_fail', {
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : null,
      });
      res.status(200).json({ result: generic });
    }
  },
);
