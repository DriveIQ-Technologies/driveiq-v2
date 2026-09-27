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
  /** Tokens written into the prompt cache on this call (1.25× / 2× input). */
  cache_creation_input_tokens: number;
  /** Tokens read from cache (0.1× input). Zero means the prefix was too short or cold. */
  cache_read_input_tokens: number;
}

/**
 * Cache only the system prompt. Top-level automatic `cache_control` would
 * breakpoint on the unique user message and never hit. 1h TTL: agent traffic
 * is shared across users but often more than 5 minutes apart.
 */
const SYSTEM_CACHE_CONTROL = { type: 'ephemeral', ttl: '1h' } as const;

function cachedSystem(system: string) {
  return [
    {
      type: 'text',
      text: system,
      cache_control: SYSTEM_CACHE_CONTROL,
    },
  ];
}

export function anthropicRequestBody(opts: {
  model: string;
  maxTokens: number;
  system: string;
  userText: string;
  stream?: boolean;
}): Record<string, unknown> {
  return {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: cachedSystem(opts.system),
    messages: [{ role: 'user', content: opts.userText }],
    ...(opts.stream ? { stream: true } : {}),
  };
}

export function parseAnthropicUsage(raw: unknown): AnthropicUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const input = Number(u.input_tokens);
  const output = Number(u.output_tokens);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
  return {
    input_tokens: Number.isFinite(input) ? input : 0,
    output_tokens: Number.isFinite(output) ? output : 0,
    cache_creation_input_tokens: Number(u.cache_creation_input_tokens) || 0,
    cache_read_input_tokens: Number(u.cache_read_input_tokens) || 0,
  };
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
      body: JSON.stringify(
        anthropicRequestBody({
          model: opts.modelId || MODEL_ID[opts.model],
          maxTokens: opts.maxTokens,
          system: opts.system,
          userText: opts.userText,
        }),
      ),
    });
    if (!res.ok) {
      // The body says why (credit balance, bad model id, rate limit). Without
      // it, weeks of 400s were indistinguishable from each other in the logs.
      const detail = await res.text().catch(() => '');
      logger.warn('anthropic.http_error', {
        status: res.status,
        model: opts.model,
        detail: detail.slice(0, 300),
      });
      return null;
    }
    const json = (await res.json()) as AnthropicResponse;
    return { ...json, usage: parseAnthropicUsage(json.usage) ?? json.usage };
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
  const usage = parseAnthropicUsage(json?.usage) ?? json?.usage ?? null;
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
      body: JSON.stringify(
        anthropicRequestBody({
          model: opts.modelId || MODEL_ID[opts.model],
          maxTokens: opts.maxTokens ?? 320,
          system: opts.system,
          userText: opts.prompt,
          stream: true,
        }),
      ),
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
            const msg = evt.message as { usage?: unknown } | undefined;
            const parsed = parseAnthropicUsage(msg?.usage);
            if (parsed) usage = parsed;
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
