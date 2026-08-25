import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const unique = [...new Set(tokens.filter((t) => t.trim().length > 8))];
  if (unique.length === 0) return { sent: 0, failed: 0 };

  const messaging = getMessaging();
  let sent = 0;
  let failed = 0;

  // FCM multicast limit is 500; we stay well under per user.
  for (const token of unique) {
    try {
      await messaging.send({
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      sent += 1;
    } catch (e) {
      failed += 1;
      logger.warn('push.send_fail', {
        message: e instanceof Error ? e.message : 'error',
        tokenPrefix: token.slice(0, 8),
      });
    }
  }
  return { sent, failed };
}
