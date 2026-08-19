/**
 * Anthropic calls from Cloud Functions only. The key is read from Secret
 * Manager (ANTHROPIC_API_KEY). It must never appear in the app, the repo,
 * or logs.
 */

import { logger } from 'firebase-functions';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export type CopyModel = 'haiku' | 'sonnet';
export type AgentModel = CopyModel;

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

const MODEL_ID: Record<CopyModel, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
};

interface AnthropicMessageText {
  type?: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicMessageText[];
  usage?: AnthropicUsage;
}

async function callAnthropic(opts: {
  apiKey: string;
  system: string;
  userText: string;
  model: AgentModel;
  modelId?: string;
  maxTokens: number;
}): Promise<AnthropicResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.modelId || MODEL_ID[opts.model],
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: 'user', content: opts.userText }],
      }),
    });
    if (!res.ok) {
      logger.warn('anthropic.http_error', { status: res.status, model: opts.model });
      return null;
    }
    return (await res.json()) as AnthropicResponse;
  } catch (e) {
    logger.warn('anthropic.failed', {
      model: opts.model,
      message: e instanceof Error ? e.message : 'error',
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function writeCopy(opts: {
  apiKey: string;
  system: string;
  rawRecord: string;
  model: CopyModel;
}): Promise<string | null> {
  const json = await callAnthropic({
    apiKey: opts.apiKey,
    system: opts.system,
    userText: `Phrase this record in one or two sentences:\n${opts.rawRecord}`,
    model: opts.model,
    maxTokens: 180,
  });
  const text = json?.content?.find((b) => b.type === 'text')?.text?.trim();
  return text || null;
}

export async function askAgent(opts: {
  apiKey: string;
  system: string;
  prompt: string;
  model: AgentModel;
  modelId?: string;
  maxTokens?: number;
}): Promise<{ text: string | null; usage: AnthropicUsage | null }> {
  const json = await callAnthropic({
    apiKey: opts.apiKey,
    system: opts.system,
    userText: opts.prompt,
    model: opts.model,
    modelId: opts.modelId,
    maxTokens: opts.maxTokens ?? 320,
  });
  const text = json?.content?.find((b) => b.type === 'text')?.text?.trim() ?? null;
  const usage = json?.usage ?? null;
  return { text, usage };
}
