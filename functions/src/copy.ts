import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { COPY_SYSTEM_PROMPT } from './prompt.js';
import { writeCopy, type CopyModel } from './anthropic.js';
import { templateFromRaw } from './templates.js';

function copyLineRef(db: Firestore, collection: string, id: string) {
  return db.doc(`copy/${collection}/lines/${id}`);
}

export async function loadSystemPrompt(db: Firestore): Promise<string> {
  const snap = await db.doc('config/runtime').get();
  const fromConfig = snap.data()?.copySystemPrompt;
  if (typeof fromConfig === 'string' && fromConfig.trim().length > 40) {
    return fromConfig;
  }
  await db.doc('config/runtime').set(
    {
      copySystemPrompt: COPY_SYSTEM_PROMPT,
      aiFreeDailyLimit: snap.data()?.aiFreeDailyLimit ?? 10,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  return COPY_SYSTEM_PROMPT;
}

/**
 * Is this usable as a driver-facing alert line?
 *
 * The copy model sometimes replies ABOUT the task instead of doing it — "I
 * can't phrase this record… Send me: the line or route" — which is a fair
 * response to a thin input but is not copy. It was being stored as though it
 * were, then read back as a push notification body and sent to a real phone.
 *
 * Reject anything that talks to us rather than to the driver, and anything too
 * long or multi-paragraph to be an alert. Rejected copy falls back to the
 * template, which is always safe.
 */
export function isUsableCopyLine(line: string | null | undefined): boolean {
  const t = (line ?? '').trim();
  if (!t) return false;
  // Alert lines are one or two sentences; a paragraph break means prose.
  if (t.length > 220 || t.includes('\n\n')) return false;
  const meta = [
    /\bi\s+(can'?t|cannot|won'?t|am unable|don'?t have|need)\b/i,
    /\byou'?ve given me\b/i,
    /\bsend me\b\s*:/i,
    /\b(please )?(provide|send) (me )?(the|more)\b/i,
    /\bthere isn'?t enough\b/i,
    /\bnot enough (useful )?information\b/i,
    /\bas an ai\b/i,
  ];
  return !meta.some((re) => re.test(t));
}

export async function phraseAndStore(opts: {
  db: Firestore;
  apiKey: string | undefined;
  collection: string;
  id: string;
  kind: 'road' | 'rail' | 'flight' | 'event';
  rawRecord: string;
  model: CopyModel;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const system = await loadSystemPrompt(opts.db);
  let line: string | null = null;
  let source: 'claude' | 'template' = 'template';

  if (opts.apiKey) {
    line = await writeCopy({
      apiKey: opts.apiKey,
      system,
      rawRecord: opts.rawRecord,
      model: opts.model,
    });
    if (line && !isUsableCopyLine(line)) {
      // The model answered about the record rather than describing it.
      logger.warn('copy.rejected_meta_reply', {
        kind: opts.kind,
        id: opts.id,
        preview: line.slice(0, 80),
      });
      line = null;
    }
    if (line) source = 'claude';
  }

  if (!line) {
    line = templateFromRaw(opts.kind, opts.rawRecord);
    logger.warn('copy.fallback', { kind: opts.kind, id: opts.id });
    await bumpFallback(opts.db);
  } else {
    await markCopySuccess(opts.db);
  }

  await copyLineRef(opts.db, opts.collection, opts.id).set({
    line,
    source,
    rawRecord: opts.rawRecord,
    kind: opts.kind,
    updatedAt: new Date().toISOString(),
    ...opts.extra,
  });
}

async function bumpFallback(db: Firestore): Promise<void> {
  const ref = db.doc('config/copyStats');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const total = Number(snap.data()?.total ?? 0) + 1;
    const fallbacks = Number(snap.data()?.fallbacks ?? 0) + 1;
    tx.set(
      ref,
      {
        total,
        fallbacks,
        rate: fallbacks / total,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  });
}

export async function markCopySuccess(db: Firestore): Promise<void> {
  const ref = db.doc('config/copyStats');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const total = Number(snap.data()?.total ?? 0) + 1;
    const fallbacks = Number(snap.data()?.fallbacks ?? 0);
    tx.set(
      ref,
      {
        total,
        fallbacks,
        rate: total ? fallbacks / total : 0,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  });
}
