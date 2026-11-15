/** Real native auth/Torrent/scoped workers/app-data. AI uses Zero's explicit code-owned service with a local SDK mock, never a network/provider credential. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MockLanguageModelV3, MockProviderV3 } from 'ai/test';
import { AIService } from '../ai/ai-service';
import { resolveAIConfig } from '../ai/ai-env';
import { createApp } from '../frontend/server/app-factory';
import { defineEndpoint } from '../frontend/server/server-extensions';
import type { WorkflowExecutionServerServices } from '../frontend/server/workflow-execution-services';
import { flow, step } from '../workflows/workflow-dsl';
import { ownedWorkerFixture } from './test-support/owned-fixture';
import { tasks } from './test-support/worker-entry';

test('queued actor work integrates scoped workers, independent AI progress, app-data commits and automatic legacy/graph cancellation', async () => {
  const fixture = await ownedWorkerFixture('torrent-core'), root = fixture.root;
  let app: Awaited<ReturnType<typeof createApp>> | null = null, stopped = false, release!: () => void, slowEntered = false;
  const slow = new Promise<void>(resolve => { release = resolve; });
  const finished = new Map<string, { pid: number; startedAt: number; finishedAt: number }>();
  const cancelled = new Map<string, { code: unknown; outcome: unknown; signalAborted: boolean }>();
  const model = new MockLanguageModelV3({ async doGenerate(options) {
    if (options.prompt.some(message => message.role === 'user' && message.content.some(part => part.type === 'text' && part.text === 'SLOW'))) {
      slowEntered = true; await slow;
    }
    return { content: [{ type: 'text' as const, text: 'synthetic result' }], warnings: [], finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } };
  } });
  const aiConfig = resolveAIConfig({ autoDetect: false, providers: { fixture: { type: 'custom', adapter: new MockProviderV3({ languageModels: { model } }) } }, aliases: { smart: 'fixture/model' } }, {});
  if (!aiConfig) throw new Error('Synthetic AI configuration did not resolve.');
  const ai = new AIService(aiConfig, { emitCode: () => {} });
  const markerFor = (id: string) => { if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new Error('Invalid synthetic run identity.'); return join(root, id + '.marker'); };
  try {
    app = await createApp({ projectRoot: root, db: { mode: 'memory' }, tables: { worker_marks: { id: 'TEXT PRIMARY KEY', value: 'INTEGER NOT NULL' } },
      auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
      workers: { tasks, processes: 2, launch: { kind: 'source', entrypoint: fileURLToPath(new URL('./test-support/worker-entry.ts', import.meta.url)) } },
      workflows: { register(registry) {
        registry.registerHandler<{ prompt: string }, WorkflowExecutionServerServices>('core.compute', async context => {
          context.assertCurrentAuthority();
          // This exact code-owned adapter is intentional: raw app-global AI is
          // not exposed through the sealed context, and must not be unblocked
          // just to make a test pass. No caller selects credentials or models.
          await ai.generateText({ prompt: context.input.prompt, maxRetries: 0, abortSignal: context.signal });
          context.assertCurrentAuthority();
          if (!context.zero?.workers) throw new Error('Scoped workers were not provided to the admitted actor.');
          const result = await (context.input.prompt === 'SLOW'
            ? context.zero.workers.run('fixture.cpu', 200)
            : context.zero.workers.run('fixture.barrier', { directory: root, id: context.input.prompt === 'FAST A' ? 'a' : 'b' })) as { pid: number; startedAt: number; finishedAt: number };
          finished.set(context.instanceId, result); return { complete: true };
        });
        registry.registerHandler<unknown, WorkflowExecutionServerServices>('core.cancel', async context => {
          if (!context.zero?.workers) throw new Error('Scoped workers were not provided.');
          try {
            // Deliberately omit {signal}: the native facade must inherit the
            // physical attempt lifetime automatically for both engine formats.
            await context.zero.workers.run('fixture.entered', { marker: markerFor(context.instanceId) });
          } catch (error) {
            const failure = error as { code?: unknown; outcome?: unknown };
            cancelled.set(context.instanceId, { code: failure.code, outcome: failure.outcome, signalAborted: context.signal?.aborted === true }); throw error;
          }
          return { complete: true };
        });
        registry.create({ name: 'core-compute', steps: [{ name: 'Compute', handler: 'core.compute', retries: 1 }] });
        registry.create({ name: 'core-legacy-cancel', steps: [{ name: 'Cancel', handler: 'core.cancel', retries: 1 }] });
        registry.create({ name: 'core-graph-cancel', version: 1, flow: flow(step('cancel', 'core.cancel')) });
      } },
      appDir: join(root, 'app'), outDir: join(root, 'out'), storageDir: join(root, 'storage'), ai: false, email: false, vector: false, kv: false, pdf: false, observability: false,
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
      serverExtensions: [defineEndpoint({ method: 'POST', path: '/api/core-warm', auth: 'user', handler: async ({ zero }) => {
        await Promise.all([zero.workers!.run('fixture.echo', null), zero.workers!.run('fixture.echo', null)]); return { ready: true };
      } }), defineEndpoint({ method: 'POST', path: '/api/core-proof', auth: 'user', handler: async ({ zero }) => {
        zero.access.requirePlatformAdmin();
        await zero.data!.mutate({ type: 'create', table: 'worker_marks', row: { id: 'proof', value: 1 } }, { idempotencyKey: 'core-proof:one' });
        return { value: (await zero.data!.get('worker_marks', 'proof')).value };
      } })],
    });
    app.listen(0); const url = 'http://127.0.0.1:' + app.server!.port;
    let token: string | undefined;
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const owner = await request('/auth/register', { username: 'torrent-worker-owner', email: 'torrent-worker@example.test', password: 'Synthetic-Torrent-Worker-94!' });
    expect(owner.status).toBe(200); token = String(owner.body.accessToken);
    expect((await request('/api/core-warm', {})).status).toBe(200);
    const enqueue = async (name: string, key: string, input: unknown = {}) => {
      const result = await request('/workflows/enqueue', { name, idempotencyKey: key, input });
      expect(result.status).toBe(202); return String(result.body.instanceId);
    };
    const wait = async (condition: () => boolean | Promise<boolean>) => {
      const deadline = Date.now() + 5000;
      while (!await condition()) { if (Date.now() >= deadline) throw new Error('Synthetic managed core condition did not settle.'); await new Promise<void>(resolve => setTimeout(resolve, 2)); }
    };
    const slowId = await enqueue('core-compute', 'core:slow', { prompt: 'SLOW' });
    await wait(() => slowEntered);
    const [a, b] = await Promise.all([enqueue('core-compute', 'core:fast-a', { prompt: 'FAST A' }), enqueue('core-compute', 'core:fast-b', { prompt: 'FAST B' })]);
    // Separate HTTP requests may arrive farther apart than a short CPU task.
    // Observe both real child entries before release instead of relying on a
    // host-speed timing window as the precondition for concurrency evidence.
    await wait(() => existsSync(join(root, 'a.ready')) && existsSync(join(root, 'b.ready')));
    expect(finished.has(a) || finished.has(b)).toBe(false);
    await Bun.write(join(root, 'release'), 'owned-synthetic-barrier-release');
    await wait(() => finished.has(a) && finished.has(b));
    expect(finished.has(slowId)).toBe(false);
    expect((await request('/workflows/' + a)).body.status).toBe('completed');
    const first = finished.get(a)!, second = finished.get(b)!;
    expect(first.pid).not.toBe(second.pid); expect(Math.max(first.startedAt, second.startedAt)).toBeLessThan(Math.min(first.finishedAt, second.finishedAt));
    const write = await request('/api/core-proof', {});
    expect(write.status).toBe(200); expect(write.body.value).toEqual({ id: 'proof', value: 1 });
    expect(finished.has(slowId)).toBe(false); release(); await wait(() => finished.has(slowId));
    for (const name of ['core-legacy-cancel', 'core-graph-cancel']) {
      const id = await enqueue(name, name + ':one');
      await wait(() => existsSync(markerFor(id)));
      expect((await request('/workflows/' + id + '/cancel', {})).status).toBe(200);
      await wait(() => cancelled.has(id));
      expect(cancelled.get(id)).toEqual({ code: 'WORKER_CANCELLED', outcome: 'unknown', signalAborted: true });
      expect((await request('/workflows/' + id)).body.status).toBe('cancelled');
    }
    expect(model.doGenerateCalls).toHaveLength(3);
    await app.stop(true); stopped = true;
  } finally {
    release(); if (app && !stopped) { await app.stop(true); stopped = true; }
    if (!app || stopped) await fixture.cleanup();
  }
}, 120_000);
