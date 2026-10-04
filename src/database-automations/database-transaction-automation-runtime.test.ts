import { describe, expect, test } from 'bun:test';

import { createReactiveDB } from '../sync/reactive-db';
import { DatabaseError } from '../databases/database-error';
import { defineDatabaseAutomations } from './database-automations';
import type { DatabaseDurableAutomationEnqueueInput } from './database-automation-runtime-contracts';
import { defineDatabaseFunction } from './database-function';
import {
  DatabaseTransactionAutomationRuntime,
} from './database-transaction-automation-runtime';
import type {
  DatabaseTransactionFunctionCapability,
} from './database-transaction-function-capability';
import type { DatabaseTriggerFunctionInput } from './database-trigger-input';
import { defineDatabaseTrigger } from './database-trigger';

function createTables() {
  const db = createReactiveDB({ mode: 'memory' });
  db.defineTable('orders', {
    id: 'TEXT PRIMARY KEY',
    status: 'TEXT NOT NULL',
    amount: 'INTEGER NOT NULL',
  });
  db.defineTable('rollups', {
    id: 'TEXT PRIMARY KEY',
    count: 'INTEGER NOT NULL',
  });
  return db;
}

function transactionFunction(
  name: string,
  handler: (
    input: DatabaseTriggerFunctionInput,
    db: DatabaseTransactionFunctionCapability,
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

describe('DatabaseTransactionAutomationRuntime', () => {
  test('commits an atomic same-database rollup from an AFTER trigger', () => {
    const db = createTables();
    const rollup = transactionFunction('orders.rollup', (_input, transaction) => {
      const current = transaction.get('rollups', 'orders');
      transaction.insert('rollups', {
        id: 'orders',
        count: Number(current?.count ?? 0) + 1,
      });
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.inserted',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: rollup,
    });
    const runtime = new DatabaseTransactionAutomationRuntime({
      db,
      registry: defineDatabaseAutomations({ functions: [rollup], triggers: [trigger] }),
    });

    db.createStrict('orders', { id: 'one', status: 'new', amount: 4 });

    expect(db.get('rollups', 'orders')).toEqual({ id: 'orders', count: 1 });
    expect(db.currentSeq).toBe(2);
    runtime.close();
    db.dispose();
  });

  test('rolls back the source row, cascades, and change sequence on failure', () => {
    const db = createTables();
    const fail = transactionFunction('orders.fail', (_input, transaction) => {
      transaction.createStrict('rollups', { id: 'should-rollback', count: 1 });
      throw new Error('private handler detail');
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.inserted',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: fail,
    });
    const runtime = new DatabaseTransactionAutomationRuntime({
      db,
      registry: defineDatabaseAutomations({ functions: [fail], triggers: [trigger] }),
    });

    let failure: unknown;
    try {
      db.createStrict('orders', { id: 'one', status: 'new', amount: 4 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DatabaseError);
    expect(failure).toMatchObject({
      code: 'DATABASE_EXECUTOR_FAILED',
      outcome: 'not-committed',
      retryable: false,
    });
    expect((failure as Error).message).not.toContain('private handler detail');
    expect(db.get('orders', 'one')).toBeNull();
    expect(db.get('rollups', 'should-rollback')).toBeNull();
    expect(db.currentSeq).toBe(0);
    runtime.close();
    db.dispose();
  });

  test('preserves chain order before draining cascaded mutations', () => {
    const db = createTables();
    const observed: string[] = [];
    const first = transactionFunction('orders.first', (_input, transaction) => {
      observed.push('orders:first');
      transaction.createStrict('rollups', { id: 'cascade', count: 1 });
    });
    const second = transactionFunction('orders.second', () => {
      observed.push('orders:second');
    });
    const cascaded = transactionFunction('rollups.observe', () => {
      observed.push('rollups:observe');
    });
    const registry = defineDatabaseAutomations({
      functions: [first, second, cascaded],
      triggers: [
        defineDatabaseTrigger({
          name: 'orders.inserted',
          version: 1,
          table: 'orders',
          after: { insert: true },
          run: [first, second],
        }),
        defineDatabaseTrigger({
          name: 'rollups.inserted',
          version: 1,
          table: 'rollups',
          after: { insert: true },
          run: cascaded,
        }),
      ],
    });
    const runtime = new DatabaseTransactionAutomationRuntime({ db, registry });

    db.createStrict('orders', { id: 'one', status: 'new', amount: 4 });
    expect(observed).toEqual([
      'orders:first',
      'orders:second',
      'rollups:observe',
    ]);
    runtime.close();
    db.dispose();
  });

  test('matches UPDATE column filters against canonical before and after rows', () => {
    const db = createTables();
    let firings = 0;
    const count = transactionFunction('orders.status-count', () => {
      firings += 1;
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.status-changed',
      version: 1,
      table: 'orders',
      after: { update: { columns: ['status'] } },
      run: count,
    });
    const runtime = new DatabaseTransactionAutomationRuntime({
      db,
      registry: defineDatabaseAutomations({ functions: [count], triggers: [trigger] }),
    });

    db.createStrict('orders', { id: 'one', status: 'new', amount: 4 });
    db.update('orders', 'one', { amount: 5 });
    db.update('orders', 'one', { status: 'paid' });
    expect(firings).toBe(1);
    runtime.close();
    db.dispose();
  });

  test('captures durable work with stable correlation and a canonical source input', () => {
    const db = createTables();
    const captured: DatabaseDurableAutomationEnqueueInput[] = [];
    const notify = defineDatabaseFunction<DatabaseTriggerFunctionInput>({
      name: 'orders.notify',
      version: 2,
      mode: 'durable',
      handler: async () => undefined,
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.inserted',
      version: 3,
      table: 'orders',
      after: { insert: true },
      run: notify,
    });
    const registry = defineDatabaseAutomations({ functions: [notify], triggers: [trigger] });
    const ids = ['invocation-one', 'delivery-one'];
    const runtime = new DatabaseTransactionAutomationRuntime({
      db,
      registry,
      durableSink: { enqueue: (input) => captured.push(input) },
      createId: () => ids.shift()!,
      now: () => 12_345,
    });

    db.createStrict('orders', { id: 'one', status: 'new', amount: 4 });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      deliveryId: 'delivery-one',
      automationFingerprint: registry.fingerprint,
      availableAt: 12_345,
      invocation: {
        invocationId: 'invocation-one',
        functionIdentity: notify.identity,
        triggerIdentity: trigger.identity,
        table: 'orders',
        operation: 'insert',
      },
      input: {
        change: {
          sequence: 1,
          table: 'orders',
          operation: 'insert',
          rowId: 'one',
          row: { id: 'one', status: 'new', amount: 4 },
          previousRow: null,
        },
      },
    });
    expect(Object.isFrozen(captured[0]!.input.change.row)).toBe(true);
    runtime.close();
    db.dispose();
  });

  test('fails closed for missing durable infrastructure and private targets', () => {
    const db = createTables();
    const durable = defineDatabaseFunction({
      name: 'orders.notify',
      version: 1,
      mode: 'durable',
      handler: async () => undefined,
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.inserted',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: durable,
    });
    expect(() => new DatabaseTransactionAutomationRuntime({
      db,
      registry: defineDatabaseAutomations({ functions: [durable], triggers: [trigger] }),
    })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));

    const privateTrigger = defineDatabaseTrigger({
      name: 'private.changed',
      version: 1,
      table: '_private',
      after: { insert: true },
      run: durable,
    });
    expect(() => new DatabaseTransactionAutomationRuntime({
      db,
      registry: defineDatabaseAutomations({
        functions: [durable],
        triggers: [privateTrigger],
      }),
      durableSink: { enqueue: () => undefined },
    })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
    db.dispose();
  });

  test('rejects async transaction handlers and rolls back their source mutation', () => {
    const db = createTables();
    const invalid = defineDatabaseFunction<
      DatabaseTriggerFunctionInput,
      any,
      DatabaseTransactionFunctionCapability
    >({
      name: 'orders.invalid-async',
      version: 1,
      mode: 'transaction',
      handler: (async () => undefined) as never,
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.inserted',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: invalid,
    });
    const runtime = new DatabaseTransactionAutomationRuntime({
      db,
      registry: defineDatabaseAutomations({ functions: [invalid], triggers: [trigger] }),
    });

    expect(() => db.createStrict(
      'orders',
      { id: 'one', status: 'new', amount: 4 },
    )).toThrow(expect.objectContaining({ code: 'DATABASE_EXECUTOR_FAILED' }));
    expect(db.get('orders', 'one')).toBeNull();
    runtime.close();
    db.dispose();
  });

  test('never exposes afterCommit, including inside nested transactions', () => {
    const db = createTables();
    const capabilities: unknown[] = [];
    const inspect = transactionFunction('orders.inspect-capability', (
      _input,
      transaction,
    ) => {
      capabilities.push(transaction);
      expect(Object.getPrototypeOf(transaction)).toBeNull();
      expect('afterCommit' in transaction).toBe(false);
      transaction.transaction((nested) => {
        capabilities.push(nested);
        expect(nested).toBe(transaction);
        expect('afterCommit' in nested).toBe(false);
      });
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.inserted',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: inspect,
    });
    const runtime = new DatabaseTransactionAutomationRuntime({
      db,
      registry: defineDatabaseAutomations({
        functions: [inspect],
        triggers: [trigger],
      }),
    });

    db.createStrict('orders', { id: 'one', status: 'new', amount: 4 });

    expect(capabilities).toHaveLength(2);
    runtime.close();
    expect(() => (
      capabilities[0] as DatabaseTransactionFunctionCapability
    ).query('orders')).toThrow(expect.objectContaining({ code: 'DATABASE_CLOSED' }));
    db.dispose();
  });

  test('enforces cascade budgets inside the root transaction', () => {
    const db = createTables();
    const loop = transactionFunction('rollups.loop', (input, transaction) => {
      const count = Number(input.change.row?.count ?? 0);
      transaction.createStrict('rollups', { id: `loop-${count + 1}`, count: count + 1 });
    });
    const trigger = defineDatabaseTrigger({
      name: 'rollups.inserted',
      version: 1,
      table: 'rollups',
      after: { insert: true },
      run: loop,
    });
    const runtime = new DatabaseTransactionAutomationRuntime({
      db,
      registry: defineDatabaseAutomations({ functions: [loop], triggers: [trigger] }),
      limits: { maxCascadeDepth: 2, maxChanges: 20, maxFunctions: 20 },
    });

    expect(() => db.createStrict(
      'rollups',
      { id: 'loop-0', count: 0 },
    )).toThrow(expect.objectContaining({
      code: 'DATABASE_PAYLOAD_LIMIT',
      outcome: 'not-committed',
    }));
    expect(db.query('rollups')).toEqual([]);
    expect(db.currentSeq).toBe(0);
    runtime.close();
    db.dispose();
  });
});
