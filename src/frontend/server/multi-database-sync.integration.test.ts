import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { databaseActorFixtureRealm } from '../../databases/test-fixtures/database-actor-realm';
import {
  clearPlatformSQLiteService,
  createPlatformSQLiteService,
  getPlatformSQLiteService,
  type PlatformSQLiteService,
} from '../../persistence';
import { getPlatformEventStore } from '../../observability';
import {
  authenticatedOnly,
  defineResource,
  tenantRealm,
} from '../../resources';
import type { ServerMessage, SyncSnapshotMessage } from '../../sync/types';
import { createApp } from './app-factory';

const DATABASE_ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../databases/test-fixtures/database-actor-same-entry.ts',
  import.meta.url,
));

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

interface RegisteredTenant {
  readonly accessToken: string;
  readonly tenant: { readonly tenantId: string };
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

let activeApp: ManagedApp | null = null;
let activeRoot: string | null = null;
let activeApplicationSqlite: PlatformSQLiteService | null = null;
const activeConnections = new Set<SyncConnection>();

afterEach(async () => {
  await Promise.all([...activeConnections].map((connection) => connection.close()));
  await activeApp?.stop(true);
  activeApp = null;

  const sqlite = getPlatformSQLiteService();
  sqlite?.close();
  clearPlatformSQLiteService(sqlite);
  if (activeApplicationSqlite && activeApplicationSqlite !== sqlite) {
    activeApplicationSqlite.close();
  }
  activeApplicationSqlite = null;

  if (activeRoot) await rm(activeRoot, { recursive: true, force: true });
  activeRoot = null;
}, 30_000);

describe('createApp actor-backed multi-database Sync', () => {
  test('multiplexes system control data with isolated tenant resources', async () => {
    const zeroDir = join(process.cwd(), '.zero');
    await mkdir(zeroDir, { recursive: true });
    activeRoot = await mkdtemp(join(zeroDir, 'multi-database-sync-'));
    const appDir = join(activeRoot, 'app');
    await mkdir(appDir, { recursive: true });

    const sqlite = createPlatformSQLiteService({ mode: 'memory' });
    activeApplicationSqlite = sqlite;
    activeApp = await createApp({
      db: { sqlite, ringBufferDepth: 500 },
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
      syncDefaults: {
        tables: { todos: 'full' },
      },
      auth: {
        tenancy: 'multi',
        bootstrap: 'public',
        registration: { mode: 'public' },
      },
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: join(activeRoot, 'tenant-databases'),
        realm: databaseActorFixtureRealm,
        actors: {
          launch: {
            kind: 'source',
            entrypoint: DATABASE_ACTOR_ENTRYPOINT,
          },
        },
        tenantIsolation: 'tenant-database',
      },
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      appDir,
      outDir: join(activeRoot, 'out'),
      generatedDir: join(activeRoot, '.zero', 'generated'),
      observability: { console: false, endpoint: false },
      email: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });

    activeApp.listen(0);
    const baseUrl = `http://localhost:${activeApp.server!.port}`;
    const syncUrl = `ws://localhost:${activeApp.server!.port}/sync`;

    const tenantA = await registerTenant(baseUrl, 'tenant-a', 'Tenant A');
    const tenantB = await registerTenant(baseUrl, 'tenant-b', 'Tenant B');
    expect(tenantA.tenant.tenantId).not.toBe(tenantB.tenant.tenantId);

    const notificationA = await createTenantNotification(
      baseUrl,
      tenantA.accessToken,
      'Tenant A control notification',
    );
    const notificationB = await createTenantNotification(
      baseUrl,
      tenantB.accessToken,
      'Tenant B control notification',
    );

    // Neither actor-owned resources nor framework system tables are
    // materialized as shadows in the application database.
    expect(hasSQLiteTable(sqlite, 'todos')).toBe(false);
    expect(hasSQLiteTable(sqlite, 'notifications')).toBe(false);

    const connectionA = await connectSync(syncUrl, tenantA.accessToken);
    const connectionB = await connectSync(syncUrl, tenantB.accessToken);
    subscribeMixed(connectionA);
    subscribeMixed(connectionB);

    const [defaultA, systemA, tenantSnapshotA, defaultB, systemB, tenantSnapshotB]
      = await Promise.all([
      waitForSnapshot(connectionA, 'default'),
      waitForSnapshot(connectionA, 'system'),
      waitForSnapshot(connectionA, 'tenant'),
      waitForSnapshot(connectionB, 'default'),
      waitForSnapshot(connectionB, 'system'),
      waitForSnapshot(connectionB, 'tenant'),
    ]);

    expect(defaultA.tables).toEqual({});
    expect(defaultB.tables).toEqual({});
    expect(Object.keys(systemA.tables.notifications ?? {})).toEqual([
      notificationA.notification_id,
    ]);
    expect(Object.keys(systemB.tables.notifications ?? {})).toEqual([
      notificationB.notification_id,
    ]);
    expect(systemA.tables.todos).toBeUndefined();
    expect(systemB.tables.todos).toBeUndefined();
    expect(tenantSnapshotA.tables).toEqual({ todos: {} });
    expect(tenantSnapshotB.tables).toEqual({ todos: {} });

    await expectSystemMutationRejected(
      connectionA,
      notificationA.notification_id,
    );

    // Resource writes and Sync mutations share the actor writer lane. Keep a
    // second live socket on the same physical tenant database to prove an HTTP
    // commit wakes every persistent binding without crossing tenant scope.
    const secondConnectionA = await connectSync(syncUrl, tenantA.accessToken);
    subscribeMixed(secondConnectionA);
    expect((await waitForSnapshot(secondConnectionA, 'tenant')).tables)
      .toEqual({ todos: {} });
    const resourceTodo = {
      id: 'resource-live',
      title: 'Resource fanout value',
    };
    const resourceCreated = await fetch(`${baseUrl}/api/resources/todos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenantA.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'resource-live-fanout',
      },
      body: JSON.stringify(resourceTodo),
    });
    expect(resourceCreated.status).toBe(201);
    expect(await resourceCreated.json()).toEqual({ row: resourceTodo });
    await Promise.all([
      waitForTodoChange(connectionA, resourceTodo),
      waitForTodoChange(secondConnectionA, resourceTodo),
    ]);
    expect(connectionB.messages.some(
      (message) => message.type === 'sync.change'
        && message.plane === 'tenant'
        && message.table === 'todos'
        && message.rowId === resourceTodo.id,
    )).toBe(false);

    await insertTodo(
      connectionA,
      baseUrl,
      tenantA.accessToken,
      'same-id',
      'Tenant A value',
      'insert-a',
    );
    await insertTodo(
      connectionB,
      baseUrl,
      tenantB.accessToken,
      'same-id',
      'Tenant B value',
      'insert-b',
    );

    await Promise.all([
      connectionA.close(),
      secondConnectionA.close(),
      connectionB.close(),
    ]);
    const reconnectA = await connectSync(syncUrl, tenantA.accessToken);
    const reconnectB = await connectSync(syncUrl, tenantB.accessToken);
    subscribeMixed(reconnectA);
    subscribeMixed(reconnectB);

    const [reloadedA, reloadedB] = await Promise.all([
      waitForSnapshot(reconnectA, 'tenant'),
      waitForSnapshot(reconnectB, 'tenant'),
    ]);
    expect(reloadedA.tables.todos).toEqual({
      [resourceTodo.id]: resourceTodo,
      'same-id': { id: 'same-id', title: 'Tenant A value' },
    });
    expect(reloadedB.tables.todos).toEqual({
      'same-id': { id: 'same-id', title: 'Tenant B value' },
    });
  }, 60_000);
});

function hasSQLiteTable(sqlite: PlatformSQLiteService, table: string): boolean {
  return sqlite.raw.query(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1
  `).get(table) !== null;
}

async function createTenantNotification(
  baseUrl: string,
  token: string,
  title: string,
): Promise<{ readonly notification_id: string }> {
  const response = await fetch(`${baseUrl}/notifications/broadcast`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });
  const body = await response.json() as {
    notification?: { notification_id?: unknown };
  };
  expect(response.status).toBe(200);
  expect(body.notification?.notification_id).toBeString();
  return body.notification as { notification_id: string };
}

async function registerTenant(
  baseUrl: string,
  label: string,
  organizationName: string,
): Promise<RegisteredTenant> {
  const suffix = crypto.randomUUID();
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `${label}-${suffix}`,
      email: `${label}-${suffix}@example.test`,
      password: 'password123',
      organizationName: `${organizationName} ${suffix}`,
    }),
  });
  const body = await response.json() as Record<string, any>;
  expect(response.status).toBe(200);
  expect(body.accessToken).toBeString();
  expect(body.tenant?.tenantId).toBeString();
  return body as RegisteredTenant;
}

function subscribeMixed(connection: SyncConnection): void {
  connection.ws.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['notifications', 'todos'],
    snapshot: ['notifications', 'todos'],
    lastSeq: 0,
  }));
}

async function waitForSnapshot(
  connection: SyncConnection,
  plane: 'default' | 'system' | 'tenant',
): Promise<SyncSnapshotMessage> {
  const first = await connection.waitFor(
    (candidate) => (
      candidate.type === 'sync.snapshot'
      || candidate.type === 'sync.snapshot.begin'
    ) && candidate.plane === plane,
    `${plane} Sync snapshot`,
  );
  if (first.type === 'sync.snapshot') return first;
  const begin = first;
  if (begin.type !== 'sync.snapshot.begin') {
    throw new Error(`Expected ${plane} Sync snapshot begin`);
  }
  const end = await connection.waitFor(
    (candidate) => candidate.type === 'sync.snapshot.end'
      && candidate.plane === plane
      && candidate.snapshotId === begin.snapshotId,
    `${plane} Sync snapshot end`,
  );
  if (end.type !== 'sync.snapshot.end') {
    throw new Error(`Expected ${plane} Sync snapshot end`);
  }

  const tables: SyncSnapshotMessage['tables'] = Object.create(null);
  for (const table of begin.tables) tables[table] = Object.create(null);
  for (const candidate of connection.messages) {
    if (candidate.type !== 'sync.snapshot.chunk'
      || candidate.snapshotId !== begin.snapshotId) continue;
    Object.assign(tables[candidate.table] ??= Object.create(null), candidate.rows);
  }
  return {
    type: 'sync.snapshot',
    plane,
    tables,
    seq: begin.seq,
    ...(begin.epoch === undefined ? {} : { epoch: begin.epoch }),
    ...(begin.scope === undefined ? {} : { scope: begin.scope }),
    reset: begin.reset,
  };
}

async function expectSystemMutationRejected(
  connection: SyncConnection,
  notificationId: string,
): Promise<void> {
  const ref = `system-write-${crypto.randomUUID()}`;
  connection.ws.send(JSON.stringify({
    type: 'sync.mutate',
    plane: 'system',
    ref,
    table: 'notifications',
    op: 'UPDATE',
    rowId: notificationId,
    row: { title: 'Client write must be rejected' },
  }));
  const ack = await connection.waitFor(
    (message) => message.type === 'sync.ack' && message.ref === ref,
    'system mutation rejection',
  );
  expect(ack).toMatchObject({
    type: 'sync.ack',
    plane: 'system',
    ref,
    ok: false,
    error: 'Framework system tables are read-only over Sync.',
  });
}

async function insertTodo(
  connection: SyncConnection,
  baseUrl: string,
  token: string,
  id: string,
  title: string,
  ref: string,
): Promise<void> {
  connection.ws.send(JSON.stringify({
    type: 'sync.mutate',
    plane: 'tenant',
    ref,
    table: 'todos',
    op: 'INSERT',
    row: { id, title },
  }));
  const ack = await connection.waitFor(
    (message) => message.type === 'sync.ack' && message.ref === ref,
    `${title} tenant mutation acknowledgement`,
  );
  if (ack.type !== 'sync.ack' || !ack.ok) {
    const persisted = await fetch(`${baseUrl}/api/resources/todos/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const events = getPlatformEventStore()?.query({
      level: ['error', 'warn'],
      limit: 20,
    }).events ?? [];
    throw new Error(
      `Tenant mutation failed: ${JSON.stringify({
        ack,
        persisted: {
          status: persisted.status,
          body: await persisted.json(),
        },
        events,
      })}`,
    );
  }
  const change = await connection.waitFor(
    (message) => message.type === 'sync.change'
      && message.plane === 'tenant'
      && message.table === 'todos'
      && message.rowId === id
      && message.row?.title === title,
    `${title} tenant change`,
  );
  expect(change).toMatchObject({
    type: 'sync.change',
    plane: 'tenant',
    op: 'INSERT',
    row: { id, title },
  });
  expect(ack).toMatchObject({
    type: 'sync.ack',
    plane: 'tenant',
    ref,
    ok: true,
  });
}

async function waitForTodoChange(
  connection: SyncConnection,
  todo: Readonly<{ id: string; title: string }>,
): Promise<void> {
  const change = await connection.waitFor(
    (message) => message.type === 'sync.change'
      && message.plane === 'tenant'
      && message.table === 'todos'
      && message.rowId === todo.id
      && message.row?.title === todo.title,
    `${todo.title} Resource-originated tenant change`,
  );
  expect(change).toMatchObject({
    type: 'sync.change',
    plane: 'tenant',
    op: 'INSERT',
    row: todo,
  });
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
          }, 5_000),
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
    (message) => message.type === 'sync.auth.ready'
      && message.authenticated,
    'authenticated Sync handshake',
  );
  return connection;
}
