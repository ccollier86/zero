import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPlatformSQLiteService } from '../persistence';
import { defineTable, field } from '../schema';
import { prepareDatabaseBindingIdentity } from './database-binding-identity';
import { DatabaseError } from './database-error';
import { createDatabaseRef, prepareDatabaseFile } from './database-file';
import { DATABASE_OPERATION_MAX_BYTES } from './database-operations';
import { DatabaseReaderRuntime } from './database-reader-runtime';
import {
  defineDatabaseRealm,
  type DatabaseReadQueryHandler,
} from './database-realm';
import { DatabaseRuntime } from './database-runtime';
import { DatabaseWriterOperationEngine } from './database-writer-engine';

const invalidQueryResult = (() => undefined) as unknown as
  DatabaseReadQueryHandler;

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
    decoy_constraints: {
      note: "text default 'primary key'",
      id: 'text primary key',
    },
  },
  queries: {
    'todos.count': ({ database }) => {
      const row = database.query('SELECT count(*) AS count FROM todos').get() as {
        count: number;
      };
      return { count: row.count };
    },
    'decoy_constraints.count': ({ database }) => {
      const row = database.query(
        'SELECT count(*) AS count FROM decoy_constraints',
      ).get() as { count: number };
      return { count: row.count };
    },
    'todos.capabilityProbe': ({ database }) => {
      const attempt = (sql: string): string => {
        try {
          database.query(sql).get();
          return 'unexpected-success';
        } catch (error) {
          return error instanceof DatabaseError ? error.code : 'untyped-error';
        }
      };
      const statement = database.query('SELECT count(*) AS count FROM todos');
      return {
        pragma: attempt('PRAGMA query_only = OFF'),
        pathQuery: attempt('SELECT file FROM pragma_database_list'),
        insert: attempt(
          "INSERT INTO todos (id, title) VALUES ('forbidden', 'no')",
        ),
        connectionKeys: Object.keys(database).sort(),
        statementKeys: Object.keys(statement).sort(),
        hasRun: 'run' in database,
        hasFilename: 'filename' in database,
        hasHandle: 'handle' in database,
        hasLoadExtension: 'loadExtension' in database,
        hasNative: 'native' in statement,
      };
    },
    'todos.oversizedResult': () => 'x'.repeat(DATABASE_OPERATION_MAX_BYTES + 1),
    'todos.invalidResult': invalidQueryResult,
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

  test('uses exact column constraints when validating the readonly schema', () => {
    expect(reader.execute({
      type: 'query',
      name: 'decoy_constraints.count',
      input: null,
    }).value).toEqual({ count: 0 });
  });

  test('rejects a readonly realm file whose Guardian FK was retargeted', () => {
    const tasks = defineTable('guardian_tasks', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'task_id' });
    const guardianRealm = defineDatabaseRealm({
      name: 'reader-guardian-test',
      version: '1',
      tables: { guardian_tasks: tasks.serverTable },
    });
    const guardianRef = createDatabaseRef('reader-guardian-test');
    const prepared = prepareDatabaseFile(directory, 'reader-guardian-test');
    const binding = prepareDatabaseBindingIdentity({
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      databaseRef: guardianRef,
      realmName: guardianRealm.name,
      initialize: true,
    });
    const anchors = new Database(prepared.path);
    anchors.exec('CREATE TABLE users (user_id TEXT PRIMARY KEY)');
    anchors.close();
    const guardianWriter = DatabaseRuntime.open({
      id: 'guardian-writer',
      role: 'tenant',
      sqlite: createPlatformSQLiteService({ mode: 'file', path: prepared.path }),
      ownsSQLite: true,
      tables: guardianRealm.tables,
    });
    guardianWriter.close();
    const drifted = new Database(prepared.path);
    try {
      drifted.exec(`
        DROP TABLE guardian_tasks;
        CREATE TABLE guardian_tasks (
          task_id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL
            REFERENCES users(user_id) ON DELETE CASCADE
        );
      `);
    } finally {
      drifted.close();
    }

    expect(() => DatabaseReaderRuntime.open({
      filePath: prepared.path,
      realm: guardianRealm,
      databaseRef: guardianRef,
      instanceId: binding.instanceId,
    })).toThrow(expect.objectContaining({
      code: 'DATABASE_SCHEMA_MISMATCH',
      details: expect.objectContaining({
        reason: 'reference-storage-invalid',
        issue: 'invalid-foreign-key',
      }),
    }));
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

  test('rejects strong reads and exposes only the readonly query capability', () => {
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
    expect(reader.execute({
      type: 'query', name: 'todos.capabilityProbe', input: null,
    }).value).toEqual({
      pragma: 'DATABASE_OPERATION_UNSUPPORTED',
      pathQuery: 'DATABASE_OPERATION_UNSUPPORTED',
      insert: 'DATABASE_OPERATION_UNSUPPORTED',
      connectionKeys: ['prepare', 'query'],
      statementKeys: ['all', 'get', 'iterate', 'raw', 'values'],
      hasRun: false,
      hasFilename: false,
      hasHandle: false,
      hasLoadExtension: false,
      hasNative: false,
    });
    expect(writer.db.get('todos', 'forbidden')).toBeNull();
  });

  test('normalizes invalid query output identically on reader and writer lanes', () => {
    const engine = new DatabaseWriterOperationEngine({ runtime: writer, realm });
    try {
      for (const name of ['todos.oversizedResult', 'todos.invalidResult']) {
        expect(captureError(() => reader.execute({
          type: 'query', name, input: null,
        })).code).toBe('DATABASE_RESULT_LIMIT');
        expect(captureError(() => engine.execute({
          type: 'query', name, input: null,
        })).code).toBe('DATABASE_RESULT_LIMIT');
      }

      expect(captureError(() => reader.execute({
        type: 'query', name: 'todos.count', input: undefined,
      })).code).toBe('DATABASE_PAYLOAD_INVALID');
      expect(captureError(() => engine.execute({
        type: 'query', name: 'todos.count', input: undefined,
      })).code).toBe('DATABASE_PAYLOAD_INVALID');
    } finally {
      engine.close();
    }
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
