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
import { eventsFromRawDocs, publishLondonEvents } from './events.js';
import { ensureAgentRuntimeDefaults, handleAskAgent } from './agent.js';
import { handleEventsAdmin } from './eventsAdmin.js';
import { ingestAirports, ingestAirportDays } from './airports.js';
import { ingestNationalRail, NSI_FEED_URL } from './nationalRail.js';
import { ingestEventsRaw } from './eventsIngest.js';
import { isAirportPollWindow } from './londonTime.js';
import {
  dispatchPushNotifications,
  dispatchSavedEventReminders,
  loadFlightsByAirport,
  parseLineStatuses,
} from './dispatch.js';
import {
  claimWaitlistPremiumCallable,
  requestWaitlistCodeByEmail,
} from './waitlistClaim.js';
import { buildWaitlistClaimCodeEmail } from './waitlistEmail.js';
import {
  handleConfirmCommunityReport,
  handleSubmitCommunityReport,
} from './communityReports.js';
import { handleDeleteAccount } from './deleteAccount.js';
import { handleRegisterAccount } from './accountLifecycle.js';
import { handleNotifyPremiumStarted } from './premiumStarted.js';
import { handleRevenueCatWebhook, handleTrialDay6Reminders, webhookAuthorized } from './premiumBilling.js';

initializeApp();
const db = getFirestore();
/**
 * Firestore rejects a document containing `undefined` and fails the whole
 * write. Optional fields are everywhere in this data — a flight with no IATA
 * code, a rail operator with no disruption link — and one missing value was
 * enough to lose an entire airport board. Drop undefined fields instead.
 */
db.settings({ ignoreUndefinedProperties: true });
const anthropicKey = defineSecret('Anthropic-API-key-Production');
const aerodataboxKey = defineSecret('AERODATABOX_RAPIDAPI_KEY');
const ticketmasterKey = defineSecret('TICKETMASTER_API_KEY');
const nationalRailKey = defineSecret('NATIONAL_RAIL_KB_KEY');
const brevoApiKey = defineSecret('BREVO_API_KEY');
const brevoSenderEmail = defineSecret('BREVO_SENDER_EMAIL');
const brevoSenderName = defineSecret('BREVO_SENDER_NAME');
const eventsAdminKey = defineSecret('EVENTS_ADMIN_KEY');
const revenueCatWebhookAuth = defineSecret('REVENUECAT_WEBHOOK_AUTH');

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
  {
    schedule: 'every 24 hours',
    timeoutSeconds: 120,
    ...london,
    serviceAccount: WAITLIST_FN_SA,
  },
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
    serviceAccount: WAITLIST_FN_SA,
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

    try {
      // national-rail dropped: TfL reports every operator as a permanent
      // "Special Service", so rail alerts could never fire. Real per-operator
      // severity comes from railCache, published by ingestNationalRailStatus.
      const lineRes = await fetch(
        'https://api.tfl.gov.uk/Line/Mode/tube,overground,dlr,elizabeth-line,tram/Status',
      );
      const lineRows = lineRes.ok ? ((await lineRes.json()) as unknown[]) : [];
      const lines = parseLineStatuses(lineRows);

      try {
        const railSnap = await db.doc('railCache/national').get();
        const operators = (railSnap.data()?.operators ?? []) as Array<{
          lineId?: string;
          name?: string;
          severity?: string;
          status?: string;
        }>;
        for (const op of operators) {
          if (!op.lineId) continue;
          lines.push({
            id: op.lineId,
            name: op.name ?? op.lineId,
            severityBucket: op.severity ?? 'good',
            statusDescription: op.status ?? 'Good service',
            source: 'nsi',
          });
        }
      } catch (e) {
        logger.warn('dispatch.rail_cache_read_fail', {
          error: e instanceof Error ? e.message : 'error',
        });
      }
      const flightsByAirport = await loadFlightsByAirport(db);
      await dispatchPushNotifications({
        db,
        incidents,
        lines,
        flightsByAirport,
      });
      await dispatchSavedEventReminders({ db });
    } catch (e) {
      logger.warn('dispatch.fail', { error: e instanceof Error ? e.message : 'error' });
    }
  },
);

/**
 * LHR / LGW near-term board, every 5 minutes during the poll window.
 *
 * Landing alerts are sent from this cache. Five minutes is as close as the
 * feed gets without calling it on every request. The other three airports
 * stay on the 15-minute job.
 */
export const ingestMajorAirports = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 180,
    ...london,
    serviceAccount: WAITLIST_FN_SA,
    secrets: [aerodataboxKey],
  },
  async () => {
    if (!isAirportPollWindow()) return;
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
  },
);

/**
 * Full-day boards for all five airports, hourly.
 *
 * Feeds Premium's all-day view, which previously called AeroDataBox straight
 * from each device. Two calls per airport, so this is deliberately infrequent —
 * the near-term jobs above keep the hours that actually change up to date.
 */
export const ingestAirportDaysHourly = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeoutSeconds: 540,
    ...london,
    serviceAccount: WAITLIST_FN_SA,
    secrets: [aerodataboxKey],
  },
  async () => {
    if (!isAirportPollWindow()) return;
    try {
      await ingestAirportDays(db, await keyOrEmpty(aerodataboxKey));
    } catch (e) {
      logger.warn('ingest.airport_days_fail', {
        error: e instanceof Error ? e.message : 'error',
      });
    }
  },
);

/**
 * National Rail operator status, every 5 minutes.
 *
 * Replaces TfL's national-rail mode, which parks eight operators on a
 * permanent "Special Service" carrying no live severity. National Rail cache
 * the feed for 1 minute their side and recommend polling every 5.
 *
 * Runs around the clock: unlike the airport polls this is cheap (one request)
 * and drivers work through the night.
 */
export const ingestNationalRailStatus = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 120,
    ...london,
    serviceAccount: WAITLIST_FN_SA,
    secrets: [nationalRailKey],
  },
  async () => {
    try {
      await ingestNationalRail({
        db,
        apiKey: await keyOrEmpty(nationalRailKey),
        url: NSI_FEED_URL,
      });
    } catch (e) {
      logger.warn('rail.ingest_fail', {
        error: e instanceof Error ? e.message : 'error',
      });
    }
  },
);

/** STN / LTN / LCY every 15 minutes during the airport poll window. */
export const ingestRegionalAirports = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeoutSeconds: 180,
    ...london,
    serviceAccount: WAITLIST_FN_SA,
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
    serviceAccount: WAITLIST_FN_SA,
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

/** Rebuild the published catalogue from eventsRaw (no feed calls). */
async function republishFromRaw(): Promise<void> {
  // Was 1500: once eventsRaw grew past it, events silently dropped out.
  const snap = await db.collection('eventsRaw').limit(5000).get();
  const events = eventsFromRawDocs(snap.docs.map((d) => d.data() as Record<string, unknown>));
  await publishLondonEvents({
    db,
    apiKey: await keyOrEmpty(anthropicKey),
    events,
  });
}

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
    serviceAccount: WAITLIST_FN_SA,
    secrets: [anthropicKey],
  },
  async () => {
    try {
      await republishFromRaw();
    } catch (e) {
      logger.warn('events.publish_fail', { error: e instanceof Error ? e.message : 'error' });
    }
  },
);

/**
 * Events admin page: add events the feeds miss (e.g. England at Wembley),
 * remove them again. Passcode-protected; publishes straight away.
 */
export const eventsAdminHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 300,
    memory: '512MiB',
    invoker: 'public',
    serviceAccount: WAITLIST_FN_SA,
    secrets: [eventsAdminKey, anthropicKey],
  },
  async (req, res) => {
    await handleEventsAdmin({
      db,
      req,
      res,
      adminKey: await keyOrEmpty(eventsAdminKey),
      republish: republishFromRaw,
    });
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
    serviceAccount: WAITLIST_FN_SA,
  },
  async (request, response) => {
    logger.info('agent.callable_in', {
      uid: request.auth?.uid ?? null,
      hasAuth: Boolean(request.auth?.uid),
      questionChars:
        typeof request.data?.question === 'string' ? request.data.question.length : 0,
    });
    const apiKey = await keyOrEmpty(anthropicKey);
    // `acceptsStreaming` is true only when the client called .stream(). Pair it
    // with the server-side `aiStreaming` flag (checked in handleAskAgent) so
    // streaming needs BOTH sides to opt in. A non-streaming client never gets
    // an onDelta, so its code path is byte-for-byte what it was.
    const onDelta =
      request.acceptsStreaming && response
        ? (text: string) => {
            // Fire-and-forget: a client that hung up must not fail the answer.
            void response.sendChunk({ delta: text }).catch(() => undefined);
          }
        : undefined;
    return handleAskAgent({ db, apiKey, request, onDelta });
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
    const body = (req.body ?? {}) as {
      data?: {
        question?: unknown;
        history?: unknown;
        clientEvents?: unknown;
        clientRoads?: unknown;
        clientRails?: unknown;
        premium?: unknown;
        clockLondon?: unknown;
        location?: unknown;
      };
      question?: unknown;
      history?: unknown;
      clientEvents?: unknown;
      clientRoads?: unknown;
      clientRails?: unknown;
      premium?: unknown;
      clockLondon?: unknown;
      location?: unknown;
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
            location: data.location,
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

async function uidFromBearer(req: { get: (h: string) => string | undefined }): Promise<string> {
  const authHeader = String(req.get('authorization') ?? '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw new Error('UNAUTHENTICATED');
  const decoded = await getAuth().verifyIdToken(token);
  if (!decoded.uid) throw new Error('UNAUTHENTICATED');
  return decoded.uid;
}

function httpError(res: { status: (n: number) => { json: (b: unknown) => void } }, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === 'UNAUTHENTICATED') {
    res.status(401).json({ error: { message: 'Sign in required', status: 'UNAUTHENTICATED' } });
    return;
  }
  const friendly: Record<string, string> = {
    invalid_category: 'Pick what you are reporting.',
    outside_london: 'Reports have to be in Greater London.',
    rate_limited: 'You have already sent several reports today. Try again tomorrow.',
    invalid_id: 'That report is gone.',
    not_found: 'That report is gone.',
    expired: 'That report has expired.',
  };
  res.status(200).json({
    error: { message: friendly[msg] || 'Could not save that report. Try again.', status: msg },
  });
}

export const submitCommunityReportHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 60,
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
    try {
      const uid = await uidFromBearer(req);
      const body = (req.body ?? {}) as { data?: Record<string, unknown> };
      const data = body.data ?? (req.body as Record<string, unknown>) ?? {};
      const result = await handleSubmitCommunityReport({
        db,
        uid,
        category: data.category,
        note: data.note,
        latitude: data.latitude,
        longitude: data.longitude,
        placeLabel: data.placeLabel,
      });
      res.status(200).json({ result });
    } catch (e) {
      logger.warn('community_report.submit_fail', {
        error: e instanceof Error ? e.message : String(e),
      });
      httpError(res, e);
    }
  },
);

export const confirmCommunityReportHttp = onRequest(
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
    try {
      const uid = await uidFromBearer(req);
      const body = (req.body ?? {}) as { data?: Record<string, unknown> };
      const data = body.data ?? (req.body as Record<string, unknown>) ?? {};
      const result = await handleConfirmCommunityReport({
        db,
        uid,
        reportId: data.reportId,
      });
      res.status(200).json({ result });
    } catch (e) {
      logger.warn('community_report.confirm_fail', {
        error: e instanceof Error ? e.message : String(e),
      });
      httpError(res, e);
    }
  },
);

/** App Store 5.1.1(v) — authenticated account + data wipe. */
export const deleteAccountHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 60,
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
    try {
      const uid = await uidFromBearer(req);
      const result = await handleDeleteAccount({
        db,
        uid,
        brevoApiKey: await keyOrEmpty(brevoApiKey),
      });
      res.status(200).json({ result });
    } catch (e) {
      logger.error('delete_account.fail', {
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : null,
      });
      if (e instanceof Error && e.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: { message: 'Sign in required', status: 'UNAUTHENTICATED' } });
        return;
      }
      res.status(200).json({
        error: {
          message: 'Could not delete your account. Try again or contact support.',
          status: 'INTERNAL',
        },
      });
    }
  },
);

/**
 * Called by the app after a real (non-anonymous) sign-in.
 *
 * Writes the account fields every lifecycle email depends on, syncs the Brevo
 * contact, and sends the welcome email once. Idempotent — the client may call
 * it on every sign-in.
 */
export const registerAccountHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 60,
    cors: true,
    invoker: 'public',
    serviceAccount: WAITLIST_FN_SA,
    secrets: [brevoApiKey, brevoSenderEmail, brevoSenderName],
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
    try {
      const uid = await uidFromBearer(req);
      const authUser = await getAuth().getUser(uid);
      const body = (req.body ?? {}) as { data?: { isNewAccount?: unknown } };
      const result = await handleRegisterAccount({
        db,
        isNewAccount: body.data?.isNewAccount === true,
        user: {
          uid,
          email: authUser.email ?? null,
          displayName: authUser.displayName ?? null,
          emailVerified: authUser.emailVerified,
          providerData: authUser.providerData.map((p) => ({ providerId: p.providerId })),
        },
        brevo: {
          apiKey: await keyOrEmpty(brevoApiKey),
          senderEmail: await keyOrEmpty(brevoSenderEmail),
          senderName: await keyOrEmpty(brevoSenderName),
        },
      });
      res.status(200).json({ result });
    } catch (e) {
      logger.error('account_register.fail', {
        error: e instanceof Error ? e.message : String(e),
      });
      if (e instanceof Error && e.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: { message: 'Sign in required', status: 'UNAUTHENTICATED' } });
        return;
      }
      // Never block the app on this: the client treats a failure as retryable.
      res.status(200).json({ error: { message: 'Could not register account', status: 'INTERNAL' } });
    }
  },
);

/**
 * Called by the app after a confirmed Premium trial start (annual or monthly).
 * Sends the matching designed welcome once. Safe to retry.
 */
export const notifyPremiumStartedHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 30,
    cors: true,
    invoker: 'public',
    serviceAccount: WAITLIST_FN_SA,
    secrets: [brevoApiKey, brevoSenderEmail, brevoSenderName],
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
    try {
      const uid = await uidFromBearer(req);
      const authUser = await getAuth().getUser(uid);
      const body = (req.body ?? {}) as {
        data?: { plan?: unknown; trialStarted?: unknown };
        plan?: unknown;
        trialStarted?: unknown;
      };
      const data = body.data ?? body;
      const result = await handleNotifyPremiumStarted({
        db,
        user: {
          uid,
          email: authUser.email ?? null,
          displayName: authUser.displayName ?? null,
        },
        brevo: {
          apiKey: await keyOrEmpty(brevoApiKey),
          senderEmail: await keyOrEmpty(brevoSenderEmail),
          senderName: await keyOrEmpty(brevoSenderName),
        },
        plan: typeof data.plan === 'string' ? data.plan : undefined,
        trialStarted: data.trialStarted === true,
      });
      res.status(200).json({ result });
    } catch (e) {
      logger.error('premium_welcome.http_fail', {
        error: e instanceof Error ? e.message : String(e),
      });
      if (e instanceof Error && e.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: { message: 'Sign in required', status: 'UNAUTHENTICATED' } });
        return;
      }
      res.status(200).json({ error: { message: 'Could not send premium welcome', status: 'INTERNAL' } });
    }
  },
);

/**
 * RevenueCat → user plan. Waitlist weeks are not written here.
 * Authorization header must match REVENUECAT_WEBHOOK_AUTH.
 */
export const revenueCatWebhookHttp = onRequest(
  {
    region: 'europe-west2',
    timeoutSeconds: 30,
    invoker: 'public',
    serviceAccount: WAITLIST_FN_SA,
    secrets: [brevoApiKey, brevoSenderEmail, brevoSenderName, revenueCatWebhookAuth],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('POST required');
      return;
    }
    let secret = '';
    try {
      secret = (await keyOrEmpty(revenueCatWebhookAuth)) ?? '';
    } catch {
      secret = '';
    }
    if (!webhookAuthorized(req.get('authorization'), secret)) {
      res.status(401).send('unauthorized');
      return;
    }
    const body = (req.body ?? {}) as { event?: Record<string, unknown> };
    const event = body.event ?? {};
    try {
      const result = await handleRevenueCatWebhook({
        db,
        brevo: {
          apiKey: await keyOrEmpty(brevoApiKey),
          senderEmail: await keyOrEmpty(brevoSenderEmail),
          senderName: await keyOrEmpty(brevoSenderName),
        },
        event: {
          type: typeof event.type === 'string' ? event.type : undefined,
          app_user_id: typeof event.app_user_id === 'string' ? event.app_user_id : undefined,
          product_id: typeof event.product_id === 'string' ? event.product_id : undefined,
          period_type: typeof event.period_type === 'string' ? event.period_type : undefined,
          expiration_at_ms: typeof event.expiration_at_ms === 'number' ? event.expiration_at_ms : null,
        },
      });
      res.status(200).json(result);
    } catch (e) {
      logger.error('revenuecat.webhook_fail', { error: e instanceof Error ? e.message : String(e) });
      res.status(500).send('error');
    }
  },
);

/** Day before the trial charge. Skips anyone who already cancelled. */
export const premiumTrialDay6 = onSchedule(
  {
    schedule: 'every day 09:00',
    timeoutSeconds: 120,
    ...london,
    serviceAccount: WAITLIST_FN_SA,
    secrets: [brevoApiKey, brevoSenderEmail, brevoSenderName],
  },
  async () => {
    const result = await handleTrialDay6Reminders({
      db,
      brevo: {
        apiKey: await keyOrEmpty(brevoApiKey),
        senderEmail: await keyOrEmpty(brevoSenderEmail),
        senderName: await keyOrEmpty(brevoSenderName),
      },
    });
    logger.info('premium_day6.done', result);
  },
);
