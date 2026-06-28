import { afterEach, describe, expect, test } from 'bun:test';

import { createMetaLlama } from './meta-llama';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createMetaLlama', () => {
  test('maps generate requests and parses Meta response bodies', async () => {
    let request: Request | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Response.json({
        completion_message: {
          content: { type: 'text', text: 'Meta says hello' },
          stop_reason: 'stop',
        },
        usage: {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 7,
        },
      });
    }) as typeof fetch;

    const model = createMetaLlama({
      apiKey: 'llama-key',
      baseURL: 'https://llama.test/v1/',
    })('Llama-Test');

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Hello' }],
      abortSignal: undefined,
    } as any);

    expect(request!.url).toBe('https://llama.test/v1/chat/completions');
    expect(request!.headers.get('authorization')).toBe('Bearer llama-key');
    expect(await request!.json()).toMatchObject({
      model: 'Llama-Test',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    });
    expect(result.content).toEqual([{ type: 'text', text: 'Meta says hello' }]);
    expect(result.usage).toEqual({
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 7,
    });
  });

  test('parses OpenAI-compatible stream chunks from Meta responses', async () => {
    globalThis.fetch = (async () => new Response(
      [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        '',
        'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
      { headers: { 'content-type': 'text/event-stream' } }
    )) as unknown as typeof fetch;

    const model = createMetaLlama({ apiKey: 'llama-key' })('Llama-Test');
    const result = await model.doStream({
      prompt: [{ role: 'user', content: 'Hello' }],
      abortSignal: undefined,
    } as any);
    const parts = await readStream(result.stream);

    expect(parts).toEqual([
      { type: 'stream-start', warnings: [] },
      { type: 'text-delta', id: 'text-0', delta: 'Hel' },
      { type: 'text-delta', id: 'text-0', delta: 'lo' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
    ]);
  });
});

async function readStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const values: T[] = [];

  while (true) {
    const next = await reader.read();
    if (next.done) return values;
    values.push(next.value);
  }
}
