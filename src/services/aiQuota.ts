/**
 * Daily AI-question quota.
 *
 * Free plan gets a Remote Config cap per calendar day (local time);
 * Premium is unlimited. Usage resets automatically when the stored day changes.
 * Work order task 07: default is 10, not 5, and the number lives in
 * Firestore `config/runtime` so it can come down without an app release.
 */

import { getJSON, setJSON } from './storage';
import { hasProAccess } from './subscription';
import {
  DEFAULT_AI_FREE_DAILY_LIMIT,
  getAiFreeDailyLimit,
} from './remoteConfig';

const QUOTA_KEY = 'driveiq.aiQuota.v1';

/** Fallback when Remote Config has not loaded yet. Prefer getAiQuota().limit. */
export const FREE_DAILY_LIMIT = DEFAULT_AI_FREE_DAILY_LIMIT;

interface StoredQuota {
  /** Local calendar day the counter belongs to, YYYY-MM-DD. */
  day: string;
  used: number;
}

export interface AiQuota {
  pro: boolean;
  used: number;
  /** Infinity for Premium. */
  limit: number;
  /** Infinity for Premium. */
  remaining: number;
}

const todayKey = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

async function loadUsedToday(): Promise<number> {
  const stored = await getJSON<StoredQuota | null>(QUOTA_KEY, null);
  if (!stored || stored.day !== todayKey()) return 0;
  return stored.used;
}

export async function getAiQuota(): Promise<AiQuota> {
  const [pro, used, limit] = await Promise.all([
    hasProAccess(),
    loadUsedToday(),
    getAiFreeDailyLimit(),
  ]);
  if (pro) return { pro, used, limit: Infinity, remaining: Infinity };
  return {
    pro,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Record one question. Returns the quota state AFTER consumption. Callers
 * should check `remaining` on getAiQuota() BEFORE answering; this just
 * persists the tick (Premium usage is tracked but never blocks).
 */
export async function consumeAiQuestion(): Promise<AiQuota> {
  const used = (await loadUsedToday()) + 1;
  await setJSON(QUOTA_KEY, { day: todayKey(), used } satisfies StoredQuota);
  return getAiQuota();
}
