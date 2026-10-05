/** Uses fresh Bun in-memory databases only; never opens application/runtime data. */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { TransactionManager } from './transaction-manager';
import { OBS_CODES } from '../observability/codes';
import type { PlatformEvent, PlatformObservabilityRuntime } from '../observability/types';

function fixture() {
  const db = new Database(':memory:');
  db.run('CREATE TABLE items (id TEXT PRIMARY KEY)');
  return { db, manager: new TransactionManager(db) };
}

describe('SQLite transaction manager boundaries', () => {
  test('rejects thenable results and rolls back their synchronous writes', () => {
    const { db, manager } = fixture();
    try {
      // @ts-expect-error Promise-returning callbacks are not a runSync contract.
      expect(() => manager.runSync(() => {
        db.run("INSERT INTO items VALUES ('discarded')");
        return Promise.resolve('not-synchronous');
      })).toThrow('synchronous');
      expect(db.query('SELECT * FROM items').all()).toEqual([]);
      expect(manager.runSync(() => 'later')).toBe('later');
    } finally { db.close(); }
  });

  test('a failed begin does not leave future calls at a false nested depth', () => {
    const { db, manager } = fixture();
    try {
      db.run('BEGIN IMMEDIATE');
      expect(() => manager.runSync(() => 'invalid-nested-root')).toThrow();
      db.run('ROLLBACK');
      const run = db.run.bind(db);
      const statements: string[] = [];
      db.run = (sql, ...params) => { statements.push(sql); return run(sql, ...params); };
      expect(manager.runSync(() => 'later', 'EXCLUSIVE')).toBe('later');
      expect(statements[0]).toBe('BEGIN EXCLUSIVE');
    } finally { db.close(); }
  });

  test('nested callback failure rolls back the savepoint while the caller may continue', () => {
    const { db, manager } = fixture();
    try {
      manager.runSync(() => {
        db.run("INSERT INTO items VALUES ('retained')");
        expect(() => manager.runSync(() => {
          db.run("INSERT INTO items VALUES ('discarded')");
          throw new Error('nested failure');
        })).toThrow('nested failure');
      });
      expect(db.query('SELECT id FROM items').all()).toEqual([{ id: 'retained' }]);
    } finally { db.close(); }
  });

  test('preserves callback failure when rollback also fails', () => {
    const original = new Error('synthetic domain failure');
    const cleanup = new Error('synthetic rollback failure');
    const sql = { run(statement: string) { if (statement === 'ROLLBACK') throw cleanup; } };
    const manager = new TransactionManager(sql as unknown as Database, { emitTelemetry: false });
    let failure: unknown;
    try { manager.runSync(() => { throw original; }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([original, cleanup]);
  });

  test('reports exceptional rollback through the app sink without SQL or error contents', () => {
    const events: PlatformEvent[] = [];
    const runtime: PlatformObservabilityRuntime = {
      config: {}, store: null, sink: { emit(event) { events.push(event); throw new Error('sink failure'); } },
    };
    const original = new Error('synthetic-private-domain-detail');
    const cleanup = new Error('synthetic-private-database-detail');
    const sql = { run(statement: string) { if (statement === 'ROLLBACK') throw cleanup; } };
    const manager = new TransactionManager(sql as unknown as Database, { observability: runtime });
    let failure: unknown;
    try { manager.runSync(() => { throw original; }); }
    catch (error) { failure = error; }
    expect((failure as AggregateError).errors).toEqual([original, cleanup]);
    expect(events).toHaveLength(1);
    expect(events[0]?.code).toBe(OBS_CODES.PERSISTENCE_SQL_TRANSACTION_ROLLBACK_FAILED.code);
    expect(events[0]?.error).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain('synthetic-private');
    expect(events[0]?.metadata).toBeUndefined();
  });
});
