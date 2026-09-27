import { afterEach, describe, expect, it, vi } from 'vitest';

import { anthropicRequestBody, askAgent, parseAnthropicUsage } from './anthropic.js';

afterEach(() => vi.unstubAllGlobals());

describe('anthropicRequestBody', () => {
  it('caches only the system prompt, not the per-ask user message', () => {
    const body = anthropicRequestBody({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 200,
      system: 'stable system',
      userText: 'unique question',
    });
    expect(body.system).toEqual([
      {
        type: 'text',
        text: 'stable system',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: 'unique question' }]);
    expect(body.cache_control).toBeUndefined();
  });
});

describe('parseAnthropicUsage', () => {
  it('reads cache write and read tokens', () => {
    expect(
      parseAnthropicUsage({
        input_tokens: 400,
        output_tokens: 80,
        cache_creation_input_tokens: 1500,
        cache_read_input_tokens: 0,
      }),
    ).toEqual({
      input_tokens: 400,
      output_tokens: 80,
      cache_creation_input_tokens: 1500,
      cache_read_input_tokens: 0,
    });
  });

  it('defaults missing cache fields to zero', () => {
    expect(parseAnthropicUsage({ input_tokens: 10, output_tokens: 2 })).toEqual({
      input_tokens: 10,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });
});

describe('askAgent prompt cache', () => {
  it('posts the cached system block and returns cache usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Central line is delayed.' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 220,
          output_tokens: 18,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1400,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await askAgent({
      apiKey: 'k',
      system: 'DriveIQ agent',
      prompt: 'Central line?',
      model: 'haiku',
    });

    expect(res.text).toBe('Central line is delayed.');
    expect(res.usage?.cache_read_input_tokens).toBe(1400);
    const posted = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      system: unknown;
    };
    expect(posted.system).toEqual([
      {
        type: 'text',
        text: 'DriveIQ agent',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ]);
  });
});
