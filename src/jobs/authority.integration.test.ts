/** Real managed createApp + native sign-in/logout + Torrent seals. No copied auth, weakened gate or real account/provider. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AuthContext } from '../auth/types';
import { createApp } from '../frontend/server/app-factory';
import { defineEndpoint } from '../frontend/server/server-extensions';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { flow, step } from '../workflows/workflow-dsl';
import type { WorkflowService } from '../workflows/workflow-service';
import { workflowDeferredStarts } from '../workflows/workflow-deferred-start-bridge';

test('revoked native actors may have prior starts reconciled privately but cannot obtain public receipts or start new work', async () => {
  const owned = await ownedWorkerFixture('jobs-authority');
  let app: Awaited<ReturnType<typeof createApp>> | null = null, service: WorkflowService | null = null, context: AuthContext | null = null, calls = 0;
  try {
    app = await createApp({ projectRoot: owned.root, db: { mode: 'memory' }, tables: {},
      auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
      workflows: { register(registry) {
        registry.registerActivity({ name: 'synthetic.job', version: '1', handler: async () => { calls++; return { completed: true }; } });
        registry.create({ name: 'synthetic.job', version: 1, flow: flow(step('job', { name: 'synthetic.job', version: '1' })) });
      }, onServiceCreated(value) { service = value; } },
      appDir: join(owned.root, 'app'), outDir: join(owned.root, 'out'), storageDir: join(owned.root, 'storage'),
      ai: false, email: false, vector: false, kv: false, pdf: false, observability: false, serverResourcesDir: false,
      serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
      serverExtensions: [defineEndpoint({ method: 'GET', path: '/api/synthetic-context', auth: 'user', handler(value) { context = value.authContext; return { accepted: true }; } })],
    });
    app.listen(0); const url = 'http://127.0.0.1:' + app.server!.port;
    const registered = await fetch(url + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'jobs-owner', email: 'jobs-owner@example.test', password: 'Synthetic-Jobs-Password-94!' }) });
    expect(registered.status).toBe(200);
    const tokens = await registered.json() as { accessToken: string; refreshToken: string };
    expect((await fetch(url + '/api/synthetic-context', { headers: { Authorization: 'Bearer ' + tokens.accessToken } })).status).toBe(200);
    if (!service || !context) throw new Error('Synthetic managed authority was not ready.');
    const workflows = service as WorkflowService, actorContext = context as AuthContext, bridge = workflowDeferredStarts(workflows);
    const authority = bridge.actor(actorContext), pin = bridge.pin(authority, 'synthetic.job', {}, 1), seal = bridge.seal(authority, 'jobs:synthetic:1');
    const receipt = await bridge.enqueue(authority, pin, {}, 'jobs:one', 'jobs:synthetic:1', () => {});
    // Enqueue acknowledges the durable commit, not completion of deferred
    // service projection/dispatch. Observe actual handler entry before revoking.
    const deadline = Date.now() + 10_000;
    while (!calls) { if (Date.now() >= deadline) throw new Error('Synthetic accepted workflow did not enter its handler.'); await Bun.sleep(2); }
    expect(calls).toBe(1);
    const logout = await fetch(url + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
    expect(logout.status).toBe(200);
    expect(() => bridge.assertCurrent(authority)).toThrow();
    expect(() => workflows.getActorStartReceipt(actorContext, 'jobs:one')).toThrow();
    const opened = bridge.open(seal, 'jobs:synthetic:1');
    expect(bridge.inspect(opened, pin, {}, 'jobs:one', 'jobs:synthetic:1')!.receipt).toEqual(receipt);
    expect(bridge.inspect(opened, pin, {}, 'jobs:never-started', 'jobs:synthetic:1')).toBeNull();
    expect(() => bridge.enqueue(opened, pin, {}, 'jobs:new', 'jobs:synthetic:1', () => {})).toThrow();
    expect(calls).toBe(1);
  } finally { if (app) await app.stop(true); await owned.cleanup(); }
}, 120_000);
