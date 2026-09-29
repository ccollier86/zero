import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { databaseActorFixtureRealm } from '../../databases/test-fixtures/database-actor-realm';
import {
  clearPlatformSQLiteService,
  createPlatformSQLiteService,
  getPlatformSQLiteService,
} from '../../persistence';
import { getPlatformEventStore } from '../../observability';
import {
  authenticatedOnly,
  defineResource,
  tenantRealm,
} from '../../resources';
import type { ReactiveDB } from '../../sync/reactive-db';
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
const activeConnections = new Set<SyncConnection>();

afterEach(async () => {
  await Promise.all([...activeConnections].map((connection) => connection.close()));
  await activeApp?.stop(true);
  activeApp = null;

  const sqlite = getPlatformSQLiteService();
  sqlite?.close();
  clearPlatformSQLiteService(sqlite);

  if (activeRoot) await rm(activeRoot, { recursive: true, force: true });
  activeRoot = null;
}, 30_000);

describe('createApp actor-backed multi-database Sync', () => {
  test('multiplexes shared control data with isolated tenant resources', async () => {
    const zeroDir = join(process.cwd(), '.zero');
    await mkdir(zeroDir, { recursive: true });
    activeRoot = await mkdtemp(join(zeroDir, 'multi-database-sync-'));
    const appDir = join(activeRoot, 'app');
    await mkdir(appDir, { recursive: true });

    const sqlite = createPlatformSQLiteService({ mode: 'memory' });
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

    const defaultDatabase = installDefaultDatabaseProbe(activeApp);
    activeApp.listen(0);
    const baseUrl = `http://localhost:${activeApp.server!.port}`;
    const syncUrl = `ws://localhost:${activeApp.server!.port}/sync`;
    const db = await defaultDatabase.resolve(baseUrl);

    const tenantA = await registerTenant(baseUrl, 'tenant-a', 'Tenant A');
    const tenantB = await registerTenant(baseUrl, 'tenant-b', 'Tenant B');
    expect(tenantA.tenant.tenantId).not.toBe(tenantB.tenant.tenantId);

    insertTenantNotification(
      db,
      'control-notification-a',
      tenantA.tenant.tenantId,
    );
    insertTenantNotification(
      db,
      'control-notification-b',
      tenantB.tenant.tenantId,
    );

    // Physical tenant resources are never materialized as shadow tables in
    // the pinned default/control database.
    expect(db.hasTable('todos')).toBe(false);
    expect(db.hasTable('notifications')).toBe(true);

    const connectionA = await connectSync(syncUrl, tenantA.accessToken);
    const connectionB = await connectSync(syncUrl, tenantB.accessToken);
    subscribeMixed(connectionA);
    subscribeMixed(connectionB);

    const [defaultA, physicalA, defaultB, physicalB] = await Promise.all([
      waitForSnapshot(connectionA, 'default'),
      waitForSnapshot(connectionA, 'tenant'),
      waitForSnapshot(connectionB, 'default'),
      waitForSnapshot(connectionB, 'tenant'),
    ]);

    expect(Object.keys(defaultA.tables.notifications ?? {})).toEqual([
      'control-notification-a',
    ]);
    expect(Object.keys(defaultB.tables.notifications ?? {})).toEqual([
      'control-notification-b',
    ]);
    expect(defaultA.tables.todos).toBeUndefined();
    expect(defaultB.tables.todos).toBeUndefined();
    expect(physicalA.tables).toEqual({ todos: {} });
    expect(physicalB.tables).toEqual({ todos: {} });

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

    await Promise.all([connectionA.close(), connectionB.close()]);
    const reconnectA = await connectSync(syncUrl, tenantA.accessToken);
    const reconnectB = await connectSync(syncUrl, tenantB.accessToken);
    subscribeMixed(reconnectA);
    subscribeMixed(reconnectB);

    const [reloadedA, reloadedB] = await Promise.all([
      waitForSnapshot(reconnectA, 'tenant'),
      waitForSnapshot(reconnectB, 'tenant'),
    ]);
    expect(reloadedA.tables.todos).toEqual({
      'same-id': { id: 'same-id', title: 'Tenant A value' },
    });
    expect(reloadedB.tables.todos).toEqual({
      'same-id': { id: 'same-id', title: 'Tenant B value' },
    });
  }, 60_000);
});

function insertTenantNotification(
  db: ReactiveDB,
  notificationId: string,
  tenantId: string,
): void {
  db.insert('notifications', {
    notification_id: notificationId,
    tenant_id: tenantId,
    type: 'info',
    priority: 'normal',
    title: 'Shared control plane',
    body: null,
    target_type: 'all',
    target_value: null,
    sender_id: null,
    action_url: null,
    metadata: null,
    created_at: Date.now(),
    expires_at: null,
  });
}

function installDefaultDatabaseProbe(app: ManagedApp): {
  resolve(baseUrl: string): Promise<ReactiveDB>;
} {
  const path = `/__zero_test/default-database-${crypto.randomUUID()}`;
  let captured: ReactiveDB | null = null;
  app.get(path, (context) => {
    captured = (context as unknown as { syncDB?: ReactiveDB }).syncDB ?? null;
    return { ready: captured !== null };
  });
  return {
    async resolve(baseUrl) {
      for (let attempt = 0; attempt < 100; attempt++) {
        await fetch(`${baseUrl}${path}`);
        if (captured) return captured;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error('Timed out waiting for the default database');
    },
  };
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
  plane: 'default' | 'tenant',
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
