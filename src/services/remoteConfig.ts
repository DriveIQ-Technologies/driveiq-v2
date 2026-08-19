/**
 * Runtime knobs the work order wants in Remote Config (task 07): the free
 * AI daily cap, and later the copy-writer system prompt.
 *
 * Native Firebase Remote Config is not wired in this Expo JS-SDK build, so
 * the same document is stored at Firestore `config/runtime`. The Cloud
 * Function writes it; the app only reads. Defaults apply if Firestore is
 * down so a missing backend never blanks the chat box.
 */

import { db, fsApi } from './firebase';

export const DEFAULT_AI_FREE_DAILY_LIMIT = 10;

export interface RuntimeConfig {
  aiFreeDailyLimit: number;
}

const FALLBACK: RuntimeConfig = {
  aiFreeDailyLimit: DEFAULT_AI_FREE_DAILY_LIMIT,
};

let cached: { value: RuntimeConfig; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

function parseConfig(raw: Record<string, unknown> | undefined): RuntimeConfig {
  const n = Number(raw?.aiFreeDailyLimit);
  return {
    aiFreeDailyLimit:
      Number.isFinite(n) && n >= 1 && n <= 100
        ? Math.floor(n)
        : DEFAULT_AI_FREE_DAILY_LIMIT,
  };
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!db || !fsApi) return FALLBACK;
  try {
    const snap = await fsApi.getDoc(fsApi.doc(db, 'config', 'runtime'));
    const value = snap.exists()
      ? parseConfig(snap.data() as Record<string, unknown>)
      : FALLBACK;
    cached = { value, at: Date.now() };
    return value;
  } catch (e) {
    console.warn('[remoteConfig] read failed', e);
    return cached?.value ?? FALLBACK;
  }
}

export async function getAiFreeDailyLimit(): Promise<number> {
  const cfg = await getRuntimeConfig();
  return cfg.aiFreeDailyLimit;
}
