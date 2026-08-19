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
