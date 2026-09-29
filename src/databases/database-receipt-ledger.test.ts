import { describe, expect, test } from 'bun:test';

import { createPlatformSQLiteService } from '../persistence';
import type { TableSchema } from '../sync/types';
import { DatabaseError } from './database-error';
import {
  DatabaseReceiptLedger,
  type DatabaseReceiptLedgerLimits,
  type DatabaseReceiptLedgerOptions,
} from './database-receipt-ledger';
import { DatabaseRuntime } from './database-runtime';

const tables = {
  todos: {
    id: 'text primary key',
    title: 'text not null',
  },
} satisfies Record<string, TableSchema>;
const realmFingerprint = `sha256:${'a'.repeat(64)}`;
const operationFingerprint = `sha256:${'b'.repeat(64)}`;

function createLedger(
  limits: DatabaseReceiptLedgerLimits,
  finalizeStatement?: DatabaseReceiptLedgerOptions<unknown>['finalizeStatement'],
) {
  const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
  const runtime = DatabaseRuntime.open({
    id: 'receipt-ledger-tests',
    role: 'named',
    sqlite,
    ownsSQLite: true,
    tables,
  });
  const ledger = new DatabaseReceiptLedger<unknown>({
    runtime,
    realmFingerprint,
    limits,
    parseRetainedResult: ({ resultJson }) => JSON.parse(resultJson),
    ...(finalizeStatement ? { finalizeStatement } : {}),
  });
  return {
    runtime,
    ledger,
    close() {
      ledger.close();
      runtime.close();
    },
  };
}

function captureDatabaseError(run: () => unknown): DatabaseError {
  try {
    run();
    throw new Error('Expected a DatabaseError.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
}

describe('DatabaseReceiptLedger bounds', () => {
  test('seals admission and retries only failed statement cleanup', () => {
    const attempts = new Map<object, number>();
    let injectFailure = true;
    const harness = createLedger({
      keyLimit: 10,
      retainedLimit: 10,
      resultByteLimit: 128,
      retainedByteLimit: 512,
    }, (statement) => {
      attempts.set(statement, (attempts.get(statement) ?? 0) + 1);
      if (injectFailure) {
        injectFailure = false;
        throw new Error('injected receipt statement cleanup failure');
      }
      statement.finalize();
    });
    try {
      expect(() => harness.ledger.close()).toThrow(AggregateError);
      expect(captureDatabaseError(() => harness.ledger.retentionCounts()))
        .toMatchObject({ code: 'DATABASE_CLOSED' });

      harness.ledger.close();

      expect([...attempts.values()].filter((count) => count === 2)).toHaveLength(1);
      expect([...attempts.values()].filter((count) => count === 1)).toHaveLength(4);
    } finally {
      harness.close();
    }
  });

  test('compacts oldest results until both retained count and bytes fit', () => {
    const harness = createLedger({
      keyLimit: 10,
      retainedLimit: 10,
      resultByteLimit: 500,
      retainedByteLimit: 600,
    });
    try {
      const first = 'a'.repeat(300);
      const second = 'b'.repeat(300);
      harness.runtime.db.transaction(() => {
        harness.ledger.assertCanInsert();
        harness.runtime.db.createStrict('todos', { id: 'one', title: 'one' });
        expect(harness.ledger.save(
          'receipt:one',
          operationFingerprint,
          first,
          harness.runtime.db.currentSeq,
        )).toBeNull();
      });
      const compaction = harness.runtime.db.transaction(() => {
        harness.ledger.assertCanInsert();
        harness.runtime.db.createStrict('todos', { id: 'two', title: 'two' });
        return harness.ledger.save(
          'receipt:two',
          operationFingerprint,
          second,
          harness.runtime.db.currentSeq,
        );
      });

      expect(compaction).toMatchObject({
        totalKeys: 2,
        retainedResults: 1,
        expiredTombstones: 1,
        retainedResultBytes: 302,
        retainedByteLimit: 600,
        prunedCount: 1,
        prunedResultBytes: 302,
      });
      expect(harness.ledger.lookup('receipt:one', operationFingerprint))
        .toEqual({ status: 'expired' });
      expect(harness.ledger.lookup('receipt:two', operationFingerprint))
        .toEqual({ status: 'retained', result: second });
    } finally {
      harness.close();
    }
  });

  test('rolls back an application mutation when its encoded result is too large', () => {
    const harness = createLedger({
      keyLimit: 10,
      retainedLimit: 10,
      resultByteLimit: 128,
      retainedByteLimit: 512,
    });
    try {
      const error = captureDatabaseError(() => harness.runtime.db.transaction(() => {
        harness.ledger.assertCanInsert();
        harness.runtime.db.createStrict('todos', {
          id: 'rolled-back',
          title: 'must not commit',
        });
        harness.ledger.save(
          'receipt:oversized',
          operationFingerprint,
          'x'.repeat(128),
          harness.runtime.db.currentSeq,
        );
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_RESULT_LIMIT',
        retryable: false,
        outcome: 'not-committed',
      });
      expect(harness.runtime.db.get('todos', 'rolled-back')).toBeNull();
      expect(harness.runtime.db.currentSeq).toBe(0);
      expect(harness.ledger.retentionCounts()).toMatchObject({
        totalKeys: 0,
        retainedResults: 0,
        retainedResultBytes: 0,
      });
    } finally {
      harness.close();
    }
  });

  test('rejects an unseen key before application work but still resolves old keys', () => {
    const harness = createLedger({
      keyLimit: 2,
      retainedLimit: 1,
      resultByteLimit: 1_000,
      retainedByteLimit: 1_000,
    });
    try {
      for (const [key, value] of [['receipt:one', 'one'], ['receipt:two', 'two']]) {
        harness.runtime.db.transaction(() => {
          harness.ledger.assertCanInsert();
          harness.runtime.db.createStrict('todos', { id: value, title: value });
          harness.ledger.save(
            key!,
            operationFingerprint,
            value,
            harness.runtime.db.currentSeq,
          );
        });
      }
      expect(harness.ledger.lookup('receipt:one', operationFingerprint))
        .toEqual({ status: 'expired' });
      expect(harness.ledger.lookup('receipt:two', operationFingerprint))
        .toEqual({ status: 'retained', result: 'two' });

      let applicationRan = false;
      const error = captureDatabaseError(() => harness.runtime.db.transaction(() => {
        harness.ledger.assertCanInsert();
        applicationRan = true;
        harness.runtime.db.createStrict('todos', { id: 'three', title: 'three' });
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_CAPACITY_EXHAUSTED',
        retryable: false,
        outcome: 'not-started',
        details: { capacityType: 'receipts', capacityLimit: 2 },
      });
      expect(applicationRan).toBe(false);
      expect(harness.runtime.db.get('todos', 'three')).toBeNull();
      expect(harness.runtime.db.currentSeq).toBe(2);
    } finally {
      harness.close();
    }
  });
});
