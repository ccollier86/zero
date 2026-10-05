import { describe, expect, test } from 'bun:test';

import { AIConversationSessionBuilder } from './ai-session';
import type { AIFileContentPart, AIMessage, AITextResult } from './ai-types';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('AIConversationSessionBuilder', () => {
  test('carries prior user and assistant turns into the next request', async () => {
    const requests: Array<{ messages: readonly AIMessage[] }> = [];
    const session = new AIConversationSessionBuilder({
      async generateConversation(request) {
        requests.push({ ...request, messages: [...request.messages] });
        return { text: `answer-${requests.length}` } as AITextResult;
      },
    }, {
      model: 'smart',
      system: 'Use short answers.',
    });

    await session.send('first');
    await session.send('second');

    expect(requests[0].messages).toEqual([
      { role: 'system', content: 'Use short answers.' },
      { role: 'user', content: 'first' },
    ]);
    expect(requests[1].messages).toEqual([
      { role: 'system', content: 'Use short answers.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'second' },
    ]);
    expect(session.messages()).toEqual([
      { role: 'system', content: 'Use short answers.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'answer-2' },
    ]);
  });

  test('bounds retained messages while preserving the configured system prompt', () => {
    const session = new AIConversationSessionBuilder({
      async generateConversation() {
        return { text: 'ok' } as AITextResult;
      },
    }, {
      system: 'System stays.',
      maxMessages: 3,
    });

    session.user('one').assistant('two').user('three').assistant('four');

    expect(session.messages()).toEqual([
      { role: 'system', content: 'System stays.' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    ]);
  });

  test.each([0, -1, 1.5, NaN, Infinity])('rejects invalid retention setting %s', value => {
    const runner = { async generateConversation() { return { text: 'ok' } as AITextResult; } };
    expect(() => new AIConversationSessionBuilder(runner, { maxMessages: value })).toThrow('maxMessages');
    expect(() => new AIConversationSessionBuilder(runner, { maxCharacters: value })).toThrow('maxCharacters');
  });

  test('serializes sends and snapshots each request after prior turn completion', async () => {
    const firstGate = deferred<AITextResult>();
    const requests: AIMessage[][] = [];
    const session = new AIConversationSessionBuilder({
      async generateConversation(request) {
        requests.push(structuredClone([...request.messages]));
        return requests.length === 1 ? firstGate.promise : { text: 'second answer' } as AITextResult;
      },
    });
    const first = session.send('first');
    const second = session.send('second');
    try {
      await Promise.resolve();
      expect(requests.length).toBe(1);
      firstGate.resolve({ text: 'first answer' } as AITextResult);
      await first;
      await second;
      expect(requests[1]).toEqual([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second' },
      ]);
    } finally {
      firstGate.resolve({ text: 'first answer' } as AITextResult);
      await Promise.allSettled([first, second]);
    }
  });

  test('keeps queued sends progressing after an earlier rejection', async () => {
    const gate = deferred<AITextResult>();
    let calls = 0;
    const session = new AIConversationSessionBuilder({
      async generateConversation() {
        calls += 1;
        if (calls === 1) return gate.promise;
        return { text: 'recovered' } as AITextResult;
      },
    });
    const first = session.send('first');
    const rejection = first.catch(error => error as Error);
    const second = session.send('second');
    await Promise.resolve();
    gate.reject(new Error('synthetic failure'));
    expect((await rejection as Error).message).toBe('synthetic failure');
    expect((await second).text).toBe('recovered');
    expect(calls).toBe(2);
  });

  test.each(['clear', 'append'] as const)('fences a late reply after manual %s', async operation => {
    const gate = deferred<AITextResult>();
    const session = new AIConversationSessionBuilder({
      async generateConversation() { return gate.promise; },
    });
    const pending = session.send('old request');
    await Promise.resolve();
    if (operation === 'clear') session.clear();
    else session.user('manual context');
    gate.resolve({ text: 'old reply' } as AITextResult);
    await pending;
    expect(session.messages().some(message => message.content === 'old reply')).toBe(false);
    if (operation === 'clear') expect(session.messages()).toEqual([]);
  });

  test('detaches admitted messages, returned history and active request history', async () => {
    const gate = deferred<AITextResult>();
    let retained: readonly AIMessage[] = [];
    const session = new AIConversationSessionBuilder({
      async generateConversation(request) { retained = request.messages; return gate.promise; },
    });
    const original: AIMessage = { role: 'user', content: [{ type: 'text', text: 'original' }] };
    session.append(original);
    (original.content as Array<{ type: 'text'; text: string }>)[0]!.text = 'caller mutation';
    const exported = session.messages();
    (exported[0]!.content as Array<{ type: 'text'; text: string }>)[0]!.text = 'history mutation';
    const pending = session.send('request');
    await Promise.resolve();
    session.user('later manual context');
    expect(retained).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'original' }] },
      { role: 'user', content: 'request' },
    ]);
    gate.resolve({ text: 'reply' } as AITextResult);
    await pending;
  });

  test('preserves captured base controls and per-call precedence', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const headers = { 'x-session': 'base' };
    const session = new AIConversationSessionBuilder({
      async generateConversation(request) {
        requests.push(request);
        return { text: 'ok' } as AITextResult;
      },
    }, { headers, timeout: 500, maxOutputTokens: 20 });
    headers['x-session'] = 'mutated';
    await session.send('first');
    await session.send('second', { maxOutputTokens: 10, headers: { 'x-call': 'override' } });
    expect(requests[0]!.headers).toEqual({ 'x-session': 'base' });
    expect(requests[0]!.timeout).toBe(500);
    expect(requests[0]!.maxOutputTokens).toBe(20);
    expect(requests[1]!.headers).toEqual({ 'x-call': 'override' });
    expect(requests[1]!.maxOutputTokens).toBe(10);
  });

  test('cancels queued stale history but allows a new post-clear request', async () => {
    const gate = deferred<AITextResult>();
    const requests: AIMessage[][] = [];
    const session = new AIConversationSessionBuilder({
      async generateConversation(request) {
        requests.push([...request.messages]);
        return requests.length === 1 ? gate.promise : { text: 'new reply' } as AITextResult;
      },
    });
    const first = session.send('old');
    const queued = session.send('queued').catch(error => error);
    await Promise.resolve();
    session.clear();
    const fresh = session.send('fresh');
    gate.resolve({ text: 'old reply' } as AITextResult);
    await first;
    expect((await queued).code).toBe('AI_REQUEST_ABORTED');
    await fresh;
    expect(requests).toHaveLength(2);
    expect(session.messages()).toEqual([
      { role: 'user', content: 'fresh' }, { role: 'assistant', content: 'new reply' },
    ]);
  });

  test('does not serialize different sessions through a global queue', async () => {
    const gate = deferred<AITextResult>();
    const blocked = new AIConversationSessionBuilder({
      async generateConversation() { return gate.promise; },
    }).send('blocked');
    const independent = new AIConversationSessionBuilder({
      async generateConversation() { return { text: 'independent' } as AITextResult; },
    }).send('independent');
    expect((await independent).text).toBe('independent');
    gate.resolve({ text: 'released' } as AITextResult);
    await blocked;
  });

  test('captures queued binary/URL content and mutable controls at admission', async () => {
    const gate = deferred<AITextResult>();
    const requests: Array<Record<string, unknown> & { messages: readonly AIMessage[] }> = [];
    const session = new AIConversationSessionBuilder({
      async generateConversation(request) {
        requests.push(request);
        return requests.length === 1 ? gate.promise : { text: 'second' } as AITextResult;
      },
    });
    const first = session.send('first');
    const bytes = new Uint8Array([1, 2]);
    const url = new URL('https://example.test/original');
    const headers = { 'x-call': 'original' };
    const providerOptions = { synthetic: { mode: 'original' } };
    const second = session.send([
      { type: 'file', data: bytes, mediaType: 'application/pdf' },
      { type: 'file', data: url, mediaType: 'application/pdf' },
    ], { headers, providerOptions });
    await Promise.resolve();
    bytes[0] = 9;
    url.pathname = '/mutated';
    headers['x-call'] = 'mutated';
    providerOptions.synthetic.mode = 'mutated';
    gate.resolve({ text: 'first answer' } as AITextResult);
    await Promise.all([first, second]);
    expect(requests[1]!.headers).toEqual({ 'x-call': 'original' });
    expect(requests[1]!.providerOptions).toEqual({ synthetic: { mode: 'original' } });
    const content = requests[1]!.messages.at(-1)!.content as readonly AIFileContentPart[];
    expect(content[0]!.data).toEqual(new Uint8Array([1, 2]));
    expect((content[1]!.data as URL).href).toBe('https://example.test/original');
  });
});
