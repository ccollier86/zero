import { describe, expect, test } from 'bun:test';

import { AutomationError } from './automation-error';
import { defineDatabaseFunction } from './database-function';
import {
  databaseFunctionReference,
  defineDatabaseTrigger,
} from './database-trigger';
import {
  deriveChangedColumns,
  matchesDatabaseTrigger,
} from './database-trigger-matcher';

describe('database automation definitions', () => {
  test('distinguishes synchronous transaction work from durable host work', () => {
    const transaction = defineDatabaseFunction({
      name: 'orders.rollup',
      version: 2,
      mode: 'transaction',
      handler: () => ({ updated: true }),
    });
    const durable = defineDatabaseFunction({
      name: 'orders.notify',
      version: 1,
      mode: 'durable',
      handler: async () => ({ sent: true }),
    });

    expect(transaction).toMatchObject({
      identity: 'function:orders.rollup@2',
      mode: 'transaction',
    });
    expect(durable).toMatchObject({
      identity: 'function:orders.notify@1',
      mode: 'durable',
    });
    expect(Object.isFrozen(transaction)).toBe(true);
    expect(Object.isFrozen(durable)).toBe(true);
  });

  test('normalizes AFTER events and preserves ordered function execution', () => {
    const rollup = defineDatabaseFunction({
      name: 'orders.rollup', version: 1, mode: 'transaction', handler: () => undefined,
    });
    const trigger = defineDatabaseTrigger({
      name: 'orders.changed',
      version: 3,
      table: 'orders',
      after: {
        insert: true,
        update: { columns: ['status', 'amount'] },
        delete: true,
      },
      run: [
        rollup,
        databaseFunctionReference({ name: 'orders.notify', version: 4 }),
      ],
    });

    expect(trigger.identity).toBe('trigger:orders.changed@3');
    expect(trigger.timing).toBe('after');
    expect(trigger.after).toEqual([
      { operation: 'insert', columns: null },
      { operation: 'update', columns: ['amount', 'status'] },
      { operation: 'delete', columns: null },
    ]);
    expect(trigger.run.map(({ identity }) => identity)).toEqual([
      'function:orders.rollup@1',
      'function:orders.notify@4',
    ]);
  });

  test('rejects malformed definitions before registry construction', () => {
    expect(() => defineDatabaseFunction({
      name: 'Invalid Name',
      version: 1,
      mode: 'transaction',
      handler: () => undefined,
    })).toThrow(AutomationError);
    expect(() => defineDatabaseTrigger({
      name: 'empty.events',
      version: 1,
      table: 'orders',
      after: {},
      run: { name: 'orders.rollup', version: 1 },
    })).toThrow(/enable at least one AFTER event/);
    expect(() => defineDatabaseTrigger({
      name: 'empty.run',
      version: 1,
      table: 'orders',
      after: { insert: true },
      run: [],
    })).toThrow(/at least one function/);
    expect(() => defineDatabaseTrigger({
      name: 'duplicate.columns',
      version: 1,
      table: 'orders',
      after: { update: { columns: ['status', 'status'] } },
      run: { name: 'orders.rollup', version: 1 },
    })).toThrow(/must not contain duplicates/);
  });

  test('matches exact tables and UPDATE-column intersections without side effects', () => {
    const trigger = defineDatabaseTrigger({
      name: 'orders.status',
      version: 1,
      table: 'orders',
      after: { update: { columns: ['status'] } },
      run: { name: 'orders.rollup', version: 1 },
    });

    expect(matchesDatabaseTrigger(trigger, {
      table: 'orders',
      operation: 'update',
      previousRow: { id: 'one', status: 'open', amount: 10 },
      row: { id: 'one', status: 'closed', amount: 10 },
    })).toBe(true);
    expect(matchesDatabaseTrigger(trigger, {
      table: 'orders',
      operation: 'update',
      changedColumns: ['amount'],
    })).toBe(false);
    expect(matchesDatabaseTrigger(trigger, {
      table: 'other',
      operation: 'update',
      changedColumns: ['status'],
    })).toBe(false);
    expect([...deriveChangedColumns(
      { id: 'one', amount: 1, removed: true },
      { id: 'one', amount: 2, added: true },
    )].sort()).toEqual(['added', 'amount', 'removed']);
  });
});

// Compile-time contract: transactional functions cannot quietly become async.
if (false) {
  // @ts-expect-error transaction handlers must complete synchronously
  defineDatabaseFunction({
    name: 'invalid.async-transaction',
    version: 1,
    mode: 'transaction',
    handler: async () => ({ invalid: true }),
  });
}
