import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createReactiveDB,
  registerReactiveDBCommitGuard,
  type ReactiveDB,
} from './reactive-db';
import {
  registerReactiveDBMutationInterceptor,
  type ReactiveDBMutationChange,
} from './reactive-db-mutation-interceptor';
import {
  assertReactiveDBTransactionTokenActive,
  type ReactiveDBTransactionToken,
} from './reactive-db-transaction-token';

describe('ReactiveDB mutation interceptor', () => {
  let db: ReactiveDB;

  beforeEach(() => {
    db = createReactiveDB({ mode: 'memory' });
    db.defineTable('items', {
      id: 'text primary key',
      label: 'text not null',
      count: 'integer not null default 0',
    });
    db.defineTable('rollups', {
      id: 'text primary key',
      count: 'integer not null default 0',
    });
  });

  afterEach(() => {
    db.dispose();
  });

  test('runs after durable recording and before commit or listener delivery', () => {
    const order: string[] = [];
    registerReactiveDBCommitGuard(db, {
      capture() {
        order.push('guard:capture');
        return undefined;
      },
      beforeCommit() {
        order.push('guard:commit');
        return undefined;
      },
    });
    db.onChange(() => order.push('listener'));
    registerReactiveDBMutationInterceptor(db, ({ change }) => {
      const recorded = db.prepare(
        'SELECT tbl, row_id FROM _changes WHERE seq = ?',
      ).get(change.seq) as { tbl: string; row_id: string } | null;
      expect(recorded).toEqual({ tbl: 'items', row_id: 'source' });
      expect(order).toEqual(['guard:capture']);
      order.push('interceptor');
    });

    db.insert('items', { id: 'source', label: 'Source' });

    expect(order).toEqual([
      'guard:capture',
      'interceptor',
      'guard:commit',
      'listener',
    ]);
  });

  test('delivers a canonical detached and deeply read-only change', () => {
    const observed: ReactiveDBMutationChange[] = [];
    registerReactiveDBMutationInterceptor(db, ({ change }) => {
      observed.push(change);
      expect(Object.isFrozen(change)).toBe(true);
      expect(Object.isFrozen(change.row)).toBe(true);
      expect(() => {
        (change.row as Record<string, unknown>).label = 'mutated';
      }).toThrow();
    });

    const returned = db.insert('items', {
      id: 'immutable',
      label: 'Canonical',
      count: 1,
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]).not.toBe(returned);
    expect(observed[0]!.row).not.toBe(returned.row);
    expect(returned.row).toEqual({
      id: 'immutable',
      label: 'Canonical',
      count: 1,
    });
    expect(db.get('items', 'immutable')).toEqual(returned.row);
  });

  test('propagates failure and rollback-only state through the root transaction', () => {
    const delivered: string[] = [];
    db.onChange((change) => delivered.push(change.rowId));
    registerReactiveDBMutationInterceptor(db, () => {
      throw new Error('interceptor rejected mutation');
    });

    expect(() => db.transaction(() => {
      try {
        db.insert('items', { id: 'rejected', label: 'Rejected' });
      } catch {
        // Swallowing the immediate error must not permit the root commit.
      }
    })).toThrow('transaction is rollback-only');

    expect(db.get('items', 'rejected')).toBeNull();
    expect(db.currentSeq).toBe(0);
    expect(delivered).toEqual([]);
  });

  test('preserves source order for nested and cascaded writes', () => {
    const intercepted: string[] = [];
    const delivered: string[] = [];
    const tokens: ReactiveDBTransactionToken[] = [];
    db.onChange((change) => delivered.push(`${change.table}:${change.rowId}`));
    registerReactiveDBMutationInterceptor(db, ({ change, transactionToken }) => {
      intercepted.push(`${change.table}:${change.rowId}`);
      tokens.push(transactionToken);
      if (change.table === 'items') {
        db.transaction(() => {
          db.insert('rollups', { id: change.rowId, count: 1 });
        });
      }
    });

    db.transaction(() => {
      db.insert('items', { id: 'first', label: 'First' });
      db.transaction(() => {
        db.insert('items', { id: 'second', label: 'Second' });
      });
    });

    const expected = [
      'items:first',
      'rollups:first',
      'items:second',
      'rollups:second',
    ];
    expect(intercepted).toEqual(expected);
    expect(delivered).toEqual(expected);
    expect(db.getChangesAfter(0)?.map(
      (change) => `${change.table}:${change.rowId}`,
    )).toEqual(expected);
    expect(tokens.every((token) => token === tokens[0])).toBe(true);
  });

  test('rejects asynchronous interceptors and poisons their continuation', async () => {
    let continuation!: Promise<void>;
    registerReactiveDBMutationInterceptor(db, () => {
      continuation = (async () => {
        await Promise.resolve();
        db.insert('items', { id: 'late', label: 'Late' });
      })();
      return continuation;
    });

    expect(() => db.insert('items', {
      id: 'source',
      label: 'Source',
    })).toThrow('mutation interceptors must be synchronous');

    await expect(continuation).rejects.toThrow('transaction is rollback-only');
    expect(db.query('items')).toEqual([]);
    expect(db.currentSeq).toBe(0);
  });

  test('scopes one active token to each root transaction and database', () => {
    const firstRoot: ReactiveDBTransactionToken[] = [];
    const secondRoot: ReactiveDBTransactionToken[] = [];
    let current = firstRoot;
    registerReactiveDBMutationInterceptor(db, ({ transactionToken }) => {
      expect(() => assertReactiveDBTransactionTokenActive(transactionToken)).not.toThrow();
      current.push(transactionToken);
    });

    db.transaction(() => {
      db.insert('items', { id: 'one', label: 'One' });
      db.transaction(() => db.insert('items', { id: 'two', label: 'Two' }));
    });
    current = secondRoot;
    db.insert('items', { id: 'three', label: 'Three' });

    const other = createReactiveDB({ mode: 'memory' });
    let otherToken: ReactiveDBTransactionToken | null = null;
    try {
      other.defineTable('items', { id: 'text primary key' });
      registerReactiveDBMutationInterceptor(other, ({ transactionToken }) => {
        otherToken = transactionToken;
      });
      other.insert('items', { id: 'other' });
    } finally {
      other.dispose();
    }

    expect(firstRoot).toHaveLength(2);
    expect(firstRoot[0]).toBe(firstRoot[1]);
    expect(secondRoot).toHaveLength(1);
    expect(secondRoot[0]).not.toBe(firstRoot[0]);
    expect(otherToken).not.toBe(firstRoot[0]);
    expect(otherToken).not.toBe(secondRoot[0]);
    expect(() => assertReactiveDBTransactionTokenActive(firstRoot[0]!)).toThrow(
      'transaction token is no longer active',
    );
    expect(() => assertReactiveDBTransactionTokenActive(secondRoot[0]!)).toThrow(
      'transaction token is no longer active',
    );
    expect(() => assertReactiveDBTransactionTokenActive(otherToken!)).toThrow(
      'transaction token is no longer active',
    );
  });

  test('uses one identity-safe registration and clears it on disposal', () => {
    const calls: string[] = [];
    const removeFirst = registerReactiveDBMutationInterceptor(
      db,
      ({ change }) => calls.push(`first:${change.rowId}`),
    );
    expect(() => registerReactiveDBMutationInterceptor(db, () => {})).toThrow(
      'already has a mutation interceptor',
    );

    removeFirst();
    const removeSecond = registerReactiveDBMutationInterceptor(
      db,
      ({ change }) => calls.push(`second:${change.rowId}`),
    );
    removeFirst();
    db.insert('items', { id: 'registered', label: 'Registered' });
    expect(calls).toEqual(['second:registered']);

    db.dispose();
    removeSecond();
    expect(() => registerReactiveDBMutationInterceptor(db, () => {})).toThrow(
      'target is not active',
    );
  });

  test('does not impose automation table-selection policy', () => {
    db.exec('CREATE TABLE _internal_events (id TEXT PRIMARY KEY)');
    const tables: string[] = [];
    registerReactiveDBMutationInterceptor(db, ({ change }) => {
      tables.push(change.table);
    });

    db.transaction(() => {
      db.prepare('INSERT INTO _internal_events (id) VALUES (?)').run('internal');
      db.recordInternalChange({
        table: '_internal_events',
        op: 'INSERT',
        rowId: 'internal',
        row: { id: 'internal' },
      });
    });

    expect(tables).toEqual(['_internal_events']);
  });
});
