/** Owned raw MEMORY only. Exact migration path, no latest table predefinition. */
import { Database } from 'bun:sqlite';
import { expect, test, spyOn } from 'bun:test';
import { Migrator, type Migration } from '../migrations/migrator';
import { defineDatabaseRealm } from './database-realm';
import { assertDatabaseRealmMigrationSource, type DatabaseRealmMigrationTableStage } from './database-realm-migration-tables';
import { resolveDatabaseOpenAdmission, assertDatabaseOpenAdmission } from './database-open-admission';
import { createReactiveDB } from '../sync/reactive-db';
import { initializeDatabaseReceiptSchema } from './database-receipt-schema';
import { LoggingSourceOutbox } from '../logging/logging-source-outbox';
import { captureLoggingEvent } from '../logging/logging-validation';
import { assertDatabaseMigrationSourceFramework } from './database-realm-source-framework';
import { createDatabaseRef } from './database-file';
import { DatabaseRuntime } from './database-runtime';
import { createPlatformSQLiteService } from '../persistence';
import { CHANGE_LOG_TRIGGER_DEFINITIONS } from '../sync/reactive-db-change-log';

const one = { items: { id: 'TEXT PRIMARY KEY', value: 'TEXT NOT NULL' } };
const two = { ...one, _later: { id: 'TEXT PRIMARY KEY', item_id: 'TEXT NOT NULL REFERENCES items(id)', _identity: ['item_id'] } };
let failFirst = false, failSecond = false;
const migrations: Migration[] = [
  { version: '001', description: 'Original first handler', up(database) { database.run('CREATE INDEX original_items_value ON items(value)'); if (failFirst) throw new Error('synthetic first failure'); } },
  { version: '002', description: 'Original second handler', up(database) { database.run('CREATE INDEX original_later_item ON _later(item_id)'); if (failSecond) throw new Error('synthetic boundary failure'); } },
];
const stages: readonly DatabaseRealmMigrationTableStage[] = [{ version: '001', tables: one, prepare: 'create-added-tables' }, { version: '002', tables: two, prepare: 'create-added-tables' }];
const definition = { name: 'synthetic.migration-tables', version: '2', tables: two, migrations };
const realm = defineDatabaseRealm({ ...definition, migrationTableStages: stages });
function memory() { const db = new Database(':memory:'); db.run('PRAGMA temp_store=MEMORY'); db.run('PRAGMA foreign_keys=ON'); return db; }
function run(db: Database, target?: string) {
  const migrator = new Migrator({ database: db, dbPath: ':memory:', migrations, migrationTableStages: realm.migrationTableStages, createBackups: false, log() {} });
  try { return migrator.run(target); } finally { migrator.dispose(); }
}
function readonlySource(db: Database): number {
  const copy = Database.deserialize(db.serialize(), { readonly: true, strict: true });
  try { copy.run('PRAGMA query_only=ON'); return assertDatabaseRealmMigrationSource(copy, realm.migrationTableStages!, migrations); }
  finally { copy.close(); }
}
function sourceObjects(db: Database) {
  const statement = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name");
  try { return statement.all() as Parameters<typeof assertDatabaseMigrationSourceFramework>[1]; } finally { statement.finalize(); }
}
function nativeHistory(db: Database, prefix = 2) {
  const reactive = createReactiveDB({ database: db, ownsDatabase: false });
  try {
    for (const [name, declaration] of Object.entries(prefix === 1 ? one : two)) reactive.defineTable(name, declaration);
    reactive.createStrict('items', { id: 'owner', value: 'PRIVATE_OWNER' });
    initializeDatabaseReceiptSchema({ runtime: { db: reactive } as DatabaseRuntime, realmFingerprint: realm.fingerprint, validateLegacyResult() {} });
    const outbox = new LoggingSourceOutbox(reactive);
    outbox.enqueue(captureLoggingEvent({ sourceId: outbox.sourceId, origin: 'system', scope: { kind: 'application', tenantId: null },
      actor: { kind: 'system', id: 'synthetic', sessionId: null, initiatorId: null }, requestId: null, correlationId: null, policyVersion: 'synthetic' },
    { id: 'synthetic-source-event', family: 'records', action: 'record.created', outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: 0 }));
    db.run(`INSERT INTO _zero_database_operation_receipts
      (receipt_key,realm_fingerprint,operation_fingerprint,receipt_state,result_json,final_seq,result_version,schema_version,created_at,insertion_ordinal)
      VALUES('synthetic-receipt',?,?,'retained','{}',0,2,2,1,1)`, [realm.fingerprint, 'sha256:' + 'a'.repeat(64)]);
    return reactive;
  } catch (error) { reactive.dispose(); throw error; }
}
function addBinding(db: Database) {
  const reference = createDatabaseRef('synthetic-current-performance'), instance = '00000000-0000-4000-8000-000000000001';
  db.run(`CREATE TABLE _zero_database_binding_v1 (
    singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
    format_version INTEGER NOT NULL CHECK (format_version = 1),
    database_ref TEXT NOT NULL CHECK (length(database_ref) = 64),
    instance_id TEXT NOT NULL CHECK (length(instance_id) = 36),
    realm_name TEXT NOT NULL CHECK (length(realm_name) BETWEEN 1 AND 128)
  ) WITHOUT ROWID`);
  db.run('INSERT INTO _zero_database_binding_v1 VALUES(1,1,?,?,?)', [reference, instance, realm.name]);
  for (const action of ['INSERT', 'UPDATE', 'DELETE']) db.run(`CREATE TRIGGER _zero_database_binding_${action.toLowerCase()}_guard_v1 BEFORE ${action} ON _zero_database_binding_v1 BEGIN
    SELECT RAISE(ABORT, 'zero database binding is immutable'); END`);
  return { reference, instance };
}
function assertOrdinarySql(sql: readonly string[]) {
  expect(sql.filter(sql => /FROM (?:main\.)?_changes WHERE seq IS NOT 0/.test(sql))).toHaveLength(1);
  expect(sql.some(sql => /FROM _zero_database_operation_receipts ORDER BY/.test(sql))).toBe(false);
  expect(sql.some(sql => /FROM _zero_logging_contexts ORDER BY/.test(sql))).toBe(false);
  expect(sql.some(sql => /FROM _zero_logging_outbox o LEFT JOIN/.test(sql))).toBe(false);
}

for (const schema of ['current', 'prepare'] as const) test(`${schema} full-prefix admission keeps exact owner/schema/ledger and one Sync proof without receipt/logging payload walks`, () => {
  const db = memory(); let reactive: ReturnType<typeof nativeHistory> | undefined;
  try {
    const binding = addBinding(db); run(db); reactive = nativeHistory(db);
    // Current admission is not a full historical-payload attestation. The
    // explicit deep helper still rejects these bytes, and never repairs them.
    db.run("UPDATE _zero_logging_outbox SET payload='malformed'");
    const copy = Database.deserialize(db.serialize(), { readonly: true, strict: true });
    try {
      copy.run('PRAGMA query_only=ON'); const before = copy.serialize(), observe = spyOn(copy, 'prepare');
      try {
        assertDatabaseOpenAdmission({ database: copy, realm, databaseRef: binding.reference, instanceId: binding.instance,
          admission: { schema, row: { table: 'items', id: 'owner', equals: { value: 'PRIVATE_OWNER' } } } });
        assertOrdinarySql(observe.mock.calls.map(([sql]) => sql));
      } finally { observe.mockRestore(); }
      expect(() => assertDatabaseMigrationSourceFramework(copy, sourceObjects(copy))).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
      expect(copy.serialize()).toEqual(before);
    } finally { copy.close(); }
  } finally { try { reactive?.dispose(); } finally { db.close(); } }
});

test('full-prefix no-op Migrator preserves one Sync proof but never scans receipt/logging payload history', () => {
  const db = memory(); let reactive: ReturnType<typeof nativeHistory> | undefined, migrator: Migrator | undefined;
  try {
    run(db); reactive = nativeHistory(db); db.run("UPDATE _zero_logging_outbox SET payload='malformed'");
    const before = db.serialize(), observe = spyOn(db, 'prepare');
    try {
      migrator = new Migrator({ database: db, dbPath: ':memory:', migrations, migrationTableStages: realm.migrationTableStages, createBackups: false, log() {} });
      expect(migrator.run()).toEqual([]); assertOrdinarySql(observe.mock.calls.map(([sql]) => sql));
    } finally { observe.mockRestore(); }
    expect(db.serialize()).toEqual(before);
  } finally { try { migrator?.dispose(); reactive?.dispose(); } finally { db.close(); } }
});

for (const [label, mutate] of [
  ['receipt counters', (db: Database) => db.run('UPDATE _zero_database_receipt_stats_v1 SET retained_result_bytes=0')],
  ['logging counters', (db: Database) => db.run('UPDATE _zero_logging_source SET bytes=0')],
  ['missing receipt singleton', (db: Database) => db.run('DELETE FROM _zero_database_receipt_stats_v1')],
  ['missing logging singleton', (db: Database) => db.run('DELETE FROM _zero_logging_source')],
  ['partial logging indexes', (db: Database) => db.run('DROP INDEX zero_logging_source_context')],
  ['unknown framework trigger', (db: Database) => db.run('CREATE TRIGGER unknown_logging_hook AFTER INSERT ON _zero_logging_source BEGIN SELECT 1; END')],
] as const) test('full-prefix current/prepare still reject malformed fixed metadata: ' + label, () => {
  const db = memory(); let reactive: ReturnType<typeof nativeHistory> | undefined;
  try {
    const binding = addBinding(db); run(db); reactive = nativeHistory(db); mutate(db); const before = db.serialize();
    for (const schema of ['current', 'prepare'] as const) {
      const copy = Database.deserialize(before, { readonly: true, strict: true });
      try {
        copy.run('PRAGMA query_only=ON');
        expect(() => assertDatabaseOpenAdmission({ database: copy, realm, databaseRef: binding.reference, instanceId: binding.instance,
          admission: { schema, row: { table: 'items', id: 'owner', equals: { value: 'PRIVATE_OWNER' } } } })).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
        expect(copy.serialize()).toEqual(before);
      } finally { copy.close(); }
    }
    expect(db.serialize()).toEqual(before);
  } finally { try { reactive?.dispose(); } finally { db.close(); } }
});

test('full-prefix current/prepare and no-op Migrator still reject malformed retained Sync before initialization', () => {
  const db = memory(); let reactive: ReturnType<typeof nativeHistory> | undefined;
  try {
    const binding = addBinding(db); run(db); reactive = nativeHistory(db);
    const fence = CHANGE_LOG_TRIGGER_DEFINITIONS.find(([name]) => name === '_zero_sync_changes_update_fence_v1');
    if (!fence) throw new Error('Native Sync fence missing.');
    db.run('DROP TRIGGER _zero_sync_changes_update_fence_v1'); db.run("UPDATE _changes SET data='malformed' WHERE seq>0"); db.run(fence[1]);
    const before = db.serialize();
    for (const schema of ['current', 'prepare'] as const) {
      const copy = Database.deserialize(before, { readonly: true, strict: true });
      try { copy.run('PRAGMA query_only=ON'); expect(() => assertDatabaseOpenAdmission({ database: copy, realm, databaseRef: binding.reference, instanceId: binding.instance,
        admission: { schema, row: { table: 'items', id: 'owner', equals: { value: 'PRIVATE_OWNER' } } } })).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' })); }
      finally { copy.close(); }
    }
    expect(() => run(db)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' })); expect(db.serialize()).toEqual(before);
  } finally { try { reactive?.dispose(); } finally { db.close(); } }
});

for (const corrupt of ['receipt-payload', 'logging-payload', 'fixed-receipts', 'fixed-logging'] as const)
  test('a pending migration still rejects ' + corrupt + ' before metadata initialization', () => {
    const db = memory(); let reactive: ReturnType<typeof nativeHistory> | undefined;
    try {
      run(db, '001'); reactive = nativeHistory(db, 1);
      if (corrupt === 'receipt-payload') {
        const trigger = db.query("SELECT sql FROM sqlite_schema WHERE name='_zero_database_receipt_update_guard_v1'").get() as { sql: string };
        db.run('DROP TRIGGER _zero_database_receipt_update_guard_v1'); db.run("UPDATE _zero_database_operation_receipts SET result_json='xx'"); db.run(trigger.sql);
      } else if (corrupt === 'logging-payload') db.run("UPDATE _zero_logging_outbox SET payload='malformed'");
      else if (corrupt === 'fixed-receipts') db.run('UPDATE _zero_database_receipt_stats_v1 SET retained_result_bytes=0');
      else db.run('UPDATE _zero_logging_source SET bytes=0');
      const before = db.serialize(); expect(() => run(db)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
      expect(db.serialize()).toEqual(before); expect(db.query("SELECT name FROM sqlite_schema WHERE name='_later'").get()).toBeNull();
    } finally { try { reactive?.dispose(); } finally { db.close(); } }
  });

test('pending migration rechecks deep source inside its transaction before attempt/artifact writes', () => {
  const db = memory(); let reactive: ReturnType<typeof nativeHistory> | undefined, migrator: Migrator | undefined;
  try {
    run(db, '001'); reactive = nativeHistory(db, 1);
    migrator = new Migrator({ database: db, dbPath: ':memory:', migrations, migrationTableStages: realm.migrationTableStages, createBackups: false, log() {} });
    db.run("UPDATE _zero_logging_outbox SET payload='malformed'"); const before = db.serialize();
    expect(() => migrator!.run()).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
    expect(db.serialize()).toEqual(before); expect(db.query("SELECT * FROM _zero_migrations WHERE version='002'").all()).toEqual([]);
    expect(db.query("SELECT name FROM sqlite_schema WHERE name='_later'").get()).toBeNull();
  } finally { try { migrator?.dispose(); reactive?.dispose(); } finally { db.close(); } }
});

for (const staged of [true, false]) test(`staged=${staged} rollback keeps the native forward-only boundary without changing unopted behavior`, () => {
  const db = memory(); let down = 0, migrator: Migrator | undefined;
  const local: Migration[] = [{ version: '001', description: 'Synthetic reversible migration', safety: 'destructive',
    up(db) { db.run('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT NOT NULL)'); }, down(db) { down++; db.run('DROP TABLE items'); } }];
  try {
    migrator = new Migrator({ database: db, dbPath: ':memory:', migrations: local,
      ...(staged ? { migrationTableStages: [{ version: '001', tables: one }] } : {}),
      createBackups: false, allowDestructive: true, allowDestructiveDown: true, log() {} });
    migrator.run(); const before = db.serialize(), checkpoint = spyOn(migrator, 'checkpoint');
    const backup = spyOn(migrator as unknown as { backupIfNeeded: (...args: unknown[]) => unknown }, 'backupIfNeeded'), sql = spyOn(db, 'prepare');
    try {
      if (staged) {
        for (const target of [undefined, '001']) expect(() => migrator!.rollback(target)).toThrow(expect.objectContaining({ code: 'DATABASE_OPERATION_UNSUPPORTED', outcome: 'not-started' }));
        expect(down).toBe(0); expect(checkpoint).not.toHaveBeenCalled(); expect(backup).not.toHaveBeenCalled(); expect(sql).not.toHaveBeenCalled(); expect(db.serialize()).toEqual(before);
      } else { expect(migrator.rollback()).toEqual(['001']); expect(down).toBe(1); expect(checkpoint).toHaveBeenCalled(); }
    } finally { checkpoint.mockRestore(); backup.mockRestore(); sql.mockRestore(); }
  } finally { migrator?.dispose(); db.close(); }
});
test('omitted manifests preserve exact realm identity while opt-in is detached/frozen and selects native readonly admission', () => {
  const absent = defineDatabaseRealm(definition), undefinedOption = defineDatabaseRealm({ ...definition, migrationTableStages: undefined });
  expect(absent.fingerprint).toBe(undefinedOption.fingerprint); expect(absent).not.toHaveProperty('migrationTableStages');
  expect(realm.fingerprint).not.toBe(absent.fingerprint); expect(realm.migrationChecksums).toEqual(absent.migrationChecksums);
  expect(realm.migrationTableStages).not.toBe(stages); expect(Object.isFrozen(realm.migrationTableStages)).toBe(true);
  expect(Object.isFrozen(realm.migrationTableStages![1]!.tables._later!._identity)).toBe(true);
  expect(resolveDatabaseOpenAdmission(undefined, 'synthetic', absent)).toBeUndefined();
  expect(resolveDatabaseOpenAdmission(undefined, 'synthetic', realm)).toEqual({ schema: 'prepare' });
  expect(resolveDatabaseOpenAdmission(() => undefined, 'synthetic', realm)).toEqual({ schema: 'prepare' });
});
test('manifest admission rejects unknown/accessor/proxy/async fields, missing versions and changed prepared old tables', () => {
  let reads = 0;
  for (const value of [[], stages.slice(0, 1), [...stages].reverse(), [{ ...stages[0], sql: 'DROP TABLE items' }, stages[1]],
    [{ ...stages[0], get tables() { reads++; return one; } }, stages[1]], new Proxy(stages, {}),
    [stages[0], { ...stages[1], prepare: undefined }], [stages[0], { ...stages[1], tables: { ...two, items: { id: 'TEXT PRIMARY KEY', value: 'INTEGER' } } }],
    [stages[0], { ...stages[1], tables: { ...two, _later: { id: 'TEXT PRIMARY KEY, injected TEXT' } } }],
    [stages[0], { ...stages[1], tables: { ...two, _later: { id: 'TEXT PRIMARY KEY', payload: 'TEXT); DROP TABLE items; --' } } }]]) {
    expect(() => defineDatabaseRealm({ ...definition, migrationTableStages: value as never })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
  }
  expect(reads).toBe(0);
});
test('fresh native migration prepares only each original boundary and reopens populated prefixes without data/ledger rewrites', () => {
  const db = memory();
  try {
    expect(readonlySource(db)).toBe(0); expect(run(db, '001')).toEqual(['001']); expect(readonlySource(db)).toBe(1);
    expect(db.query("SELECT name FROM sqlite_schema WHERE name='_later'").get()).toBeNull();
    db.run("INSERT INTO items VALUES('retained','PRIVATE_VALUE')"); const original = db.query('SELECT * FROM _zero_migrations ORDER BY id').all();
    expect(run(db)).toEqual(['002']); expect(readonlySource(db)).toBe(2); expect(db.query('SELECT * FROM items').all()).toEqual([{ id: 'retained', value: 'PRIVATE_VALUE' }]);
    expect(db.query('SELECT * FROM _zero_migrations ORDER BY id LIMIT 1').all()).toEqual(original); expect(run(db)).toEqual([]);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
test('boundary table/index/original-up/success evidence are atomic, and clean failed attempts are retryable', () => {
  const db = memory();
  try {
    run(db, '001'); failSecond = true;
    expect(() => run(db)).toThrow('synthetic boundary failure'); expect(readonlySource(db)).toBe(1);
    expect(db.query("SELECT name FROM sqlite_schema WHERE name IN ('_later','original_later_item','idx__later_identity')").all()).toEqual([]);
    expect(db.query("SELECT status FROM _zero_migrations WHERE version='002'").all()).toEqual([{ status: 'failed' }]);
    failSecond = false; expect(run(db)).toEqual(['002']); expect(readonlySource(db)).toBe(2);
  } finally { failSecond = false; db.close(); }
});
test('failed first boundary leaves only recognized native failure evidence and can retry from prefix zero', () => {
  const db = memory();
  try { failFirst = true; expect(() => run(db)).toThrow('synthetic first failure'); expect(readonlySource(db)).toBe(0);
    expect(db.query("SELECT name FROM sqlite_schema WHERE name IN ('items','original_items_value','_later')").all()).toEqual([]);
    failFirst = false; expect(run(db)).toEqual(['001', '002']);
  } finally { failFirst = false; db.close(); }
});
test('current readonly manifest admission accepts genuine sync/receipts/logging, checks owner first and never repairs missing tables', () => {
  const db = memory(), reference = createDatabaseRef('synthetic-manifest-current'), instance = '00000000-0000-4000-8000-000000000001';
  let reactive: ReturnType<typeof createReactiveDB> | undefined;
  try {
    db.run(`CREATE TABLE _zero_database_binding_v1 (
      singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
      format_version INTEGER NOT NULL CHECK (format_version = 1),
      database_ref TEXT NOT NULL CHECK (length(database_ref) = 64),
      instance_id TEXT NOT NULL CHECK (length(instance_id) = 36),
      realm_name TEXT NOT NULL CHECK (length(realm_name) BETWEEN 1 AND 128)
    ) WITHOUT ROWID`);
    db.run('INSERT INTO _zero_database_binding_v1 VALUES(1,1,?,?,?)', [reference, instance, realm.name]);
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) db.run(`CREATE TRIGGER _zero_database_binding_${action.toLowerCase()}_guard_v1 BEFORE ${action} ON _zero_database_binding_v1 BEGIN
      SELECT RAISE(ABORT, 'zero database binding is immutable'); END`);
    run(db); reactive = createReactiveDB({ database: db, ownsDatabase: false });
    for (const [name, declaration] of Object.entries(realm.tables)) reactive.defineTable(name, declaration);
    reactive.createStrict('items', { id: 'owner', value: 'PRIVATE_OWNER' });
    initializeDatabaseReceiptSchema({ runtime: { db: reactive } as DatabaseRuntime, realmFingerprint: realm.fingerprint, validateLegacyResult() {} }); new LoggingSourceOutbox(reactive);
    const assert = (expected: string) => {
      const copy = Database.deserialize(db.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA query_only=ON'); const before = copy.serialize();
        try { assertDatabaseOpenAdmission({ database: copy, realm, databaseRef: reference, instanceId: instance,
          admission: { schema: 'current', row: { table: 'items', id: 'owner', equals: { value: expected } } } }); }
        finally { expect(copy.serialize()).toEqual(before); }
      } finally { copy.close(); }
    };
    expect(() => assert('PRIVATE_OWNER')).not.toThrow();
    db.run('DROP TABLE _later'); const before = db.serialize();
    expect(() => assert('WRONG_OWNER')).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'row' }) }));
    expect(() => assert('PRIVATE_OWNER')).toThrow(); expect(db.serialize()).toEqual(before);
  } finally { try { reactive?.dispose(); } finally { db.close(); } }
});
test('migrate:false never invokes table preparation/migrator on a genuinely migrated MEMORY runtime', () => {
  const sqlite = createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false });
  let runtime: DatabaseRuntime | undefined;
  const observe = spyOn(Migrator.prototype, 'run');
  try { sqlite.raw.run('PRAGMA temp_store=MEMORY'); run(sqlite.raw);
    const source = nativeHistory(sqlite.raw); source.dispose(); sqlite.raw.run("UPDATE _zero_logging_outbox SET payload='malformed'"); observe.mockClear();
    const prepare = spyOn(sqlite.raw, 'prepare');
    try {
      runtime = DatabaseRuntime.open({ id: 'synthetic-manifest-current', role: 'named', sqlite, ownsSQLite: false,
        migrations, migrationTableStages: realm.migrationTableStages, migrate: false, tables: realm.tables });
      assertOrdinarySql(prepare.mock.calls.map(([sql]) => sql));
    } finally { prepare.mockRestore(); }
    expect(observe).not.toHaveBeenCalled(); expect(runtime.db.hasTable('_later')).toBe(true);
    expect(sqlite.raw.query('SELECT payload FROM _zero_logging_outbox').get()).toEqual({ payload: 'malformed' });
  } finally { observe.mockRestore(); try { runtime?.close(); } finally { sqlite.close(); } }
});
test('opted-in ephemeral Runtime executes genuine staged migrations before initializing ReactiveDB; unopted skip remains unchanged', () => {
  for (const enabled of [false, true]) {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false }); let runtime: DatabaseRuntime | undefined;
    try { sqlite.raw.run('PRAGMA temp_store=MEMORY');
      runtime = DatabaseRuntime.open({ id: 'synthetic-ephemeral-stages', role: 'named', sqlite, ownsSQLite: false,
        migrations, ...(enabled ? { migrationTableStages: realm.migrationTableStages } : {}), migrate: true, tables: realm.tables });
      expect(sqlite.raw.query("SELECT name FROM sqlite_schema WHERE name='original_items_value'").all()).toHaveLength(enabled ? 1 : 0);
      expect(sqlite.raw.query("SELECT name FROM sqlite_schema WHERE name='_zero_migrations'").all()).toHaveLength(enabled ? 1 : 0);
      if (enabled) expect(readonlySource(sqlite.raw)).toBe(2);
    } finally { try { runtime?.close(); } finally { sqlite.close(); } }
  }
});
for (const source of ['new', 'prefix', 'wrong-tables', 'malformed-tables'] as const) test('migrate:false rejects manifest source before any runtime initialization: ' + source, () => {
  const sqlite = createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false });
  try { sqlite.raw.run('PRAGMA temp_store=MEMORY'); if (source !== 'new') run(sqlite.raw, source === 'prefix' ? '001' : undefined);
    const bytes = sqlite.raw.serialize(), options = { id: 'synthetic-rejected-stages', role: 'named' as const, sqlite, ownsSQLite: false,
      migrations, migrationTableStages: realm.migrationTableStages, migrate: false,
      tables: source === 'wrong-tables' ? one : source === 'malformed-tables' ? { ...realm.tables, items: { ...realm.tables.items, ignoredFunction() {} } } as never : realm.tables };
    expect(() => DatabaseRuntime.open(options)).toThrow(); expect(sqlite.raw.serialize()).toEqual(bytes);
    expect(sqlite.raw.query("SELECT name FROM sqlite_schema WHERE name='_changes'").get()).toBeNull();
  } finally { sqlite.close(); }
});
for (const [label, mutate] of [
  ['unledgered table', (db: Database) => db.run('CREATE TABLE rogue(id TEXT PRIMARY KEY)')],
  ['future private table', (db: Database) => { run(db, '001'); db.run('CREATE TABLE _later(id TEXT PRIMARY KEY,item_id TEXT)'); }],
  ['missing applied table', (db: Database) => { run(db, '001'); db.run('DROP TABLE items'); }],
  ['wrong column', (db: Database) => { run(db, '001'); db.run('ALTER TABLE items ADD COLUMN unexplained TEXT'); }],
  ['checksum mismatch', (db: Database) => { run(db, '001'); db.run("UPDATE _zero_migrations SET checksum='wrong'"); }],
  ['unknown ledger version', (db: Database) => { run(db, '001'); db.run("UPDATE _zero_migrations SET version='999'"); }],
  ['legacy-only ledger', (db: Database) => db.run('CREATE TABLE _migrations(version TEXT PRIMARY KEY,description TEXT NOT NULL,applied_at TEXT NOT NULL,checksum TEXT NOT NULL,duration_ms INTEGER NOT NULL DEFAULT 0)')],
] as const) test('reject retained source before constructor writes: ' + label, () => {
  const db = memory();
  try { mutate(db); const bytes = db.serialize(); expect(() => readonlySource(db)).toThrow(); expect(db.serialize()).toEqual(bytes);
    expect(() => run(db)).toThrow(); expect(db.serialize()).toEqual(bytes);
  } finally { db.close(); }
});
