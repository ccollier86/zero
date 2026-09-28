import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  CompatibilityProviderRegistry,
  ZERO_RUNTIME_AMBIGUOUS,
} from '../runtime/compatibility-provider-registry';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ZERO_SQLITE_SERVICE, ZERO_SYNC_DB } from '../runtime/service-keys';
import { getPlatformSQLiteService } from '../persistence';
import { createReactiveDB, type ReactiveDB } from './reactive-db';
import { createSyncPlugin, getSyncDB } from './sync.plugin';
import { allowLegacyEphemeralTopicPolicy } from './ephemeral-policy';
import type {
  ServerMessage,
  SyncResourcePolicyAdapter,
  SyncTokenVerifier,
} from './types';

interface SyncApp {
  server: { hostname?: string; port?: number } | null;
  stop(closeActiveConnections?: boolean): Promise<unknown>;
}

interface TestConnection {
  ws: WebSocket;
  messages: ServerMessage[];
  waitForMessage(
    predicate: (message: ServerMessage) => boolean,
    timeout?: number,
  ): Promise<ServerMessage>;
  close(): void;
}

const apps: SyncApp[] = [];
const connections: TestConnection[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.close();
  for (const app of apps.splice(0).reverse()) await app.stop(true);
});

describe('sync plugin runtime isolation', () => {
  test('legacy compatibility semantics are fail-closed for 0, 1, and multiple providers', () => {
    const registry = new CompatibilityProviderRegistry<{ id: string }>('Sync runtime');
    const runtimeA = { id: 'a' };

    expect(registry.get()).toBeNull();

    const registrationA = registry.register({}, () => runtimeA);
    expect(registry.get()).toBe(runtimeA);

    const registrationB = registry.register({}, () => null);
    expect(() => registry.get()).toThrow(expect.objectContaining({
      code: ZERO_RUNTIME_AMBIGUOUS,
      providerCount: 2,
    }));

    registrationB.unregister();
    expect(registry.get()).toBe(runtimeA);

    registrationA.unregister();
    expect(registry.get()).toBeNull();
  });

  test('rolls back every owned registration when plugin composition fails', () => {
    const runtime = new ZeroAppRuntime('failed-sync-composition');
    let capturedDB: ReactiveDB | null = null;

    expect(() => createSyncPlugin({
      db: { mode: 'memory' },
      runtime,
      tables: {
        parents: { id: 'text primary key' },
        children: {
          id: 'text primary key',
          parent_id: 'text references parents(id) on delete cascade',
        },
      },
      onDatabaseCreated(db) {
        capturedDB = db;
      },
    })).toThrow('foreign-key actions are not observable');

    expect(getSyncDB()).toBeNull();
    expect(getPlatformSQLiteService()).toBeNull();
    expect(runtime.get(ZERO_SYNC_DB)).toBeNull();
    expect(runtime.get(ZERO_SQLITE_SERVICE)).toBeNull();
    expect(capturedDB).not.toBeNull();
    expect(() => capturedDB!.currentSeq).toThrow('disposed');
  });

  test('rejects invalid replica polling during composition and disposes the database', () => {
    let capturedDB: ReactiveDB | null = null;

    expect(() => createSyncPlugin({
      db: { mode: 'memory' },
      tables: {},
      replicaChangePolling: { intervalMs: Number.NaN },
      onDatabaseCreated(db) {
        capturedDB = db;
      },
    })).toThrow('positive safe integer');

    expect(getSyncDB()).toBeNull();
    expect(getPlatformSQLiteService()).toBeNull();
    expect(capturedDB).not.toBeNull();
    expect(() => capturedDB!.currentSeq).toThrow('disposed');
  });

  test('rejects async database composition hooks and poisons late database access', async () => {
    let capturedDB: ReactiveDB | null = null;
    let lateAccess = '';

    expect(() => createSyncPlugin({
      db: { mode: 'memory' },
      tables: {},
      async onDatabaseCreated(db) {
        capturedDB = db;
        await Promise.resolve();
        try {
          void db.currentSeq;
        } catch (error) {
          lateAccess = String(error);
        }
      },
    })).toThrow('onDatabaseCreated must be synchronous');

    await Promise.resolve();
    expect(getSyncDB()).toBeNull();
    expect(getPlatformSQLiteService()).toBeNull();
    expect(capturedDB).not.toBeNull();
    expect(() => capturedDB!.currentSeq).toThrow('disposed');
    expect(lateAccess).toContain('disposed');
  });

  test('tears down every partial lifecycle stage when onStart fails', () => {
    const runtime = new ZeroAppRuntime('failed-sync-start');
    let capturedDB: ReactiveDB | null = null;
    const plugin = createSyncPlugin({
      db: { mode: 'memory' },
      runtime,
      tables: {},
      stateSync: true,
      onDatabaseCreated(db) {
        capturedDB = db;
        db.exec('CREATE TABLE _user_state (broken TEXT)');
      },
    });
    const app = new Elysia({ name: 'failed-sync-start-app' }).use(plugin);

    expect(() => app.listen(0)).toThrow('no such column: user_id');
    // Bun has already allocated the HTTP server by the time Elysia invokes
    // onStart. Track it for test teardown; the Sync plugin owns and has already
    // released every resource it created.
    apps.push(app);
    expect(getSyncDB()).toBeNull();
    expect(getPlatformSQLiteService()).toBeNull();
    expect(runtime.get(ZERO_SYNC_DB)).toBeNull();
    expect(runtime.get(ZERO_SQLITE_SERVICE)).toBeNull();
    expect(capturedDB).not.toBeNull();
    expect(() => capturedDB!.currentSeq).toThrow('disposed');
  });

  test('keeps an injected ReactiveDB caller-owned and removes its Sync listener on stop', async () => {
    const injected = createReactiveDB({ mode: 'memory' });
    let observedChanges = 0;
    let capturedDB: ReactiveDB | null = null;
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess({ tableNames }) {
        return {
          readableTables: new Set(tableNames),
          rowFilters: new Map(),
        };
      },
      async authorizeMutation() {
        return { ok: true };
      },
      observeChange() {
        observedChanges += 1;
      },
    };
    const app = new Elysia({ name: 'injected-sync-database' }).use(createSyncPlugin({
      db: { mode: 'memory' },
      reactiveDB: injected,
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      resourcePolicy,
      onDatabaseCreated(db) {
        expect(db).toBe(injected);
        capturedDB = db;
      },
    })).listen(0);
    apps.push(app);
    let connection: TestConnection | null = null;

    try {
      expect(capturedDB).not.toBeNull();
      connection = await connect(app);
      connections.push(connection);
      await subscribeToTodos(connection);

      injected.insert('todos', { id: 'before-stop', title: 'Delivered by Sync' });
      const delivered = await connection.waitForMessage(
        (message) => message.type === 'sync.change'
          && message.rowId === 'before-stop',
      );
      expect(delivered).toMatchObject({
        type: 'sync.change',
        table: 'todos',
        rowId: 'before-stop',
      });
      expect(observedChanges).toBe(1);

      const transportClosed = new Promise<void>((resolve) => {
        connection!.ws.addEventListener('close', () => resolve(), { once: true });
      });
      await app.stop(true);
      await transportClosed;
      const connectionIndex = connections.indexOf(connection);
      if (connectionIndex >= 0) connections.splice(connectionIndex, 1);
      connection = null;
      const appIndex = apps.indexOf(app);
      if (appIndex >= 0) apps.splice(appIndex, 1);

      injected.insert('todos', { id: 'after-stop', title: 'Caller still owns DB' });
      expect(injected.queryOne('todos', 'after-stop')).toEqual({
        id: 'after-stop',
        title: 'Caller still owns DB',
      });
      expect(observedChanges).toBe(1);
      expect(getSyncDB()).toBeNull();
      expect(getPlatformSQLiteService()).toBeNull();
    } finally {
      connection?.close();
      const connectionIndex = connection ? connections.indexOf(connection) : -1;
      if (connectionIndex >= 0) connections.splice(connectionIndex, 1);
      const appIndex = apps.indexOf(app);
      if (appIndex >= 0) {
        await app.stop(true);
        apps.splice(appIndex, 1);
      }
      injected.dispose();
    }
  });

  test('disposes an explicitly owned injected ReactiveDB on stop', async () => {
    const injected = createReactiveDB({ mode: 'memory' });
    const app = new Elysia({ name: 'owned-injected-sync-database' }).use(createSyncPlugin({
      db: { mode: 'memory' },
      reactiveDB: injected,
      ownsReactiveDB: true,
      tables: {},
    })).listen(0);
    apps.push(app);

    await app.stop(true);
    apps.splice(apps.indexOf(app), 1);

    expect(() => injected.currentSeq).toThrow('disposed');
  });

  test('continues to own a ReactiveDB created from the standalone db config', async () => {
    let capturedDB: ReactiveDB | null = null;
    const app = new Elysia({ name: 'standalone-owned-sync-database' }).use(createSyncPlugin({
      db: { mode: 'memory' },
      tables: {},
      onDatabaseCreated(db) {
        capturedDB = db;
      },
    })).listen(0);
    apps.push(app);

    expect(capturedDB).not.toBeNull();
    await app.stop(true);
    apps.splice(apps.indexOf(app), 1);

    expect(() => capturedDB!.currentSeq).toThrow('disposed');
  });

  test('keeps a caller-owned injected ReactiveDB usable after composition failure', () => {
    const injected = createReactiveDB({ mode: 'memory' });
    try {
      expect(() => createSyncPlugin({
        db: { mode: 'memory' },
        reactiveDB: injected,
        tables: {
          parents: { id: 'text primary key' },
          children: {
            id: 'text primary key',
            parent_id: 'text references parents(id) on delete cascade',
          },
        },
      })).toThrow('foreign-key actions are not observable');

      expect(injected.currentSeq).toBe(0);
      expect(getSyncDB()).toBeNull();
      injected.defineTable('still_usable', { id: 'text primary key' });
      injected.insert('still_usable', { id: 'retained' });
      expect(injected.queryOne('still_usable', 'retained')).toEqual({ id: 'retained' });
    } finally {
      injected.dispose();
    }
  });

  test('disposes an owned injected ReactiveDB after composition failure', () => {
    const injected = createReactiveDB({ mode: 'memory' });

    expect(() => createSyncPlugin({
      db: { mode: 'memory' },
      reactiveDB: injected,
      ownsReactiveDB: true,
      tables: {
        parents: { id: 'text primary key' },
        children: {
          id: 'text primary key',
          parent_id: 'text references parents(id) on delete cascade',
        },
      },
    })).toThrow('foreign-key actions are not observable');

    expect(getSyncDB()).toBeNull();
    expect(() => injected.currentSeq).toThrow('disposed');
  });

  test('rejects an injected-database ownership flag without an injected database', () => {
    expect(() => createSyncPlugin({
      db: { mode: 'memory' },
      ownsReactiveDB: false,
      tables: {},
    })).toThrow('ownsReactiveDB is valid only when reactiveDB is provided');
    expect(getSyncDB()).toBeNull();
  });

  test('keeps database, managers, listeners, sockets, and mutation origin instance-local', async () => {
    let dbA: ReactiveDB | null = null;
    let dbB: ReactiveDB | null = null;

    const pluginA = createIsolatedPlugin((db) => { dbA = db; });
    const pluginB = createIsolatedPlugin((db) => { dbB = db; });
    expect(dbA).not.toBeNull();
    expect(dbB).not.toBeNull();

    // A listener-induced write into B runs while A's mutation is being
    // delivered. This catches process-global mutation-origin metadata.
    dbA!.onChange((change) => {
      if (change.table === 'todos' && change.rowId === 'from-a') {
        dbB!.insert('todos', {
          id: 'written-into-b',
          title: 'B-local nested write',
        });
      }
    });

    const appA = new Elysia({ name: 'sync-runtime-a' }).use(pluginA).listen(0);
    const appB = new Elysia({ name: 'sync-runtime-b' }).use(pluginB).listen(0);
    apps.push(appA, appB);

    const connectionA = await connect(appA);
    const connectionB = await connect(appB);
    connections.push(connectionA, connectionB);
    await authenticate(connectionA);
    await authenticate(connectionB);

    await subscribeToTodos(connectionA);
    await subscribeToTodos(connectionB);

    connectionA.ws.send(JSON.stringify({
      type: 'ephemeral.set',
      topic: 'shared-name',
      key: 'only-a',
      value: 'A',
    }));
    connectionB.ws.send(JSON.stringify({
      type: 'ephemeral.subscribe',
      topic: 'shared-name',
    }));

    const isolatedSnapshot = await connectionB.waitForMessage(
      (message) => message.type === 'ephemeral.snapshot',
    );
    expect(isolatedSnapshot).toMatchObject({
      type: 'ephemeral.snapshot',
      topic: 'shared-name',
      entries: {},
    });

    connectionA.ws.send(JSON.stringify({
      type: 'sync.mutate',
      ref: 'write-a',
      table: 'todos',
      op: 'INSERT',
      row: { id: 'from-a', title: 'A-local row' },
    }));
    await connectionA.waitForMessage(
      (message) => message.type === 'sync.ack' && message.ref === 'write-a',
    );

    const nestedBChange = await connectionB.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'written-into-b',
    );
    expect(nestedBChange).toMatchObject({
      type: 'sync.change',
      rowId: 'written-into-b',
      origin: '',
    });
    expect(dbA!.get('todos', 'written-into-b')).toBeNull();
    expect(dbB!.get('todos', 'from-a')).toBeNull();

    // Stopping A must not unsubscribe B's change listener or dispose B's
    // state/ephemeral managers.
    connectionA.close();
    await appA.stop(true);
    apps.splice(apps.indexOf(appA), 1);

    connectionB.ws.send(JSON.stringify({ type: 'state.subscribe' }));
    const stateSnapshot = await connectionB.waitForMessage(
      (message) => message.type === 'state.snapshot',
    );
    expect(stateSnapshot).toEqual({ type: 'state.snapshot', entries: {} });

    connectionB.ws.send(JSON.stringify({
      type: 'ephemeral.set',
      topic: 'shared-name',
      key: 'after-a-stopped',
      value: 'B',
    }));
    connectionB.ws.send(JSON.stringify({
      type: 'ephemeral.unsubscribe',
      topic: 'shared-name',
    }));
    connectionB.ws.send(JSON.stringify({
      type: 'ephemeral.subscribe',
      topic: 'shared-name',
    }));
    const postStopEphemeralSnapshot = await connectionB.waitForMessage(
      (message) => message.type === 'ephemeral.snapshot'
        && Object.hasOwn(message.entries, 'after-a-stopped'),
    );
    expect(postStopEphemeralSnapshot).toMatchObject({
      type: 'ephemeral.snapshot',
      topic: 'shared-name',
      entries: {
        'after-a-stopped': { value: 'B' },
      },
    });

    connectionB.ws.send(JSON.stringify({
      type: 'sync.mutate',
      ref: 'write-b-after-stop',
      table: 'todos',
      op: 'INSERT',
      row: { id: 'after-a-stopped', title: 'B remains active' },
    }));
    const postStopChange = await connectionB.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'after-a-stopped',
    );
    expect(postStopChange).toMatchObject({
      type: 'sync.change',
      rowId: 'after-a-stopped',
    });
    expect(dbB!.get('todos', 'after-a-stopped')).toMatchObject({
      title: 'B remains active',
    });
  });
});

function createIsolatedPlugin(onDatabaseCreated: (db: ReactiveDB) => void) {
  const verifier: SyncTokenVerifier = {
    async verifyAccessToken(token) {
      return token === 'valid-token'
        ? { sub: 'user-1', email: 'user@example.test', role: 'user' }
        : null;
    },
  };

  return createSyncPlugin({
    db: { mode: 'memory' },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    stateSync: true,
    auth: {
      required: true,
      getTokenVerifier: () => verifier,
    },
    // This fixture is testing plugin-instance isolation, not topic policy.
    // Auth-enabled plugins otherwise fail closed until topics are classified.
    ephemeralPolicy: allowLegacyEphemeralTopicPolicy,
    onDatabaseCreated,
  });
}

async function connect(app: SyncApp): Promise<TestConnection> {
  const server = app.server!;
  const ws = new WebSocket(
    `ws://${server.hostname ?? 'localhost'}:${server.port!}/sync`,
  );
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiter = waiters[index]!;
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(index, 1);
      waiter.resolve(message);
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  return {
    ws,
    messages,
    waitForMessage(predicate, timeout = 2_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);

      return new Promise<ServerMessage>((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index !== -1) waiters.splice(index, 1);
            reject(new Error('Timed out waiting for WebSocket message'));
          }, timeout),
        };
        waiters.push(waiter);
      });
    },
    close() {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('WebSocket closed'));
      }
      ws.close();
    },
  };
}

async function authenticate(connection: TestConnection): Promise<void> {
  connection.ws.send(JSON.stringify({
    type: 'sync.auth',
    token: 'valid-token',
  }));
  await connection.waitForMessage(
    (message) => message.type === 'sync.auth.ready',
  );
}

async function subscribeToTodos(connection: TestConnection): Promise<void> {
  connection.ws.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['todos'],
    snapshot: ['todos'],
    lastSeq: 0,
  }));
  await connection.waitForMessage(
    (message) => message.type === 'sync.snapshot',
  );
}
