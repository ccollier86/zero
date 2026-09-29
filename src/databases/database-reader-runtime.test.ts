import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPlatformSQLiteService } from '../persistence';
import { prepareDatabaseBindingIdentity } from './database-binding-identity';
import { DatabaseError } from './database-error';
import { createDatabaseRef, prepareDatabaseFile } from './database-file';
import { DatabaseReaderRuntime } from './database-reader-runtime';
import { defineDatabaseRealm } from './database-realm';
import { DatabaseRuntime } from './database-runtime';

const realm = defineDatabaseRealm({
  name: 'reader-test',
  version: '1',
  tables: {
    todos: {
      id: 'text primary key',
      title: 'text not null collate nocase',
    },
    flags: {
      id: 'text primary key',
      value: 'any',
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
    const databaseRef = createDatabaseRef('reader-test');
    const prepared = prepareDatabaseFile(directory, 'reader-test');
    filePath = prepared.path;
    const bindingIdentity = prepareDatabaseBindingIdentity({
      filePath,
      fileIdentity: prepared.identity,
      databaseRef,
      realmName: realm.name,
      initialize: true,
    });
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
    reader = DatabaseReaderRuntime.open({
      filePath,
      realm,
      databaseRef,
      instanceId: bindingIdentity.instanceId,
    });
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

  test('runs projected nested finds with exact constraints and stable PK ties', () => {
    writer.db.createStrict('todos', { id: 'd', title: 'First' });

    expect(reader.execute({
      type: 'find',
      table: 'todos',
      select: ['id', 'title'],
      filters: [{
        type: 'anyOf',
        filters: [
          { type: 'field', field: 'title', operator: 'contains', value: 'ir' },
          { type: 'field', field: 'id', operator: 'in', value: ['missing'] },
        ],
      }],
      order: [{ field: 'title', direction: 'asc' }],
      limit: 10,
    })).toEqual({
      value: [
        { id: 'a', title: 'First' },
        { id: 'd', title: 'First' },
        { id: 'c', title: 'Third' },
      ],
      sequence: { seq: 4 },
    });

    // The declared NOCASE collation broadens ordinary caller equality.
    expect(reader.execute({
      type: 'find', table: 'todos', limit: 10,
      filters: [{ type: 'field', field: 'title', operator: 'eq', value: 'first' }],
    }).value).toHaveLength(2);
    // Framework-owned exact equality remains storage-class/BINARY exact.
    expect(reader.execute({
      type: 'find', table: 'todos', limit: 10,
      filters: [{
        type: 'field', field: 'title', operator: 'eq', value: 'first',
        match: 'exact',
      }],
    }).value).toEqual([]);
  });

  test('binds find values and escapes contains wildcards', () => {
    writer.db.createStrict('todos', { id: 'percent', title: '100% ready' });
    expect(reader.execute({
      type: 'find', table: 'todos', select: ['id'], limit: 10,
      filters: [{ type: 'field', field: 'title', operator: 'contains', value: '%' }],
    }).value).toEqual([{ id: 'percent' }]);
    expect(reader.execute({
      type: 'find', table: 'todos', limit: 10,
      filters: [{
        type: 'field', field: 'title', operator: 'eq', value: "' OR 1=1 --",
      }],
    }).value).toEqual([]);
  });

  test('preserves canonical exact-boolean storage alternatives', () => {
    for (const [id, value] of [
      ['integer', true],
      ['text-number', '1'],
      ['text-boolean', 'true'],
      ['false-number', false],
      ['unrelated', 'yes'],
    ] as const) {
      writer.db.createStrict('flags', { id, value });
    }
    expect(reader.execute({
      type: 'find',
      table: 'flags',
      select: ['id'],
      filters: [{
        type: 'field', field: 'value', operator: 'eq', value: true,
        match: 'exact',
      }],
      limit: 10,
    }).value).toEqual([
      { id: 'integer' },
      { id: 'text-boolean' },
      { id: 'text-number' },
    ]);
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
      type: 'find', table: 'todos', limit: 1, consistency: { mode: 'strong' },
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

  test('turns startup handle cleanup ambiguity into an unknown executor failure', () => {
    const closeModes: boolean[] = [];
    const error = captureError(() => DatabaseReaderRuntime.openForTesting({
      filePath,
      realm,
      databaseRef: createDatabaseRef('wrong-reader'),
      instanceId: reader.bindingIdentity.instanceId,
    }, {
      finalizeStatement(statement) {
        statement.finalize();
      },
      closeDatabase(database, throwOnError) {
        closeModes.push(throwOnError);
        database.close(throwOnError);
        if (throwOnError) throw new Error('injected close-report failure');
      },
    }));
    expect(error).toMatchObject({
      code: 'DATABASE_EXECUTOR_FAILED',
      retryable: false,
      outcome: 'unknown',
    });
    expect(error.cause).toBeInstanceOf(AggregateError);
    expect(closeModes).toEqual([true, false]);
  });

  test('keeps failed close state retryable until throwing SQLite close succeeds', () => {
    let injected = false;
    const injectedReader = DatabaseReaderRuntime.openForTesting({
      filePath,
      realm,
      databaseRef: reader.bindingIdentity.databaseRef,
      instanceId: reader.bindingIdentity.instanceId,
    }, {
      finalizeStatement(statement) {
        statement.finalize();
      },
      closeDatabase(database, throwOnError) {
        if (throwOnError && !injected) {
          injected = true;
          throw new Error('injected pending-query failure');
        }
        database.close(throwOnError);
      },
    });
    try {
      expect(captureError(() => injectedReader.close())).toMatchObject({
        code: 'DATABASE_EXECUTOR_FAILED',
        retryable: false,
        outcome: 'unknown',
      });
      expect(injectedReader.diagnostics().state).toBe('ready');
      injectedReader.close();
      expect(injectedReader.diagnostics().state).toBe('closed');
    } finally {
      try { injectedReader.close(); } catch { /* Preserve the test failure. */ }
    }
  });

  test('proves immediate reader-handle release on the normal close path', () => {
    const closeModes: boolean[] = [];
    let openedDatabase: Database | null = null;
    const strictReader = DatabaseReaderRuntime.openForTesting({
      filePath,
      realm,
      databaseRef: reader.bindingIdentity.databaseRef,
      instanceId: reader.bindingIdentity.instanceId,
    }, {
      finalizeStatement(statement) {
        statement.finalize();
      },
      closeDatabase(database, throwOnError) {
        openedDatabase = database;
        closeModes.push(throwOnError);
        database.close(throwOnError);
      },
    });

    strictReader.close();

    expect(closeModes).toEqual([true]);
    expect(() => openedDatabase!.run('SELECT 1')).toThrow();
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
