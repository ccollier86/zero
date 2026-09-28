import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPlatformSQLiteService } from '../persistence';
import { DatabaseError } from './database-error';
import { DatabaseReaderRuntime } from './database-reader-runtime';
import { defineDatabaseRealm } from './database-realm';
import { DatabaseRuntime } from './database-runtime';

const realm = defineDatabaseRealm({
  name: 'reader-test',
  version: '1',
  tables: {
    todos: {
      id: 'text primary key',
      title: 'text not null',
    },
  },
  queries: {
    'todos.count': ({ database }) => {
      const row = database.query('SELECT count(*) AS count FROM todos').get() as {
        count: number;
      };
      return { count: row.count };
    },
    'todos.tryWrite': ({ database }) => {
      database.run("INSERT INTO todos (id, title) VALUES ('forbidden', 'no')");
      return null;
    },
  },
});

describe('DatabaseReaderRuntime', () => {
  let directory: string;
  let filePath: string;
  let writer: DatabaseRuntime;
  let reader: DatabaseReaderRuntime;

  beforeEach(() => {
    directory = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'zero-database-reader-')),
    );
    filePath = join(directory, 'tenant.sqlite');
    writer = DatabaseRuntime.open({
      id: 'writer-test',
      role: 'tenant',
      sqlite: createPlatformSQLiteService({ mode: 'file', path: filePath }),
      ownsSQLite: true,
      tables: realm.tables,
    });
    writer.db.createStrict('todos', { id: 'b', title: 'Second' });
    writer.db.createStrict('todos', { id: 'a', title: 'First' });
    writer.db.createStrict('todos', { id: 'c', title: 'Third' });
    reader = DatabaseReaderRuntime.open({ filePath, realm });
  });

  afterEach(() => {
    try { reader?.close(); } catch { /* Preserve the originating test failure. */ }
    try { writer?.close(); } catch { /* Preserve the originating test failure. */ }
    rmSync(directory, { recursive: true, force: true });
  });

  test('returns rows and the durable sequence from one readonly snapshot', () => {
    expect(reader.execute({
      type: 'get',
      table: 'todos',
      id: 'a',
      consistency: { mode: 'snapshot' },
    })).toEqual({
      value: { id: 'a', title: 'First' },
      sequence: { seq: 3 },
    });

    expect(reader.execute({
      type: 'query',
      name: 'todos.count',
      input: null,
    })).toEqual({
      value: { count: 3 },
      sequence: { seq: 3 },
    });
  });

  test('paginates in stable primary-key order without an unbounded scan', () => {
    const first = reader.execute({
      type: 'list',
      table: 'todos',
      limit: 2,
    });
    expect(first).toEqual({
      value: {
        rows: [
          { id: 'a', title: 'First' },
          { id: 'b', title: 'Second' },
        ],
        nextCursor: 'b',
      },
      sequence: { seq: 3 },
    });
    expect(reader.execute({
      type: 'list',
      table: 'todos',
      limit: 2,
      after: 'b',
    })).toEqual({
      value: {
        rows: [{ id: 'c', title: 'Third' }],
        nextCursor: null,
      },
      sequence: { seq: 3 },
    });
  });

  test('reads the previous committed WAL value while another writer is uncommitted', () => {
    const external = new Database(filePath);
    try {
      external.run('PRAGMA journal_mode = WAL');
      external.run('BEGIN IMMEDIATE');
      external.run("UPDATE todos SET title = 'Uncommitted' WHERE id = 'a'");

      expect(reader.execute({
        type: 'get',
        table: 'todos',
        id: 'a',
      }).value).toEqual({ id: 'a', title: 'First' });
      external.run('ROLLBACK');
    } finally {
      try { external.run('ROLLBACK'); } catch { /* Already rolled back. */ }
      external.close();
    }
  });

  test('fails a stale read-your-writes snapshot for coordinator retry', () => {
    const error = captureError(() => reader.execute({
      type: 'get',
      table: 'todos',
      id: 'a',
      consistency: { mode: 'read-your-writes', minSeq: { seq: 4 } },
    }));
    expect(error.code).toBe('DATABASE_TRANSACTION_STALE');
    expect(error.retryable).toBe(true);
    expect(error.outcome).toBe('not-started');
  });

  test('rejects strong reads, writes, and query-handler mutation attempts', () => {
    expect(captureError(() => reader.execute({
      type: 'get', table: 'todos', id: 'a', consistency: { mode: 'strong' },
    })).code).toBe('DATABASE_OPERATION_UNSUPPORTED');
    expect(captureError(() => reader.execute({
      type: 'mutate',
      idempotencyKey: 'write-1',
      mutation: { type: 'delete', table: 'todos', id: 'a' },
    })).code).toBe('DATABASE_OPERATION_UNSUPPORTED');
    expect(captureError(() => reader.execute({
      type: 'query', name: 'todos.tryWrite', input: null,
    })).code).toBe('DATABASE_EXECUTOR_FAILED');
    expect(writer.db.get('todos', 'forbidden')).toBeNull();
  });

  test('closes idempotently and exposes no file path in diagnostics or errors', () => {
    expect(reader.diagnostics()).toEqual({
      state: 'ready',
      schemaVersion: expect.any(Number),
      realmFingerprint: realm.fingerprint,
    });
    expect(JSON.stringify(reader.diagnostics())).not.toContain(filePath);
    reader.close();
    reader.close();
    const error = captureError(() => reader.execute({
      type: 'get', table: 'todos', id: 'a',
    }));
    expect(error.code).toBe('DATABASE_CLOSED');
    expect(JSON.stringify(error)).not.toContain(filePath);
  });
});

function captureError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError.');
}
