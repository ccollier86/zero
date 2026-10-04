import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getAuthStore, getTokenService } from '../auth/auth.plugin';
import { createApp } from '../frontend/server/app-factory';
import { ServerRouteLoaderError } from '../frontend/server/server-route-loader';
import { getScheduler } from '../scheduler';
import { getSyncDB } from '../sync/sync.plugin';
import type { ServerMessage } from '../sync/types';
import {
  getWorkflowRegistry,
  getWorkflowService,
} from './workflow.plugin';

test('workflows false keeps historical workflow tables outside Sync', async () => {
  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, 'workflow-disabled-sync-'));
  const appDir = join(root, 'app');
  await mkdir(appDir, { recursive: true });
  let app: Awaited<ReturnType<typeof createApp>> | null = null;
  let socket: WebSocket | null = null;
  try {
    app = await createApp({
      db: { mode: 'memory' },
      tables: {
        // Simulate an app that disabled workflows while retaining its old table.
        workflow_definitions: {
          definition_id: 'text primary key',
          name: 'text',
          steps_json: 'text',
          input_schema: 'text',
        },
        workflow_instances: {
          instance_id: 'text primary key',
          started_by: 'text',
        },
      },
      auth: true,
      workflows: false,
      syncDefaults: { defaultMode: 'lazy' },
      appDir,
      outDir: join(root, 'out'),
      storageDir: join(root, 'storage'),
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      resourceRoutes: false,
      observability: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
      email: false,
      migrate: false,
    });
    app.listen(0);
    await waitFor(() => Boolean(getAuthStore() && getTokenService()));
    const user = await getAuthStore()!.createUser({
      username: 'workflow-sync-user',
      email: 'workflow-sync-user@example.test',
      password: 'password123',
      role: 'user',
    });
    const tokens = await getTokenService()!.issueTokenPair(user);
    getSyncDB()!.insert('workflow_instances', {
      instance_id: 'historical-workflow',
      started_by: user.userId,
    });
    getSyncDB()!.insert('workflow_definitions', {
      definition_id: 'historical-definition',
      name: 'historical-workflow',
      steps_json: '[{"name":"Secret","handler":"internal-handler"}]',
      input_schema: null,
    });

    const lazyRead = await fetch(
      `http://localhost:${app.server!.port}/api/data?table=workflow_instances`,
      { headers: { authorization: `Bearer ${tokens.accessToken}` } },
    );
    expect(lazyRead.status).toBe(404);
    await expect(lazyRead.json()).resolves.toEqual({
      error: 'Table not found',
      code: 'table-not-queryable',
    });
    const definitionRead = await fetch(
      `http://localhost:${app.server!.port}/api/data?table=workflow_definitions`,
      { headers: { authorization: `Bearer ${tokens.accessToken}` } },
    );
    expect(definitionRead.status).toBe(404);
    await expect(definitionRead.json()).resolves.toEqual({
      error: 'Table not found',
      code: 'table-not-queryable',
    });

    const connection = await connectWS(app.server!.hostname, app.server!.port);
    socket = connection.ws;
    socket.send(JSON.stringify({
      type: 'sync.auth', token: tokens.accessToken,
    }));
    await connection.waitFor((message) => message.type === 'sync.auth.ready');
    socket.send(JSON.stringify({
      type: 'sync.subscribe',
      tables: ['workflow_definitions', 'workflow_instances'],
      snapshot: ['workflow_definitions', 'workflow_instances'],
      lastSeq: 0,
    }));
    const snapshot = await connection.waitFor(
      (message) => message.type === 'sync.snapshot',
    );
    if (snapshot.type !== 'sync.snapshot') throw new Error('Expected Sync snapshot');
    expect(snapshot.tables.workflow_definitions).toBeUndefined();
    expect(snapshot.tables.workflow_instances).toBeUndefined();

    socket.send(JSON.stringify({
      type: 'sync.mutate',
      ref: 'historical-workflow-write',
      table: 'workflow_instances',
      op: 'UPDATE',
      rowId: 'historical-workflow',
      row: { started_by: 'attacker' },
    }));
    const denied = await connection.waitFor(
      (message) => message.type === 'sync.ack'
        && message.ref === 'historical-workflow-write',
    );
    expect(denied).toEqual({
      type: 'sync.ack',
      ref: 'historical-workflow-write',
      seq: null,
      ok: false,
      error: 'Table is read-only over sync: workflow_instances',
    });
    expect(getSyncDB()!.queryOne('workflow_instances', 'historical-workflow')?.started_by)
      .toBe(user.userId);

    socket.send(JSON.stringify({
      type: 'sync.mutate',
      ref: 'historical-definition-write',
      table: 'workflow_definitions',
      op: 'UPDATE',
      rowId: 'historical-definition',
      row: { steps_json: '[]' },
    }));
    const deniedDefinition = await connection.waitFor(
      (message) => message.type === 'sync.ack'
        && message.ref === 'historical-definition-write',
    );
    expect(deniedDefinition).toEqual({
      type: 'sync.ack',
      ref: 'historical-definition-write',
      seq: null,
      ok: false,
      error: 'Table is read-only over sync: workflow_definitions',
    });
    expect(getSyncDB()!.queryOne('workflow_definitions', 'historical-definition')?.steps_json)
      .not.toBe('[]');
  } finally {
    socket?.close();
    if (app) await app.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test('createApp registers workflows before listen and owns startup and cleanup', async () => {
  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, 'workflow-managed-app-'));
  const appDir = join(root, 'app');
  await mkdir(appDir, { recursive: true });
  let app: Awaited<ReturnType<typeof createApp>> | null = null;

  try {
    let registrationCalled = false;
    app = await createApp({
      db: { mode: 'memory' },
      tables: {},
      auth: true,
      workflows: {
        register(registry) {
          registrationCalled = true;
          registry.registerHandler('managed-complete', async ({ input }) => ({ input }));
          registry.registerWorkflow({
            name: 'managed-workflow',
            steps: [{ name: 'Complete', handler: 'managed-complete' }],
          });
        },
      },
      appDir,
      outDir: join(root, 'out'),
      storageDir: join(root, 'storage'),
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      resourceRoutes: false,
      observability: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
      email: false,
      migrate: false,
    });

    expect(registrationCalled).toBe(true);
    expect(getWorkflowRegistry()?.getWorkflow('managed-workflow')).toBeDefined();
    // Managed createApp() composition now awaits recovery and publishes the
    // service before returning. HTTP remains unavailable until Elysia starts.
    expect(getWorkflowService()).not.toBeNull();

    const health = await app.handle(new Request('http://localhost/api/health'));
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ status: 'ok' });
    const beforeListen = await app.handle(new Request('http://localhost/workflows'));
    expect(beforeListen.status).toBe(503);
    await expect(beforeListen.json()).resolves.toEqual({
      error: 'Workflow request failed',
      code: 'WORKFLOW_NOT_READY',
    });
    expect(getWorkflowService()).not.toBeNull();

    app.listen(0);
    await waitFor(() => Boolean(
      getAuthStore()
      && getTokenService()
      && getWorkflowService()
      && getScheduler()?.has('workflow-retries')
      && getScheduler()?.has('workflow-timeouts'),
    ));

    const user = await getAuthStore()!.createUser({
      username: 'managed-workflow-user',
      email: 'managed-workflow-user@example.test',
      password: 'password123',
      role: 'user',
    });
    const tokens = await getTokenService()!.issueTokenPair(user);
    const response = await fetch(`http://localhost:${app.server!.port}/workflows`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'managed-workflow', input: { value: 42 } }),
    });
    expect(response.status).toBe(200);
    const { instanceId } = await response.json() as { instanceId: string };
    expect(getWorkflowService()!.getInstance(instanceId)?.started_by).toBe(user.userId);

    await app.stop(true);
    app = null;
    expect(getWorkflowService()).toBeNull();
    expect(getWorkflowRegistry()).toBeNull();
    expect(getScheduler()).toBeNull();
  } finally {
    if (app) await app.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test('createApp clears workflow and Sync runtimes when composition fails', async () => {
  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, 'workflow-failed-composition-'));
  const appDir = join(root, 'app');
  const routesDir = join(root, 'server', 'routes');
  await mkdir(appDir, { recursive: true });
  await mkdir(routesDir, { recursive: true });
  await Bun.write(join(routesDir, 'invalid.ts'), 'export default { invalid: true };\n');

  try {
    await expect(createApp({
      db: { mode: 'memory' },
      tables: {},
      auth: true,
      workflows: {
        register(registry) {
          registry.registerHandler('never-started', async () => undefined);
          registry.registerWorkflow({
            name: 'never-started',
            steps: [{ name: 'Never started', handler: 'never-started' }],
          });
        },
      },
      appDir,
      outDir: join(root, 'out'),
      storageDir: join(root, 'storage'),
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: routesDir,
      resourceRoutes: false,
      observability: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
      email: false,
      migrate: false,
    })).rejects.toBeInstanceOf(ServerRouteLoaderError);

    expect(getWorkflowRegistry()).toBeNull();
    expect(getWorkflowService()).toBeNull();
    expect(getSyncDB()).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function connectWS(
  hostname: string | undefined,
  port: number | undefined,
): Promise<{
  ws: WebSocket;
  waitFor: (predicate: (message: ServerMessage) => boolean) => Promise<ServerMessage>;
}> {
  if (typeof port !== 'number') throw new Error('Test server did not expose a port');
  const ws = new WebSocket(`ws://${hostname ?? 'localhost'}:${port}/sync`);
  const messages: ServerMessage[] = [];
  let close: { code: number; reason: string } | null = null;
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (!waiters[index].predicate(message)) continue;
      waiters[index].resolve(message);
      waiters.splice(index, 1);
    }
  };
  ws.onclose = (event) => {
    close = { code: event.code, reason: event.reason };
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  return {
    ws,
    waitFor(predicate) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(
            `Timed out waiting for Sync message; received ${JSON.stringify(messages)}; closed ${JSON.stringify(close)}`,
          )),
          2_000,
        );
        waiters.push({
          predicate,
          resolve(message) {
            clearTimeout(timeout);
            resolve(message);
          },
        });
      });
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Test runtime did not initialize');
}
