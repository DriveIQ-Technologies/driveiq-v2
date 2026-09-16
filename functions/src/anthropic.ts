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
  /**
   * Why generation stopped. `max_tokens` means the answer was CUT OFF, not
   * finished — we were returning those to users mid-sentence with no signal
   * that anything was missing.
   */
  stop_reason?: string;
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
  // The callable itself allows 120s. 20s was tight once max_tokens went to
  // 1200 — a long answer could be aborted after generating most of it, and the
  // user got the generic "could not reach the assistant" with everything lost.
  const timer = setTimeout(() => controller.abort(), 45_000);
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
}): Promise<{
  text: string | null;
  usage: AnthropicUsage | null;
  /** True when the model ran out of room mid-answer. */
  truncated: boolean;
}> {
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
  const truncated = json?.stop_reason === 'max_tokens';
  if (truncated) {
    logger.warn('anthropic.answer_truncated', {
      model: opts.model,
      maxTokens: opts.maxTokens ?? 320,
      outputTokens: usage?.output_tokens ?? null,
    });
  }
  return { text, usage, truncated };
}

/**
 * Same request as {@link askAgent}, but streamed.
 *
 * The non-streaming call makes the user watch a spinner for the whole
 * generation — several seconds on a long answer — and then dumps it all at
 * once. Streaming puts the first words on screen in about a second, which is
 * most of what "feels responsive" actually means.
 *
 * `onDelta` is called with each text fragment as it arrives. The full text is
 * still returned at the end, so callers that only want the final answer (and
 * the truncation flag) behave exactly as before.
 *
 * Errors are thrown rather than swallowed: the caller falls back to the
 * non-streaming path, so a streaming failure costs latency, never the answer.
 */
export async function askAgentStream(opts: {
  apiKey: string;
  system: string;
  prompt: string;
  model: AgentModel;
  modelId?: string;
  maxTokens?: number;
  onDelta: (text: string) => void;
}): Promise<{ text: string; usage: AnthropicUsage | null; truncated: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
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
        max_tokens: opts.maxTokens ?? 320,
        system: opts.system,
        messages: [{ role: 'user', content: opts.prompt }],
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`anthropic stream http ${res.status}`);
    }

    let text = '';
    let usage: AnthropicUsage | null = null;
    let stopReason = '';
    let buffer = '';

    // SSE frames are separated by a blank line; a frame's payload may be split
    // across chunks, so hold anything after the last separator until more
    // arrives rather than parsing a half-written line.
    const decoder = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            continue; // a frame we can't read must not kill the stream
          }
          const type = String(evt.type ?? '');
          if (type === 'content_block_delta') {
            const delta = evt.delta as { type?: string; text?: string } | undefined;
            if (delta?.type === 'text_delta' && delta.text) {
              text += delta.text;
              opts.onDelta(delta.text);
            }
          } else if (type === 'message_delta') {
            const delta = evt.delta as { stop_reason?: string } | undefined;
            if (delta?.stop_reason) stopReason = delta.stop_reason;
            const u = evt.usage as { output_tokens?: number } | undefined;
            if (u?.output_tokens != null && usage) {
              usage.output_tokens = u.output_tokens;
            }
          } else if (type === 'message_start') {
            const msg = evt.message as { usage?: AnthropicUsage } | undefined;
            if (msg?.usage) usage = { ...msg.usage };
          } else if (type === 'error') {
            throw new Error(`anthropic stream error: ${payload.slice(0, 200)}`);
          }
        }
      }
    }

    const truncated = stopReason === 'max_tokens';
    if (truncated) {
      logger.warn('anthropic.answer_truncated', {
        model: opts.model,
        maxTokens: opts.maxTokens ?? 320,
        outputTokens: usage?.output_tokens ?? null,
        streamed: true,
      });
    }
    return { text: text.trim(), usage, truncated };
  } finally {
    clearTimeout(timer);
  }
}
