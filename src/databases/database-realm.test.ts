import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import type { Migration } from '../migrations/types';
import { defineTable, field } from '../schema';
import { createReactiveDB } from '../sync/reactive-db';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type Row,
  type SyncTableMutationValidator,
  type TableSchema,
} from '../sync/types';
import { DatabaseError, type DatabaseErrorCode } from './database-error';
import type { DatabaseSerializableValue } from './database-operations';
import {
  createDatabaseReadQuerySession,
  withDatabaseReadQuerySession,
} from './database-read-query-capability';
import {
  createDatabaseRealmOperationCatalog,
  defineDatabaseRealm,
  runDatabaseRealmCommand,
  runDatabaseRealmQuery,
  type DatabaseReadQueryHandler,
  type DatabaseWriteCommandCapability,
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

function expectDatabaseConfigMessage(
  operation: () => unknown,
  message: string,
): void {
  try {
    operation();
    throw new Error('Expected a DatabaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe('DATABASE_CONFIG_INVALID');
    expect((error as DatabaseError).message).toContain(message);
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
  test('rejects Guardian metadata whose actor-realm SQL was mutated', () => {
    const tasks = defineTable('tasks', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'task_id' });
    tasks.serverTable.owner_user_id = 'text not null';

    expectDatabaseConfigMessage(() => defineDatabaseRealm({
      name: 'invalid-guardian-realm',
      version: '1',
      tables: { tasks: tasks.serverTable },
    }), 'does not declare its exact managed foreign key');
  });

  test('rejects app realm tables that shadow activated Guardian anchors', () => {
    const tasks = defineTable('tasks', {
      user_id: field.guardianUser(),
    }, { pk: 'task_id' });
    for (const [anchor, schema] of Object.entries({
      users: { user_id: 'text primary key' },
      tenant_memberships: {
        membership_id: 'text primary key',
        tenant_id: 'text not null',
        user_id: 'text references users(user_id) on delete restrict not null',
      },
    })) {
      expectDatabaseConfigMessage(() => defineDatabaseRealm({
        name: `shadowed-${anchor}`,
        version: '1',
        tables: { [anchor]: schema, tasks: tasks.serverTable },
      }), `"${anchor}" is a framework-owned Guardian anchor`);
    }
  });

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

  test('admits only TEXT or INTEGER affinity primary-key declarations', () => {
    for (const definition of [
      'text primary key',
      'varchar(128) primary key',
      'integer primary key',
      'unsigned big int primary key',
    ]) {
      const realm = defineDatabaseRealm({
        name: 'supported-primary-key',
        version: '1',
        tables: { records: { id: definition, value: 'text' } },
      });
      expect(realm.tables.records?.id).toBe(definition);
    }

    for (const definition of [
      'real primary key',
      'blob primary key',
      'numeric primary key',
      'primary key',
    ]) {
      try {
        defineDatabaseRealm({
          name: 'unsupported-primary-key',
          version: '1',
          tables: { records: { id: definition, value: 'text' } },
        });
        throw new Error('Expected unsupported primary-key affinity to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe('DATABASE_CONFIG_INVALID');
        expect((error as DatabaseError).message)
          .toBe('Database realm table "records" primary-key column "id" must declare TEXT or INTEGER affinity.');
      }
    }
  });

  test('rejects non-portable Fabric value affinities before actor startup', () => {
    for (const [definition, affinity] of [
      ['blob', 'BLOB'],
      ['"BLOB"', 'BLOB'],
      ['blobless', 'BLOB'],
      ['not null default 1', 'TYPELESS'],
      ['unique', 'TYPELESS'],
    ] as const) {
      expectDatabaseConfigMessage(() => defineDatabaseRealm({
        name: 'non-portable-value',
        version: '1',
        tables: {
          records: { id: 'text primary key', value: definition },
        },
      }), `column "value" has ${affinity} affinity`);
    }

    expect(() => defineDatabaseRealm({
      name: 'portable-values',
      version: '1',
      tables: {
        records: {
          id: 'text primary key',
          ratio: 'real',
          amount: 'numeric',
          ordinary_hidden_word: 'text hidden',
        },
      },
    })).not.toThrow();
  });

  test('rejects generated columns without mistaking quoted or nested AS tokens', () => {
    for (const definition of [
      'text generated always as (upper(id)) virtual',
      'text generated/**/always/**/as/**/(upper(id)) stored',
      'text as (upper(id))',
      'text\ufeffAS\ufeff(upper(id)) virtual',
    ]) {
      expectDatabaseConfigMessage(() => defineDatabaseRealm({
        name: 'generated-column',
        version: '1',
        tables: {
          records: { id: 'text primary key', derived: definition },
        },
      }), 'generated columns are not supported');
    }

    expect(() => defineDatabaseRealm({
      name: 'generated-false-positives',
      version: '1',
      tables: {
        records: {
          id: 'text primary key',
          quoted: "text default 'generated always as (id) stored'",
          nested: "text check (cast(id as text) <> '')",
          quoted_type: '"AS"',
          generated_type_word: 'text generated',
          generated_constraint_name: 'text constraint generated not null',
          ordinary_hidden_word: 'text hidden',
        },
      },
    })).not.toThrow();
  });

  test('rejects foreign-key actions that bypass tracked row mutations', () => {
    for (const action of [
      'on delete cascade',
      'on update cascade',
      'on delete set/**/null',
      'on update set default',
      'on delete -- comment through bare CR\r\n cascade',
    ]) {
      expectDatabaseConfigMessage(() => defineDatabaseRealm({
        name: 'mutating-foreign-key',
        version: '1',
        tables: {
          parents: { id: 'text primary key' },
          children: {
            id: 'text primary key',
            parent_id: `text references parents(id) ${action}`,
          },
        },
      }), 'uses a mutating foreign-key action');
    }

    expect(() => defineDatabaseRealm({
      name: 'safe-foreign-key-actions',
      version: '1',
      tables: {
        parents: { id: 'text primary key' },
        children: {
          id: 'text primary key',
          parent_id: 'text references parents(id) on delete restrict on update no action',
          note: "text default 'references parents(id) on delete cascade'",
          checked: "text check (cast(id as text) <> 'on update set null')",
          commented: 'text references parents(id) -- on delete cascade\r not null\n',
        },
      },
    })).not.toThrow();
  });

  test('rejects SQLite and Zero object names reserved inside Fabric files', () => {
    for (const table of [
      'sqlite_future',
      'SQLITE_SCHEMA_COPY',
      '_zero_future',
      'IDX_ZERO_FUTURE',
      '_changes',
      '_CHANGE_SEQUENCE',
      '_migrations',
    ]) {
      expectDatabaseConfigMessage(() => defineDatabaseRealm({
        name: 'reserved-table-name',
        version: '1',
        tables: { [table]: { id: 'text primary key' } },
      }), `table name "${table}" is reserved`);
    }

    expect(() => defineDatabaseRealm({
      name: 'application-internal-names',
      version: '1',
      tables: {
        _internal: { id: 'text primary key' },
        zero_documents: { id: 'text primary key' },
        idx_app_lookup: { id: 'text primary key' },
      },
    })).not.toThrow();
  });

  test('rejects generated natural-identity index namespace collisions', () => {
    expectDatabaseConfigMessage(() => defineDatabaseRealm({
      name: 'identity-table-collision',
      version: '1',
      tables: {
        IDX_DOCUMENTS_IDENTITY: { id: 'text primary key' },
        documents: {
          id: 'text primary key',
          owner_id: 'text not null',
          _identity: ['owner_id'],
        },
      },
    }), 'collides with the generated identity index');

    expectDatabaseConfigMessage(() => defineDatabaseRealm({
      name: 'identity-reserved-collision',
      version: '1',
      tables: {
        zero_documents: {
          id: 'text primary key',
          owner_id: 'text not null',
          _identity: ['owner_id'],
        },
      },
    }), 'generates reserved SQLite object name "idx_zero_documents_identity"');
  });

  test('rejects table-constraint injection from a column definition', () => {
    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'escaped-column-slot',
      version: '1',
      tables: {
        records: {
          id: 'text',
          other: 'text unique, primary key (id, other)',
        },
      },
    }), 'DATABASE_CONFIG_INVALID');

    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'comment-hidden-key',
      version: '1',
      tables: {
        records: {
          id: 'text unique-- hidden through bare CR\rprimary key\n',
        },
      },
    }), 'DATABASE_CONFIG_INVALID');

    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'unicode-joined-key',
      version: '1',
      tables: {
        records: {
          id: 'text\u00a0primary key unique',
        },
      },
    }), 'DATABASE_CONFIG_INVALID');

    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'unicode-folded-keyword',
      version: '1',
      tables: {
        records: {
          id: 'text prımary key unique',
        },
      },
    }), 'DATABASE_CONFIG_INVALID');

    expectDatabaseCode(() => defineDatabaseRealm({
      name: 'ambiguous-quoted-type',
      version: '1',
      tables: {
        records: {
          id: '"REAL" text primary key',
        },
      },
    }), 'DATABASE_CONFIG_INVALID');

    expect(() => defineDatabaseRealm({
      name: 'nested-column-syntax',
      version: '1',
      tables: {
        records: {
          note: "text default 'primary key, not null'",
          id: 'text primary key',
          amount: 'decimal(10, 2) check (amount in (1, 2, 3))',
        },
      },
    })).not.toThrow();
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
    const throwingThenResult = (() => {
      const result = Object.create(null) as object;
      Object.defineProperty(result, 'then', {
        enumerable: true,
        get() {
          throw new Error('hostile then accessor');
        },
      });
      return result;
    }) as unknown as DatabaseReadQueryHandler;
    const realm = defineDatabaseRealm({
      name: 'query-data',
      version: '1',
      tables: { notes: { id: 'text primary key', body: 'text not null' } },
      queries: {
        'notes.get': ({ database }, input: { id: string }) =>
          (database.query('SELECT id, body FROM notes WHERE id = ?').get(input.id)
            ?? null) as Row | null,
        'notes.throwingThen': throwingThenResult,
      },
    });
    const readonlyDatabase = Database.deserialize(database.serialize(), {
      readonly: true,
      strict: true,
    });
    const query = (name: string, input: DatabaseSerializableValue) =>
      withDatabaseReadQuerySession(
        createDatabaseReadQuerySession(readonlyDatabase),
        (context) => runDatabaseRealmQuery(realm, context, name, input),
      );

    try {
      const result = query('notes.get', { id: 'one' });
      expect(result).toEqual({ id: 'one', body: 'hello' });
      expect(Object.isFrozen(result)).toBe(true);
      expectDatabaseCode(
        () => query('notes.missing', null),
        'DATABASE_OPERATION_UNSUPPORTED',
      );
      expectDatabaseCode(
        () => query('notes.throwingThen', null),
        'DATABASE_RESULT_LIMIT',
      );
    } finally {
      readonlyDatabase.close();
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
    const throwingThenResult = (({ db }: DatabaseWriteCommandContext) => {
      db.createStrict('todos', { id: 'poisoned', title: 'No commit' });
      const result = Object.create(null) as object;
      Object.defineProperty(result, 'then', {
        enumerable: true,
        get() {
          throw new Error('hostile then accessor');
        },
      });
      return result;
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
        throwingThenResult,
      },
    });

    try {
      const result = runDatabaseRealmCommand(
        realm,
        db,
        'todos.create',
        { id: 'committed', title: 'Stored' },
      );
      expect(result).toEqual({ id: 'committed', seq: 1 });
      expect(db.get('todos', 'committed')).toEqual({
        id: 'committed', title: 'Stored',
      });

      expectDatabaseCode(() => runDatabaseRealmCommand(
        realm,
        db,
        'unsafeAsyncResult',
        null,
      ), 'DATABASE_OPERATION_UNSUPPORTED');
      expect(db.get('todos', 'rolled-back')).toBeNull();
      expect(db.currentSeq).toBe(1);

      expectDatabaseCode(() => runDatabaseRealmCommand(
        realm,
        db,
        'throwingThenResult',
        null,
      ), 'DATABASE_RESULT_LIMIT');
      expect(db.get('todos', 'poisoned')).toBeNull();
      expect(db.currentSeq).toBe(1);
    } finally {
      db.dispose();
    }
  });

  test('keeps projected Guardian anchors readable but immutable to realm commands', () => {
    const tasks = defineTable('protected_tasks', {
      membership_id: field.guardianMembership(),
      title: field.text({ required: true }),
    }, { pk: 'task_id' });
    const realm = defineDatabaseRealm({
      name: 'guardian-anchor-command-fence',
      version: '1',
      tables: { protected_tasks: tasks.serverTable },
      commands: {
        'anchors.mutate': ({ db }, input: { method: string }) => {
          const row = { user_id: 'user-one' };
          switch (input.method) {
            case 'insert':
              db.insert('users', { user_id: 'attacker' });
              break;
            case 'create':
              db.create('users', { user_id: 'attacker' });
              break;
            case 'createStrict':
              db.createStrict('users', { user_id: 'attacker' });
              break;
            case 'createScoped':
              db.createScoped('users', { user_id: 'attacker' }, {
                field: 'user_id',
                value: 'attacker',
              });
              break;
            case 'update':
              db.update('users', 'user-one', { user_id: 'attacker' });
              break;
            case 'updateIfCurrent':
              db.updateIfCurrent('users', 'user-one', { user_id: 'attacker' }, row);
              break;
            case 'updateScoped':
              db.updateScoped('users', 'user-one', { user_id: 'attacker' }, {
                field: 'user_id',
                value: 'user-one',
              }, row);
              break;
            case 'delete':
              db.delete('users', 'user-one');
              break;
            case 'deleteIfCurrent':
              db.deleteIfCurrent('users', 'user-one', row);
              break;
            case 'deleteScoped':
              db.deleteScoped('users', 'user-one', {
                field: 'user_id',
                value: 'user-one',
              }, row);
              break;
            case 'upsertByIdentity':
              db.upsertByIdentity('users', { user_id: 'attacker' });
              break;
            case 'updateByIdentity':
              db.updateByIdentity('users', { user_id: 'user-one' }, {
                user_id: 'attacker',
              });
              break;
            case 'deleteByIdentity':
              db.deleteByIdentity('users', { user_id: 'user-one' });
              break;
          }
          return null;
        },
        'anchors.deleteMembership': ({ db }) => {
          db.delete('tenant_memberships', 'membership-one');
          return null;
        },
        'tasks.create': ({ db }) => {
          const membership = db.get('tenant_memberships', 'membership-one');
          if (!membership || membership.user_id !== 'user-one') {
            throw new Error('Missing projected membership');
          }
          const change = db.createStrict('protected_tasks', {
            task_id: 'task-one',
            membership_id: 'membership-one',
            title: 'Allowed realm write',
          });
          return { rowId: change.rowId, userId: membership.user_id };
        },
      },
    });
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('users', { user_id: 'text primary key' });
    db.defineTable('tenant_memberships', {
      membership_id: 'text primary key',
      tenant_id: 'text not null',
      user_id: 'text references users(user_id) on delete restrict not null',
    });
    db.defineTable('protected_tasks', tasks.serverTable);
    db.createStrict('users', { user_id: 'user-one' });
    db.createStrict('tenant_memberships', {
      membership_id: 'membership-one',
      tenant_id: 'tenant-one',
      user_id: 'user-one',
    });

    try {
      const methods = [
        'insert',
        'create',
        'createStrict',
        'createScoped',
        'update',
        'updateIfCurrent',
        'updateScoped',
        'delete',
        'deleteIfCurrent',
        'deleteScoped',
        'upsertByIdentity',
        'updateByIdentity',
        'deleteByIdentity',
      ];
      for (const method of methods) {
        expectDatabaseCode(() => runDatabaseRealmCommand(
          realm,
          db,
          'anchors.mutate',
          { method },
        ), 'DATABASE_OPERATION_UNSUPPORTED');
      }
      expectDatabaseCode(() => runDatabaseRealmCommand(
        realm,
        db,
        'anchors.deleteMembership',
        null,
      ), 'DATABASE_OPERATION_UNSUPPORTED');
      expect(db.get('users', 'user-one')).toEqual({ user_id: 'user-one' });
      expect(db.get('users', 'attacker')).toBeNull();
      expect(db.get('tenant_memberships', 'membership-one')).toEqual({
        membership_id: 'membership-one',
        tenant_id: 'tenant-one',
        user_id: 'user-one',
      });

      expect(runDatabaseRealmCommand(
        realm,
        db,
        'tasks.create',
        null,
      )).toEqual({ rowId: 'task-one', userId: 'user-one' });
      expect(db.get('protected_tasks', 'task-one')).toEqual({
        task_id: 'task-one',
        membership_id: 'membership-one',
        title: 'Allowed realm write',
      });
    } finally {
      db.dispose();
    }
  });

  test('gives commands only a frozen tracked-data capability', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', {
      id: 'text primary key',
      title: 'text not null',
    });
    let afterCommitRan = false;
    let afterCommitEscapeCode: DatabaseErrorCode | null = null;
    let retainedCapability: DatabaseWriteCommandCapability | null = null;
    const realm = defineDatabaseRealm({
      name: 'command-capability',
      version: '1',
      tables: { todos: { id: 'text primary key', title: 'text not null' } },
      commands: {
        'todos.inspect': (context) => {
          const capability = context.db;
          retainedCapability = capability;
          const hostile = capability as unknown as Record<string, unknown>;
          expect(Object.getPrototypeOf(context)).toBeNull();
          expect(Object.getPrototypeOf(capability)).toBeNull();
          expect(Object.isFrozen(context)).toBe(true);
          expect(Object.isFrozen(capability)).toBe(true);
          expect(Object.getOwnPropertySymbols(capability)).toEqual([]);
          expect(Object.keys(capability).sort()).toEqual([
            'afterCommit',
            'create',
            'createScoped',
            'createStrict',
            'delete',
            'deleteByIdentity',
            'deleteIfCurrent',
            'deleteScoped',
            'get',
            'getIdentity',
            'getScoped',
            'identityKey',
            'insert',
            'list',
            'query',
            'queryByIdentity',
            'queryOne',
            'transaction',
            'update',
            'updateByIdentity',
            'updateIfCurrent',
            'updateScoped',
            'upsertByIdentity',
          ]);
          for (const denied of [
            'exec',
            'prepare',
            'getRawDatabase',
            'getSQLiteService',
            'defineTable',
            'onChange',
            'dispose',
            'recordInternalChange',
            'currentSeq',
          ]) {
            expect(denied in capability).toBe(false);
            expect(hostile[denied]).toBeUndefined();
          }
          expect(() => Object.defineProperty(capability, 'exec', {
            value: () => undefined,
          })).toThrow();

          const change = capability.transaction((nested) => {
            expect(nested).toBe(capability);
            return nested.createStrict('todos', {
              id: 'tracked',
              title: 'Stored through the facade',
            });
          });
          capability.afterCommit(() => {
            afterCommitRan = true;
            try {
              capability.createStrict('todos', {
                id: 'after-commit-escape',
                title: 'Must not be stored',
              });
            } catch (error) {
              afterCommitEscapeCode = (error as DatabaseError).code;
            }
          });
          return { id: change.rowId, found: capability.get('todos', 'tracked') };
        },
      },
    });

    try {
      expect(runDatabaseRealmCommand(
        realm,
        db,
        'todos.inspect',
        null,
      )).toEqual({
        id: 'tracked',
        found: { id: 'tracked', title: 'Stored through the facade' },
      });
      expect(afterCommitRan).toBe(true);
      expect(afterCommitEscapeCode as DatabaseErrorCode | null)
        .toBe('DATABASE_CLOSED');
      expect(db.get('todos', 'after-commit-escape')).toBeNull();
      expect(db.get('todos', 'tracked')).toEqual({
        id: 'tracked',
        title: 'Stored through the facade',
      });
      const retained = retainedCapability!;
      const sequenceAfterCommand = db.currentSeq;
      for (const operation of [
        () => retained.get('todos', 'tracked'),
        () => retained.createStrict('todos', {
          id: 'escaped',
          title: 'Must not be stored',
        }),
        () => retained.transaction(() => null),
        () => retained.afterCommit(() => undefined),
      ]) {
        expectDatabaseCode(operation, 'DATABASE_CLOSED');
      }
      expect(db.currentSeq).toBe(sequenceAfterCommand);
      expect(db.get('todos', 'escaped')).toBeNull();
    } finally {
      db.dispose();
    }
  });
});
