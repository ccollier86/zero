/** Actual SDK execution with synthetic models; provider work must wait on durable audit, never on unrelated calls. */
import { expect, test } from 'bun:test';
import { generateText, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { auditAIModel, type AIExecutionAuditSpan } from './ai-execution-audit';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

function span(events: string[], admitted: Promise<void> = Promise.resolve()): AIExecutionAuditSpan {
  let done = false;
  return { async admit() { events.push('admitting'); await admitted; events.push('admitted'); },
    async finish(outcome) { if (!done) { done = true; events.push(outcome); } }, assertCurrent() {} };
}

test('SDK provider invocation waits for durable admission and preserves model receivers, including frozen models', async () => {
  let release!: () => void;
  const admission = new Promise<void>(resolve => { release = resolve; }), events: string[] = [];
  const model = Object.freeze(new MockLanguageModelV4({ doGenerate: { content: [{ type: 'text', text: 'synthetic answer' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] } }));
  const wrapped = auditAIModel(model, () => span(events, admission));
  const generation = generateText({ model: wrapped, prompt: 'private prompt must never be audit input', maxRetries: 0 });
  await Promise.resolve(); await Promise.resolve(); expect(model.doGenerateCalls).toHaveLength(0);
  release(); expect((await generation).text).toBe('synthetic answer'); expect(model.doGenerateCalls).toHaveLength(1);
  expect(events).toEqual(['admitting', 'admitted', 'completed']);
});

test('SDK streaming remains synchronously constructible and records completion only after an actual finish part', async () => {
  const events: string[] = [];
  const model = new MockLanguageModelV4({ doStream: { stream: new ReadableStream({ start(c) {
    const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: 'Hello' },
      { type: 'text-end', id: 'a' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }];
    for (const part of parts) c.enqueue(part);
    c.close();
  } }) } });
  const result = streamText({ model: auditAIModel(model, () => span(events)), prompt: 'synthetic private prompt', maxRetries: 0 });
  expect(result).not.toBeInstanceOf(Promise);
  expect(await result.text).toBe('Hello'); expect(events).toEqual(['admitting', 'admitted', 'completed']);
});

test('audit admission failure performs no provider call, and a slow invocation does not serialize independent ones', async () => {
  let calls = 0, release!: () => void;
  const model = { async doGenerate() { calls++; if (calls === 1) await new Promise<void>(resolve => { release = resolve; }); return { ok: true }; } };
  const denied = auditAIModel(model, () => ({ ...span([]), async admit() { throw new Error('Audit unavailable'); } }));
  await expect(denied.doGenerate()).rejects.toThrow('Audit unavailable'); expect(calls).toBe(0);
  const events: string[] = [], wrapped = auditAIModel(model, () => span(events));
  const first = wrapped.doGenerate();
  while (!release) await Promise.resolve();
  expect(await wrapped.doGenerate()).toEqual({ ok: true }); expect(calls).toBe(2);
  release(); await first; expect(events.filter(e => e === 'completed')).toHaveLength(2);
});

test('stream cancellation and EOF without a provider finish are unknown, never fabricated completion', async () => {
  for (const cancel of [false, true]) {
    const events: string[] = [];
    const model = { async doStream() { return { stream: new ReadableStream({ start(c) { if (!cancel) c.close(); } }) }; } };
    const result = await auditAIModel(model, () => span(events)).doStream();
    if (cancel) await result.stream.cancel(); else await new Response(result.stream).text();
    expect(events).toEqual(['admitting', 'admitted', 'unknown']);
  }
});
