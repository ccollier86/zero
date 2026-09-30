import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { ServerWebSocket } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReactiveDB } from './reactive-db';
import { createSyncPlugin } from './sync.plugin';
import { SyncSystemSocketBridge } from './sync-system-data-plane';
import { DatabaseError } from '../databases/database-error';
import type {
  Change,
  ServerMessage,
  SyncSocketData,
} from './types';

describe('Sync system data-plane configuration', () => {
  test('uses the stable database configuration contract for plane collisions', () => {
    const application = createReactiveDB({ mode: 'memory' });
    const system = createReactiveDB({ mode: 'memory' });
    const state = createReactiveDB({ mode: 'memory' });

    try {
      expectDatabaseConfigurationFailure(() => createSyncPlugin({
        db: { mode: 'memory' },
        reactiveDB: application,
        tables: {},
        systemDataPlane: { db: application, tables: [] },
      }), 'system-application-runtime-alias');

      expectDatabaseConfigurationFailure(() => createSyncPlugin({
        db: { mode: 'memory' },
        reactiveDB: application,
        tables: {},
        stateDB: state,
        systemDataPlane: { db: system, tables: [] },
      }), 'state-system-runtime-mismatch');

      expectDatabaseConfigurationFailure(() => createSyncPlugin({
        db: { mode: 'memory' },
        reactiveDB: application,
        tables: {
          tasks: { task_id: 'text primary key' },
        },
        systemDataPlane: { db: system, tables: ['tasks'] },
      }), 'duplicate-table-plane');
    } finally {
      state.dispose();
      system.dispose();
      application.dispose();
    }
  });
});

describe('SyncSystemSocketBridge', () => {
  test('keeps a tagged system cursor and exposes the plane as read-only', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notifications', {
      notification_id: 'text primary key',
      message: 'text not null',
    });
    db.insert('notifications', {
      notification_id: 'n1',
      message: 'First',
    });

    const socket = testSocket(['notifications']);
    const bridge = new SyncSystemSocketBridge({
      socket: socket.value,
      db,
      tables: ['notifications'],
      snapshotTables: new Set(['notifications']),
    });

    await bridge.subscribe({
      type: 'sync.subscribe',
      tables: ['notifications'],
      snapshot: ['notifications'],
      lastSeq: 0,
      cursors: { system: { lastSeq: 0 } },
    });
    expect(socket.messages[0]).toMatchObject({
      type: 'sync.snapshot',
      plane: 'system',
      tables: {
        notifications: {
          n1: { notification_id: 'n1', message: 'First' },
        },
      },
    });
    expect(socket.data.lastSeq).toBe(0);

    let committed: Change | null = null;
    const unsubscribe = db.onChange((change) => { committed = change; });
    db.insert('notifications', {
      notification_id: 'n2',
      message: 'Second',
    });
    bridge.deliver(committed!, '', () => true);
    expect(socket.messages.at(-1)).toMatchObject({
      type: 'sync.change',
      plane: 'system',
      table: 'notifications',
      rowId: 'n2',
    });

    bridge.rejectMutation('mutation-1');
    expect(socket.messages.at(-1)).toEqual({
      type: 'sync.ack',
      plane: 'system',
      ref: 'mutation-1',
      seq: null,
      ok: false,
      error: 'Framework system tables are read-only over Sync.',
    });

    unsubscribe();
    bridge.dispose();
    db.dispose();
  });

  test('polls one shared system/state database and relays remote commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-sync-system-replica-'));
    const systemPath = join(root, 'system.db');
    const writer = createReactiveDB({ mode: systemPath, busyTimeout: 10_000 });
    const observer = createReactiveDB({ mode: systemPath, busyTimeout: 10_000 });
    const schema = {
      notification_id: 'text primary key',
      message: 'text not null',
    };
    writer.defineTable('notifications', schema);
    observer.defineTable('notifications', schema);

    const originalStart = observer.startExternalChangePolling.bind(observer);
    let pollingStarts = 0;
    let pollingStops = 0;
    observer.startExternalChangePolling = (options) => {
      pollingStarts += 1;
      const stop = originalStart(options);
      return () => {
        pollingStops += 1;
        stop();
      };
    };

    const app = new Elysia().use(createSyncPlugin({
      db: { mode: 'memory' },
      tables: {},
      systemDataPlane: {
        db: observer,
        tables: ['notifications'],
      },
      // State and the system projection share one physical ReactiveDB. Sync
      // must start exactly one external dispatcher for that handle.
      stateDB: observer,
      snapshotTables: new Set(['notifications']),
    })).listen(0);
    let connection: Awaited<ReturnType<typeof connectSystemSocket>> | null = null;

    try {
      expect(pollingStarts).toBe(1);
      connection = await connectSystemSocket(
        `ws://${app.server!.hostname}:${app.server!.port}/sync`,
      );
      connection.ws.send(JSON.stringify({
        type: 'sync.subscribe',
        tables: ['notifications'],
        snapshot: ['notifications'],
        lastSeq: 0,
        cursors: { system: { lastSeq: 0 } },
      }));
      await connection.waitForMessage((message) =>
        message.type === 'sync.snapshot' && message.plane === 'system');

      writer.insert('notifications', {
        notification_id: 'remote',
        message: 'Committed by another Zero runtime',
      });
      await connection.waitForMessage((message) =>
        message.type === 'sync.change'
          && message.plane === 'system'
          && message.rowId === 'remote');
      await Bun.sleep(300);
      expect(connection.messages.filter((message) =>
        message.type === 'sync.change'
          && message.plane === 'system'
          && message.rowId === 'remote')).toHaveLength(1);
    } finally {
      connection?.close();
      await app.stop(true);
      expect(pollingStops).toBe(1);
      observer.dispose();
      writer.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);
});

async function connectSystemSocket(url: string) {
  const messages: Array<ServerMessage & { plane?: string }> = [];
  const waiters: Array<{
    predicate: (message: ServerMessage & { plane?: string }) => boolean;
    resolve: (message: ServerMessage & { plane?: string }) => void;
  }> = [];
  const ws = new WebSocket(url);
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage & { plane?: string };
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!;
      if (!waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      waiter.resolve(message);
    }
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('System Sync WebSocket failed to open'));
  });
  return {
    ws,
    messages,
    waitForMessage(
      predicate: (message: ServerMessage & { plane?: string }) => boolean,
      timeoutMs = 3_000,
    ) {
      const current = messages.find(predicate);
      if (current) return Promise.resolve(current);
      return new Promise<ServerMessage & { plane?: string }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timed out waiting for system Sync message')),
          timeoutMs,
        );
        waiters.push({
          predicate,
          resolve(message) {
            clearTimeout(timer);
            resolve(message);
          },
        });
      });
    },
    close() {
      ws.close();
    },
  };
}

function testSocket(allowed: readonly string[]) {
  const messages: ServerMessage[] = [];
  const data: SyncSocketData = {
    allowedTables: new Set(allowed),
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: null,
    authResolved: true,
    authorizationFingerprint: 'policy',
    authorizationScope: 'scope',
    connectionId: 'system-plane-test',
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set(),
    resourceRowFilters: new Map(),
    resourceRowProjectors: new Map(),
    rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    send(payload: string) {
      messages.push(JSON.parse(payload));
      return payload.length;
    },
    close() {},
    terminate() {},
    subscribe() {},
    unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, messages };
}

function expectDatabaseConfigurationFailure(
  run: () => unknown,
  reason: string,
): void {
  let failure: unknown;
  try {
    run();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(DatabaseError);
  expect(failure).toMatchObject({
    code: 'DATABASE_CONFIG_INVALID',
    retryable: false,
    outcome: 'not-started',
    details: {
      component: 'sync',
      reason,
    },
  });
}
