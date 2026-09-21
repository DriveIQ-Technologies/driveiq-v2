/**
 * Push delivery via the Expo Push Service.
 *
 * This used to call `getMessaging().send({ token })`, which requires an FCM
 * registration token — but the app stores what `getDevicePushTokenAsync()`
 * returns, and on iOS that is the raw APNs device token. FCM rejected every
 * one of them, the failure was caught and logged as `push.send_fail`, and
 * nothing surfaced. The result: no road, rail, flight or community-report
 * notification has ever been delivered. Local event reminders kept working
 * because they never touch this path.
 *
 * There is no way to mint a real FCM token in this app (no
 * `@react-native-firebase/messaging` — the project uses the Firebase JS SDK,
 * which has no React Native messaging), so the fix is to send through Expo,
 * which brokers APNs and FCM for us using the `ExponentPushToken[...]` values
 * the client already knows how to obtain.
 */
import { logger } from 'firebase-functions';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

/** `ExponentPushToken[...]` / `ExpoPushToken[...]` — anything else is stale. */
export function isExpoPushToken(token: unknown): token is string {
  return (
    typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim())
  );
}

export function chunkTokens(tokens: string[], size = CHUNK_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < tokens.length; i += size) out.push(tokens.slice(i, i + size));
  return out;
}

export interface PushResult {
  sent: number;
  failed: number;
  /**
   * Tokens Expo reports as dead (`DeviceNotRegistered`). Callers should drop
   * these from the user document so we stop paying to retry them forever.
   */
  invalidTokens: string[];
}

export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<PushResult> {
  // Filter to real Expo tokens. Legacy APNs/FCM values linger in user docs
  // from the old registration path and would just produce errors.
  const unique = [...new Set(tokens.map((t) => String(t).trim()))].filter(
    isExpoPushToken,
  );
  const skipped = tokens.length - unique.length;
  if (skipped > 0) {
    logger.info('push.skipped_legacy_tokens', { skipped });
  }
  if (unique.length === 0) return { sent: 0, failed: 0, invalidTokens: [] };

  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  for (const chunk of chunkTokens(unique)) {
    const messages = chunk.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      sound: 'default' as const,
      priority: 'high' as const,
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        failed += chunk.length;
        logger.warn('push.http_error', { status: res.status, count: chunk.length });
        continue;
      }

      const json = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown };
      const tickets = Array.isArray(json.data) ? json.data : [];
      tickets.forEach((ticket, i) => {
        if (ticket?.status === 'ok') {
          sent += 1;
          return;
        }
        failed += 1;
        const reason = ticket?.details?.error;
        if (reason === 'DeviceNotRegistered') invalidTokens.push(chunk[i]);
        logger.warn('push.ticket_error', {
          error: reason ?? 'unknown',
          message: ticket?.message?.slice(0, 160),
        });
      });
      // A malformed response shouldn't silently look like success.
      if (tickets.length === 0) {
        failed += chunk.length;
        logger.warn('push.no_tickets', { count: chunk.length });
      }
    } catch (e) {
      failed += chunk.length;
      logger.warn('push.send_fail', {
        message: e instanceof Error ? e.message : 'error',
        count: chunk.length,
      });
    }
  }

  logger.info('push.sent', { sent, failed, invalid: invalidTokens.length });
  return { sent, failed, invalidTokens };
}
