import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatformSQLiteService } from '../persistence';
import { createReactiveDB, ReactiveDB } from './reactive-db';
import type { Change } from './types';

let db: ReactiveDB;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  db.defineTable('todos', {
    id: 'text primary key',
    title: 'text not null',
    done: 'integer default 0',
  });
});

afterEach(() => {
  db.dispose();
});

function defineMembershipTable(): void {
  db.defineTable('memberships', {
    membership_id: 'text primary key',
    team_id: 'text not null',
    user_id: 'text not null',
    role: 'text',
    _identity: ['team_id', 'user_id'],
  });
}

// ─── defineTable ──────────────────────────────────────────────────────────

describe('defineTable', () => {
  test('creates table and prepared statements', () => {
    expect(db.hasTable('todos')).toBe(true);
    expect(db.getTableNames()).toContain('todos');
  });

  test('is idempotent — calling twice does not throw', () => {
    expect(() => {
      db.defineTable('todos', {
        id: 'text primary key',
        title: 'text not null',
        done: 'integer default 0',
      });
    }).not.toThrow();
  });

  test('throws if schema has no columns', () => {
    expect(() => db.defineTable('empty', {})).toThrow('at least one column');
  });

  test('throws if schema has no primary key', () => {
    expect(() =>
      db.defineTable('bad', { name: 'text not null', age: 'integer' })
    ).toThrow('primary key');
  });

  test('allows _ prefix tables', () => {
    expect(() => {
      db.defineTable('_internal', {
        key: 'text primary key',
        value: 'text',
      });
    }).not.toThrow();
    expect(db.hasTable('_internal')).toBe(true);
  });

  test('supports multiple tables', () => {
    db.defineTable('users', {
      id: 'text primary key',
      name: 'text not null',
      email: 'text',
    });
    expect(db.hasTable('todos')).toBe(true);
    expect(db.hasTable('users')).toBe(true);
    expect(db.getTableNames()).toEqual(expect.arrayContaining(['todos', 'users']));
  });

  test('rejects invalid natural identity declarations', () => {
    expect(() => {
      db.defineTable('bad_identity_pk', {
        id: 'text primary key',
        team_id: 'text',
        _identity: ['id'],
      });
    }).toThrow("identity field 'id' cannot be the primary key");

    expect(() => {
      db.defineTable('bad_identity_column', {
        id: 'text primary key',
        team_id: 'text',
        _identity: ['missing'],
      });
    }).toThrow("identity field 'missing' is not a table column");
  });
});

// ─── Natural Identity ─────────────────────────────────────────────────────

describe('natural identity', () => {
  test('generates deterministic primary keys for inserts missing the sync id', () => {
    defineMembershipTable();

    const change = db.insert('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });
    const id = db.identityKey('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    });

    expect(change.rowId).toBe(id);
    expect(change.row).toEqual({
      membership_id: id,
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });
    expect(db.queryByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    })).toEqual(change.row);
  });

  test('enforces unique natural identity values', () => {
    defineMembershipTable();
    db.insert('memberships', {
      membership_id: 'custom-1',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    });

    expect(() => db.insert('memberships', {
      membership_id: 'custom-2',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    })).toThrow();
  });

  test('upserts by natural identity while preserving an existing sync id', () => {
    defineMembershipTable();
    db.insert('memberships', {
      membership_id: 'legacy-id',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    });

    const change = db.upsertByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });

    expect(change.op).toBe('UPDATE');
    expect(change.rowId).toBe('legacy-id');
    expect(change.row).toEqual({
      membership_id: 'legacy-id',
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'admin',
    });
  });

  test('updates and deletes by natural identity', () => {
    defineMembershipTable();
    db.insert('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    });

    const update = db.updateByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    }, {
      role: 'owner',
    });
    expect(update?.row?.role).toBe('owner');

    const deletion = db.deleteByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    });
    expect(deletion?.op).toBe('DELETE');
    expect(db.queryByIdentity('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
    })).toBeNull();
  });

  test('rejects identity field changes through update paths', () => {
    defineMembershipTable();
    const change = db.insert('memberships', {
      team_id: 'team-1',
      user_id: 'user-1',
      role: 'member',
    });

    expect(() => db.update('memberships', change.rowId, {
      user_id: 'user-2',
    })).toThrow("identity field 'user_id' is immutable");

    expect(() => db.insert('memberships', {
      membership_id: change.rowId,
      team_id: 'team-2',
      user_id: 'user-1',
      role: 'member',
    })).toThrow("identity field 'team_id' is immutable");
  });
});

// ─── insert ───────────────────────────────────────────────────────────────

describe('insert', () => {
  test('inserts a new row and returns Change with op INSERT', () => {
    const change = db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });

    expect(change.table).toBe('todos');
    expect(change.op).toBe('INSERT');
    expect(change.rowId).toBe('1');
    expect(change.row).toEqual({ id: '1', title: 'Buy milk', done: 0 });
    expect(change.seq).toBe(1);
    expect(change.ts).toBeGreaterThan(0);
  });

  test('row is readable after insert', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    const row = db.queryOne('todos', '1');
    expect(row).toEqual({ id: '1', title: 'Buy milk', done: 0 });
  });

  test('INSERT OR REPLACE on duplicate PK emits op UPDATE', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    const change = db.insert('todos', { id: '1', title: 'Buy oats', done: 0 });

    expect(change.op).toBe('UPDATE');
    expect(change.row).toEqual({ id: '1', title: 'Buy oats', done: 0 });
  });

  test('increments seq monotonically', () => {
    const c1 = db.insert('todos', { id: '1', title: 'First', done: 0 });
    const c2 = db.insert('todos', { id: '2', title: 'Second', done: 0 });
    const c3 = db.insert('todos', { id: '3', title: 'Third', done: 0 });

    expect(c1.seq).toBe(1);
    expect(c2.seq).toBe(2);
    expect(c3.seq).toBe(3);
    expect(db.currentSeq).toBe(3);
  });

  test('applies SQLite defaults for missing columns', () => {
    const change = db.insert('todos', { id: '1', title: 'Test' });
    expect(change.row!.done).toBe(0);
  });

  test('throws on undefined table', () => {
    expect(() => db.insert('nonexistent', { id: '1' })).toThrow('not defined');
  });

  test('canonical create/get/list aliases preserve insert and query semantics', () => {
    const change = db.create('todos', { id: '1', title: 'Alias', done: 0 });

    expect(change.op).toBe('INSERT');
    expect(db.get('todos', '1')).toEqual({ id: '1', title: 'Alias', done: 0 });
    expect(db.list('todos')).toEqual([{ id: '1', title: 'Alias', done: 0 }]);
  });
});

// ─── update ───────────────────────────────────────────────────────────────

describe('update', () => {
  test('merges partial data into existing row', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    const change = db.update('todos', '1', { done: 1 });

    expect(change).not.toBeNull();
    expect(change!.op).toBe('UPDATE');
    expect(change!.row).toEqual({ id: '1', title: 'Buy milk', done: 1 });
  });

  test('returns null for non-existent row', () => {
    const change = db.update('todos', 'nonexistent', { done: 1 });
    expect(change).toBeNull();
  });

  test('preserves unchanged fields', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    db.update('todos', '1', { title: 'Buy oats' });

    const row = db.queryOne('todos', '1');
    expect(row).toEqual({ id: '1', title: 'Buy oats', done: 0 });
  });

  test('does not change primary key even if provided in partial', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    db.update('todos', '1', { id: '999', title: 'Hacked' });

    expect(db.queryOne('todos', '1')).toEqual({ id: '1', title: 'Hacked', done: 0 });
    expect(db.queryOne('todos', '999')).toBeNull();
  });

  test('increments seq and records in ring buffer', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 }); // seq 1
    const change = db.update('todos', '1', { done: 1 }); // seq 2

    expect(change!.seq).toBe(2);
    const changes = db.getChangesAfter(1);
    expect(changes).toHaveLength(1);
    expect(changes![0].op).toBe('UPDATE');
  });
});

// ─── delete ───────────────────────────────────────────────────────────────

describe('delete', () => {
  test('removes existing row and returns Change with op DELETE', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    const change = db.delete('todos', '1');

    expect(change).not.toBeNull();
    expect(change!.op).toBe('DELETE');
    expect(change!.rowId).toBe('1');
    expect(change!.row).toBeNull();
  });

  test('row is gone after delete', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    db.delete('todos', '1');

    expect(db.queryOne('todos', '1')).toBeNull();
  });

  test('returns null for non-existent row', () => {
    const change = db.delete('todos', 'nonexistent');
    expect(change).toBeNull();
  });
});

// ─── query / queryOne ─────────────────────────────────────────────────────

describe('query', () => {
  test('returns empty array for empty table', () => {
    expect(db.query('todos')).toEqual([]);
  });

  test('returns all rows', () => {
    db.insert('todos', { id: '1', title: 'First', done: 0 });
    db.insert('todos', { id: '2', title: 'Second', done: 1 });

    const rows = db.query('todos');
    expect(rows).toHaveLength(2);
  });

  test('queryOne returns null for missing row', () => {
    expect(db.queryOne('todos', 'missing')).toBeNull();
  });

  test('queryOne returns the row object', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    expect(db.queryOne('todos', '1')).toEqual({ id: '1', title: 'Buy milk', done: 0 });
  });
});

// ─── onChange ─────────────────────────────────────────────────────────────

describe('onChange', () => {
  test('listener fires on insert', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.insert('todos', { id: '1', title: 'Test', done: 0 });

    expect(changes).toHaveLength(1);
    expect(changes[0].op).toBe('INSERT');
    expect(changes[0].table).toBe('todos');
  });

  test('listener fires on update', () => {
    db.insert('todos', { id: '1', title: 'Test', done: 0 });

    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.update('todos', '1', { done: 1 });

    expect(changes).toHaveLength(1);
    expect(changes[0].op).toBe('UPDATE');
  });

  test('listener fires on delete', () => {
    db.insert('todos', { id: '1', title: 'Test', done: 0 });

    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.delete('todos', '1');

    expect(changes).toHaveLength(1);
    expect(changes[0].op).toBe('DELETE');
  });

  test('does NOT fire for no-op update (nonexistent row)', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.update('todos', 'missing', { done: 1 });

    expect(changes).toHaveLength(0);
  });

  test('does NOT fire for no-op delete (nonexistent row)', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.delete('todos', 'missing');

    expect(changes).toHaveLength(0);
  });

  test('multiple listeners all fire in order', () => {
    const order: number[] = [];
    db.onChange(() => order.push(1));
    db.onChange(() => order.push(2));
    db.onChange(() => order.push(3));

    db.insert('todos', { id: '1', title: 'Test', done: 0 });

    expect(order).toEqual([1, 2, 3]);
  });

  test('unsubscribe stops listener from firing', () => {
    const changes: Change[] = [];
    const unsub = db.onChange((c) => changes.push(c));

    db.insert('todos', { id: '1', title: 'Test', done: 0 });
    expect(changes).toHaveLength(1);

    unsub();
    db.insert('todos', { id: '2', title: 'Test2', done: 0 });
    expect(changes).toHaveLength(1); // Still 1 — listener removed
  });

  test('error in listener does not prevent other listeners', () => {
    const changes: Change[] = [];
    db.onChange(() => {
      throw new Error('broken listener');
    });
    db.onChange((c) => changes.push(c));

    // Should not throw, and second listener should still fire
    db.insert('todos', { id: '1', title: 'Test', done: 0 });
    expect(changes).toHaveLength(1);
  });

  test('error in listener does not roll back the write', () => {
    db.onChange(() => {
      throw new Error('broken listener');
    });

    db.insert('todos', { id: '1', title: 'Test', done: 0 });
    expect(db.queryOne('todos', '1')).toEqual({ id: '1', title: 'Test', done: 0 });
  });
});

// ─── Ring Buffer (_changes) ──────────────────────────────────────────────

describe('ring buffer', () => {
  test('getChangesAfter returns changes after given seq', () => {
    db.insert('todos', { id: '1', title: 'First', done: 0 });
    db.insert('todos', { id: '2', title: 'Second', done: 0 });
    db.insert('todos', { id: '3', title: 'Third', done: 0 });

    const changes = db.getChangesAfter(1);
    expect(changes).toHaveLength(2);
    expect(changes![0].seq).toBe(2);
    expect(changes![1].seq).toBe(3);
  });

  test('getChangesAfter(0) returns all changes', () => {
    db.insert('todos', { id: '1', title: 'First', done: 0 });
    db.insert('todos', { id: '2', title: 'Second', done: 0 });

    const changes = db.getChangesAfter(0);
    expect(changes).toHaveLength(2);
  });

  test('getChangesAfter returns empty array when up to date', () => {
    db.insert('todos', { id: '1', title: 'First', done: 0 });

    const changes = db.getChangesAfter(1);
    expect(changes).toEqual([]);
  });

  test('getChangesAfter returns empty array for empty buffer', () => {
    const changes = db.getChangesAfter(0);
    expect(changes).toEqual([]);
  });

  test('ring buffer prunes old entries', () => {
    const smallDb = createReactiveDB({ mode: 'memory', ringBufferDepth: 5 });
    smallDb.defineTable('t', { id: 'text primary key', val: 'text' });

    // Insert 10 entries — should prune first 5
    for (let i = 1; i <= 10; i++) {
      smallDb.insert('t', { id: String(i), val: `v${i}` });
    }

    // seq 1-5 should be pruned, seq 6-10 should remain
    const changes = smallDb.getChangesAfter(5);
    expect(changes).toHaveLength(5);
    expect(changes![0].seq).toBe(6);
    expect(changes![4].seq).toBe(10);

    // seq 4 is pruned — should return null
    const pruned = smallDb.getChangesAfter(4);
    expect(pruned).toBeNull();

    smallDb.dispose();
  });

  test('changes include correct data for INSERT/UPDATE/DELETE', () => {
    db.insert('todos', { id: '1', title: 'Buy milk', done: 0 });
    db.update('todos', '1', { done: 1 });
    db.delete('todos', '1');

    const changes = db.getChangesAfter(0);
    expect(changes).toHaveLength(3);

    // INSERT
    expect(changes![0].op).toBe('INSERT');
    expect(changes![0].row).toEqual({ id: '1', title: 'Buy milk', done: 0 });

    // UPDATE
    expect(changes![1].op).toBe('UPDATE');
    expect(changes![1].row).toEqual({ id: '1', title: 'Buy milk', done: 1 });

    // DELETE
    expect(changes![2].op).toBe('DELETE');
    expect(changes![2].row).toBeNull();
  });
});

// ─── Transactions ─────────────────────────────────────────────────────────

describe('transactions', () => {
  test('all writes in a transaction are atomic', () => {
    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.insert('todos', { id: '2', title: 'Second', done: 0 });
    });

    expect(db.query('todos')).toHaveLength(2);
  });

  test('failed transaction rolls back all writes', () => {
    try {
      db.transaction(() => {
        db.insert('todos', { id: '1', title: 'First', done: 0 });
        throw new Error('abort!');
      });
    } catch {
      // Expected
    }

    expect(db.query('todos')).toHaveLength(0);
  });

  test('change listeners are deferred until commit', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      // Mid-transaction: listener should NOT have fired yet
      expect(changes).toHaveLength(0);

      db.insert('todos', { id: '2', title: 'Second', done: 0 });
      expect(changes).toHaveLength(0);
    });

    // After commit: all changes emitted
    expect(changes).toHaveLength(2);
    expect(changes[0].rowId).toBe('1');
    expect(changes[1].rowId).toBe('2');
  });

  test('queues reentrant listener writes behind the complete committed batch', () => {
    const firstListener: number[] = [];
    const secondListener: number[] = [];

    db.onChange((change) => {
      firstListener.push(change.seq);
      if (change.rowId === '1') {
        db.insert('todos', { id: '3', title: 'Reentrant', done: 0 });
      }
    });
    db.onChange((change) => secondListener.push(change.seq));

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.insert('todos', { id: '2', title: 'Second', done: 0 });
    });

    expect(firstListener).toEqual([1, 2, 3]);
    expect(secondListener).toEqual([1, 2, 3]);
    expect(db.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1, 2, 3]);
  });

  test('failed transaction does not emit changes', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    try {
      db.transaction(() => {
        db.insert('todos', { id: '1', title: 'First', done: 0 });
        throw new Error('abort!');
      });
    } catch {
      // Expected
    }

    expect(changes).toHaveLength(0);
  });

  test('seq is rolled back on failed transaction', () => {
    const initialSeq = db.currentSeq;

    try {
      db.transaction(() => {
        db.insert('todos', { id: '1', title: 'First', done: 0 });
        db.insert('todos', { id: '2', title: 'Second', done: 0 });
        throw new Error('abort!');
      });
    } catch {
      // Expected
    }

    expect(db.currentSeq).toBe(initialSeq);
  });

  test('rolls back domain writes when durable change allocation fails', () => {
    db.insert('todos', { id: 'seed', title: 'Seed', done: 0 });
    const raw = db.getRawDatabase();
    const exhaustSequence = () => raw.prepare(
      'UPDATE _change_sequence SET seq = ? WHERE singleton = 1',
    ).run(Number.MAX_SAFE_INTEGER);
    const restoreSequence = () => raw.prepare(
      'UPDATE _change_sequence SET seq = 1 WHERE singleton = 1',
    ).run();

    exhaustSequence();
    expect(() => db.insert('todos', { id: 'inserted', title: 'No', done: 0 }))
      .toThrow('durable change sequence');
    expect(db.queryOne('todos', 'inserted')).toBeNull();

    restoreSequence();
    exhaustSequence();
    expect(() => db.update('todos', 'seed', { title: 'Changed' }))
      .toThrow('durable change sequence');
    expect(db.queryOne('todos', 'seed')?.title).toBe('Seed');

    restoreSequence();
    exhaustSequence();
    expect(() => db.delete('todos', 'seed')).toThrow('durable change sequence');
    expect(db.queryOne('todos', 'seed')?.title).toBe('Seed');
  });

  test('keeps a transaction rollback-only when a tracked-write error is caught', () => {
    db.getRawDatabase().prepare(
      'UPDATE _change_sequence SET seq = ? WHERE singleton = 1',
    ).run(Number.MAX_SAFE_INTEGER);

    expect(() => db.transaction(() => {
      try {
        db.insert('todos', { id: 'caught', title: 'Must roll back', done: 0 });
      } catch {
        // An application catch cannot commit the untracked domain write.
      }
    })).toThrow('rollback-only');
    expect(db.queryOne('todos', 'caught')).toBeNull();
  });

  test('rejects async transactions and poisons their awaited continuation', async () => {
    let continuation!: Promise<void>;
    expect(() => db.transaction(() => {
      db.insert('todos', { id: 'before-await', title: 'Rollback', done: 0 });
      continuation = (async () => {
        await Promise.resolve();
        db.insert('todos', { id: 'after-await', title: 'Never commit', done: 0 });
      })();
      return continuation;
    })).toThrow('must be synchronous');

    await expect(continuation).rejects.toThrow('rollback-only');
    expect(db.queryOne('todos', 'before-await')).toBeNull();
    expect(db.queryOne('todos', 'after-await')).toBeNull();
  });

  test('transaction returns the function result', () => {
    const result = db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      return 42;
    });

    expect(result).toBe(42);
  });

  test('nested transactions work (inner runs in outer context)', () => {
    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.transaction(() => {
        db.insert('todos', { id: '2', title: 'Second', done: 0 });
      });
    });

    // Both writes committed, changes emitted after outer transaction
    expect(db.query('todos')).toHaveLength(2);
    expect(changes).toHaveLength(2);
  });

  test('changes are recorded in ring buffer during transaction', () => {
    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'First', done: 0 });
      db.insert('todos', { id: '2', title: 'Second', done: 0 });
    });

    const changes = db.getChangesAfter(0);
    expect(changes).toHaveLength(2);
    expect(changes![0].rowId).toBe('1');
    expect(changes![1].rowId).toBe('2');
  });

  test('runs afterCommit callbacks after change delivery in registration order', () => {
    const order: string[] = [];
    db.onChange(() => order.push('change'));

    db.transaction(() => {
      db.insert('todos', { id: '1', title: 'Committed', done: 0 });
      db.afterCommit(() => order.push('first'));
      db.transaction(() => db.afterCommit(() => order.push('nested')));
    });

    expect(order).toEqual(['change', 'first', 'nested']);
  });

  test('discards afterCommit callbacks on rollback and requires a transaction', () => {
    const callbacks: string[] = [];
    expect(() => db.afterCommit(() => undefined)).toThrow('active transaction');

    expect(() => db.transaction(() => {
      db.afterCommit(() => callbacks.push('unexpected'));
      throw new Error('rollback');
    })).toThrow('rollback');

    expect(callbacks).toEqual([]);
  });

  test('contains an afterCommit failure and continues later callbacks', () => {
    const callbacks: string[] = [];
    expect(() => db.transaction(() => {
      db.afterCommit(() => { throw new Error('notification failed'); });
      db.afterCommit(() => callbacks.push('continued'));
    })).not.toThrow();
    expect(callbacks).toEqual(['continued']);
  });
});

// ─── dispose ──────────────────────────────────────────────────────────────

describe('dispose', () => {
  test('throws on any operation after dispose', () => {
    db.dispose();

    expect(() => db.insert('todos', { id: '1', title: 'Test', done: 0 })).toThrow('disposed');
    expect(() => db.update('todos', '1', { done: 1 })).toThrow('disposed');
    expect(() => db.delete('todos', '1')).toThrow('disposed');
    expect(() => db.query('todos')).toThrow('disposed');
    expect(() => db.queryOne('todos', '1')).toThrow('disposed');
    expect(() => db.getChangesAfter(0)).toThrow('disposed');
    expect(() => db.onChange(() => {})).toThrow('disposed');
    expect(() =>
      db.defineTable('x', { id: 'text primary key' })
    ).toThrow('disposed');
  });

  test('dispose is idempotent', () => {
    db.dispose();
    expect(() => db.dispose()).not.toThrow();
  });
});

// ─── exec / prepare (raw access) ─────────────────────────────────────────

describe('raw access', () => {
  test('exec creates internal tables', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _credentials (
        user_id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL
      )
    `);

    // Should be queryable via prepare
    const stmt = db.prepare('SELECT * FROM _credentials');
    expect(stmt.all()).toEqual([]);
  });

  test('prepare returns usable statement', () => {
    db.exec('CREATE TABLE IF NOT EXISTS _kv (key TEXT PRIMARY KEY, value TEXT)');
    const insert = db.prepare('INSERT INTO _kv (key, value) VALUES (?, ?)');
    const get = db.prepare('SELECT value FROM _kv WHERE key = ?');

    insert.run('theme', 'dark');
    const result = get.get('theme') as { value: string };
    expect(result.value).toBe('dark');
  });
});

// ─── Multi-table ──────────────────────────────────────────────────────────

describe('multi-table', () => {
  test('changes from different tables have independent tracking', () => {
    db.defineTable('users', {
      id: 'text primary key',
      name: 'text not null',
    });

    const changes: Change[] = [];
    db.onChange((c) => changes.push(c));

    db.insert('todos', { id: '1', title: 'Todo 1', done: 0 });
    db.insert('users', { id: 'u1', name: 'Alice' });

    expect(changes).toHaveLength(2);
    expect(changes[0].table).toBe('todos');
    expect(changes[1].table).toBe('users');

    // Seq is global across tables
    expect(changes[0].seq).toBe(1);
    expect(changes[1].seq).toBe(2);
  });

  test('query only returns rows from specified table', () => {
    db.defineTable('users', {
      id: 'text primary key',
      name: 'text not null',
    });

    db.insert('todos', { id: '1', title: 'Todo', done: 0 });
    db.insert('users', { id: 'u1', name: 'Alice' });

    expect(db.query('todos')).toHaveLength(1);
    expect(db.query('users')).toHaveLength(1);
  });
});

// ─── File mode ────────────────────────────────────────────────────────────

describe('file mode', () => {
  test('persists data and continues the durable change sequence on restart', () => {
    const path = `/tmp/test-reactive-db-${Date.now()}.db`;

    // First instance: write some data
    const db1 = createReactiveDB({ mode: path });
    db1.defineTable('items', { id: 'text primary key', name: 'text' });
    const firstEpoch = db1.syncEpoch;
    db1.insert('items', { id: '1', name: 'Widget' });
    expect(db1.getChangesAfter(0)).toHaveLength(1);
    db1.dispose();

    // Second instance: data and reconnect replay state both persist.
    const db2 = createReactiveDB({ mode: path });
    db2.defineTable('items', { id: 'text primary key', name: 'text' });
    expect(db2.syncEpoch).not.toBe(firstEpoch);

    // Data still there
    expect(db2.queryOne('items', '1')).toEqual({ id: '1', name: 'Widget' });

    expect(db2.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1]);
    expect(db2.currentSeq).toBe(1);
    const second = db2.insert('items', { id: '2', name: 'Second' });
    expect(second.seq).toBe(2);

    db2.dispose();

    // Cleanup
    try {
      const fs = require('fs');
      fs.unlinkSync(path);
      fs.unlinkSync(`${path}-wal`);
      fs.unlinkSync(`${path}-shm`);
    } catch {
      // Files may not exist
    }
  });

  test('allocates unique monotonic sequences across independent handles', () => {
    const path = `/tmp/test-reactive-db-multi-handle-${Date.now()}.db`;
    const first = createReactiveDB({ mode: path });
    const second = createReactiveDB({ mode: path });

    try {
      for (const handle of [first, second]) {
        handle.defineTable('items', { id: 'text primary key', name: 'text' });
      }

      const changes = [
        first.insert('items', { id: '1', name: 'first' }),
        second.insert('items', { id: '2', name: 'second' }),
        first.insert('items', { id: '3', name: 'third' }),
        second.insert('items', { id: '4', name: 'fourth' }),
      ];

      expect(changes.map((change) => change.seq)).toEqual([1, 2, 3, 4]);
      expect(first.currentSeq).toBe(4);
      expect(second.currentSeq).toBe(4);
      expect(second.getChangesAfter(0)?.map((change) => change.seq)).toEqual([1, 2, 3, 4]);
    } finally {
      first.dispose();
      second.dispose();
      try {
        const fs = require('fs');
        fs.unlinkSync(path);
        fs.unlinkSync(`${path}-wal`);
        fs.unlinkSync(`${path}-shm`);
      } catch {
        // Files may not exist.
      }
    }
  });

  test('retains the allocator high-water mark after ring pruning', () => {
    const path = `/tmp/test-reactive-db-pruned-sequence-${Date.now()}.db`;
    const first = createReactiveDB({ mode: path, ringBufferDepth: 2 });
    try {
      first.defineTable('items', { id: 'text primary key', name: 'text' });
      for (let index = 1; index <= 5; index += 1) {
        first.insert('items', { id: String(index), name: `item-${index}` });
      }
      expect(first.getChangesAfter(0)?.map((change) => change.seq)).toEqual([4, 5]);
    } finally {
      first.dispose();
    }

    const second = createReactiveDB({ mode: path, ringBufferDepth: 2 });
    try {
      second.defineTable('items', { id: 'text primary key', name: 'text' });
      expect(second.insert('items', { id: '6', name: 'item-6' }).seq).toBe(6);
    } finally {
      second.dispose();
      try {
        const fs = require('fs');
        fs.unlinkSync(path);
        fs.unlinkSync(`${path}-wal`);
        fs.unlinkSync(`${path}-shm`);
      } catch {
        // Files may not exist.
      }
    }
  });

  test('supports an explicit isolated legacy ring reset', () => {
    const path = `/tmp/test-reactive-db-explicit-reset-${Date.now()}.db`;
    const first = createReactiveDB({ mode: path });
    first.defineTable('items', { id: 'text primary key', name: 'text' });
    first.insert('items', { id: '1', name: 'first' });
    first.dispose();

    const second = createReactiveDB({ mode: path, clearChangesOnStart: true });
    try {
      second.defineTable('items', { id: 'text primary key', name: 'text' });
      expect(second.getChangesAfter(0)).toEqual([]);
      expect(second.currentSeq).toBe(0);
      expect(second.insert('items', { id: '2', name: 'second' }).seq).toBe(1);
    } finally {
      second.dispose();
      try {
        const fs = require('fs');
        fs.unlinkSync(path);
        fs.unlinkSync(`${path}-wal`);
        fs.unlinkSync(`${path}-shm`);
      } catch {
        // Files may not exist.
      }
    }
  });
});

// ─── Platform Persistence Foundation ─────────────────────────────────────

describe('platform SQLite integration', () => {
  test('uses an injected platform SQLite service without owning its lifecycle', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const reactive = createReactiveDB({ sqlite });

    reactive.defineTable('items', { id: 'text primary key', name: 'text' });
    reactive.insert('items', { id: '1', name: 'Shared handle' });
    expect(reactive.queryOne('items', '1')).toEqual({ id: '1', name: 'Shared handle' });

    reactive.dispose();

    expect(() => sqlite.raw.prepare('SELECT 1 AS ok').get()).not.toThrow();
    sqlite.close();
  });

  test('does not close an injected raw database by default', () => {
    const raw = new Database(':memory:');
    const reactive = createReactiveDB({ database: raw, clearChangesOnStart: false });

    reactive.defineTable('items', { id: 'text primary key', name: 'text' });
    reactive.insert('items', { id: '1', name: 'Raw handle' });
    reactive.dispose();

    expect(() => raw.prepare('SELECT 1 AS ok').get()).not.toThrow();
    raw.close();
  });

  test('routes owned hot mode through the platform snapshot service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zero-reactive-hot-'));
    const dbPath = join(dir, 'app.db');
    const snapshotPath = join(dir, 'app.snapshot.db');

    try {
      const first = createReactiveDB({
        mode: 'hot',
        path: dbPath,
        snapshotPath,
        snapshotIntervalMs: 60_000,
      });
      first.defineTable('items', { id: 'text primary key', name: 'text' });
      first.insert('items', { id: '1', name: 'Hot row' });
      first.dispose();

      const second = createReactiveDB({
        mode: 'hot',
        path: dbPath,
        snapshotPath,
        snapshotIntervalMs: 60_000,
      });
      second.defineTable('items', { id: 'text primary key', name: 'text' });

      expect(second.queryOne('items', '1')).toEqual({ id: '1', name: 'Hot row' });
      second.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
