import { describe, expect, test } from 'bun:test';
import { AIService } from './ai-service';
import { resolveAIConfig } from './ai-env';
import { AIDecision } from './ai-decision-types';
import type { AIDecisionRequest, AIDecisionQuestions } from './ai-decision-types';
import type { AIFetchFunction, AIProviderConfig } from './ai-provider-types';
import { AIError } from './ai-errors';
import { OBS_CODES } from '../observability/codes';
import { createAIRegistry } from './ai-registry';

const questions = {
  department: AIDecision.choice('Which department handles this?', { billing: 'Payments', technical: 'Software' }),
  urgency: AIDecision.score('How urgent?', ['Routine', 'Soon', 'Blocking']),
  human: AIDecision.yesNo('Did they request a human?'),
};
function response() {
  return { model: 'qualified-checkpoint', answers: {
    department: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, technical: 0.1 }, confidence: 0.8 },
    urgency: { type: 'score', score: 1.3, probabilities: { '0': 0.1, '1': 0.5, '2': 0.4 },
      legend: { '0': 'Routine', '1': 'Soon', '2': 'Blocking' }, confidence: 0.4 },
    human: { type: 'noul', noul: 0.98 },
  }, usage: { input_tokens: 200, output_tokens: 30 } };
}
function service(fetch: AIFetchFunction, overrides: Partial<AIProviderConfig> = {}, events: unknown[] = []) {
  const config = resolveAIConfig({ autoDetect: false, providers: {
    local: { type: 'laya', baseURL: 'http://127.0.0.1:8000', apiKey: null, decisionLocality: 'local', fetch, ...overrides },
  }, aliases: { decisions: 'local/convaiinnovations/laya' } }, {});
  if (!config) throw new Error('Fixture AI disabled');
  return new AIService(config, { emitCode: (code, options) => { events.push({ code: code.code, options }); } });
}
async function expectCode(operation: Promise<unknown>, code: string) {
  const error = await operation.then(() => null, error => error);
  expect(error).toBeInstanceOf(AIError); expect(error?.code).toBe(code); return error;
}

describe('native Zero decision facade', () => {
  test('evaluates a heterogeneous batch with inferred labels and exact wire semantics', async () => {
    let wire: Record<string, unknown> | undefined;
    const ai = service(async (url, init) => {
      expect(String(url)).toBe('http://127.0.0.1:8000/v1/systemone');
      expect(init?.redirect).toBe('error'); expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      wire = JSON.parse(init!.body as string); return Response.json(response());
    });
    const result = await ai.decisions.evaluate({ state: { message: 'I was charged twice' }, questions, contract: 'intake@1', locality: 'local-only' });
    const label: 'billing' | 'technical' = result.answers.department.choice;
    expect(label).toBe('billing'); expect(result.answers.urgency.score).toBe(1.3);
    expect(result.answers.human.noul).toBe(0.98);
    expect(result.answers.human).not.toHaveProperty('confidence');
    expect(wire).toEqual({ model: 'convaiinnovations/laya', state: { message: 'I was charged twice' }, questions });
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 30, totalTokens: 230 });
    expect(result.provenance).toMatchObject({ providerId: 'local', providerType: 'laya', contract: 'intake@1', locality: 'local' });
    expect(result.truncated).toBeNull();
    expect(Object.isFrozen(result.answers.department.probabilities)).toBe(true);
    expect(Object.isFrozen(result.provenance)).toBe(true);
    expect(ai.status().aliases.decisions.active).toBe(true);
    expect(ai.status().providers[0]?.capabilities.decisions).toBe(true);
  });

  test('Jev uses direct bearer HTTP without constructing an SDK adapter', async () => {
    let called = false;
    const config = resolveAIConfig({ autoDetect: false, providers: { jev: {
      type: 'jev', apiKey: 'synthetic-key', fetch: async (url, init) => {
        called = true; expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-key');
        expect(JSON.parse(init!.body as string).model).toBe('jev-1.13.0'); return Response.json(response());
      },
    } }, aliases: { decisions: 'jev/jev-1.13.0' } }, {});
    if (!config) throw new Error('Fixture AI disabled');
    const registry = createAIRegistry(config);
    expect(registry.providerInstances.jev).toBeUndefined(); expect(registry.decisionProviders?.jev).toBeDefined();
    const ai = new AIService(config, { emitCode: () => undefined });
    await ai.decisions.evaluate({ state: 'billing', questions }); expect(called).toBe(true);
    await expectCode(ai.generateText({ model: 'jev/jev-1.13.0', prompt: 'Do not execute' }), 'AI_CAPABILITY_NOT_SUPPORTED');
  });

  test('local-only refuses hosted providers before sending any evidence', async () => {
    let calls = 0;
    const ai = service(async () => { calls++; return Response.json(response()); }, { decisionLocality: 'hosted' });
    await expectCode(ai.decisions.evaluate({ state: 'private', questions, locality: 'local-only' }), 'AI_CAPABILITY_NOT_SUPPORTED');
    expect(calls).toBe(0);
  });

  test('captures headers, credentials, questions and evidence before asynchronous work', async () => {
    let release!: () => void; let captured = '';
    const pending = new Promise<void>(resolve => { release = resolve; });
    const headers = { 'X-Test': 'original' };
    const state = { body: 'original' }, mutable = structuredClone(questions);
    const ai = service(async (_url, init) => {
      expect(new Headers(init?.headers).get('x-test')).toBe('original');
      captured = init!.body as string; await pending; return Response.json(response());
    }, { headers });
    headers['X-Test'] = 'changed';
    const result = ai.decisions.evaluate({ state, questions: mutable });
    state.body = 'changed'; Object.assign(mutable.department.criteria, { billing: 'changed' }); release();
    await result; expect(JSON.parse(captured).state.body).toBe('original');
    expect(JSON.parse(captured).questions.department.criteria.billing).toBe('Payments');
  });

  test('preserves Laya abstention and separate confidence measures and forwards bounded controls', async () => {
    const raw = response() as any;
    raw.answers.department.abstention = 'abstained'; raw.answers.department.abstention_threshold = 0.95;
    raw.answers.department.x_jev_confidence = 0.8; raw.answers.department.answer_confidence = 0.7;
    raw.truncated = true;
    const ai = service(async (_url, init) => {
      expect(JSON.parse(init!.body as string)).toMatchObject({ max_len: 4096, head_max_len: 128, min_confidence: 0.95,
        lang: 'en', lang_guess: 'en', task: 'triage' }); return Response.json(raw);
    });
    const result = await ai.decisions.evaluate({ state: 'billing', questions, laya: {
      maxInputTokens: 4096, maxQuestionTokens: 128, minConfidence: 0.95, language: 'en', languageHint: 'en', task: 'triage',
    } });
    expect(result.answers.department.signals).toEqual({ abstained: true, abstention: 'abstained', abstentionThreshold: 0.95, jevConfidence: 0.8, answerConfidence: 0.7 });
    expect(result.truncated).toBe(true);
  });

  test('does not fabricate usage when a compatible Laya server omits it', async () => {
    const raw = response() as any; delete raw.usage;
    const result = await service(async () => Response.json(raw)).decisions.evaluate({ state: 'billing', questions });
    expect(result.usage).toBeNull();
  });

  test('preserves an unevaluated abstention gate instead of turning it into a pass', async () => {
    const raw = response() as any; raw.answers.human.abstention = 'unevaluated'; raw.answers.human.abstention_threshold = 0.8;
    const result = await service(async () => Response.json(raw)).decisions.evaluate({ state: 'billing', questions });
    expect(result.answers.human.signals.abstention).toBe('unevaluated'); expect(result.answers.human.signals.abstained).toBeNull();
  });

  test('reports actual Laya usage-level truncation and rejects inconsistent coverage', async () => {
    const raw = response() as any;
    Object.assign(raw.usage, { truncated: true, state_tokens: 2000, state_tokens_dropped: 1200, truncated_questions: ['department', 'human'] });
    const result = await service(async () => Response.json(raw)).decisions.evaluate({ state: 'billing', questions });
    expect(result.truncated).toBe(true);
    expect(result.inputCoverage).toEqual({ stateTokens: 2000, stateTokensDropped: 1200, truncatedQuestions: ['department', 'human'] });
    raw.usage.truncated = false;
    await expectCode(service(async () => Response.json(raw)).decisions.evaluate({ state: 'billing', questions }), 'AI_PROVIDER_RESPONSE_INVALID');
  });

  test('retains full unknown-option probability rather than treating it as a failure', async () => {
    const q = { route: AIDecision.choice('Route?', { billing: 'Billing', unknown: 'Insufficient evidence' }) };
    const ai = service(async () => Response.json({ model: 'checkpoint', answers: {
      route: { type: 'choice', choice: 'unknown', probabilities: { billing: 0.05, unknown: 0.95 }, confidence: 0.9 },
    } }));
    const result = await ai.decisions.evaluate({ state: 'Hello', questions: q });
    expect(result.answers.route.choice).toBe('unknown');
  });
});

describe('native decision integrity and lifecycle', () => {
  const mutations: Record<string, (value: any) => void> = {
    missing: raw => { delete raw.answers.human; },
    extra: raw => { raw.answers.injected = { type: 'noul', noul: 1 }; },
    type: raw => { raw.answers.human.type = 'choice'; },
    probability: raw => { raw.answers.human.noul = 1.5; },
    distribution: raw => { raw.answers.department.probabilities.billing = 0.4; },
    unknownLabel: raw => { raw.answers.department.choice = 'injected'; },
    wrongWinner: raw => { raw.answers.department.choice = 'technical'; },
    extraLabel: raw => { raw.answers.department.probabilities.other = 0; },
    score: raw => { raw.answers.urgency.score = 0; },
    legend: raw => { delete raw.answers.urgency.legend['0']; },
    confidence: raw => { raw.answers.department.confidence = -1; },
    usage: raw => { raw.usage.input_tokens = -1; },
    model: raw => { raw.model = ''; },
    truncation: raw => { raw.truncated = 'false'; },
    abstention: raw => { raw.answers.department.abstention = 'false'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    test(`rejects invalid provider ${name}`, async () => {
      const raw = response(); mutate(raw);
      await expectCode(service(async () => Response.json(raw)).decisions.evaluate({ state: 'billing', questions }), 'AI_PROVIDER_RESPONSE_INVALID');
    });
  }

  test('invalid inputs and accessors fail before fetch, without reading the accessor', async () => {
    let calls = 0, getters = 0;
    const ai = service(async () => { calls++; return Response.json(response()); });
    const invalid: unknown[] = [ {}, { q: { type: 'choice', instructions: 'Q', criteria: { one: 'Only' } } },
      { q: { type: 'score', instructions: 'Q', criteria: ['Only'] } },
      { q: { type: 'noul', instructions: 'Q', extra: 'no' } },
      { q: { type: 'noul', instructions: 'Q', criteria: { maybe: 'no' } } },
      Object.defineProperty({}, 'q', { enumerable: true, get() { getters++; throw new Error('private'); } }),
    ];
    for (const value of invalid) await expectCode(ai.decisions.evaluate({ state: 'billing', questions: value as AIDecisionQuestions }), 'AI_REQUEST_INVALID');
    await expectCode(ai.decisions.evaluate({ state: 'billing', questions, timeoutMs: 0 }), 'AI_REQUEST_INVALID');
    await expectCode(ai.decisions.evaluate({ state: 'billing', questions, maxRetries: 4 }), 'AI_REQUEST_INVALID');
    await expectCode(ai.decisions.evaluate({ state: 'x'.repeat(1024 * 1024), questions }), 'AI_REQUEST_LIMIT_EXCEEDED');
    expect(calls).toBe(0); expect(getters).toBe(0);
  });

  test('enforces deadline even if a custom fetch ignores cancellation', async () => {
    const ai = service(() => new Promise(() => {}));
    await expectCode(ai.decisions.evaluate({ state: 'billing', questions, timeoutMs: 15 }), 'AI_REQUEST_TIMEOUT');
  });

  test('cancels a stalled response body and never accepts an incomplete answer', async () => {
    let cancelled = false;
    const ai = service(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await expectCode(ai.decisions.evaluate({ state: 'billing', questions, timeoutMs: 15 }), 'AI_REQUEST_TIMEOUT');
    expect(cancelled).toBe(true);
  });

  test('external cancellation is distinct from timeout and does not leak the abort reason', async () => {
    const controller = new AbortController(), events: unknown[] = [];
    const ai = service(() => new Promise(() => {}), {}, events);
    const result = ai.decisions.evaluate({ state: 'private-body', questions, abortSignal: controller.signal });
    controller.abort(new Error('private-secret-abort'));
    const error = await expectCode(result, 'AI_REQUEST_ABORTED');
    expect(error.message).not.toContain('private-secret-abort'); expect(JSON.stringify(events)).not.toContain('private-body');
  });

  test('reentrant cancellation observes a rejected transport without an unhandled private error', async () => {
    const controller = new AbortController();
    const ai = service(() => { controller.abort(); return Promise.reject(new Error('private-fetch-rejection')); });
    await expectCode(ai.decisions.evaluate({ state: 'billing', questions, abortSignal: controller.signal }), 'AI_REQUEST_ABORTED');
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });

  test('retirement during request-start observability cannot admit new inference', async () => {
    let calls = 0;
    const config = resolveAIConfig({ autoDetect: false, providers: { local: {
      type: 'laya', baseURL: 'http://localhost:8000', fetch: async () => { calls++; return Response.json(response()); },
    } }, aliases: { decisions: 'local/multilingual' } }, {});
    if (!config) throw new Error('Fixture disabled');
    let ai!: AIService;
    ai = new AIService(config, { emitCode: code => { if (code.code === OBS_CODES.AI_REQUEST_STARTED.code) ai.decisions.dispose(); } });
    await expectCode(ai.decisions.evaluate({ state: 'billing', questions }), 'AI_DISABLED');
    expect(calls).toBe(0);
  });

  test('pre-aborted requests do not fetch', async () => {
    let calls = 0; const controller = new AbortController(); controller.abort();
    await expectCode(service(async () => { calls++; return Response.json(response()); }).decisions.evaluate({
      state: 'billing', questions, abortSignal: controller.signal,
    }), 'AI_REQUEST_ABORTED'); expect(calls).toBe(0);
  });

  test('honors bounded rate-limit retries, uses the same captured request, and emits one lifecycle', async () => {
    let calls = 0; const bodies: string[] = [], events: any[] = [];
    const ai = service(async (_url, init) => {
      bodies.push(init!.body as string); calls++;
      return calls === 1 ? new Response('private-error-body', { status: 429, headers: { 'Retry-After': '0' } }) : Response.json(response());
    }, {}, events);
    await ai.decisions.evaluate({ state: 'private-message', questions, maxRetries: 1 });
    expect(calls).toBe(2); expect(bodies[0]).toBe(bodies[1]);
    expect(events.filter(e => e.code === OBS_CODES.AI_REQUEST_STARTED.code)).toHaveLength(1);
    expect(events.filter(e => e.code === OBS_CODES.AI_REQUEST_COMPLETED.code)).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('private-message'); expect(JSON.stringify(events)).not.toContain('private-error-body');
  });

  test('default no-retry and exhausted provider errors stay failures, with no raw body leakage', async () => {
    let calls = 0;
    const ai = service(async () => { calls++; return new Response('private-provider-error', { status: 529 }); });
    const error = await expectCode(ai.decisions.evaluate({ state: 'billing', questions }), 'AI_REQUEST_FAILED');
    expect(error.status).toBe(529); expect(error.message).not.toContain('private-provider-error'); expect(calls).toBe(1);
  });

  test('retry waits are included in the one overall deadline', async () => {
    let calls = 0;
    await expectCode(service(async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); })
      .decisions.evaluate({ state: 'billing', questions, maxRetries: 3, timeoutMs: 15 }), 'AI_REQUEST_TIMEOUT');
    expect(calls).toBe(1);
  });

  test('rejects malformed JSON, invalid UTF-8 and oversized streaming response bodies', async () => {
    for (const raw of ['not-json', new Uint8Array([0xff]), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      await expectCode(service(async () => new Response(raw)).decisions.evaluate({ state: 'billing', questions }), 'AI_PROVIDER_RESPONSE_INVALID');
    }
  });

  test('rejects redirects and never retries client rejection', async () => {
    let calls = 0;
    const ai = service(async () => { calls++; return new Response('', { status: 422 }); });
    await expectCode(ai.decisions.evaluate({ state: 'billing', questions, maxRetries: 3 }), 'AI_REQUEST_FAILED');
    expect(calls).toBe(1);
    await expectCode(service(async () => new Response('', { status: 302, headers: { Location: 'https://other.test' } }))
      .decisions.evaluate({ state: 'billing', questions }), 'AI_REQUEST_FAILED');
  });
});
