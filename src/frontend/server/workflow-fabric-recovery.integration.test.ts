import { afterEach, describe, expect, test } from 'bun:test';
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { databaseActorFixtureRealm } from '../../databases/test-fixtures/database-actor-realm';
import {
  clearPlatformSQLiteService,
  getPlatformSQLiteService,
} from '../../persistence';
import {
  authenticatedOnly,
  defineResource,
  tenantRealm,
} from '../../resources';
import type { ServerMessage, SyncSnapshotMessage } from '../../sync/types';
import { expr, flow, step, waitFor } from '../../workflows';
import { createApp } from './app-factory';
import type { WorkflowExecutionServerServices } from './workflow-execution-services';

const DATABASE_ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../databases/test-fixtures/database-actor-same-entry.ts',
  import.meta.url,
));

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

interface RegisteredTenant {
  readonly accessToken: string;
  readonly username: string;
  readonly password: string;
  readonly tenant: {
    readonly tenantId: string;
    readonly membershipId: string;
  };
}

interface FabricWriteInput {
  readonly id: string;
  readonly title: string;
  readonly handlerEnteredPath?: string;
}

interface BlockingWriteInput {
  readonly id: string;
  readonly title: string;
  readonly enteredPath: string;
  readonly releasePath: string;
}

interface SyncConnection {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[];
  waitFor(
    predicate: (message: ServerMessage) => boolean,
    description: string,
  ): Promise<ServerMessage>;
  close(): Promise<void>;
}

const activeApps = new Set<ManagedApp>();
const activeConnections = new Set<SyncConnection>();
const cleanupRoots = new Set<string>();
const barrierReleases = new Set<string>();

afterEach(async () => {
  await Promise.all([...barrierReleases].map(async (path) => {
    await writeFile(path, 'release').catch(() => undefined);
  }));
  barrierReleases.clear();
  await Promise.all([...activeConnections].map((connection) => connection.close()));
  await Promise.allSettled([...activeApps].map((app) => app.stop(true)));
  activeApps.clear();

  const sqlite = getPlatformSQLiteService();
  sqlite?.close();
  clearPlatformSQLiteService(sqlite);

  await Promise.all([...cleanupRoots].map((root) =>
    rm(root, { recursive: true, force: true })));
  cleanupRoots.clear();
}, 30_000);

describe('managed workflows across ReactiveDB Fabric', () => {
  test('recovers a waiting actor workflow across an app restart and writes its sealed tenant file', async () => {
    const root = await createRoot('workflow-fabric-restart-');
    const first = await startFabricApp(root);
    const firstBaseUrl = baseUrl(first);
    const administrator = await registerTenant(
      firstBaseUrl,
      'restart-administrator',
      'Restart Administration',
    );
    const tenant = await registerTenant(
      firstBaseUrl,
      'restart-tenant',
      'Restart Tenant',
    );
    const todo = {
      id: 'after-restart',
      title: 'Created after workflow recovery',
    };
    const instanceId = await startWorkflow(
      firstBaseUrl,
      tenant.accessToken,
      'fabric-wait-then-write',
      todo,
    );
    await eventually(
      () => workflowSteps(firstBaseUrl, tenant.accessToken, instanceId),
      (steps) => steps.some((candidate) =>
        candidate.node_id === 'resume' && candidate.status === 'waiting'),
      'workflow wait before restart',
    );

    await stopApp(first);

    const second = await startFabricApp(root);
    const secondBaseUrl = baseUrl(second);
    const tenantSync = await connectSync(syncUrl(second), tenant.accessToken);
    subscribeWorkflowFabric(tenantSync);
    const [tenantSystemBefore, tenantDataBefore] = await Promise.all([
      waitForSnapshot(tenantSync, 'system'),
      waitForSnapshot(tenantSync, 'tenant'),
    ]);
    expect(tenantSystemBefore.tables.workflow_instances?.[instanceId]).toMatchObject({
      instance_id: instanceId,
      status: 'running',
      tenant_id: tenant.tenant.tenantId,
    });
    expect(tenantDataBefore.tables).toEqual({ todos: {} });

    const resumed = await requestJson(
      secondBaseUrl,
      'POST',
      `/workflows/${instanceId}/events`,
      { eventName: 'resume', payload: { source: 'restart-test' } },
      tenant.accessToken,
    );
    expect(resumed).toMatchObject({ status: 200, body: { ok: true, matched: true } });

    const [tenantTodoChange, completedInstance] = await Promise.all([
      tenantSync.waitFor(
        (message) => message.type === 'sync.change'
          && message.plane === 'tenant'
          && message.table === 'todos'
          && message.rowId === todo.id,
        'recovered workflow tenant row',
      ),
      tenantSync.waitFor(
        (message) => message.type === 'sync.change'
          && message.plane === 'system'
          && message.table === 'workflow_instances'
          && message.row?.instance_id === instanceId
          && message.row?.status === 'completed',
        'recovered workflow completion',
      ),
    ]);
    expect(tenantTodoChange).toMatchObject({
      plane: 'tenant',
      op: 'INSERT',
      row: todo,
    });
    expect(completedInstance).toMatchObject({
      plane: 'system',
      row: {
        instance_id: instanceId,
        tenant_id: tenant.tenant.tenantId,
        input: null,
        output: null,
        error: null,
      },
    });

    // Connect only after the recovered commit so these snapshots are an
    // ordered isolation proof rather than an absence assertion against a live
    // socket that may still be catching up.
    const administratorSync = await connectSync(
      syncUrl(second),
      administrator.accessToken,
    );
    subscribeWorkflowFabric(administratorSync);
    const [administratorSystem, administratorData] = await Promise.all([
      waitForSnapshot(administratorSync, 'system'),
      waitForSnapshot(administratorSync, 'tenant'),
    ]);
    expect(administratorSystem.tables.workflow_instances?.[instanceId]).toBeUndefined();
    expect(administratorSystem.tables.workflow_steps).toEqual({});
    expect(administratorData.tables).toEqual({ todos: {} });
    expect(await getTodo(secondBaseUrl, tenant.accessToken, todo.id)).toMatchObject({
      status: 200,
      body: { row: todo },
    });
    expect((await getTodo(
      secondBaseUrl,
      administrator.accessToken,
      todo.id,
    )).status).toBe(404);
  }, 90_000);

  test('rejects a cancelled activity queued behind the tenant writer before admission', async () => {
    const root = await createRoot('workflow-fabric-cancel-');
    const app = await startFabricApp(root);
    const url = baseUrl(app);
    await registerTenant(url, 'cancel-administrator', 'Cancel Administration');
    const tenant = await registerTenant(url, 'cancel-tenant', 'Cancel Tenant');

    const blocker = { id: 'writer-blocker', title: 'Before blocking update' };
    expect(await createTodo(url, tenant.accessToken, blocker)).toMatchObject({
      status: 201,
      body: { row: blocker },
    });
    const enteredPath = join(root, 'barriers', 'blocker-entered');
    const releasePath = join(root, 'barriers', 'blocker-release');
    const handlerEnteredPath = join(root, 'barriers', 'cancelled-handler-entered');
    await mkdir(join(root, 'barriers'), { recursive: true });
    barrierReleases.add(releasePath);

    const target = {
      id: 'must-not-commit',
      title: 'Cancelled before actor admission',
      handlerEnteredPath,
    };
    const targetId = await startWorkflow(
      url,
      tenant.accessToken,
      'fabric-wait-then-write',
      target,
    );
    const blockerStart = requestJson(
      url,
      'POST',
      '/workflows',
      {
        name: 'fabric-block-writer',
        input: {
          id: blocker.id,
          title: 'Committed blocker update',
          enteredPath,
          releasePath,
        },
      },
      tenant.accessToken,
    );
    await waitForPath(enteredPath, 'blocking tenant writer');

    const event = requestJson(
      url,
      'POST',
      `/workflows/${targetId}/events`,
      { eventName: 'resume', payload: null },
      tenant.accessToken,
    );
    await waitForPath(handlerEnteredPath, 'queued workflow activity handler');
    await eventually(
      () => databaseDiagnostics(url),
      (diagnostics) => diagnostics.queuedOperations >= 1,
      'tenant actor writer queue',
    );

    const cancelled = await requestJson(
      url,
      'POST',
      `/workflows/${targetId}/cancel`,
      undefined,
      tenant.accessToken,
    );
    expect(cancelled).toMatchObject({ status: 200, body: { ok: true } });
    await writeFile(releasePath, 'release');
    barrierReleases.delete(releasePath);
    expect(await blockerStart).toMatchObject({ status: 200 });
    await event.catch(() => undefined);

    const terminal = await eventually(
      () => getWorkflow(url, tenant.accessToken, targetId),
      (response) => response.body.status === 'cancelled',
      'cancelled workflow terminal state',
    );
    expect(terminal.body).toMatchObject({
      instance_id: targetId,
      status: 'cancelled',
      input: null,
      output: null,
      error: null,
    });
    expect((await getTodo(url, tenant.accessToken, target.id)).status).toBe(404);
    expect(await getTodo(url, tenant.accessToken, blocker.id)).toMatchObject({
      status: 200,
      body: {
        row: { id: blocker.id, title: 'Committed blocker update' },
      },
    });
  }, 90_000);

  test('fails a sealed actor run after Guardian tenant authority is revoked before dispatch', async () => {
    const root = await createRoot('workflow-fabric-revocation-');
    const app = await startFabricApp(root);
    const url = baseUrl(app);
    const administrator = await registerTenant(
      url,
      'revocation-administrator',
      'Revocation Administration',
    );
    const tenant = await registerTenant(
      url,
      'revocation-tenant',
      'Revocation Tenant',
    );
    const handlerEnteredPath = join(root, 'revoked-handler-entered');
    const target = {
      id: 'revoked-must-not-commit',
      title: 'Revoked before activity dispatch',
      handlerEnteredPath,
    };
    const instanceId = await startWorkflow(
      url,
      tenant.accessToken,
      'fabric-wait-then-write',
      target,
    );
    await eventually(
      () => workflowSteps(url, tenant.accessToken, instanceId),
      (steps) => steps.some((candidate) =>
        candidate.node_id === 'resume' && candidate.status === 'waiting'),
      'revocation workflow wait',
    );

    const suspended = await requestJson(
      url,
      'PATCH',
      `/auth/platform/tenants/${tenant.tenant.tenantId}`,
      { status: 'suspended', expectedAuthorizationGeneration: 0 },
      administrator.accessToken,
    );
    expect(suspended).toMatchObject({
      status: 200,
      body: { tenant: { status: 'suspended' } },
    });
    const systemEvent = await requestJson(
      url,
      'POST',
      `/__test/workflows/${instanceId}/events`,
      {
        tenantId: tenant.tenant.tenantId,
        eventName: 'resume',
        payload: null,
      },
    );
    expect(systemEvent.status).toBe(200);

    expect(systemEvent.body).toMatchObject({ matched: false, status: 'failed' });
    await expect(access(handlerEnteredPath)).rejects.toBeDefined();
    const reactivated = await requestJson(
      url,
      'PATCH',
      `/auth/platform/tenants/${tenant.tenant.tenantId}`,
      {
        status: 'active',
        expectedAuthorizationGeneration: Number(
          (suspended.body.tenant as Record<string, unknown>).authorizationGeneration,
        ),
      },
      administrator.accessToken,
    );
    expect(reactivated).toMatchObject({
      status: 200,
      body: { tenant: { status: 'active' } },
    });
    const replacement = await requestJson(url, 'POST', '/auth/login', {
      username: tenant.username,
      password: tenant.password,
    });
    expect(replacement.status).toBe(200);
    expect(replacement.body.accessToken).toBeString();
    expect((await getTodo(
      url,
      String(replacement.body.accessToken),
      target.id,
    )).status).toBe(404);
  }, 90_000);
});

async function startFabricApp(root: string): Promise<ManagedApp> {
  const appDir = join(root, 'app');
  const pluginsDir = join(root, 'server', 'plugins');
  await Promise.all([
    mkdir(appDir, { recursive: true }),
    mkdir(pluginsDir, { recursive: true }),
    mkdir(join(root, 'control'), { recursive: true }),
  ]);
  await writeTestControlPlugin(pluginsDir);
  const app = await createApp({
    db: { mode: 'file', path: join(root, 'control', 'application.db') },
    systemDb: { mode: 'file', path: join(root, 'control', 'system.db') },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    resources: [defineResource({
      table: 'todos',
      exposure: 'all',
      realm: tenantRealm(),
      policy: authenticatedOnly(),
    })],
    syncDefaults: { tables: { todos: 'full' } },
    auth: {
      tenancy: 'multi',
      bootstrap: 'public',
      registration: { mode: 'public' },
      accountEmails: { passwordReset: false },
    },
    workflows: {
      register(registry) {
        registry.registerHandler<FabricWriteInput, WorkflowExecutionServerServices>(
          'fabric-write',
          async (context) => {
            const data = context.zero?.data;
            if (!data) throw new Error('Tenant workflow database is unavailable');
            if (!context.idempotencyKey) {
              throw new Error('Workflow idempotency key is unavailable');
            }
            const input = context.input;
            if (input.handlerEnteredPath) {
              await writeFile(input.handlerEnteredPath, 'entered', { flag: 'wx' });
            }
            await data.mutate({
              type: 'create',
              table: 'todos',
              row: { id: input.id, title: input.title },
            }, { idempotencyKey: context.idempotencyKey });
            return { createdId: input.id };
          },
        );
        registry.registerHandler<BlockingWriteInput, WorkflowExecutionServerServices>(
          'fabric-block-writer',
          async (context) => {
            const data = context.zero?.data;
            if (!data) throw new Error('Tenant workflow database is unavailable');
            if (!context.idempotencyKey) {
              throw new Error('Workflow idempotency key is unavailable');
            }
            await data.command('test.blockingUpdate', {
              id: context.input.id,
              title: context.input.title,
              enteredPath: context.input.enteredPath,
              releasePath: context.input.releasePath,
            }, {
              idempotencyKey: context.idempotencyKey,
            });
            return { updatedId: context.input.id };
          },
        );
        registry.create({
          name: 'fabric-wait-then-write',
          flow: flow(
            waitFor('resume', 'resume'),
            step('write', 'fabric-write', { input: expr.input() }),
          ),
        });
        registry.create({
          name: 'fabric-block-writer',
          steps: [{ name: 'Block tenant writer', handler: 'fabric-block-writer' }],
        });
      },
    },
    databaseTopology: {
      mode: 'multiple',
      rootDirectory: join(root, 'fabric'),
      realm: databaseActorFixtureRealm,
      actors: {
        launch: { kind: 'source', entrypoint: DATABASE_ACTOR_ENTRYPOINT },
      },
      tenantIsolation: 'tenant-database',
    },
    appDir,
    outDir: join(root, 'out'),
    storageDir: join(root, 'storage'),
    generatedDir: join(root, '.zero', 'generated'),
    serverResourcesDir: false,
    serverPluginsDir: pluginsDir,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    observability: { console: false, endpoint: false },
    email: false,
    ai: false,
    vector: false,
    pdf: false,
    kv: false,
  });
  activeApps.add(app);
  app.listen(0);
  return app;
}

async function writeTestControlPlugin(pluginsDir: string): Promise<void> {
  const serverImport = pathToFileURL(
    join(process.cwd(), 'src/frontend/server.ts'),
  ).href;
  const authImport = pathToFileURL(join(process.cwd(), 'src/auth/index.ts')).href;
  await writeFile(join(pluginsDir, 'workflow-fabric-control.ts'), [
    `import { defineZeroPlugin } from ${JSON.stringify(serverImport)};`,
    `import { trustedSystemServiceDataScope } from ${JSON.stringify(authImport)};`,
    'export default defineZeroPlugin({',
    "  name: 'test.workflow-fabric-control',",
    '  setup({ app, zero }) {',
    "    return app.get('/__test/database-diagnostics', () => {",
    '      const diagnostics = zero.databases?.diagnostics();',
    '      return {',
    '        queuedOperations: diagnostics?.coordinator?.queuedOperations ?? 0,',
    '        authority: diagnostics?.authority ?? null,',
    '      };',
    '    }).post(\'/__test/workflows/:id/events\', async ({ params, body }) => {',
    "      if (!zero.workflows) throw new Error('workflow service unavailable');",
    '      const scope = trustedSystemServiceDataScope({',
    "        scopeKind: 'tenant',",
    '        tenantId: body.tenantId,',
    '      });',
    '      const matched = await zero.workflows.sendEventAsSystem(',
    '          params.id,',
    '          body.eventName,',
    '          body.payload,',
    '          {',
    "            principal: 'workflow-fabric-integration-test',",
    "            reason: 'Exercise stale actor authority after a trusted test event',",
    '            scope,',
    '          },',
    '        );',
    '      return {',
    '        matched,',
    '        status: zero.workflows.getInstance(params.id, scope)?.status ?? null,',
    '      };',
    '    });',
    '  },',
    '});',
    '',
  ].join('\n'));
}

async function createRoot(prefix: string): Promise<string> {
  const base = join(process.cwd(), '.zero');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, prefix));
  cleanupRoots.add(root);
  return root;
}

async function stopApp(app: ManagedApp): Promise<void> {
  await app.stop(true);
  activeApps.delete(app);
}

function baseUrl(app: ManagedApp): string {
  return `http://localhost:${app.server!.port}`;
}

function syncUrl(app: ManagedApp): string {
  return `ws://localhost:${app.server!.port}/sync`;
}

async function registerTenant(
  url: string,
  label: string,
  organizationName: string,
): Promise<RegisteredTenant> {
  const suffix = crypto.randomUUID();
  const username = `${label}-${suffix}`;
  const password = 'password123';
  const response = await requestJson(url, 'POST', '/auth/register', {
    username,
    email: `${label}-${suffix}@example.test`,
    password,
    organizationName: `${organizationName} ${suffix}`,
  });
  expect(response.status).toBe(200);
  expect(response.body.accessToken).toBeString();
  expect((response.body.tenant as Record<string, unknown>)?.tenantId).toBeString();
  return {
    ...(response.body as unknown as RegisteredTenant),
    username,
    password,
  };
}

async function startWorkflow(
  url: string,
  token: string,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const response = await requestJson(
    url,
    'POST',
    '/workflows',
    { name, input },
    token,
  );
  expect(response.status).toBe(200);
  expect(response.body.instanceId).toBeString();
  return String(response.body.instanceId);
}

async function workflowSteps(
  url: string,
  token: string,
  instanceId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await requestJson(
    url,
    'GET',
    `/workflows/${instanceId}/steps`,
    undefined,
    token,
  );
  expect(response.status).toBe(200);
  return response.body as unknown as Array<Record<string, unknown>>;
}

async function getWorkflow(
  url: string,
  token: string,
  instanceId: string,
) {
  return requestJson(
    url,
    'GET',
    `/workflows/${instanceId}`,
    undefined,
    token,
  );
}

async function createTodo(
  url: string,
  token: string,
  todo: Readonly<{ id: string; title: string }>,
) {
  return requestJson(url, 'POST', '/api/resources/todos', todo, token, {
    'Idempotency-Key': `test:${todo.id}`,
  });
}

async function getTodo(url: string, token: string, id: string) {
  return requestJson(url, 'GET', `/api/resources/todos/${id}`, undefined, token);
}

async function databaseDiagnostics(url: string): Promise<{ queuedOperations: number }> {
  const response = await requestJson(url, 'GET', '/__test/database-diagnostics');
  expect(response.status).toBe(200);
  return response.body as unknown as { queuedOperations: number };
}

async function requestJson(
  url: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, any>,
  };
}

async function waitForPath(path: string, description: string): Promise<void> {
  await eventually(
    async () => access(path).then(() => true, () => false),
    (exists) => exists,
    description,
  );
}

async function eventually<T>(
  read: () => T | Promise<T>,
  accepted: (value: T) => boolean,
  description: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest = await read();
  while (!accepted(latest) && Date.now() < deadline) {
    await Bun.sleep(10);
    latest = await read();
  }
  if (!accepted(latest)) {
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(latest)}`);
  }
  return latest;
}

function subscribeWorkflowFabric(connection: SyncConnection): void {
  connection.ws.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['todos', 'workflow_instances', 'workflow_steps'],
    snapshot: ['todos', 'workflow_instances', 'workflow_steps'],
    lastSeq: 0,
  }));
}

async function waitForSnapshot(
  connection: SyncConnection,
  plane: 'system' | 'tenant',
): Promise<SyncSnapshotMessage> {
  const first = await connection.waitFor(
    (candidate) => (
      candidate.type === 'sync.snapshot'
      || candidate.type === 'sync.snapshot.begin'
    ) && candidate.plane === plane,
    `${plane} Sync snapshot`,
  );
  if (first.type === 'sync.snapshot') return first;
  if (first.type !== 'sync.snapshot.begin') {
    throw new Error(`Expected ${plane} Sync snapshot begin`);
  }
  const end = await connection.waitFor(
    (candidate) => candidate.type === 'sync.snapshot.end'
      && candidate.plane === plane
      && candidate.snapshotId === first.snapshotId,
    `${plane} Sync snapshot end`,
  );
  if (end.type !== 'sync.snapshot.end') {
    throw new Error(`Expected ${plane} Sync snapshot end`);
  }
  const tables: SyncSnapshotMessage['tables'] = Object.create(null);
  for (const table of first.tables) tables[table] = Object.create(null);
  for (const candidate of connection.messages) {
    if (candidate.type !== 'sync.snapshot.chunk'
      || candidate.snapshotId !== first.snapshotId) continue;
    Object.assign(tables[candidate.table] ??= Object.create(null), candidate.rows);
  }
  return {
    type: 'sync.snapshot',
    plane,
    tables,
    seq: first.seq,
    ...(first.epoch === undefined ? {} : { epoch: first.epoch }),
    ...(first.scope === undefined ? {} : { scope: first.scope }),
    reset: first.reset,
  };
}

async function connectSync(url: string, token: string): Promise<SyncConnection> {
  const messages: ServerMessage[] = [];
  const waiters = new Set<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const ws = new WebSocket(url);
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  };
  ws.addEventListener('close', (event) => {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(
        `WebSocket closed (${event.code}: ${event.reason || 'no reason'})`,
      ));
    }
    waiters.clear();
  });
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  let closeTask: Promise<void> | null = null;
  const connection: SyncConnection = {
    ws,
    messages,
    waitFor(predicate, description) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(
              `Timed out waiting for ${description}; received ${JSON.stringify(messages)}`,
            ));
          }, 10_000),
        };
        waiters.add(waiter);
      });
    },
    close() {
      if (closeTask) return closeTask;
      activeConnections.delete(connection);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('WebSocket closed'));
      }
      waiters.clear();
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      closeTask = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        ws.addEventListener('close', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        ws.close();
      });
      return closeTask;
    },
  };
  activeConnections.add(connection);
  ws.send(JSON.stringify({ type: 'sync.auth', token }));
  await connection.waitFor(
    (message) => message.type === 'sync.auth.ready' && message.authenticated,
    'authenticated Sync handshake',
  );
  return connection;
}
