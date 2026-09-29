import { Database, Statement } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DatabaseError } from './database-error';
import {
  assertDatabaseReadQuerySql,
  createDatabaseReadQuerySession,
  openDatabaseWriterReadQuerySession,
  withDatabaseReadQuerySession,
  type DatabaseReadQueryStatement,
} from './database-read-query-capability';

describe('registered database read-query capability', () => {
  test('admits one SELECT/WITH read statement and rejects unsafe SQL forms', () => {
    for (const sql of [
      'SELECT 1 AS value',
      '\ufeffSELECT 1 AS value',
      "SELECT '; -- /* insert */' AS text",
      "SELECT 'readfile' AS label",
      'SELECT readfile AS label FROM (SELECT 1 AS readfile)',
      'SELECT 1 AS "readfile"',
      'WITH value AS (SELECT 1 AS id) SELECT id FROM value',
      'WITH cafédelete AS (SELECT 1 AS id) SELECT id FROM cafédelete',
      'WITH value(id) AS (VALUES (1)) SELECT id FROM value UNION SELECT 2',
    ]) {
      expect(() => assertDatabaseReadQuerySql(sql)).not.toThrow();
    }

    for (const sql of [
      '',
      'VALUES (1)',
      'PRAGMA query_only = OFF',
      'INSERT INTO todos VALUES (1)',
      'UPDATE todos SET title = NULL',
      'DELETE FROM todos',
      'SELECT 1; SELECT 2',
      'SELECT 1 -- hidden statement',
      'SELECT 1 /* hidden statement */',
      'WITH value AS (SELECT 1) DELETE FROM todos',
      'WITH xéselect AS (SELECT 1) DELETE FROM todos',
      'WITH xéselect AS (SELECT 1) UPDATE todos SET title = NULL',
      'WITH xéselect AS (SELECT 1) INSERT INTO todos SELECT * FROM xéselect',
      'SELECT file FROM pragma_database_list',
      'SELECT file FROM "pragma_database_list"',
      "SELECT file FROM 'pragma_database_list'",
      "SELECT load_extension('/tmp/unsafe')",
      "SELECT \"readfile\"('/tmp/unsafe')",
      "SELECT * FROM 'readfile'('/tmp/unsafe')",
      "SELECT writefile('/tmp/unsafe', 'data')",
    ]) {
      expectDatabaseCode(
        () => assertDatabaseReadQuerySql(sql),
        'DATABASE_OPERATION_UNSUPPORTED',
      );
    }
  });

  test('exposes only read methods and seals retained statements on cleanup', () => {
    const source = new Database(':memory:', { strict: true });
    source.run('CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
    source.run("INSERT INTO todos VALUES ('a', 'First'), ('b', 'Second')");
    const readonly = Database.deserialize(source.serialize(), {
      readonly: true,
      strict: true,
    });
    let retained: DatabaseReadQueryStatement<{ count: number }> | null = null;
    try {
      const result = withDatabaseReadQuerySession(
        createDatabaseReadQuerySession(readonly),
        ({ database }) => {
          expect(Object.getPrototypeOf(database)).toBeNull();
          expect(Object.keys(database).sort()).toEqual(['prepare', 'query']);
          retained = database.query<{ count: number }>(
            'SELECT count(*) AS count FROM todos',
          );
          expect(Object.getPrototypeOf(retained)).toBeNull();
          expect(Object.keys(retained).sort()).toEqual([
            'all', 'get', 'iterate', 'raw', 'values',
          ]);
          expect('run' in database).toBe(false);
          expect('exec' in database).toBe(false);
          expect('transaction' in database).toBe(false);
          expect('filename' in database).toBe(false);
          expect('handle' in database).toBe(false);
          expect('loadExtension' in database).toBe(false);
          expect('native' in retained).toBe(false);
          return retained.get();
        },
      );
      expect(result).toEqual({ count: 2 });
      expectDatabaseCode(() => retained!.get(), 'DATABASE_CLOSED');
      expect(readonly.query('SELECT count(*) AS count FROM todos').get())
        .toEqual({ count: 2 });
    } finally {
      readonly.close();
      source.close();
    }
  });

  test('does not reopen a replacement path for file writer queries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zero-writer-query-binding-'));
    const verifiedPath = join(directory, 'tenant.verified.sqlite');
    const replacementPath = join(directory, 'tenant.replacement.sqlite');
    const writer = new Database(verifiedPath, { create: true, strict: true });
    const replacement = new Database(replacementPath, {
      create: true,
      strict: true,
    });
    try {
      writer.run('CREATE TABLE marker (value TEXT NOT NULL)');
      writer.run("INSERT INTO marker VALUES ('verified-handle')");
      writer.run('PRAGMA query_only = ON');

      replacement.run('CREATE TABLE marker (value TEXT NOT NULL)');
      replacement.run("INSERT INTO marker VALUES ('replacement-path')");
      expect(replacement.query('SELECT value FROM marker').get()).toEqual({
        value: 'replacement-path',
      });

      // This intentionally models the post-verification state of a swapped
      // pathname: the native writer remains bound to the verified inode while
      // resolving its stored path would now open replacement data.
      const session = openDatabaseWriterReadQuerySession({
        sqlite: { mode: 'file', path: replacementPath, raw: writer },
      } as unknown as Parameters<typeof openDatabaseWriterReadQuerySession>[0]);
      expect(withDatabaseReadQuerySession(
        session,
        ({ database }) => database.query('SELECT value FROM marker').get(),
      )).toEqual({ value: 'verified-handle' });
    } finally {
      replacement.close();
      writer.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('requires query_only before exposing the verified file writer handle', () => {
    const writer = new Database(':memory:', { strict: true });
    try {
      expectDatabaseCode(() => openDatabaseWriterReadQuerySession({
        sqlite: { mode: 'file', path: '/unused/tenant.sqlite', raw: writer },
      } as unknown as Parameters<typeof openDatabaseWriterReadQuerySession>[0]),
      'DATABASE_EXECUTOR_FAILED');
    } finally {
      writer.close();
    }
  });

  test('force-closes an owned connection after statement cleanup fails', () => {
    const source = new Database(':memory:', { strict: true });
    const session = openDatabaseWriterReadQuerySession({
      sqlite: { mode: 'ephemeral', raw: source },
    } as unknown as Parameters<typeof openDatabaseWriterReadQuerySession>[0]);
    const retained = session.context.database.query<{ value: number }>(
      'SELECT 1 AS value',
    );
    const finalizeDescriptor = Object.getOwnPropertyDescriptor(
      Statement.prototype,
      'finalize',
    )!;
    const closeDescriptor = Object.getOwnPropertyDescriptor(
      Database.prototype,
      'close',
    )!;
    const originalClose = closeDescriptor.value as Database['close'];
    const closeAttempts: Array<boolean | undefined> = [];

    try {
      Object.defineProperty(Statement.prototype, 'finalize', {
        ...finalizeDescriptor,
        value() {
          throw new Error('injected statement finalization failure');
        },
      });
      Object.defineProperty(Database.prototype, 'close', {
        ...closeDescriptor,
        value(this: Database, throwOnError?: boolean) {
          closeAttempts.push(throwOnError);
          return originalClose.call(this, throwOnError);
        },
      });

      let cleanupError: unknown;
      try {
        session.close();
      } catch (error) {
        cleanupError = error;
      }
      expect(cleanupError).toBeInstanceOf(DatabaseError);
      expect((cleanupError as DatabaseError).code)
        .toBe('DATABASE_EXECUTOR_FAILED');
      expect((cleanupError as DatabaseError).outcome).toBeNull();
      expect(closeAttempts).toEqual([true, false]);
      expectDatabaseCode(() => retained.get(), 'DATABASE_CLOSED');
      expect(() => session.close()).not.toThrow();
    } finally {
      Object.defineProperty(Statement.prototype, 'finalize', finalizeDescriptor);
      Object.defineProperty(Database.prototype, 'close', closeDescriptor);
      source.close();
    }
  });
});

function expectDatabaseCode(
  operation: () => unknown,
  code: DatabaseError['code'],
): void {
  try {
    operation();
    throw new Error('Expected a DatabaseError.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
  }
}
