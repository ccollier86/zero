import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import type { Migration } from '../migrations/types';
import { createReactiveDB } from '../sync/reactive-db';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type Row,
  type SyncTableMutationValidator,
  type TableSchema,
} from '../sync/types';
import { DatabaseError, type DatabaseErrorCode } from './database-error';
import {
  createDatabaseRealmOperationCatalog,
  defineDatabaseRealm,
  runDatabaseRealmCommand,
  runDatabaseRealmQuery,
  type DatabaseReadQueryHandler,
  type DatabaseWriteCommandContext,
  type DatabaseWriteCommandHandler,
} from './database-realm';

function expectDatabaseCode(operation: () => unknown, code: DatabaseErrorCode): void {
  try {
    operation();
    throw new Error('Expected a DatabaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
  }
}

const migration001: Migration = {
  version: '001',
  description: 'create an actor-local marker',
  up(database) {
    database.run('CREATE TABLE IF NOT EXISTS realm_marker (id TEXT PRIMARY KEY)');
  },
};

const tables = {
  todos: {
    id: 'text primary key',
    owner_id: 'text not null',
    title: 'text not null',
    _identity: ['owner_id', 'title'],
  },
} satisfies Record<string, TableSchema>;

describe('database realm definition', () => {
  test('clones and freezes schema, migrations, and handler registries', () => {
    const sourceTables: Record<string, TableSchema> = {
      todos: {
        id: 'text primary key',
        title: 'text not null',
        _identity: ['title'],
      },
    };
    const sourceMigrations = [{ ...migration001 }];
    const originalQuery = (() => []) as DatabaseReadQueryHandler;
    const originalCommand = (() => null) as DatabaseWriteCommandHandler;
    const sourceQueries = { 'todos.all': originalQuery };
    const sourceCommands = { 'todos.noop': originalCommand };

    const realm = defineDatabaseRealm({
      name: 'app-data',
      version: '1.0.0',
      tables: sourceTables,
      migrations: sourceMigrations,
      queries: sourceQueries,
      commands: sourceCommands,
    });

    sourceTables.todos!.title = 'integer';
    sourceTables.todos!._identity![0] = 'id';
    sourceMigrations[0]!.description = 'mutated after registration';
    sourceQueries['todos.all'] = (() => ['changed']) as DatabaseReadQueryHandler;
    sourceCommands['todos.noop'] = (() => 'changed') as DatabaseWriteCommandHandler;

    expect(realm.tables.todos).toEqual({
      id: 'text primary key',
      title: 'text not null',
      _identity: ['title'],
    });
    expect(realm.migrations[0]?.description).toBe('create an actor-local marker');
    expect(realm.queries['todos.all']).toBe(originalQuery);
    expect(realm.commands['todos.noop']).toBe(originalCommand);
    expect(Object.isFrozen(realm)).toBe(true);
    expect(Object.isFrozen(realm.tables)).toBe(true);
    expect(Object.isFrozen(realm.tables.todos)).toBe(true);
    expect(Object.isFrozen(realm.tables.todos?._identity)).toBe(true);
    expect(Object.isFrozen(realm.migrations)).toBe(true);
    expect(Object.isFrozen(realm.migrations[0])).toBe(true);
    expect(Object.isFrozen(realm.queries)).toBe(true);
    expect(Object.isFrozen(realm.commands)).toBe(true);
    expect(realm.schemaChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(realm.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(realm.migrationChecksums).toEqual([{
      version: '001',
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    }]);
  });

  test('produces a stable fingerprint independent of handler declaration order', () => {
    const first = defineDatabaseRealm({
      name: 'tenant-data',
      version: '2026.09.1',
      tables,
      migrations: [migration001],
      queries: {
        'todos.zeta': () => null,
        'todos.alpha': () => null,
      },
      commands: {
        'todos.zetaWrite': () => null,
        'todos.alphaWrite': () => null,
      },
    });
    const second = defineDatabaseRealm({
      name: 'tenant-data',
      version: '2026.09.1',
      tables: {
        todos: {
          id: 'text primary key',
          owner_id: 'text not null',
          title: 'text not null',
          _identity: ['owner_id', 'title'],
        },
      },
      migrations: [migration001],
      queries: {
        'todos.alpha': () => ({ ignoredBody: true }),
        'todos.zeta': () => ({ ignoredBody: true }),
      },
      commands: {
        'todos.alphaWrite': () => ({ ignoredBody: true }),
        'todos.zetaWrite': () => ({ ignoredBody: true }),
      },
    });

    expect(second.schemaChecksum).toBe(first.schemaChecksum);
    expect(second.migrationChecksums).toEqual(first.migrationChecksums);
    expect(second.fingerprint).toBe(first.fingerprint);

    expect(defineDatabaseRealm({
      name: 'tenant-data',
      version: '2026.09.2',
      tables,
      migrations: [migration001],
      queries: first.queries,
      commands: first.commands,
    }).fingerprint).not.toBe(first.fingerprint);

    expect(defineDatabaseRealm({
      name: 'tenant-data',
      version: '2026.09.1',
      tables: {
        todos: {
          ...tables.todos,
          title: 'text not null default \'untitled\'',
        },
      },
      migrations: [migration001],
      queries: first.queries,
      commands: first.commands,
    }).fingerprint).not.toBe(first.fingerprint);

    expect(defineDatabaseRealm({
      name: 'tenant-data',
      version: '2026.09.1',
      tables,
      migrations: [{
        ...migration001,
        up(database) {
          database.run('CREATE TABLE realm_marker (id TEXT PRIMARY KEY, changed INTEGER)');
        },
      }],
      queries: first.queries,
      commands: first.commands,
    }).fingerprint).not.toBe(first.fingerprint);

    expect(defineDatabaseRealm({
      name: 'tenant-data',
      version: '2026.09.1',
      tables,
      migrations: [migration001],
      queries: { ...first.queries, 'todos.newQuery': () => null },
      commands: first.commands,
    }).fingerprint).not.toBe(first.fingerprint);
  });

  test('preserves and freezes logical table mutation validators', () => {
    const validator: SyncTableMutationValidator = {
      primaryKey: 'id',
      fieldNames: ['title'],
      decodeRow: (row) => ({ ...row }),
      encodeRow: (row) => ({ ...row }),
      validateRow: (row) => ({ success: true, output: row }),
    };
    const schema: TableSchema = {
      id: 'text primary key',
      title: 'text not null',
      [SYNC_TABLE_MUTATION_VALIDATOR]: validator,
    };
    const realm = defineDatabaseRealm({
      name: 'validated-data',
      version: '1',
      tables: { records: schema },
    });
    const cloned = realm.tables.records?.[SYNC_TABLE_MUTATION_VALIDATOR];

    (validator.fieldNames as string[])[0] = 'id';
    expect(cloned).not.toBe(validator);
    expect(cloned?.fieldNames).toEqual(['title']);
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(Object.isFrozen(cloned?.fieldNames)).toBe(true);
    expect(cloned?.decodeRow).toBe(validator.decodeRow);
  });

  test('exposes frozen catalog snapshots for actor-side operation admission', () => {
    const realm = defineDatabaseRealm({
      name: 'catalog-data',
      version: '1',
      tables,
      queries: { 'todos.all': () => [] },
      commands: { 'todos.clear': () => null },
    });
    const first = createDatabaseRealmOperationCatalog(realm);
    const second = createDatabaseRealmOperationCatalog(realm);

    expect(first.tables?.includes('todos')).toBe(true);
    expect(first.queries?.includes('todos.all')).toBe(true);
    expect(first.commands?.includes('todos.clear')).toBe(true);
    expect(first.columns?.todos).toEqual(['id', 'owner_id', 'title']);
    expect(first.primaryKeys?.todos).toBe('id');
    expect(first.tables).not.toBe(second.tables);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.tables)).toBe(true);
    expect(Object.isFrozen(first.columns)).toBe(true);
    expect(Object.isFrozen(first.columns?.todos)).toBe(true);
    expect(second.tables?.includes('not-in-realm')).toBe(false);
    expect(Object.keys(realm.tables)).toEqual(['todos']);
  });

  test('rejects unsafe, ambiguous, or mutable-code registry definitions', () => {
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'bad realm',
      version: '1',
      tables: {},
    }), 'DATABASE_CONFIG_INVALID');
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'data',
      version: '../1',
      tables: {},
    }), 'DATABASE_CONFIG_INVALID');
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'data',
      version: '1',
      tables: {
        Todos: { id: 'text primary key' },
        todos: { id: 'text primary key' },
      },
    }), 'DATABASE_CONFIG_INVALID');
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'data',
      version: '1',
      tables: { invalid: { note: "text default 'primary key'" } },
    }), 'DATABASE_CONFIG_INVALID');
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'data',
      version: '1',
      tables,
      queries: { duplicate: () => null },
      commands: { duplicate: () => null },
    }), 'DATABASE_CONFIG_INVALID');
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'data',
      version: '1',
      tables,
      queries: { '2unsafe': () => null },
    }), 'DATABASE_CONFIG_INVALID');
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'data',
      version: '1',
      tables,
      queries: { asyncQuery: async () => null },
    }), 'DATABASE_CONFIG_INVALID');
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'data',
      version: '1',
      tables,
      migrations: [migration001, { ...migration001 }],
    }), 'DATABASE_CONFIG_INVALID');
  });

  test('rejects proxies and accessors without evaluating them', () => {
    expectDatabaseCode(() => defineDatabaseRealm(new Proxy({
      name: 'data', version: '1', tables,
    }, {})), 'DATABASE_CONFIG_INVALID');

    let getterCalls = 0;
    const definition: Record<string, unknown> = { name: 'data', version: '1' };
    Object.defineProperty(definition, 'tables', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return tables;
      },
    });
    expectDatabaseCode(
      () => defineDatabaseRealm(definition as never),
      'DATABASE_CONFIG_INVALID',
    );
    expect(getterCalls).toBe(0);
  });
});

describe('database realm handler execution', () => {
  test('runs named queries against actor-local handles and validates results', () => {
    const database = new Database(':memory:', { strict: true });
    database.run('CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    database.run('INSERT INTO notes (id, body) VALUES (?, ?)', ['one', 'hello']);
    const realm = defineDatabaseRealm({
      name: 'query-data',
      version: '1',
      tables: { notes: { id: 'text primary key', body: 'text not null' } },
      queries: {
        'notes.get': ({ database }, input: { id: string }) =>
          (database.query('SELECT id, body FROM notes WHERE id = ?').get(input.id)
            ?? null) as Row | null,
      },
    });

    try {
      const result = runDatabaseRealmQuery(
        realm,
        { database },
        'notes.get',
        { id: 'one' },
      );
      expect(result).toEqual({ id: 'one', body: 'hello' });
      expect(Object.isFrozen(result)).toBe(true);
      expectDatabaseCode(() => runDatabaseRealmQuery(
        realm,
        { database },
        'notes.missing',
        null,
      ), 'DATABASE_OPERATION_UNSUPPORTED');
    } finally {
      database.close();
    }
  });

  test('runs commands transactionally and rolls back asynchronous results', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', {
      id: 'text primary key',
      title: 'text not null',
    });
    const unsafeAsyncResult = (({ db }: DatabaseWriteCommandContext) => {
      db.createStrict('todos', { id: 'rolled-back', title: 'No commit' });
      return Promise.resolve(null);
    }) as unknown as DatabaseWriteCommandHandler;
    const realm = defineDatabaseRealm({
      name: 'command-data',
      version: '1',
      tables: { todos: { id: 'text primary key', title: 'text not null' } },
      commands: {
        'todos.create': ({ db }, input: { id: string; title: string }) => {
          const change = db.createStrict('todos', input);
          return { id: change.rowId, seq: change.seq };
        },
        unsafeAsyncResult,
      },
    });

    try {
      const result = runDatabaseRealmCommand(
        realm,
        { db },
        'todos.create',
        { id: 'committed', title: 'Stored' },
      );
      expect(result).toEqual({ id: 'committed', seq: 1 });
      expect(db.get('todos', 'committed')).toEqual({
        id: 'committed', title: 'Stored',
      });

      expectDatabaseCode(() => runDatabaseRealmCommand(
        realm,
        { db },
        'unsafeAsyncResult',
        null,
      ), 'DATABASE_OPERATION_UNSUPPORTED');
      expect(db.get('todos', 'rolled-back')).toBeNull();
      expect(db.currentSeq).toBe(1);
    } finally {
      db.dispose();
    }
  });
});
