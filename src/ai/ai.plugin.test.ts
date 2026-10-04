import { describe, expect, test } from 'bun:test';
import type { LanguageModelV4GenerateResult, ProviderV4 } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { Elysia } from 'elysia';

import { MemoryEventStore } from '../observability/memory-event-store';
import {
  ZERO_AI_SERVICE,
  ZERO_OBSERVABILITY_RUNTIME,
} from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { resolveAIConfig } from './ai-env';
import { createAIPlugin } from './ai.plugin';

describe('createAIPlugin', () => {
  test('does not expose AI routes by default', async () => {
    const config = resolveAIConfig(true, { OPENAI_API_KEY: 'secret-key' });
    expect(config).not.toBe(false);
    if (config === false) return;

    const app = new Elysia().use(createAIPlugin({ config, authEnabled: false }));
    const response = await app.handle(new Request('http://localhost/api/_zero/ai/status'));

    expect(response.status).toBe(404);
  });

  test('exposes provider status in development mode when explicitly enabled', async () => {
    const config = resolveAIConfig({
      statusEndpoint: { enabled: true },
    }, { OPENAI_API_KEY: 'secret-key' });
    expect(config).not.toBe(false);
    if (config === false) return;

    const app = new Elysia().use(createAIPlugin({ config, authEnabled: false }));
    const response = await app.handle(new Request('http://localhost/api/_zero/ai/status'));
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.providers.find((provider: any) => provider.id === 'openai')).toMatchObject({
      active: true,
      configuredBy: ['OPENAI_API_KEY'],
    });
    expect(JSON.stringify(body)).not.toContain('secret-key');
  });

  test('requires admin access when the optional status endpoint is enabled with auth', async () => {
    const config = resolveAIConfig({
      statusEndpoint: { enabled: true },
    }, { OPENAI_API_KEY: 'secret-key' });
    expect(config).not.toBe(false);
    if (config === false) return;

    const anonymous = new Elysia().use(createAIPlugin({ config, authEnabled: true }));
    const denied = await anonymous.handle(new Request('http://localhost/api/_zero/ai/status'));
    expect(denied.status).toBe(403);

    const admin = new Elysia()
      .resolve({ as: 'global' }, () => ({
        authContext: { userId: 'admin-1', email: 'admin@test.local', role: 'admin' },
      }))
      .use(createAIPlugin({ config, authEnabled: true }));

    const allowed = await admin.handle(new Request('http://localhost/api/_zero/ai/status'));
    expect(allowed.status).toBe(200);
  });

  test('keeps request telemetry isolated between managed app runtimes', async () => {
    const first = createManagedAI('first');
    const second = createManagedAI('second');
    try {
      await Promise.all([
        first.service.generateText({ prompt: 'first private prompt' }),
        second.service.generateText({ prompt: 'second private prompt' }),
      ]);

      expect(providerIds(first.store)).toEqual(['first', 'first']);
      expect(providerIds(second.store)).toEqual(['second', 'second']);
      expect(JSON.stringify(first.store.query().events)).not.toContain('second private prompt');
      expect(JSON.stringify(second.store.query().events)).not.toContain('first private prompt');
    } finally {
      await Promise.all([first.runtime.dispose(), second.runtime.dispose()]);
    }
  });

  test('rolls back app-local registration when plugin composition fails', async () => {
    const config = resolveAIConfig(true, { OPENAI_API_KEY: 'secret-key' });
    expect(config).not.toBe(false);
    if (config === false) return;
    const runtime = new ZeroAppRuntime('ai-plugin-rollback');
    const store = new MemoryEventStore();
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
      config: { console: false, store },
      sink: store,
      store,
    });
    const failure = new Error('composition failed');

    expect(() => createAIPlugin({
      config,
      runtime,
      onServiceCreated() {
        throw failure;
      },
    })).toThrow(failure);
    expect(runtime.get(ZERO_AI_SERVICE)).toBeNull();
    await expect(runtime.dispose()).resolves.toBeUndefined();
  });

  test('keeps startup and access-denial observability best-effort', async () => {
    const config = resolveAIConfig({
      statusEndpoint: { enabled: true },
    }, { OPENAI_API_KEY: 'secret-key' });
    expect(config).not.toBe(false);
    if (config === false) return;
    const runtime = new ZeroAppRuntime('ai-plugin-failing-sink');
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
      config: { console: false, store: false },
      sink: {
        emit() {
          throw new Error('observability sink failed');
        },
      },
      store: null,
    });
    const app = new Elysia()
      .use(createAIPlugin({ config, authEnabled: true, runtime }))
      .listen(0);

    try {
      const port = app.server?.port;
      if (port === undefined) throw new Error('AI test server did not start.');
      const denied = await fetch(`http://localhost:${port}/api/_zero/ai/status`);
      expect(denied.status).toBe(403);
    } finally {
      await app.stop(true);
      await runtime.dispose();
    }
  });
});

function createManagedAI(id: string) {
  const model = new MockLanguageModelV4({
    doGenerate: async (): Promise<LanguageModelV4GenerateResult> => ({
      content: [{ type: 'text', text: id }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  const adapter: ProviderV4 = {
    specificationVersion: 'v4',
    languageModel: () => model,
    embeddingModel: () => { throw new Error('not used'); },
    imageModel: () => { throw new Error('not used'); },
  };
  const config = resolveAIConfig({
    autoDetect: false,
    providers: { [id]: { type: 'custom', adapter } },
    aliases: { smart: `${id}/model` },
  }, {});
  if (config === false) throw new Error('AI unexpectedly resolved as disabled.');

  const runtime = new ZeroAppRuntime(`ai-observability-${id}`);
  const store = new MemoryEventStore();
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
    config: { console: false, store },
    sink: store,
    store,
  });
  let service: Parameters<NonNullable<Parameters<typeof createAIPlugin>[0]['onServiceCreated']>>[0]
    | undefined;
  createAIPlugin({
    config,
    runtime,
    onServiceCreated(created) {
      service = created;
    },
  });
  if (!service) throw new Error('Managed AI service was not created.');
  return { runtime, service, store };
}

function providerIds(store: MemoryEventStore): unknown[] {
  return store.query().events
    .filter((event) => event.code === 'ai.request.started' || event.code === 'ai.request.completed')
    .map((event) => event.metadata?.providerId);
}
