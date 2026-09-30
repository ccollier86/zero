import { describe, expect, test } from 'bun:test';

import { OBS_CODES } from '../observability/codes';
import { createReactiveDB, type ReactiveDB } from './reactive-db';
import { createSyncDurableChangeRuntime } from './sync-durable-change-runtime';
import {
  isSyncPromiseLike,
  SyncLifecycleError,
} from './sync-lifecycle-error';
import {
  createSyncPluginRuntimeState,
  type SyncPlatformCodeReporter,
} from './sync-plugin-runtime-state';
import { createSyncPluginLifecycle } from './sync-plugin-lifecycle';
import { createSyncSocketCollections } from './sync-socket-controller';
import type {
  SyncPluginConfig,
  SyncSocketData,
} from './types';

describe('Sync durable change runtime', () => {
  test('removes pollers and change listeners in reverse registration order', () => {
    const order: string[] = [];
    const defaultDB = fakeReactiveDB('default', order);
    const secondaryDB = fakeReactiveDB('secondary', order);
    const runtime = createSyncPluginRuntimeState(defaultDB);
    const durable = createSyncDurableChangeRuntime({
      config: syncConfig(),
      runtime,
      db: defaultDB,
      stateDB: defaultDB,
      secondaryDB,
      secondaryPlane: 'system',
      systemTables: new Set(),
      replicaPolling: { intervalMs: 10 },
      secondaryReplicaPolling: { intervalMs: 10 },
      socketAuth: socketAuthRuntime(),
      sockets: createSyncSocketCollections(),
      socketController: socketController(),
      reportSyncCode: () => undefined,
    });

    durable.startDelivery();
    durable.startReplicaPolling();
    durable.dispose((cleanup) => cleanup());

    expect(order).toEqual([
      'start:default:changes',
      'start:secondary:changes',
      'start:default:polling',
      'start:secondary:polling',
      'stop:secondary:polling',
      'stop:default:polling',
      'stop:secondary:changes',
      'stop:default:changes',
    ]);
  });

  test('invalidates after failed authority revalidation even when reporting throws', async () => {
    const db = createSilentReactiveDB();
    db.defineTable('room_members', { member_id: 'TEXT PRIMARY KEY' });
    const runtime = createSyncPluginRuntimeState(db);
    const failure = new Error('private provider failure');
    const order: string[] = [];
    const reports: Array<{
      code: string;
      error: unknown;
      metadata: Readonly<Record<string, unknown>> | undefined;
    }> = [];
    runtime.ephemeralChannel = {
      requestRevalidation(trigger: string) {
        order.push(`ephemeral:${trigger}`);
      },
    } as never;
    const reportSyncCode: SyncPlatformCodeReporter = (definition, options) => {
      order.push('report');
      reports.push({
        code: definition.code,
        error: options?.error,
        metadata: options?.metadata,
      });
      throw new Error('private observability failure');
    };
    const durable = createSyncDurableChangeRuntime({
      config: syncConfig(),
      runtime,
      db,
      stateDB: db,
      secondaryDB: null,
      secondaryPlane: 'state',
      systemTables: new Set(),
      replicaPolling: null,
      secondaryReplicaPolling: null,
      socketAuth: socketAuthRuntime({
        revalidateAll: () => Promise.reject(failure),
        invalidateAll: () => { order.push('invalidate'); },
      }),
      sockets: createSyncSocketCollections(),
      socketController: socketController(),
      reportSyncCode,
    });

    try {
      durable.startDelivery();
      db.insert('room_members', { member_id: 'member-one' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(order).toEqual([
        'ephemeral:room-members-change',
        'report',
        'invalidate',
      ]);
      expect(reports).toEqual([{
        code: OBS_CODES.SYNC_AUTH_REVALIDATION_FAILED.code,
        error: failure,
        metadata: {
          channel: 'socket',
          trigger: 'room-members-change',
        },
      }]);
    } finally {
      durable.dispose((cleanup) => cleanup());
      db.dispose();
    }
  });

  test('classifies asynchronous policy observers with a closed lifecycle error', () => {
    const db = createSilentReactiveDB();
    db.defineTable('todos', { todo_id: 'TEXT PRIMARY KEY' });
    const runtime = createSyncPluginRuntimeState(db);
    const failures: unknown[] = [];
    let invalidated = false;
    const durable = createSyncDurableChangeRuntime({
      config: syncConfig({
        resourcePolicy: {
          observeChange: () => Promise.resolve(),
        },
      }),
      runtime,
      db,
      stateDB: db,
      secondaryDB: null,
      secondaryPlane: 'state',
      systemTables: new Set(),
      replicaPolling: null,
      secondaryReplicaPolling: null,
      socketAuth: socketAuthRuntime(),
      sockets: createSyncSocketCollections(),
      socketController: socketController({
        invalidateReplicaConnections: (invalidateAuth: () => void) => {
          invalidated = true;
          invalidateAuth();
        },
      }),
      reportSyncCode: (definition, options) => {
        if (definition === OBS_CODES.SYNC_POLICY_STATE_FAILED) {
          failures.push(options?.error);
        }
      },
    });

    try {
      durable.startDelivery();
      db.insert('todos', { todo_id: 'todo-one' });

      expect(runtime.replicaLogInvalid).toBe(true);
      expect(invalidated).toBe(true);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toBeInstanceOf(SyncLifecycleError);
      expect(failures[0]).toMatchObject({
        code: 'SYNC_POLICY_OBSERVER_ASYNC',
      });
    } finally {
      durable.dispose((cleanup) => cleanup());
      db.dispose();
    }
  });

  test('classifies hostile thenable inspection without exposing the thrown value', () => {
    const privateFailure = new Error('private callback value');
    const hostile = Object.defineProperty({}, 'then', {
      get() { throw privateFailure; },
    });

    try {
      isSyncPromiseLike(hostile);
      throw new Error('Expected thenable inspection to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(SyncLifecycleError);
      expect(error).toMatchObject({
        code: 'SYNC_CALLBACK_THENABLE_INSPECTION_FAILED',
        message: 'Sync synchronous callback thenable inspection failed.',
        cause: privateFailure,
      });
    }
  });

  test('reports ephemeral sweep failure before lifecycle invalidation', async () => {
    const db = createSilentReactiveDB();
    const runtime = createSyncPluginRuntimeState(db);
    const sockets = createSyncSocketCollections();
    const failure = new Error('private ephemeral manager failure');
    const order: string[] = [];
    const reports: Array<{
      code: string;
      error: unknown;
      metadata: Readonly<Record<string, unknown>> | undefined;
    }> = [];
    let policyCalls = 0;
    let releaseInvalidated!: () => void;
    const invalidated = new Promise<void>((resolve) => {
      releaseInvalidated = resolve;
    });
    const lifecycle = createSyncPluginLifecycle({
      config: syncConfig({
        ephemeralPolicy: {
          async authorize(context: { topic: string }) {
            policyCalls += 1;
            return policyCalls === 1
              ? {
                  ok: true,
                  namespace: `lifecycle:${context.topic}`,
                  keyOwnership: 'actor',
                }
              : {
                  ok: false,
                  code: 'EPHEMERAL_FORBIDDEN',
                  reason: 'Lifecycle authority was revoked',
                };
          },
        },
      }),
      runtime,
      db,
      stateDB: db,
      systemDB: null,
      secondaryDB: null,
      systemTables: new Set(),
      replicaPolling: null,
      secondaryReplicaPolling: null,
      socketAuth: socketAuthRuntime({
        start: () => undefined,
        dispose: () => undefined,
        invalidateAll: () => {
          order.push('invalidate');
          releaseInvalidated();
        },
      }),
      sockets,
      socketController: socketController({
        disposeCapabilities: () => undefined,
        clearConnections: () => undefined,
      }),
      sqlite: null,
      ownsDatabase: false,
      databaseMode: 'ephemeral',
      unregisterCompatibilityRuntime: () => undefined,
      reportSyncCode(definition, options) {
        if (definition !== OBS_CODES.SYNC_AUTH_REVALIDATION_FAILED) return;
        order.push('report');
        reports.push({
          code: definition.code,
          error: options?.error,
          metadata: options?.metadata,
        });
      },
    });
    const socket = {
      data: {
        connectionId: 'lifecycle-ephemeral-failure',
        authContext: {
          userId: 'alice',
          email: 'alice@example.test',
          role: 'user',
        },
        ephemeralTopics: new Set<string>(),
      } as SyncSocketData,
      send: () => 1,
      close: () => { order.push('close'); },
    };

    try {
      lifecycle.start({});
      await runtime.ephemeralChannel!.subscribe(socket as never, 'custom:lifecycle');
      runtime.ephemeralManager!.unsubscribe = () => { throw failure; };

      runtime.ephemeralChannel!.requestRevalidation('authority-revision');
      await invalidated;
      await Promise.resolve();

      expect(order).toEqual(['report', 'invalidate', 'close']);
      expect(reports).toEqual([{
        code: OBS_CODES.SYNC_AUTH_REVALIDATION_FAILED.code,
        error: failure,
        metadata: {
          channel: 'ephemeral',
          trigger: 'authority-revision',
        },
      }]);
      expect(socket.data.ephemeralTopics.size).toBe(0);
    } finally {
      lifecycle.stop();
      db.dispose();
    }
  });
});

function syncConfig(
  overrides: Readonly<Record<string, unknown>> = {},
): SyncPluginConfig {
  return {
    db: { mode: 'ephemeral' },
    tables: {},
    ...overrides,
  } as unknown as SyncPluginConfig;
}

function createSilentReactiveDB(): ReactiveDB {
  return createReactiveDB({
    mode: 'memory',
    emitCode: () => ({}) as never,
  });
}

function fakeReactiveDB(name: string, order: string[]): ReactiveDB {
  return {
    onChange(_listener: unknown) {
      order.push(`start:${name}:changes`);
      return () => { order.push(`stop:${name}:changes`); };
    },
    startExternalChangePolling(_options: unknown) {
      order.push(`start:${name}:polling`);
      return () => { order.push(`stop:${name}:polling`); };
    },
  } as unknown as ReactiveDB;
}

function socketAuthRuntime(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    invalidateAll: () => undefined,
    revalidateAll: () => Promise.resolve(),
    validateCurrentAuthority: () => true,
    ...overrides,
  } as never;
}

function socketController(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    invalidateReplicaConnections: (invalidateAuth: () => void) => invalidateAuth(),
    ...overrides,
  } as never;
}
