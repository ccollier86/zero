/**
 * Owned MEMORY snapshots only. These tests prove generic validation and absence
 * of SQL/data mutation, not physical inode/WAL/hot/process admission ordering.
 */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { MigrationLedger } from '../migrations/migration-ledger';
import { createReactiveDB } from '../sync/reactive-db';
import { createDatabaseRef } from './database-file';
import {
  assertDatabaseOpenAdmission,
  assertDatabaseOpenAdmissionTransition,
  databaseOpenAdmissionFingerprint,
  normalizeDatabaseOpenAdmission,
  resolveDatabaseOpenAdmission,
  type DatabaseOpenAdmission,
} from './database-open-admission';
import { initializeDatabaseReceiptSchema } from './database-receipt-schema';
import { defineDatabaseRealm, type DatabaseRealm } from './database-realm';
import type { DatabaseRuntime } from './database-runtime';

const realm = defineDatabaseRealm({ name: 'open-admission-memory', version: '1', tables: {
  _owner: { id: 'text primary key', owner_id: 'text not null', scope_id: 'text not null' },
}, migrations: [{ version: '001', description: 'synthetic owner table', up(database) {
  database.run('CREATE TABLE _owner(id text primary key, owner_id text not null, scope_id text not null)');
} }] });
const databaseRef = createDatabaseRef('synthetic-open-admission');
const instanceId = '00000000-0000-4000-8000-000000000001';
const current: DatabaseOpenAdmission = { schema: 'current', row: {
  table: '_owner', id: 'application', equals: { owner_id: 'synthetic-owner', scope_id: 'application' },
} };

function fixture(mutate?: (database: Database, ledger: MigrationLedger, reactive: ReturnType<typeof createReactiveDB>) => void): Database {
  const source = new Database(':memory:');
  let reactive: ReturnType<typeof createReactiveDB> | null = null;
  let migrator: Migrator | null = null;
  try {
    source.run('PRAGMA temp_store=MEMORY');
    source.run(`CREATE TABLE _zero_database_binding_v1 (
      singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton=1),
      format_version INTEGER NOT NULL CHECK(format_version=1),
      database_ref TEXT NOT NULL CHECK(length(database_ref)=64),
      instance_id TEXT NOT NULL CHECK(length(instance_id)=36),
      realm_name TEXT NOT NULL CHECK(length(realm_name) BETWEEN 1 AND 128)
    ) WITHOUT ROWID`);
    source.run('INSERT INTO _zero_database_binding_v1 VALUES(1,1,?,?,?)', [databaseRef, instanceId, realm.name]);
    for (const action of ['insert', 'update', 'delete']) {
      source.run(`CREATE TRIGGER _zero_database_binding_${action}_guard_v1 BEFORE ${action} ON _zero_database_binding_v1
        BEGIN SELECT RAISE(ABORT,'zero database binding is immutable'); END`);
    }
    migrator = new Migrator({ database: source, dbPath: ':memory:', migrations: realm.migrations,
      applyPragmas: false, createBackups: false, log() {} });
    migrator.run();
    reactive = createReactiveDB({ database: source, ownsDatabase: false });
    for (const [table, schema] of Object.entries(realm.tables)) reactive.defineTable(table, schema);
    initializeDatabaseReceiptSchema({ runtime: { db: reactive } as DatabaseRuntime,
      realmFingerprint: realm.fingerprint, validateLegacyResult() {} });
    source.run("INSERT INTO _owner VALUES('application','synthetic-owner','application')");
    mutate?.(source, new MigrationLedger(source), reactive);
    const copy = Database.deserialize(source.serialize(), { readonly: true, strict: true });
    try {
      copy.run('PRAGMA temp_store=MEMORY');
      copy.run('PRAGMA query_only=ON');
      return copy;
    } catch (error) { copy.close(); throw error; }
  } finally {
    reactive?.dispose();
    migrator?.dispose();
    source.close();
  }
}

function assert(database: Database, admission: DatabaseOpenAdmission = current, assignedRealm: DatabaseRealm = realm): void {
  assertDatabaseOpenAdmission({ database, admission, realm: assignedRealm, databaseRef, instanceId });
}

function unchanged(database: Database, run: () => void): void {
  const bytes = database.serialize();
  const schema = database.query('PRAGMA schema_version').get();
  const seq = database.query('SELECT seq FROM _zero_sync_log_state').get();
  const changes = database.query('SELECT total_changes() AS changes').get();
  try { run(); }
  finally {
    expect(database.serialize()).toEqual(bytes);
    expect(database.query('PRAGMA schema_version').get()).toEqual(schema);
    expect(database.query('SELECT seq FROM _zero_sync_log_state').get()).toEqual(seq);
    expect(database.query('SELECT total_changes() AS changes').get()).toEqual(changes);
  }
}

test('open admission normalizes a detached frozen realm-owned row assertion', () => {
  const input = { schema: 'current', row: { table: '_owner', id: 'application', equals: { owner_id: 'synthetic-owner' } } };
  const normalized = normalizeDatabaseOpenAdmission(input, realm);
  input.row.equals.owner_id = 'changed-after-admission';
  expect(normalized).toEqual({ schema: 'current', row: { table: '_owner', id: 'application', equals: { owner_id: 'synthetic-owner' } } });
  expect(Object.isFrozen(normalized)).toBe(true);
  expect(Object.isFrozen(normalized.row)).toBe(true);
  expect(Object.isFrozen(normalized.row!.equals)).toBe(true);
});

test('open admission rejects callbacks, accessors, unknown fields, undeclared tables/columns and nonscalars', () => {
  let getterCalls = 0;
  const getter = { get schema() { getterCalls++; return 'current'; } };
  for (const value of [null, [], {}, { schema: 'other' }, { schema: 'current', path: '/private' },
    { schema: 'current', row: null }, { schema: 'current', row: { table: '_owner', id: '', equals: { owner_id: 'x' } } },
    { schema: 'current', row: { table: '_zero_sync_log_state', id: '1', equals: { seq: 0 } } },
    { schema: 'current', row: { table: '_owner', id: 'application', equals: {} } },
    { schema: 'current', row: { table: '_owner', id: 'application', equals: { missing: 'x' } } },
    { schema: 'current', row: { table: '_owner', id: 'application', equals: { owner_id: [] } } },
    { schema: 'current', row: { table: '_owner', id: 'application', equals: { owner_id: NaN } } },
    { schema: 'current', row: { table: '_owner', id: 1.5, equals: { owner_id: 'x' } } },
    { schema: 'current', row: { table: '_owner', id: 'application', equals: { owner_id: 'x' }, sql: 'SELECT 1' } },
    { schema: 'prepare', check() {} }, getter]) {
    expect(() => normalizeDatabaseOpenAdmission(value, realm)).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
  }
  expect(getterCalls).toBe(0);
});

test('current admission accepts a native-current owner snapshot without mutation', () => {
  const database = fixture();
  try { unchanged(database, () => expect(() => assert(database)).not.toThrow()); }
  finally { database.close(); }
});

test('current admission accepts advanced managed history while the legacy allocator remains frozen', () => {
  const database = fixture((_source, _ledger, reactive) => {
    reactive.create('_owner', { id: 'other', owner_id: 'synthetic-other', scope_id: 'application' });
  });
  try {
    expect(database.query('SELECT seq FROM _zero_sync_log_state').get()).toEqual({ seq: 1 });
    expect(database.query('SELECT seq FROM _change_sequence').get()).toEqual({ seq: 0 });
    unchanged(database, () => expect(() => assert(database)).not.toThrow());
  } finally { database.close(); }
});

test('cold history proof streams instead of all() and finalizes its statement on success and failure', () => {
  for (const corrupt of [false, true]) {
    const database = fixture((source, _ledger, reactive) => {
      reactive.create('_owner', { id: 'other', owner_id: 'synthetic-other', scope_id: 'application' });
      if (corrupt) {
        source.run('DROP TRIGGER _zero_sync_changes_update_fence_v1');
        source.run("UPDATE _changes SET data='not-json' WHERE seq=1");
      }
    });
    let iterations = 0;
    let finalizations = 0;
    const reader = {
      prepare(sql: string) {
        const statement = database.prepare(sql);
        if (!sql.includes('FROM main._changes WHERE seq IS NOT 0')) return statement;
        return {
          all() { throw new Error('retained history must not be buffered with all()'); },
          iterate() { iterations++; return statement.iterate(); },
          finalize() { finalizations++; statement.finalize(); },
        };
      },
      transaction: database.transaction.bind(database),
    } as Database;
    try {
      unchanged(database, () => {
        const validate = () => assertDatabaseOpenAdmission({ database: reader, realm, admission: current, databaseRef, instanceId });
        if (corrupt) expect(validate).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
        else expect(validate).not.toThrow();
      });
      expect(iterations).toBe(1);
      expect(finalizations).toBe(1);
    } finally { database.close(); }
  }
});

test('row admission compares scalar booleans using SQLite integer storage without text coercion', () => {
  const booleanRealm = defineDatabaseRealm({ name: realm.name, version: 'boolean-memory',
    tables: { _owner: { ...realm.tables._owner!, enabled: 'integer not null default 1' } }, migrations: realm.migrations });
  for (const enabled of [0, 1]) {
    const database = fixture(source => {
      source.run('ALTER TABLE _owner ADD COLUMN enabled integer not null default 1');
      source.run('UPDATE _owner SET enabled=?', [enabled]);
    });
    try {
      const run = (expected: boolean | string) => assertDatabaseOpenAdmission({ database, realm: booleanRealm,
        admission: { schema: 'current', row: { ...current.row!, equals: { enabled: expected } } }, databaseRef, instanceId });
      unchanged(database, () => {
        expect(() => run(enabled === 1)).not.toThrow();
        expect(() => run(enabled !== 1)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
        expect(() => run(String(enabled))).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
      });
    } finally { database.close(); }
  }
});

test('missing and substituted owner fail before ledger preparation or migration', () => {
  for (const sql of ["DELETE FROM _owner", "UPDATE _owner SET owner_id='substituted'", "UPDATE _owner SET scope_id='other'"]) {
    const database = fixture(source => { source.run(sql); source.run('DROP TABLE _zero_migrations'); });
    try {
      unchanged(database, () => {
        for (const schema of ['prepare', 'current'] as const) {
          expect(() => assert(database, { ...current, schema })).toThrow(expect.objectContaining({
            code: 'DATABASE_SCHEMA_MISMATCH', outcome: 'not-started', details: { component: 'open-admission', reason: 'row' },
          }));
        }
      });
    } finally { database.close(); }
  }
});

test('stale, missing, legacy-only, checksum-mismatched and unknown durable ledger state never repairs', () => {
  for (const mutate of [
    (source: Database) => source.run('DELETE FROM _zero_migrations'),
    (source: Database) => source.run('DROP TABLE _zero_migrations'),
    (source: Database) => source.run("UPDATE _zero_migrations SET checksum='substituted'"),
    (source: Database) => {
      source.run('ALTER TABLE _zero_migrations RENAME TO previous_native_ledger');
      source.run('CREATE VIEW _zero_migrations AS SELECT * FROM previous_native_ledger');
    },
    (source: Database) => {
      source.run('ALTER TABLE _zero_migrations RENAME TO previous_native_ledger');
      source.run('CREATE TABLE _zero_migrations AS SELECT * FROM previous_native_ledger');
    },
    (_source: Database, ledger: MigrationLedger) => ledger.recordRolledBack({ migration: realm.migrations[0]!,
      checksum: realm.migrationChecksums[0]!.checksum, safety: 'safe', batch: 2, durationMs: 0, schemaHash: null }),
    (_source: Database, ledger: MigrationLedger) => ledger.recordApplied({ migration: {
      version: 'unknown', description: 'synthetic unknown state', up() {},
    }, checksum: 'unknown', safety: 'safe', batch: 2, durationMs: 0, schemaHash: null }),
  ]) {
    const database = fixture(mutate);
    try {
      unchanged(database, () => expect(() => assert(database)).toThrow(expect.objectContaining({
        code: 'DATABASE_SCHEMA_MISMATCH', outcome: 'not-started',
      })));
    } finally { database.close(); }
  }
});

test('a failed rollback does not hide the last applied native migration state', () => {
  const database = fixture((_source, ledger) => ledger.recordFailed({ migration: realm.migrations[0]!,
    checksum: realm.migrationChecksums[0]!.checksum, safety: 'safe', batch: 2, durationMs: 0,
    schemaHash: null, direction: 'down', error: 'synthetic failure' }));
  try { unchanged(database, () => expect(() => assert(database)).not.toThrow()); }
  finally { database.close(); }
});

test('explicit preparation proves the owner but permits stale ledger/schema for later migration', () => {
  const database = fixture(source => { source.run('DROP TABLE _zero_migrations'); source.run('ALTER TABLE _owner ADD COLUMN obsolete text'); });
  try { unchanged(database, () => expect(() => assert(database, { ...current, schema: 'prepare' })).not.toThrow()); }
  finally { database.close(); }
});

test('prepare-only allowMissing permits absent owner table/row but never an existing mismatch', () => {
  const admission: DatabaseOpenAdmission = { schema: 'prepare', row: { ...current.row!, allowMissing: true } };
  for (const sql of ['DELETE FROM _owner', 'DROP TABLE _owner']) {
    const database = fixture(source => source.run(sql));
    try { unchanged(database, () => expect(() => assert(database, admission)).not.toThrow()); }
    finally { database.close(); }
  }
  const database = fixture(source => source.run("UPDATE _owner SET owner_id='substituted'"));
  try {
    unchanged(database, () => expect(() => assert(database, admission)).toThrow(expect.objectContaining({
      code: 'DATABASE_SCHEMA_MISMATCH', details: { component: 'open-admission', reason: 'row' },
    })));
  } finally { database.close(); }
  for (const value of [{ ...admission, schema: 'current' },
    { ...admission, row: { ...admission.row!, allowMissing: false } }]) {
    expect(() => normalizeDatabaseOpenAdmission(value, realm)).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
  }
});

test('native admission resolver rejects asynchronous results and detaches each synchronous snapshot', async () => {
  let calls = 0;
  const input = { schema: 'prepare' as const, row: { ...current.row!, equals: { owner_id: 'synthetic-owner' } } };
  const resolver = () => { calls++; return input; };
  const first = resolveDatabaseOpenAdmission(resolver, 'synthetic', realm)!;
  input.row.equals.owner_id = 'changed';
  expect(first.row!.equals.owner_id).toBe('synthetic-owner');
  expect(resolveDatabaseOpenAdmission(resolver, 'synthetic', realm)!.row!.equals.owner_id).toBe('changed');
  expect(calls).toBe(2);
  for (const invalid of [async () => input, function* () { yield input; }, () => Promise.reject(new Error('synthetic rejection'))]) {
    expect(() => resolveDatabaseOpenAdmission(invalid as never, 'synthetic', realm)).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
  }
  await Promise.resolve(); // Observe the deliberately rejected promise through resolver cleanup.
});

test('admission continuation permits strengthening but rejects owner retargeting or policy weakening', () => {
  const staged: DatabaseOpenAdmission = { schema: 'prepare', row: { ...current.row!, allowMissing: true } };
  const prepared: DatabaseOpenAdmission = { schema: 'prepare', row: current.row };
  expect(() => assertDatabaseOpenAdmissionTransition(undefined, staged)).not.toThrow();
  expect(() => assertDatabaseOpenAdmissionTransition(staged, prepared)).not.toThrow();
  expect(() => assertDatabaseOpenAdmissionTransition(prepared, current)).not.toThrow();
  for (const [previous, next] of [
    [staged, undefined], [current, prepared], [prepared, staged],
    [staged, { schema: 'prepare' }],
    [staged, { ...staged, row: { ...staged.row!, id: 'other' } }],
    [staged, { ...staged, row: { ...staged.row!, table: 'other' } }],
    [staged, { ...staged, row: { ...staged.row!, equals: { owner_id: 'other' } } }],
  ] as const) {
    expect(() => assertDatabaseOpenAdmissionTransition(previous, next)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
  }
  expect(databaseOpenAdmissionFingerprint({ schema: 'current', row: { ...current.row!, equals: {
    scope_id: 'application', owner_id: 'synthetic-owner',
  } } })).toBe(databaseOpenAdmissionFingerprint(current));
  expect(databaseOpenAdmissionFingerprint(staged)).not.toBe(databaseOpenAdmissionFingerprint(current));
});

test('current admission refuses physical declared-schema drift without changing sequence or bytes', () => {
  const database = fixture(source => source.run('ALTER TABLE _owner ADD COLUMN obsolete text'));
  try {
    unchanged(database, () => expect(() => assert(database)).toThrow(expect.objectContaining({
      code: 'DATABASE_SCHEMA_MISMATCH', details: { component: 'open-admission', reason: 'realm' },
    })));
  } finally { database.close(); }
});

test('explicit preparation never broadens owner primary-key proof through SQLite collation', () => {
  const database = fixture(source => {
    source.run('DROP TABLE _owner');
    source.run('CREATE TABLE _owner(id text primary key collate nocase, owner_id text not null, scope_id text not null)');
    source.run("INSERT INTO _owner VALUES('Application','synthetic-owner','application')");
  });
  try {
    unchanged(database, () => expect(() => assert(database, { ...current, schema: 'prepare' })).toThrow(expect.objectContaining({
      code: 'DATABASE_SCHEMA_MISMATCH', details: { component: 'open-admission', reason: 'row' },
    })));
  } finally { database.close(); }
});

test('current admission requires pending configured migrations and declared natural-identity indexes', () => {
  const pending = defineDatabaseRealm({ name: realm.name, version: '2', tables: realm.tables,
    migrations: [...realm.migrations, { version: '002', description: 'synthetic pending migration', up() {} }] });
  const identity = defineDatabaseRealm({ name: realm.name, version: '2',
    tables: { _owner: { ...realm.tables._owner!, _identity: ['owner_id'] } }, migrations: realm.migrations });
  const database = fixture();
  try {
    unchanged(database, () => {
      for (const expectedRealm of [pending, identity]) {
        expect(() => assertDatabaseOpenAdmission({ database, realm: expectedRealm, admission: current, databaseRef, instanceId }))
          .toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH', outcome: 'not-started' }));
      }
    });
  } finally { database.close(); }
});

test('current admission requires already-prepared framework receipts without installing them', () => {
  const database = fixture(source => source.run('DROP TABLE _zero_database_operation_receipts'));
  try {
    unchanged(database, () => expect(() => assert(database)).toThrow(expect.objectContaining({
      code: 'DATABASE_SCHEMA_MISMATCH', details: { component: 'open-admission', reason: 'receipts' },
    })));
  } finally { database.close(); }
});

test('admission requires query-only source discipline and expected immutable instance identity', () => {
  const database = fixture();
  try {
    database.run('PRAGMA query_only=OFF');
    expect(() => assert(database)).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
    database.run('PRAGMA query_only=ON');
    unchanged(database, () => expect(() => assertDatabaseOpenAdmission({ database, realm, admission: current,
      databaseRef, instanceId: '00000000-0000-4000-8000-000000000002' })).toThrow(expect.objectContaining({
      code: 'DATABASE_SCHEMA_MISMATCH', details: { component: 'open-admission', reason: 'binding' },
    })));
  } finally { database.close(); }
});
