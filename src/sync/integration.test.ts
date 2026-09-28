import { describe, test, expect, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactiveDB } from './reactive-db';
import { createSyncPlugin } from './sync.plugin';
import type { ServerMessage } from './types';

// ─── Helpers ───────────────────────────────────────────────────────────────

let app: ReturnType<typeof createApp> | null = null;
const appDatabases = new WeakMap<object, ReactiveDB>();

function createApp(options: { ringBufferDepth?: number; snapshotTables?: Set<string> } = {}) {
  let db: ReactiveDB | null = null;
  const testApp = new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory', ringBufferDepth: options.ringBufferDepth ?? 100 },
        tables: {
          todos: {
            id: 'text primary key',
            title: 'text not null',
            done: 'integer default 0',
          },
          logs: {
            id: 'text primary key',
            message: 'text not null',
          },
        },
        snapshotTables: options.snapshotTables,
        onDatabaseCreated(created) {
          db = created;
        },
      })
    )
    .listen(0); // Random available port

  if (!db) throw new Error('Sync test database was not created');
  appDatabases.set(testApp, db);
  return testApp;
}

function getAppDatabase(testApp: object): ReactiveDB {
  const db = appDatabases.get(testApp);
  if (!db) throw new Error('Sync test database is not bound to this app');
  return db;
}

function getUrl(app: ReturnType<typeof createApp>): string {
  const { hostname, port } = app.server!;
  return `ws://${hostname}:${port}/sync`;
}

async function connectWS(
  url: string
): Promise<{
  ws: WebSocket;
  messages: ServerMessage[];
  waitForMessage: (
    predicate: (msg: ServerMessage) => boolean,
    timeout?: number
  ) => Promise<ServerMessage>;
  close: () => void;
}> {
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
  }> = [];

  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    try {
      const msg = JSON.parse(event.data) as ServerMessage;
      messages.push(msg);
      // Check waiters
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    } catch {}
  };

  // Wait for open
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  function waitForMessage(
    predicate: (msg: ServerMessage) => boolean,
    timeout = 2000
  ): Promise<ServerMessage> {
    // Check existing messages first
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for message`));
      }, timeout);

      waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject,
      });
    });
  }

  return {
    ws,
    messages,
    waitForMessage,
    close: () => ws.close(),
  };
}

afterEach(async () => {
  await app?.stop(true);
  app = null;
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('sync engine integration', () => {
  test('closes current and future sockets after a fatal replica-log failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-sync-replica-invalid-'));
    const path = join(directory, 'app.sqlite');
    try {
      const fixture = fileURLToPath(new URL(
        './test-fixtures/fatal-replica-log-sockets.ts',
        import.meta.url,
      ));
      const child = Bun.spawn([process.execPath, fixture, path], {
        cwd: process.cwd(),
        env: Bun.env,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
      const prefix = 'ZERO_FATAL_REPLICA_RESULT:';
      const resultLine = stdout.split('\n').find((line) => line.startsWith(prefix));
      expect(resultLine, stdout).toBeDefined();
      const result = JSON.parse(resultLine!.slice(prefix.length)) as {
        current: { code: number; reason: string };
        future: { code: number; reason: string };
        futureMessages: unknown[];
        pending: { code: number; reason: string };
        pendingMessages: Array<{ type?: string }>;
        recovery: {
          close: { code: number; reason: string };
          replacement: {
            type?: string;
            seq?: number;
            reset?: string;
            tables?: Record<string, unknown>;
          };
          observedHistoryGaps: Array<{
            kind?: string;
            afterSeq?: number;
            oldestSeq?: number;
            currentSeq?: number;
          }>;
        };
        missingPolicyReset: {
          current: { code: number; reason: string };
          future: { code: number; reason: string };
        };
        asyncPolicyReset: {
          current: { code: number; reason: string };
          future: { code: number; reason: string };
        };
        localObserverFailure: {
          current: { code: number; reason: string };
          future: { code: number; reason: string };
        };
        externalObserverFailure: {
          current: { code: number; reason: string };
          future: { code: number; reason: string };
        };
        asyncObserverFailure: {
          current: { code: number; reason: string };
          future: { code: number; reason: string };
        };
        projectorFailure: {
          current: { code: number; reason: string };
          future: { code: number; reason: string };
        };
      };
      expect(result.current).toEqual({
        code: 1012,
        reason: 'Sync replica history invalid',
      });
      expect(result.future).toEqual({
        code: 1012,
        reason: 'Sync replica history invalid',
      });
      expect(result.futureMessages).toEqual([]);
      expect(result.pending).toEqual({
        code: 1012,
        reason: 'Sync replica history invalid',
      });
      expect(result.pendingMessages).toEqual([]);
      expect(result.recovery.close).toEqual({
        code: 1012,
        reason: 'Sync replica history gap',
      });
      expect(result.recovery.replacement).toMatchObject({
        type: 'sync.snapshot',
        seq: 1,
        reset: 'preserve-pending',
        tables: { todos: {} },
      });
      expect(result.recovery.observedHistoryGaps).toEqual([{
        kind: 'format',
        afterSeq: 0,
        oldestSeq: 1,
        currentSeq: 1,
      }]);
      for (const unsafe of [
        result.missingPolicyReset,
        result.asyncPolicyReset,
        result.localObserverFailure,
        result.externalObserverFailure,
        result.asyncObserverFailure,
        result.projectorFailure,
      ]) {
        expect(unsafe.current).toEqual({
          code: 1012,
          reason: 'Sync replica history invalid',
        });
        expect(unsafe.future).toEqual({
          code: 1012,
          reason: 'Sync replica history invalid',
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('relays file-backed changes across active runtime replicas exactly once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-sync-replica-'));
    const path = join(directory, 'app.sqlite');
    let firstDb: ReactiveDB | null = null;
    let secondDb: ReactiveDB | null = null;
    const tables = {
      todos: {
        id: 'text primary key',
        title: 'text not null',
        done: 'integer default 0',
      },
    };
    const firstApp = new Elysia().use(createSyncPlugin({
      db: { mode: path, ringBufferDepth: 100, busyTimeout: 10_000 },
      tables,
      replicaChangePolling: { intervalMs: 10 },
      onDatabaseCreated(created) { firstDb = created; },
    })).listen(0);
    const secondApp = new Elysia().use(createSyncPlugin({
      db: { mode: path, ringBufferDepth: 100, busyTimeout: 10_000 },
      tables,
      replicaChangePolling: { intervalMs: 10 },
      onDatabaseCreated(created) { secondDb = created; },
    })).listen(0);

    try {
      expect(firstDb).not.toBeNull();
      expect(secondDb).not.toBeNull();
      const connection = await connectWS(
        `ws://${secondApp.server!.hostname}:${secondApp.server!.port}/sync`,
      );
      connection.ws.send(JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      }));
      await connection.waitForMessage((message) => message.type === 'sync.snapshot');

      firstDb!.insert('todos', { id: 'remote', title: 'Replica write', done: 0 });
      const change = await connection.waitForMessage(
        (message) => message.type === 'sync.change' && message.rowId === 'remote',
      );
      expect(change).toMatchObject({
        type: 'sync.change',
        op: 'INSERT',
        table: 'todos',
        rowId: 'remote',
      });
      await new Promise((resolve) => setTimeout(resolve, 35));
      expect(connection.messages.filter(
        (message) => message.type === 'sync.change' && message.rowId === 'remote',
      )).toHaveLength(1);
      connection.close();
    } finally {
      // Bun's graceful server stop waits for the WebSocket close handshake and
      // can hold the test open for the full idle timeout. The transport
      // behavior is already asserted above, so force-close the two disposable
      // test servers before removing their shared database.
      await secondApp.stop(true);
      await firstApp.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('delivers pending remote N before local N+1 with continuous origins and cursors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-sync-replica-order-'));
    const path = join(directory, 'app.sqlite');
    let firstDb: ReactiveDB | null = null;
    let secondDb: ReactiveDB | null = null;
    const tables = {
      todos: {
        id: 'text primary key',
        title: 'text not null',
        done: 'integer default 0',
      },
    };
    const firstApp = new Elysia().use(createSyncPlugin({
      db: { mode: path, ringBufferDepth: 100, busyTimeout: 10_000 },
      tables,
      replicaChangePolling: { intervalMs: 1_000 },
      onDatabaseCreated(created) { firstDb = created; },
    })).listen(0);
    const secondApp = new Elysia().use(createSyncPlugin({
      db: { mode: path, ringBufferDepth: 100, busyTimeout: 10_000 },
      tables,
      replicaChangePolling: { intervalMs: 1_000 },
      onDatabaseCreated(created) { secondDb = created; },
    })).listen(0);

    try {
      expect(firstDb).not.toBeNull();
      expect(secondDb).not.toBeNull();
      const connection = await connectWS(
        `ws://${secondApp.server!.hostname}:${secondApp.server!.port}/sync`,
      );
      connection.ws.send(JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      }));
      const snapshot = await connection.waitForMessage(
        (message) => message.type === 'sync.snapshot',
      );
      expect(snapshot.type === 'sync.snapshot' && snapshot.seq).toBe(0);

      // Runtime A commits seq 1, but runtime B's long polling interval leaves it
      // pending until B's own seq 2 commit synchronously wakes the ordered drain.
      firstDb!.insert('todos', { id: 'remote', title: 'Remote N', done: 0 });
      connection.ws.send(JSON.stringify({
        type: 'sync.mutate',
        ref: 'local-n-plus-one',
        table: 'todos',
        op: 'INSERT',
        row: { id: 'local', title: 'Local N+1', done: 0 },
      }));

      await connection.waitForMessage(
        (message) => message.type === 'sync.ack' && message.ref === 'local-n-plus-one',
      );
      await connection.waitForMessage(
        (message) => message.type === 'sync.change' && message.rowId === 'local',
      );
      const changes = connection.messages.filter(
        (message) => message.type === 'sync.change'
          && (message.rowId === 'remote' || message.rowId === 'local'),
      );
      expect(changes).toHaveLength(2);
      expect(changes.map((message) => message.type === 'sync.change'
        ? [message.seq, message.prevSeq, message.rowId, message.origin]
        : null)).toEqual([
        [1, 0, 'remote', ''],
        [2, 1, 'local', 'conn_1'],
      ]);
      await new Promise((resolve) => setTimeout(resolve, 35));
      expect(connection.messages.filter(
        (message) => message.type === 'sync.change'
          && (message.rowId === 'remote' || message.rowId === 'local'),
      )).toHaveLength(2);
      expect(connection.ws.readyState).toBe(WebSocket.OPEN);
      connection.close();
    } finally {
      await secondApp.stop(true);
      await firstApp.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('exposes ReactiveDB during plugin composition for dependent plugins', () => {
    let db: ReactiveDB | null = null;
    const plugin = createSyncPlugin({
      db: { mode: 'memory' },
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      onDatabaseCreated(created) {
        db = created;
      },
    });

    expect(db).not.toBeNull();
    expect(db!.hasTable('todos')).toBe(true);

    app = new Elysia().use(plugin).listen(0);
  });

  test('subscribe → snapshot flow', async () => {
    app = createApp();
    const url = getUrl(app);
    const { ws, waitForMessage, close } = await connectWS(url);

    // Send subscribe
    ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );

    // Wait for snapshot
    const snapshot = await waitForMessage(
      (msg) => msg.type === 'sync.snapshot'
    );

    expect(snapshot.type).toBe('sync.snapshot');
    if (snapshot.type === 'sync.snapshot') {
      expect(snapshot.tables.todos).toEqual({});
      expect(typeof snapshot.seq).toBe('number');
    }

    close();
  });

  test('server snapshot allow-list excludes tables while keeping live subscriptions', async () => {
    app = createApp({ snapshotTables: new Set(['todos']) });
    const db = getAppDatabase(app);
    db.insert('logs', { id: 'l1', message: 'lazy row' });

    const url = getUrl(app);
    const { ws, waitForMessage, close } = await connectWS(url);

    ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos', 'logs'],
        snapshot: ['todos', 'logs'],
        lastSeq: 0,
      })
    );

    const snapshot = await waitForMessage(
      (msg) => msg.type === 'sync.snapshot'
    );

    expect(snapshot.type).toBe('sync.snapshot');
    if (snapshot.type === 'sync.snapshot') {
      expect(snapshot.tables.todos).toEqual({});
      expect(snapshot.tables.logs).toBeUndefined();
    }

    close();
  });

  test('subscribe without snapshot tracks live changes without table snapshot', async () => {
    app = createApp();
    const url = getUrl(app);
    const { ws, waitForMessage, close } = await connectWS(url);

    ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        lastSeq: 0,
      })
    );

    const snapshot = await waitForMessage(
      (msg) => msg.type === 'sync.snapshot'
    );

    expect(snapshot.type).toBe('sync.snapshot');
    if (snapshot.type === 'sync.snapshot') {
      expect(snapshot.tables.todos).toBeUndefined();
      expect(snapshot.tables).toEqual({});
    }

    ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'lazy-ref-1',
        table: 'todos',
        op: 'INSERT',
        row: { id: '1', title: 'Lazy Live Change', done: 0 },
      })
    );

    const change = await waitForMessage(
      (msg) => msg.type === 'sync.change' && msg.rowId === '1'
    );

    expect(change.type).toBe('sync.change');
    if (change.type === 'sync.change') {
      expect(change.row?.title).toBe('Lazy Live Change');
    }

    close();
  });

  test('mutate → ack + change flow', async () => {
    app = createApp();
    const url = getUrl(app);
    const { ws, waitForMessage, close } = await connectWS(url);

    // Subscribe first
    ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );

    await waitForMessage((msg) => msg.type === 'sync.snapshot');

    // Send mutation
    ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'test-ref-1',
        table: 'todos',
        op: 'INSERT',
        row: { id: '1', title: 'Integration Test', done: 0 },
      })
    );

    // Wait for ack
    const ack = await waitForMessage((msg) => msg.type === 'sync.ack');
    expect(ack.type).toBe('sync.ack');
    if (ack.type === 'sync.ack') {
      expect(ack.ref).toBe('test-ref-1');
      expect(ack.ok).toBe(true);
      expect(typeof ack.seq).toBe('number');
    }

    // Wait for change broadcast (we also receive it since publishToSelf is true)
    const change = await waitForMessage((msg) => msg.type === 'sync.change');
    expect(change.type).toBe('sync.change');
    if (change.type === 'sync.change') {
      expect(change.table).toBe('todos');
      expect(change.op).toBe('INSERT');
      expect(change.rowId).toBe('1');
      expect(change.row).toEqual({
        id: '1',
        title: 'Integration Test',
        done: 0,
      });
    }

    close();
  });

  test('does not inherit a socket origin for a reentrant application write', async () => {
    app = createApp();
    const db = getAppDatabase(app);
    const first = await connectWS(getUrl(app));
    const second = await connectWS(getUrl(app));

    for (const connection of [first, second]) {
      connection.ws.send(JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      }));
      await connection.waitForMessage((message) => message.type === 'sync.snapshot');
    }

    db.onChange((change) => {
      if (change.rowId === 'socket-write') {
        db.insert('todos', {
          id: 'reentrant-write',
          title: 'Application listener write',
          done: 0,
        });
      }
    });

    first.ws.send(JSON.stringify({
      type: 'sync.mutate',
      ref: 'origin-reentrant',
      table: 'todos',
      op: 'INSERT',
      row: { id: 'socket-write', title: 'Socket write', done: 0 },
    }));

    await first.waitForMessage(
      (message) => message.type === 'sync.ack'
        && message.ref === 'origin-reentrant',
    );
    const firstSocketWrite = await first.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'socket-write',
    );
    const firstReentrantWrite = await first.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'reentrant-write',
    );
    const secondSocketWrite = await second.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'socket-write',
    );
    const secondReentrantWrite = await second.waitForMessage(
      (message) => message.type === 'sync.change'
        && message.rowId === 'reentrant-write',
    );

    expect(firstSocketWrite).toMatchObject({ origin: 'conn_1' });
    expect(secondSocketWrite).toMatchObject({ origin: 'conn_1' });
    expect(firstReentrantWrite).toMatchObject({ origin: '' });
    expect(secondReentrantWrite).toMatchObject({ origin: '' });

    first.close();
    second.close();
  });

  test('update mutation round-trip', async () => {
    app = createApp();
    const url = getUrl(app);
    const { ws, waitForMessage, messages, close } = await connectWS(url);

    // Subscribe
    ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );
    await waitForMessage((msg) => msg.type === 'sync.snapshot');

    // Insert
    ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'insert-ref',
        table: 'todos',
        op: 'INSERT',
        row: { id: '1', title: 'Before Update', done: 0 },
      })
    );
    await waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'insert-ref'
    );

    // Update
    ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'update-ref',
        table: 'todos',
        op: 'UPDATE',
        rowId: '1',
        row: { title: 'After Update', done: 1 },
      })
    );

    const updateAck = await waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'update-ref'
    );

    if (updateAck.type === 'sync.ack') {
      expect(updateAck.ok).toBe(true);
    }

    // Wait for the update change
    const updateChange = await waitForMessage(
      (msg) =>
        msg.type === 'sync.change' &&
        msg.op === 'UPDATE' &&
        msg.rowId === '1'
    );

    if (updateChange.type === 'sync.change') {
      expect(updateChange.row?.title).toBe('After Update');
      expect(updateChange.row?.done).toBe(1);
    }

    close();
  });

  test('delete mutation round-trip', async () => {
    app = createApp();
    const url = getUrl(app);
    const { ws, waitForMessage, close } = await connectWS(url);

    // Subscribe + insert
    ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );
    await waitForMessage((msg) => msg.type === 'sync.snapshot');

    ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'insert-ref',
        table: 'todos',
        op: 'INSERT',
        row: { id: '1', title: 'To Delete', done: 0 },
      })
    );
    await waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'insert-ref'
    );

    // Delete
    ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'delete-ref',
        table: 'todos',
        op: 'DELETE',
        rowId: '1',
      })
    );

    const deleteAck = await waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'delete-ref'
    );

    if (deleteAck.type === 'sync.ack') {
      expect(deleteAck.ok).toBe(true);
    }

    close();
  });

  test('mutation on unknown table returns error ack', async () => {
    app = createApp();
    const url = getUrl(app);
    const { ws, waitForMessage, close } = await connectWS(url);

    ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );
    await waitForMessage((msg) => msg.type === 'sync.snapshot');

    ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'bad-table-ref',
        table: 'nonexistent',
        op: 'INSERT',
        row: { id: '1' },
      })
    );

    const ack = await waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'bad-table-ref'
    );

    if (ack.type === 'sync.ack') {
      expect(ack.ok).toBe(false);
      expect(ack.error).toContain('Unknown table');
    }

    close();
  });

  test('reconnect with catchup', async () => {
    app = createApp();
    const url = getUrl(app);

    // First connection — subscribe and insert a row
    const conn1 = await connectWS(url);
    conn1.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );

    const snapshot = await conn1.waitForMessage(
      (msg) => msg.type === 'sync.snapshot'
    );
    let lastSeq = snapshot.type === 'sync.snapshot' ? snapshot.seq : 0;

    conn1.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'ref-1',
        table: 'todos',
        op: 'INSERT',
        row: { id: '1', title: 'Before Reconnect', done: 0 },
      })
    );

    const ack = await conn1.waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'ref-1'
    );

    conn1.close();

    // Second connection — subscribe with lastSeq from first connection
    // The insert happened after our snapshot, so we should get a catchup
    const conn2 = await connectWS(url);
    conn2.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq,
      })
    );

    // Should get either catchup or snapshot
    const response = await conn2.waitForMessage(
      (msg) => msg.type === 'sync.catchup' || msg.type === 'sync.snapshot'
    );

    if (response.type === 'sync.catchup') {
      expect(response.changes.length).toBeGreaterThan(0);
      const insertChange = response.changes.find(
        (c) => c.table === 'todos' && c.rowId === '1'
      );
      expect(insertChange).toBeDefined();
    } else if (response.type === 'sync.snapshot') {
      // If the server decided to send a full snapshot instead, that's also valid
      expect(response.tables.todos['1']).toBeDefined();
    }

    conn2.close();
  });

  test('reconnect catchup includes lazy table changes omitted from snapshots', async () => {
    app = createApp();
    const db = getAppDatabase(app);

    db.insert('todos', { id: 'seed', title: 'Seed row', done: 0 });

    const conn1 = await connectWS(getUrl(app));
    conn1.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos', 'logs'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );

    const snapshot = await conn1.waitForMessage(
      (msg) => msg.type === 'sync.snapshot'
    );
    expect(snapshot.type).toBe('sync.snapshot');
    const lastSeq = snapshot.type === 'sync.snapshot' ? snapshot.seq : 0;
    const epoch = snapshot.type === 'sync.snapshot' ? snapshot.epoch : undefined;
    const scope = snapshot.type === 'sync.snapshot' ? snapshot.scope : undefined;

    db.insert('logs', { id: 'l1', message: 'Lazy table catchup' });
    db.insert('todos', { id: 'after', title: 'Full table catchup', done: 0 });
    conn1.close();

    const conn2 = await connectWS(getUrl(app));
    conn2.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos', 'logs'],
        snapshot: ['todos'],
        lastSeq,
        epoch,
        scope,
      })
    );

    const catchup = await conn2.waitForMessage((msg) => msg.type === 'sync.catchup');
    expect(catchup.type).toBe('sync.catchup');
    if (catchup.type === 'sync.catchup') {
      expect(
        catchup.changes.some(
          (change) => change.table === 'logs' && change.rowId === 'l1'
        )
      ).toBe(true);
      expect(
        catchup.changes.some(
          (change) => change.table === 'todos' && change.rowId === 'after'
        )
      ).toBe(true);
    }

    conn2.close();
  });

  test('reconnect falls back to snapshot when requested seq was pruned', async () => {
    app = createApp({ ringBufferDepth: 2 });
    const db = getAppDatabase(app);

    db.insert('todos', { id: 'old', title: 'Old row', done: 0 });
    const staleLastSeq = db.currentSeq;

    db.insert('todos', { id: 'new-1', title: 'New row 1', done: 0 });
    db.insert('todos', { id: 'new-2', title: 'New row 2', done: 0 });
    db.insert('todos', { id: 'new-3', title: 'New row 3', done: 0 });

    const conn = await connectWS(getUrl(app));
    conn.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: staleLastSeq,
      })
    );

    const snapshot = await conn.waitForMessage((msg) => msg.type === 'sync.snapshot');
    expect(snapshot.type).toBe('sync.snapshot');
    if (snapshot.type === 'sync.snapshot') {
      expect(snapshot.tables.todos['new-3']).toEqual({
        id: 'new-3',
        title: 'New row 3',
        done: 0,
      });
      expect(snapshot.seq).toBe(db.currentSeq);
    }

    conn.close();
  });

  test('two clients see each other\'s changes', async () => {
    app = createApp();
    const url = getUrl(app);

    const client1 = await connectWS(url);
    const client2 = await connectWS(url);

    // Both subscribe
    client1.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );
    client2.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );

    await client1.waitForMessage((msg) => msg.type === 'sync.snapshot');
    await client2.waitForMessage((msg) => msg.type === 'sync.snapshot');

    // Client 1 inserts
    client1.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'c1-ref',
        table: 'todos',
        op: 'INSERT',
        row: { id: '1', title: 'From Client 1', done: 0 },
      })
    );

    // Client 2 should receive the change via pub/sub
    const change = await client2.waitForMessage(
      (msg) => msg.type === 'sync.change' && msg.rowId === '1'
    );

    if (change.type === 'sync.change') {
      expect(change.table).toBe('todos');
      expect(change.row?.title).toBe('From Client 1');
    }

    client1.close();
    client2.close();
  });

  test('SQLite defaults applied on insert', async () => {
    app = createApp();
    const url = getUrl(app);
    const { ws, waitForMessage, close } = await connectWS(url);

    ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        snapshot: ['todos'],
        lastSeq: 0,
      })
    );
    await waitForMessage((msg) => msg.type === 'sync.snapshot');

    // Insert without 'done' — should get default 0
    ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'default-ref',
        table: 'todos',
        op: 'INSERT',
        row: { id: '1', title: 'No Done Field' },
      })
    );

    const change = await waitForMessage(
      (msg) => msg.type === 'sync.change' && msg.rowId === '1'
    );

    if (change.type === 'sync.change') {
      expect(change.row?.done).toBe(0); // SQLite default applied
    }

    close();
  });
});
