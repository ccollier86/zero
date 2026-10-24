/** Managed route ownership, actor admission and public authoring using disposable loopback createApp. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from './app-factory';
import { defineEndpoint } from './server-extensions';
import type { WorkflowGraphIR } from '../../workflows/workflow-ir';

test('http:false keeps managed services while removing all generic workflow routes and retaining app route ownership', async () => {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/workflow-contracts-app-');
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await mkdir(join(root, 'app'));
    const graph: WorkflowGraphIR = { schemaVersion: 1, entry: 'a', nodes: [{ id: 'a', kind: 'activity', activity: { name: 'fixture', version: '1' } }], edges: [] };
    app = await createApp({ db: { mode: 'memory' }, systemDb: { mode: 'memory' }, tables: {},
      auth: { bootstrap: 'public', registration: { mode: 'admin-only' } }, email: false,
      workflows: { http: false, register(registry) { registry.registerActivity({ name: 'fixture', version: '1', databaseCallable: true, handler: async ({ input }) => input }); } },
      serverExtensions: [
        defineEndpoint({ method: 'POST', path: '/api/pantheon/workflows/proof', auth: 'user', handler: async ({ zero }) => {
          const draft = zero.workflows!.definitions.createDraft({ name: 'installed-public-proof', graph });
          const version = zero.workflows!.definitions.publishDraft(draft.draft.draft_id, { expectedRevision: 1 });
          const ack = await zero.workflows!.startOnce('installed-public-proof', { synthetic: true }, { version: version.version.version_number, idempotencyKey: 'manual:proof' });
          return { ack, receipt: zero.workflows!.getStartReceipt('manual:proof'), instance: zero.workflows!.get(ack.instanceId) };
        } }),
        defineEndpoint({ method: 'GET', path: '/workspace/workflows', auth: 'user', handler: () => ({ owner: 'application-workspace' }) }),
        defineEndpoint({ method: 'POST', path: '/api/pantheon/workflows/conflict', auth: 'user', handler: ({ zero }) =>
          zero.workflows!.startOnce('installed-public-proof', { changed: true }, { idempotencyKey: 'manual:proof', version: 1 }) }),
      ],
      appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
      stateSync: false, ai: false, vector: false, pdf: false, kv: false, observability: { console: false, endpoint: false },
    });
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${app.server!.port}`;
    const registration = await fetch(origin + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'workflow-owner', email: 'workflow-owner@example.test', password: 'Synthetic-only-password-123' }) });
    expect(registration.status).toBe(200);
    const session = await registration.json() as { accessToken: string };
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` };
    const admitted = await fetch(origin + '/api/pantheon/workflows/proof', { method: 'POST', headers });
    expect(admitted.status).toBe(200);
    const proof = await admitted.json() as any;
    expect(proof.ack).toEqual(proof.receipt); expect(proof.instance.started_by).toBeString();
    expect(proof.instance.output).toContain('synthetic');
    for (const [method, path] of [['GET', '/workflows'], ['GET', '/workflows/' + proof.ack.instanceId],
      ['POST', '/workflows/start'], ['GET', '/workflows/admin/definitions'], ['POST', '/workflows/admin/definitions/publish'],
      ['POST', '/workflows/' + proof.ack.instanceId + '/cancel'], ['POST', '/workflows/' + proof.ack.instanceId + '/events']] as const) {
      const response = await fetch(origin + path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) });
      expect(response.status, method + ' ' + path).toBe(404);
    }
    expect(await fetch(origin + '/workspace/workflows', { headers }).then(r => r.json())).toEqual({ owner: 'application-workspace' });
    expect((await fetch(origin + '/api/pantheon/workflows/proof', { method: 'POST' })).status).toBe(401);
    const conflict = await fetch(origin + '/api/pantheon/workflows/conflict', { method: 'POST', headers });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'WORKFLOW_START_IDEMPOTENCY_CONFLICT' });
  } finally { await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
