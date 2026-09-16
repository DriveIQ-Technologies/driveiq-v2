import { afterEach, describe, expect, it, vi } from 'vitest';

import { askAgentStream } from './anthropic.js';

/**
 * The SSE parser is the part of streaming most likely to be subtly wrong: the
 * network splits frames at arbitrary byte boundaries, so a parser that assumes
 * one chunk == one frame silently drops or mangles text. These feed the same
 * response split in several awkward ways and assert the assembled answer is
 * identical every time.
 */

function sse(events: unknown[]): string {
  return events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** Serve `body` as a stream cut into chunks of exactly `size` bytes. */
function mockFetch(body: string, size: number) {
  const bytes = new TextEncoder().encode(body);
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < bytes.length; i += size) {
          yield bytes.slice(i, i + size);
        }
      },
    },
  });
}

const FRAMES = [
  { type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 0 } } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Arsenal play ' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'at 19:30 London' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: ' tonight.' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } },
];

afterEach(() => vi.unstubAllGlobals());

async function run(chunkSize: number) {
  vi.stubGlobal('fetch', mockFetch(sse(FRAMES), chunkSize));
  const deltas: string[] = [];
  const res = await askAgentStream({
    apiKey: 'k',
    system: 's',
    prompt: 'p',
    model: 'haiku',
    onDelta: (t) => deltas.push(t),
  });
  return { res, deltas };
}

describe('askAgentStream', () => {
  it('assembles the answer regardless of where chunks split', async () => {
    for (const size of [1, 3, 17, 64, 4096]) {
      const { res, deltas } = await run(size);
      expect(res.text, `chunk size ${size}`).toBe('Arsenal play at 19:30 London tonight.');
      expect(deltas.join(''), `chunk size ${size}`).toBe(
        'Arsenal play at 19:30 London tonight.',
      );
      vi.unstubAllGlobals();
    }
  });

  it('emits deltas progressively rather than all at the end', async () => {
    const { deltas } = await run(4096);
    expect(deltas.length).toBe(3);
    expect(deltas[0]).toBe('Arsenal play ');
  });

  it('reports usage and a clean stop', async () => {
    const { res } = await run(64);
    expect(res.truncated).toBe(false);
    expect(res.usage?.input_tokens).toBe(1200);
    expect(res.usage?.output_tokens).toBe(42);
  });

  it('flags a truncated answer', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        sse([
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Half an ans' } },
          { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
        ]),
        11,
      ),
    );
    const res = await askAgentStream({
      apiKey: 'k', system: 's', prompt: 'p', model: 'haiku', onDelta: () => undefined,
    });
    expect(res.truncated).toBe(true);
    expect(res.text).toBe('Half an ans');
  });

  it('ignores an unparseable frame instead of failing the whole stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('data: {broken json\n\n');
          yield new TextEncoder().encode(
            `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'still here' } })}\n\n`,
          );
        },
      },
    }));
    const res = await askAgentStream({
      apiKey: 'k', system: 's', prompt: 'p', model: 'haiku', onDelta: () => undefined,
    });
    expect(res.text).toBe('still here');
  });

  it('throws on a non-200 so the caller can fall back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 529, body: null }));
    await expect(
      askAgentStream({ apiKey: 'k', system: 's', prompt: 'p', model: 'haiku', onDelta: () => undefined }),
    ).rejects.toThrow(/529/);
  });
});
