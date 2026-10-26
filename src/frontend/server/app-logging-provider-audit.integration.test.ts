/** Real managed compliance composition, SDK execution and private Fabric evidence; no external providers. */
import type { ProviderV4 } from '@ai-sdk/provider';
import { expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app-factory';
import { defineEndpoint, defineRouter, defineZeroPlugin } from './server-extensions';
import type { ServerRouteServices } from './server-services';
import { normalizeLoggingEvent } from '../../logging/logging-validation';
import { AIDecision } from '../../ai';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const message = { to: 'private-recipient@example.test', subject: 'PRIVATE_SUBJECT', text: 'PRIVATE_EMAIL_CONTENT' };

test('managed AI generation, streaming and email acceptance retain valid provider provenance and the initiating actor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-managed-provider-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined, services: ServerRouteServices | undefined, sends = 0, decisions = 0;
  const model = new MockLanguageModelV4({
    doGenerate: { content: [{ type: 'text', text: 'PRIVATE_AI_RESULT' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] },
    doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'text-start', id: 'a' });
      controller.enqueue({ type: 'text-delta', id: 'a', delta: 'PRIVATE_STREAM_RESULT' });
      controller.enqueue({ type: 'text-end', id: 'a' });
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage });
      controller.close();
    } }) }),
  });
  const adapter: ProviderV4 = { specificationVersion: 'v4', languageModel: () => model,
    embeddingModel() { throw new Error('Not used'); }, imageModel() { throw new Error('Not used'); } };
  const decisionFetch = async () => {
    decisions++; return Response.json({ model: 'synthetic-checkpoint', answers: { route: { type: 'choice', choice: 'billing',
      probabilities: { billing: 0.95, triage: 0.05 }, confidence: 0.9 } }, usage: { input_tokens: 1, output_tokens: 0 } });
  };
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({ projectRoot: root,
      db: { mode: 'file', path: join(root, 'application.db'), synchronous: 'FULL' },
      systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {},
      auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
      logging: { preset: 'compliance', rootDirectory: 'logging' },
      ai: { autoDetect: false, providers: {
        synthetic: { type: 'custom', adapter, capabilities: { text: true, streaming: true } },
        local: { type: 'laya', baseURL: 'http://127.0.0.1:1/v1', fetch: decisionFetch },
        hosted: { type: 'jev', apiKey: 'PRIVATE_SYNTHETIC_KEY', fetch: decisionFetch },
      }, aliases: { smart: 'synthetic/private-model' } },
      email: { from: 'private-sender@example.test', provider: { name: 'synthetic', async send(value) {
        sends++; return { provider: 'synthetic', accepted: Array.isArray(value.to) ? value.to : [value.to] };
      } } },
      workflows: false, vector: false, kv: false, pdf: false,
      appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
      migrate: false, serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
      serverRoutesDir: false, resourceRoutes: false, observability: { console: false }, serverExtensions: [
        defineZeroPlugin({ name: 'provider-proof-services', setup({ zero }) { services = zero; } }),
        defineRouter({ name: 'provider-proof', prefix: '/proof', auth: { user: 'required', credentials: ['session'] }, routes: [
          defineEndpoint({ method: 'POST', path: '/providers', handler: ({ zero }) => zero.logging!.run(async () => {
            const generated = await zero.ai!.generateText({ prompt: 'PRIVATE_AI_PROMPT', maxRetries: 0 });
            const streamed = await zero.ai!.streamText({ prompt: 'PRIVATE_STREAM_PROMPT', maxRetries: 0 }).text;
            const questions = { route: AIDecision.choice('Which team?', { billing: 'Payments', triage: 'Other' }) };
            const local = await zero.ai!.decisions.evaluate({ model: 'local/fixture', state: 'PRIVATE_DECISION_INPUT', questions });
            const hosted = await zero.ai!.decisions.evaluate({ model: 'hosted/fixture', state: 'PRIVATE_DECISION_INPUT', questions });
            const sent = await zero.email!.send(message);
            return { generated: generated.text, streamed, local: local.answers.route.choice, hosted: hosted.answers.route.choice, accepted: sent.accepted.length };
          }) }),
          defineEndpoint({ method: 'POST', path: '/forged-provider-evidence', handler: ({ zero }) => zero.logging!.record({
            id: 'forged-provider', family: 'ai', action: 'app.provider.completed', outcome: 'succeeded', evidence: 'provider-confirmed', occurredAt: Date.now(),
          }) }),
        ] }),
      ] });
    app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = 'http://127.0.0.1:' + app.server!.port;
    const call = (path: string, body: unknown, token?: string) => fetch(origin + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    const registered = await call('/auth/register', { username: 'provider-owner', email: 'owner@example.test', password: 'Fixture-password-123!' });
    expect(registered.status, await registered.clone().text()).toBe(200);
    const user = await registered.json() as { accessToken: string; user: { userId: string } };
    expect((await call('/api/_zero/logging/observations', { observations: [], policyVersion: services!.logging!.config.policyVersion }, user.accessToken)).status).toBe(200);
    const response = await call('/proof/providers', {}, user.accessToken);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ generated: 'PRIVATE_AI_RESULT', streamed: 'PRIVATE_STREAM_RESULT', local: 'billing', hosted: 'billing', accepted: 1 });
    expect(sends).toBe(1); expect(decisions).toBe(2);

    // Lazy, pre-composition email services and unscoped AI jobs use system
    // actors, but the external confirmation still originates at the provider.
    expect((await services!.ai!.generateText({ prompt: 'PRIVATE_BACKGROUND_PROMPT', maxRetries: 0 })).text).toBe('PRIVATE_AI_RESULT');
    expect((await services!.email!.send(message)).accepted).toHaveLength(1);
    expect(sends).toBe(2);
    await services!.logging!.flush();
    const rows = (await services!.logging!.page('audit', { kind: 'platform' }, { limit: 100 })).events.map(row => row.event)
      .filter(event => event.family === 'ai' || event.action.startsWith('email.provider.'));
    expect(rows).toHaveLength(14);
    for (const terminal of rows.filter(event => event.evidence === 'provider-confirmed')) {
      expect(terminal.origin).toBe('provider'); expect(terminal.outcome).toBe('succeeded');
      expect(normalizeLoggingEvent(JSON.parse(JSON.stringify(terminal)))).toEqual(terminal);
      const admission = rows.find(event => event.target?.id === terminal.target?.id && event.action.endsWith('.admitted'))!;
      expect(admission).toBeDefined(); expect(admission.evidence).toBe('server-confirmed');
      expect(admission.origin).toBe(terminal.actor.kind === 'system' ? 'system' : 'backend');
      for (const key of ['sourceId', 'scope', 'actor', 'requestId', 'correlationId', 'policyVersion', 'target'] as const) {
        expect(terminal[key]).toEqual(admission[key]);
      }
    }
    expect(rows.filter(event => event.evidence === 'provider-confirmed')).toHaveLength(7);
    expect(rows.filter(event => event.evidence === 'provider-confirmed' && event.actor.id === user.user.userId)).toHaveLength(5);
    expect(rows.filter(event => event.evidence === 'provider-confirmed' && event.actor.kind === 'system')).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_|example\.test|private-model/);
    const forged = await call('/proof/forged-provider-evidence', {}, user.accessToken);
    expect(forged.status).toBeGreaterThanOrEqual(400);
    await services!.logging!.flush();
    expect((await services!.logging!.page('audit', { kind: 'platform' }, { action: 'app.provider.completed' })).events).toHaveLength(0);
  } finally { await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
