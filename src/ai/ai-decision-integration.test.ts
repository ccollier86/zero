/** Real loopback transport and managed Elysia facade proof; no hosted model calls. */
import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { AIDecision, AIService, createAIPlugin, resolveAIConfig } from '@zero/framework/ai';
import { AIDecision as ServerDecision } from '@zero/framework/server';
import { createAIRegistry } from './ai-registry';
import type { AIDecisionResult, AIDecisionRequest, AIDecisionChoiceQuestion } from './ai-decision-types';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';

const questions = { route: AIDecision.choice('Which team?', { billing: 'Payments', triage: 'Other' }) };
function raw(choice: 'billing' | 'triage' = 'billing') {
  return { model: 'loopback-checkpoint', answers: { route: { type: 'choice', choice,
    probabilities: { billing: choice === 'billing' ? 0.95 : 0.05, triage: choice === 'triage' ? 0.95 : 0.05 }, confidence: 0.9 } },
    usage: { input_tokens: 40, output_tokens: 0 } };
}

describe('native decisions configuration and package integration', () => {
  test('public AI and server barrels share the same native helpers', () => {
    expect(AIDecision).toBe(ServerDecision);
  });

  test('detects Jev credentials and Laya endpoints but does not select a hosted default alias', () => {
    const config = resolveAIConfig(true, { TYPESAFE_API_KEY: 'synthetic-key', LAYA_BASE_URL: 'http://127.0.0.1:8000' });
    if (!config) throw new Error('Fixture disabled');
    expect(config.providers.jev.active).toBe(true); expect(config.providers.jev.baseURL).toBe('https://api.typesafe.ai/v1');
    expect(config.providers.laya.active).toBe(true); expect(config.providers.laya.apiKey).toBeUndefined();
    expect(config.aliases.decisions).toBeUndefined();
    const selected = resolveAIConfig(true, { ZERO_AI_DECISIONS_MODEL: 'laya/multilingual', LAYA_BASE_URL: 'http://127.0.0.1:8000' });
    if (!selected) throw new Error('Fixture disabled');
    expect(selected.aliases.decisions).toBe('laya/multilingual');
  });

  test('keeps missing key / endpoint inactive and honors explicit ambient credential suppression', () => {
    const config = resolveAIConfig({ autoDetect: false, providers: {
      jev: { type: 'jev', apiKey: null }, laya: { type: 'laya', baseURL: null },
    } }, { TYPESAFE_API_KEY: 'must-not-inherit', LAYA_BASE_URL: 'http://127.0.0.1:8000' });
    if (!config) throw new Error('Fixture disabled');
    expect(config.providers.jev.reason).toBe('missing_api_key'); expect(config.providers.laya.reason).toBe('missing_base_url');
    expect(new AIService(config, { emitCode: () => undefined }).status().providers.every(p => !p.active)).toBe(true);
  });

  test('rejects impossible native capability/locality declarations and credential-bearing endpoints', () => {
    expect(() => resolveAIConfig({ autoDetect: false, providers: { jev: { type: 'jev', apiKey: 'key', decisionLocality: 'local' } } }, {})).toThrow();
    expect(() => resolveAIConfig({ autoDetect: false, providers: { openai: { type: 'openai', apiKey: 'key', capabilities: { decisions: true } } } }, {})).toThrow();
    for (const baseURL of ['http://user:private@localhost:8000', 'http://localhost:8000?key=private', 'http://localhost:8000#private']) {
      const config = resolveAIConfig({ autoDetect: false, providers: { laya: { type: 'laya', baseURL } } }, {});
      if (!config) throw new Error('Fixture disabled');
      expect(() => createAIRegistry(config, () => undefined)).toThrow('requires a valid HTTP(S) endpoint');
    }
  });

  test('missing decision alias is a configuration failure, never automatic local-to-hosted fallback', async () => {
    let calls = 0;
    const config = resolveAIConfig({ autoDetect: false, providers: {
      jev: { type: 'jev', apiKey: 'key', fetch: async () => { calls++; return Response.json(raw()); } },
    } }, {});
    if (!config) throw new Error('Fixture disabled');
    const error = await new AIService(config, { emitCode: () => undefined }).decisions.evaluate({ state: 'hello', questions }).catch(e => e);
    expect(error.code).toBe('AI_MODEL_NOT_CONFIGURED'); expect(calls).toBe(0);
  });

  test('operation-specific and custom native aliases report correct capability readiness', () => {
    const config = resolveAIConfig({ autoDetect: false, providers: { local: {
      type: 'laya', baseURL: 'http://localhost:8000',
    } }, aliases: { decisions: 'local/multilingual', intake: 'local/multilingual', smart: 'local/multilingual' } }, {});
    if (!config) throw new Error('Fixture disabled');
    const status = new AIService(config, { emitCode: () => undefined }).status();
    expect(status.aliases.decisions.active).toBe(true); expect(status.aliases.intake.active).toBe(true);
    expect(status.aliases.smart.active).toBe(false);
  });

  test('managed app decoration reaches the real self-hosted HTTP endpoint', async () => {
    let calls = 0;
    const runtime = new ZeroAppRuntime('native-decision-loopback');
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      calls++; expect(new URL(request.url).pathname).toBe('/v1/systemone');
      expect(request.headers.get('authorization')).toBe('Bearer local-fixture-key');
      const body = await request.json() as { model: string; state: unknown; questions: unknown };
      expect(body.model).toBe('multilingual'); expect(body.questions).toEqual(questions);
      expect(body.state).toEqual({ message: 'I need help with a payment' }); return Response.json(raw());
    } });
    try {
      const config = resolveAIConfig({ autoDetect: false, providers: { local: {
        type: 'laya', apiKey: 'local-fixture-key', baseURL: `http://127.0.0.1:${server.port}/v1`, decisionLocality: 'local',
      } }, aliases: { decisions: 'local/multilingual' } }, {});
      if (!config) throw new Error('Fixture disabled');
      const app = new Elysia().use(createAIPlugin({ config, runtime,
        service: new AIService(config, { emitCode: () => undefined }),
      })).get('/route', ({ ai }) => ai.decisions.evaluate({
        state: { message: 'I need help with a payment' }, questions, locality: 'local-only',
      }));
      const response = await app.handle(new Request('http://localhost/route'));
      expect(response.status).toBe(200);
      const result = await response.json() as AIDecisionResult<typeof questions>;
      expect(result.answers.route.choice).toBe('billing'); expect(calls).toBe(1);
    } finally { await runtime.dispose(); server.stop(true); }
  });

  test('managed retirement cancels native requests and rejects retained service handles', async () => {
    const runtime = new ZeroAppRuntime('native-decision-retirement');
    const config = resolveAIConfig({ autoDetect: false, providers: { local: {
      type: 'laya', baseURL: 'http://localhost:8000', fetch: () => new Promise(() => {}),
    } }, aliases: { decisions: 'local/multilingual' } }, {});
    if (!config) throw new Error('Fixture disabled');
    const service = new AIService(config, { emitCode: () => undefined });
    createAIPlugin({ config, runtime, service });
    const pending = service.decisions.evaluate({ state: 'hello', questions });
    await runtime.dispose();
    expect((await pending.catch(error => error)).code).toBe('AI_REQUEST_ABORTED');
    expect((await service.decisions.evaluate({ state: 'hello', questions }).catch(error => error)).code).toBe('AI_DISABLED');
  });

  test('independent app services never cross their configured decision transports', async () => {
    const create = (id: string, choice: 'billing' | 'triage') => {
      const config = resolveAIConfig({ autoDetect: false, providers: { [id]: { type: 'laya', baseURL: 'http://localhost:8000',
        fetch: async () => Response.json(raw(choice)) } }, aliases: { decisions: `${id}/checkpoint` } }, {});
      if (!config) throw new Error('Fixture disabled'); return new AIService(config, { emitCode: () => undefined });
    };
    const [a, b] = await Promise.all([create('appA', 'billing'), create('appB', 'triage')].map(ai => ai.decisions.evaluate({ state: 'same', questions })));
    expect(a.answers.route.choice).toBe('billing'); expect(a.provenance.providerId).toBe('appA');
    expect(b.answers.route.choice).toBe('triage'); expect(b.provenance.providerId).toBe('appB');
  });
});

// Compiled by the normal repository typecheck, never executed against a provider.
function verifyInferredAnswers(ai: AIService) {
  void ai.decisions.evaluate({ state: 'text', questions }).then(result => {
    const label: 'billing' | 'triage' = result.answers.route.choice; void label;
    // @ts-expect-error Choice labels are not arbitrary strings.
    const bad: 'sales' = result.answers.route.choice; void bad;
    // @ts-expect-error A choice result does not expose a yes/no probability field.
    result.answers.route.noul;
  });
  const question: AIDecisionChoiceQuestion<'billing' | 'triage'> = questions.route; void question;
  const request: AIDecisionRequest<typeof questions> = { state: 'text', questions }; void request;
}
void verifyInferredAnswers;
