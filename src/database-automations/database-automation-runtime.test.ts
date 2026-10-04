import { afterEach, describe, expect, test } from 'bun:test';

import { DatabaseError } from '../databases/database-error';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineDatabaseAutomations } from './database-automations';
import { defineDatabaseFunction } from './database-function';
import { DatabaseAutomationRuntime } from './database-automation-runtime';
import type { DatabaseAutomationRuntimeOptions } from './database-automation-runtime-types';
import type { DatabaseTransactionFunctionCapability } from './database-transaction-function-capability';
import type { DatabaseTriggerFunctionInput } from './database-trigger-input';
import { defineDatabaseTrigger } from './database-trigger';

const REALM_FINGERPRINT_A = `sha256:${'a'.repeat(64)}`;
const REALM_FINGERPRINT_B = `sha256:${'b'.repeat(64)}`;
const FILE_TEST_TIMEOUT_MS = 20_000;
const filePaths: string[] = [];

afterEach(async () => {
  for (const path of filePaths.splice(0)) {
    await Bun.file(path).delete().catch(() => {});
    await Bun.file(`${path}-wal`).delete().catch(() => {});
    await Bun.file(`${path}-shm`).delete().catch(() => {});
  }
});

describe('DatabaseAutomationRuntime', () => {
  test('atomically captures exact realm, manifest, function, and source provenance', () => {
    const path = nextDatabasePath();
    const db = createOrdersDatabase(path);
    const definitions = durableDefinitions();
    const ids = ['invocation-one', 'delivery-one'];
    const runtime = createRuntime({
      db,
      registry: definitions.registry,
      path,
      now: () => 12_345,
      createId: () => ids.shift()!,
    });

    db.createStrict('orders', { id: 'order-one', status: 'new', amount: 4 });

    expect(runtime.status()).toMatchObject({
      outbox: 'ready',
      manifestFingerprint: definitions.registry.fingerprint,
      counts: { pendingRecords: 1, processingRecords: 0 },
    });
    const claim = runtime.claim('worker-one', 12_345, 1_000)!;
    expect(claim).toMatchObject({
      deliveryId: 'delivery-one',
      invocationId: 'invocation-one',
      triggerIdentity: definitions.trigger.identity,
      functionIdentity: definitions.notify.identity,
      manifestFingerprint: definitions.registry.fingerprint,
      realmName: 'orders.realm',
      realmFingerprint: REALM_FINGERPRINT_A,
      sourceSequence: 1,
      sourceTable: 'orders',
      sourceOperation: 'insert',
      sourceRowId: 'order-one',
      input: {
        change: {
          sequence: 1,
          table: 'orders',
          operation: 'insert',
          rowId: 'order-one',
          row: { id: 'order-one', status: 'new', amount: 4 },
          previousRow: null,
        },
      },
    });
    expect(runtime.complete(claim, 12_500)).toBe('completed');
    expect(runtime.status().counts).toMatchObject({
      activeRecords: 0,
      completedRecords: 1,
    });
    runtime.close();
    db.dispose();
  }, FILE_TEST_TIMEOUT_MS);

  test('rolls back a durable enqueue with its source mutation and later chain failure', () => {
    const path = nextDatabasePath();
    const db = createOrdersDatabase(path);
    const notify = durableFunction('orders.notify');
    const fail = transactionFunction('orders.fail', () => {
      throw new Error('private handler failure');
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.inserted',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: [notify, fail],
    });
    const runtime = createRuntime({
      db,
      path,
      registry: defineDatabaseAutomations({
        functions: [notify, fail],
        triggers: [trigger],
      }),
      createId: sequentialIds(),
      now: () => 100,
    });

    const failure = captureError(() => {
      db.createStrict('orders', { id: 'rolled-back', status: 'new', amount: 4 });
    });
    expect(failure).toBeInstanceOf(DatabaseError);
    expect(failure).toMatchObject({
      code: 'DATABASE_EXECUTOR_FAILED',
      outcome: 'not-committed',
    });
    expect((failure as Error).message).not.toContain('private handler failure');
    expect(db.get('orders', 'rolled-back')).toBeNull();
    expect(db.currentSeq).toBe(0);
    expect(runtime.status().counts).toMatchObject({
      totalRecords: 0,
      activeRecords: 0,
      pendingRecords: 0,
    });
    runtime.close();
    db.dispose();
  }, FILE_TEST_TIMEOUT_MS);

  test('persists leased work across restart and recovers only after lease expiry', () => {
    const path = nextDatabasePath();
    const definitions = durableDefinitions();
    const firstDb = createOrdersDatabase(path);
    const first = createRuntime({
      db: firstDb,
      path,
      registry: definitions.registry,
      createId: sequentialIds(),
      now: () => 100,
    });
    firstDb.createStrict('orders', { id: 'order-one', status: 'new', amount: 4 });
    const stale = first.claim('worker-one', 100, 1_000)!;
    first.close();
    firstDb.dispose();

    const secondDb = createOrdersDatabase(path);
    const second = createRuntime({
      db: secondDb,
      path,
      registry: definitions.registry,
      createId: sequentialIds(),
    });
    expect(second.recoverExpired(1_099)).toEqual({ requeued: 0, dead: 0 });
    expect(second.claim('worker-two', 1_099, 1_000)).toBeNull();
    expect(second.recoverExpired(1_100)).toEqual({ requeued: 1, dead: 0 });
    const recovered = second.claim('worker-two', 1_100, 1_000)!;
    expect(recovered.deliveryId).toBe(stale.deliveryId);
    expect(recovered.leaseToken).not.toBe(stale.leaseToken);
    expect(recovered.attemptCount).toBe(2);
    expect(second.complete(stale, 1_101)).toBe('stale');
    expect(second.complete(recovered, 1_101)).toBe('completed');
    second.close();
    secondDb.dispose();
  }, FILE_TEST_TIMEOUT_MS);

  test('allows additive manifest drift when the exact durable function remains', () => {
    const path = nextDatabasePath();
    const definitions = durableDefinitions();
    const firstDb = createOrdersDatabase(path);
    const first = createRuntime({
      db: firstDb,
      path,
      registry: definitions.registry,
      realmFingerprint: REALM_FINGERPRINT_A,
      createId: sequentialIds(),
      now: () => 100,
    });
    firstDb.createStrict('orders', { id: 'order-one', status: 'new', amount: 4 });
    const oldManifestFingerprint = definitions.registry.fingerprint;
    first.close();
    firstDb.dispose();

    const additive = transactionFunction('orders.audit', () => undefined);
    const nextRegistry = defineDatabaseAutomations({
      functions: [definitions.notify, additive],
      triggers: [definitions.trigger],
    });
    expect(nextRegistry.fingerprint).not.toBe(oldManifestFingerprint);
    const secondDb = createOrdersDatabase(path);
    const second = createRuntime({
      db: secondDb,
      path,
      registry: nextRegistry,
      realmFingerprint: REALM_FINGERPRINT_B,
    });

    const claim = second.claim('worker-one', 100, 1_000)!;
    expect(claim.functionIdentity).toBe(definitions.notify.identity);
    expect(claim.manifestFingerprint).toBe(oldManifestFingerprint);
    expect(claim.realmFingerprint).toBe(REALM_FINGERPRINT_A);
    expect(second.complete(claim, 200)).toBe('completed');
    second.close();
    secondDb.dispose();
  }, FILE_TEST_TIMEOUT_MS);

  test('rejects another active realm and permanently disposes unavailable exact functions', () => {
    const realmPath = nextDatabasePath();
    const definitions = durableDefinitions();
    const realmDb = createOrdersDatabase(realmPath);
    const original = createRuntime({
      db: realmDb,
      path: realmPath,
      registry: definitions.registry,
      createId: sequentialIds(),
    });
    realmDb.createStrict('orders', { id: 'order-one', status: 'new', amount: 4 });
    original.close();
    realmDb.dispose();

    const wrongRealmDb = createOrdersDatabase(realmPath);
    expect(() => createRuntime({
      db: wrongRealmDb,
      path: realmPath,
      realmName: 'other.realm',
      registry: definitions.registry,
    })).toThrow(expect.objectContaining({
      code: 'DATABASE_AUTHORITY_CHANGED',
      outcome: 'not-started',
    }));
    wrongRealmDb.dispose();

    const unavailablePath = nextDatabasePath();
    const oldNotify = durableFunction('orders.old-notify');
    const removedArchive = durableFunction('orders.removed-archive');
    const oldTrigger = defineDatabaseTrigger({
      name: 'orders.old-deliveries',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: [oldNotify, removedArchive],
    });
    const oldRegistry = defineDatabaseAutomations({
      functions: [oldNotify, removedArchive],
      triggers: [oldTrigger],
    });
    const oldDb = createOrdersDatabase(unavailablePath);
    const oldRuntime = createRuntime({
      db: oldDb,
      path: unavailablePath,
      registry: oldRegistry,
      createId: sequentialIds(),
    });
    oldDb.createStrict('orders', { id: 'order-two', status: 'new', amount: 4 });
    oldRuntime.close();
    oldDb.dispose();

    const wrongMode = transactionFunction('orders.old-notify', () => undefined);
    const replacement = durableDefinitions('orders.replacement', 2);
    const replacementRegistry = defineDatabaseAutomations({
      functions: [wrongMode, replacement.notify],
      triggers: [replacement.trigger],
    });
    const replacementDb = createOrdersDatabase(unavailablePath);
    const replacementRuntime = createRuntime({
      db: replacementDb,
      path: unavailablePath,
      registry: replacementRegistry,
    });
    expect(() => replacementRuntime.claim('worker-one', Date.now(), 1_000))
      .toThrow(expect.objectContaining({
        code: 'DATABASE_OPERATION_UNSUPPORTED',
        outcome: 'not-started',
      }));
    expect(() => replacementRuntime.claim('worker-one', Date.now(), 1_000))
      .toThrow(expect.objectContaining({
        code: 'DATABASE_OPERATION_UNSUPPORTED',
        outcome: 'not-started',
      }));
    expect(replacementRuntime.status().counts).toMatchObject({
      activeRecords: 0,
      deadRecords: 2,
    });
    replacementRuntime.close();
    replacementDb.dispose();
  }, FILE_TEST_TIMEOUT_MS);

  test('does not install an outbox for transaction-only registries', () => {
    const db = createOrdersDatabase('memory');
    let calls = 0;
    const count = transactionFunction('orders.count', () => {
      calls += 1;
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.inserted',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: count,
    });
    const runtime = createRuntime({
      db,
      path: 'memory',
      storageMode: 'ephemeral',
      registry: defineDatabaseAutomations({
        functions: [count],
        triggers: [trigger],
      }),
    });

    db.createStrict('orders', { id: 'order-one', status: 'new', amount: 4 });
    expect(calls).toBe(1);
    expect(runtime.status()).toMatchObject({ outbox: 'disabled', counts: null });
    expect(hasPrivateOutbox(db)).toBe(false);
    expect(() => runtime.claim('worker-one', 100, 1_000))
      .toThrow(expect.objectContaining({ code: 'DATABASE_OPERATION_UNSUPPORTED' }));
    runtime.close();
    db.dispose();
  });

  test('fails configuration before schema mutation for ephemeral or disabled durability', () => {
    const definitions = durableDefinitions();
    const ephemeral = createOrdersDatabase('memory');
    expect(() => createRuntime({
      db: ephemeral,
      path: 'memory',
      storageMode: 'ephemeral',
      registry: definitions.registry,
    })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
    expect(hasPrivateOutbox(ephemeral)).toBe(false);
    ephemeral.dispose();

    const path = nextDatabasePath();
    const disabled = createOrdersDatabase(path);
    expect(() => createRuntime({
      db: disabled,
      path,
      registry: definitions.registry,
      outboxEnabled: false,
    })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
    expect(hasPrivateOutbox(disabled)).toBe(false);
    disabled.dispose();

    const invalidFingerprintDb = createOrdersDatabase('memory');
    expect(() => createRuntime({
      db: invalidFingerprintDb,
      path: 'memory',
      storageMode: 'ephemeral',
      registry: defineDatabaseAutomations({}),
      realmFingerprint: 'not-a-fingerprint',
    })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
    expect(hasPrivateOutbox(invalidFingerprintDb)).toBe(false);
    invalidFingerprintDb.dispose();
  }, FILE_TEST_TIMEOUT_MS);
});

interface RuntimeFixtureOptions {
  readonly db: ReactiveDB;
  readonly registry: DatabaseAutomationRuntimeOptions['registry'];
  readonly path: string;
  readonly storageMode?: DatabaseAutomationRuntimeOptions['storageMode'];
  readonly realmName?: string;
  readonly realmFingerprint?: string;
  readonly outboxEnabled?: boolean;
  readonly now?: () => number;
  readonly createId?: () => string;
}

function createRuntime(options: RuntimeFixtureOptions): DatabaseAutomationRuntime {
  return new DatabaseAutomationRuntime({
    db: options.db,
    registry: options.registry,
    realmName: options.realmName ?? 'orders.realm',
    realmFingerprint: options.realmFingerprint ?? REALM_FINGERPRINT_A,
    storageMode: options.storageMode ?? 'file',
    outbox: { enabled: options.outboxEnabled ?? true },
    now: options.now,
    createId: options.createId,
  });
}

function durableDefinitions(name = 'orders.notify', version = 1) {
  const notify = durableFunction(name, version);
  const trigger = defineDatabaseTrigger({
    name: `${name}-inserted`,
    version,
    table: 'orders',
    after: { insert: true },
    run: notify,
  });
  return {
    notify,
    trigger,
    registry: defineDatabaseAutomations({
      functions: [notify],
      triggers: [trigger],
    }),
  };
}

function durableFunction(name: string, version = 1) {
  return defineDatabaseFunction<DatabaseTriggerFunctionInput>({
    name,
    version,
    mode: 'durable',
    handler: async () => undefined,
  });
}

function transactionFunction(
  name: string,
  handler: (
    input: DatabaseTriggerFunctionInput,
    transaction: DatabaseTransactionFunctionCapability,
  ) => unknown,
) {
  return defineDatabaseFunction<
    DatabaseTriggerFunctionInput,
    any,
    DatabaseTransactionFunctionCapability
  >({
    name,
    version: 1,
    mode: 'transaction',
    handler: ({ input, transaction }) => handler(input, transaction),
  });
}

function createOrdersDatabase(path: string): ReactiveDB {
  const db = createReactiveDB(path === 'memory'
    ? { mode: 'memory', emitCode: () => {}, emitTelemetry: false }
    : { mode: 'file', path, emitCode: () => {}, emitTelemetry: false });
  db.defineTable('orders', {
    id: 'text primary key',
    status: 'text not null',
    amount: 'integer not null',
  });
  return db;
}

function nextDatabasePath(): string {
  const path = `/tmp/zero-automation-runtime-${crypto.randomUUID()}.sqlite`;
  filePaths.push(path);
  return path;
}

function sequentialIds(): () => string {
  let id = 0;
  return () => `automation-${++id}`;
}

function hasPrivateOutbox(db: ReactiveDB): boolean {
  const statement = db.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name = '_zero_database_automation_outbox'
  `);
  try {
    return statement.get() !== null;
  } finally {
    statement.finalize();
  }
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}
