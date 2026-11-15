/** Real managed authentication/HTTP/receipt boundary. Synthetic private state; no provider or production access. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createApp } from '../frontend/server/app-factory';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';

test('HTTP enqueue commits before slow activity completion and preserves actor receipt replay, conflict and isolation', async () => {
  const fixture = await ownedWorkerFixture('workflow-http'), root = fixture.root;
  let app: Awaited<ReturnType<typeof createApp>> | null = null, stopped = false, calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    app = await createApp({ projectRoot: root, db: { mode: 'memory' }, tables: {},
      auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
      workflows: { register(registry) {
        registry.registerHandler('queued.slow', async () => { calls++; await gate; return { finished: true }; });
        registry.registerHandler('queued.fast', async () => ({ finished: true }));
        registry.create({ name: 'slow', steps: [{ name: 'Synthetic slow task', handler: 'queued.slow', retries: 1 }] });
        registry.create({ name: 'fast', steps: [{ name: 'Synthetic fast task', handler: 'queued.fast', retries: 1 }] });
      } },
      appDir: join(root, 'app'), outDir: join(root, 'out'), storageDir: join(root, 'storage'),
      ai: false, email: false, vector: false, kv: false, pdf: false, observability: false,
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
      serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
    });
    app.listen(0); const url = 'http://127.0.0.1:' + app.server!.port;
    const request = async (path: string, token?: string, body?: unknown) => {
      const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as Record<string, unknown> | null };
    };
    const register = async (username: string) => {
      const response = await request('/auth/register', undefined, { username, email: username + '@example.test', password: 'Synthetic-Workflow-Password-94!' });
      expect(response.status).toBe(200); return String(response.body!.accessToken);
    };
    const owner = await register('queued-owner'), other = await register('queued-other');
    const command = { name: 'slow', input: { value: 1 }, idempotencyKey: 'http:one' };
    const started = await request('/workflows/enqueue', owner, command);
    expect(started.status).toBe(202); expect(started.body?.name).toBe('slow');
    const id = String(started.body!.instanceId);
    const running = await request('/workflows/' + id, owner); expect(running.body?.status).toBe('running');
    expect(calls).toBe(1);
    const replay = await request('/workflows/enqueue', owner, command);
    expect(replay.status).toBe(202); expect(replay.body).toEqual(started.body);
    const receipt = await request('/workflows/starts/http%3Aone', owner);
    expect(receipt.status).toBe(200); expect(receipt.body).toEqual(started.body);
    const absent = await request('/workflows/starts/http%3Aone', other);
    expect(absent.status).toBe(200); expect(absent.body).toBeNull();
    expect((await request('/workflows/starts/http%3Aone')).status).toBe(401);
    const conflicting = await request('/workflows/enqueue', owner, { ...command, input: { value: 2 } });
    expect(conflicting.status).toBe(409); expect(conflicting.body?.code).toBe('WORKFLOW_START_IDEMPOTENCY_CONFLICT');
    const independent = await request('/workflows/enqueue', owner, { name: 'fast', input: {}, idempotencyKey: 'http:other' });
    expect(independent.status).toBe(202);
    const wait = async (instanceId: string) => {
      const until = Date.now() + 3000;
      while ((await request('/workflows/' + instanceId, owner)).body?.status !== 'completed') {
        if (Date.now() >= until) throw new Error('Synthetic HTTP workflow did not finish.');
        await new Promise<void>(resolve => setTimeout(resolve, 5));
      }
    };
    await wait(String(independent.body!.instanceId)); expect(calls).toBe(1);
    release(); await wait(id);
    expect((await request('/workflows/starts/http%3Aone', owner)).body).toEqual(started.body);
    await app.stop(true); stopped = true;
  } finally {
    release();
    if (app && !stopped) { await app.stop(true); stopped = true; }
    if (!app || stopped) await fixture.cleanup();
  }
}, 30_000);
