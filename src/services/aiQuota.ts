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

let sessionUsed: { day: string; used: number } | null = null;

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

/** Always use the London calendar day to stay in sync with the server quota. */
const todayKey = (): string => {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
};

async function loadUsedToday(): Promise<number> {
  const day = todayKey();
  const stored = await getJSON<StoredQuota | null>(QUOTA_KEY, null);
  const storedUsed = stored && stored.day === day ? stored.used : 0;
  const session = sessionUsed && sessionUsed.day === day ? sessionUsed.used : 0;
  return Math.max(storedUsed, session);
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

export async function applyServerAiQuota(limit: number, remaining: number): Promise<void> {
  const day = todayKey();
  const used = Math.max(0, limit - remaining);
  sessionUsed = { day, used: Math.max(used, sessionUsed?.day === day ? sessionUsed.used : 0) };
  await setJSON(QUOTA_KEY, { day, used: sessionUsed.used } satisfies StoredQuota);
}

/**
 * Record one question. Returns the quota state AFTER consumption. Callers
 * should check `remaining` on getAiQuota() BEFORE answering; this just
 * persists the tick (Premium usage is tracked but never blocks).
 */
export async function consumeAiQuestion(): Promise<AiQuota> {
  const day = todayKey();
  const used = (await loadUsedToday()) + 1;
  sessionUsed = { day, used };
  await setJSON(QUOTA_KEY, { day, used } satisfies StoredQuota);
  return getAiQuota();
}
