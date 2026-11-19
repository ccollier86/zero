/** Constructor parity and readonly rejection using owned MEMORY copies only. */
import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { createReactiveDB } from '../sync/reactive-db';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { assertDatabaseMigrationSourceFramework, assertDatabaseSourceFrameworkStructure, type DatabaseSourceSchemaObject } from './database-realm-source-framework';
import { DATABASE_RECEIPT_SCHEMA_OBJECTS, initializeDatabaseReceiptSchema } from './database-receipt-schema';
import { DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES } from './database-receipt-contract';
import type { DatabaseRuntime } from './database-runtime';
function objects(database: Database): DatabaseSourceSchemaObject[] {
  const statement = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name");
  try { return statement.all() as DatabaseSourceSchemaObject[]; } finally { statement.finalize(); }
}
function inspect(database: Database) {
  const copy = Database.deserialize(database.serialize(), { readonly: true, strict: true });
  try {
    copy.run('PRAGMA query_only=ON'); const before = copy.serialize(), changes = copy.query('SELECT total_changes() AS n').get();
    try { return assertDatabaseMigrationSourceFramework(copy, objects(copy)); }
    finally { expect(copy.serialize()).toEqual(before); expect(copy.query('SELECT total_changes() AS n').get()).toEqual(changes); }
  } finally { copy.close(); }
}
function fixture(legacyOutbox = false) {
  const db = createReactiveDB({ mode: 'memory' }); let migrator: Migrator | undefined, source: LoggingActorSource | undefined;
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    db.defineTable('records', { id: 'TEXT PRIMARY KEY', label: 'TEXT' });
    migrator = new Migrator({ database: db.getRawDatabase(), dbPath: ':memory:', migrations: [], createBackups: false, log() {} });
    initializeDatabaseReceiptSchema({ runtime: { db } as DatabaseRuntime, realmFingerprint: 'sha256:' + 'a'.repeat(64), validateLegacyResult() {} });
    if (legacyOutbox) db.exec(`CREATE TABLE _zero_logging_outbox (
      event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, bytes INTEGER NOT NULL, ordinal INTEGER NOT NULL UNIQUE
    )`);
    source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: true, policyVersion: 'synthetic', scope: { kind: 'application', tenantId: null } }));
    db.create('records', { id: 'synthetic-record', label: 'SYNTHETIC_PRIVATE_CONTENT' });
    return { db, raw: db.getRawDatabase(), source,
      close() { try { source!.close(); migrator!.dispose(); } finally { db.dispose(); } } };
  } catch (error) { try { source?.close(); migrator?.dispose(); } finally { db.dispose(); } throw error; }
}
function insertReceipt(raw: Database, key: string, ordinal: number, result = '{"synthetic":true}') {
  raw.run(`INSERT INTO _zero_database_operation_receipts
    (receipt_key,realm_fingerprint,operation_fingerprint,receipt_state,result_json,final_seq,result_version,schema_version,created_at,insertion_ordinal)
    VALUES(?,?,?,'retained',?,0,2,2,1,?)`, [key, 'sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64), result, ordinal]);
}

/** Prove that the EXACT failing readonly admission query returns a small null
 * sentinel, not the oversized source value. No source reconstruction/repair. */
function projectedRejection(raw: Database, table: string, column: string): void {
  const metadata = objects(raw), before = raw.serialize();
  raw.run('PRAGMA query_only=ON'); const prepare = spyOn(raw, 'prepare');
  try {
    expect(() => assertDatabaseMigrationSourceFramework(raw, metadata)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
    const sql = prepare.mock.calls.map(([sql]) => sql).find(sql => sql.includes('FROM ' + table) && sql.includes('CASE WHEN'));
    if (!sql) throw new Error('Expected a bounded native source projection.');
    expect(sql).not.toMatch(/SELECT\s+(?:[a-z]+\.)?\*/i);
    const statement = raw.prepare(sql);
    try {
      const row = (sql.includes('?') ? statement.get(1_000_001) : statement.get()) as Record<string, unknown>;
      expect(row[column]).toBeNull(); expect(JSON.stringify(row).length).toBeLessThan(2048);
    } finally { statement.finalize(); }
    expect(raw.serialize()).toEqual(before);
  } finally { prepare.mockRestore(); raw.run('PRAGMA query_only=OFF'); }
}

test('current native source constructor legacy ALTER preserves valid outbox evidence and is admitted without rewriting its SQL', () => {
  const f = fixture(true);
  try {
    const statement = f.raw.prepare("SELECT sql FROM sqlite_schema WHERE name='_zero_logging_outbox'");
    let sql: string;
    try { sql = (statement.get() as { sql: string }).sql; } finally { statement.finalize(); }
    expect(sql).toContain('UNIQUE\n    , context_id INTEGER');
    const before = f.raw.serialize(), queued = f.source.control({});
    expect(inspect(f.raw).has('_zero_logging_outbox')).toBe(true);
    expect(f.raw.serialize()).toEqual(before); expect(f.source.control({})).toEqual(queued); expect(queued.queued).toBe(1);
  } finally { f.close(); }
});

test('the known native ALTER shape does not admit an unexplained later outbox declaration', () => {
  const f = fixture(true);
  try {
    f.raw.run('ALTER TABLE _zero_logging_outbox ADD COLUMN unexplained TEXT'); const before = f.raw.serialize();
    expect(() => inspect(f.raw)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
    expect(f.raw.serialize()).toEqual(before);
  } finally { f.close(); }
});

for (const [label, table, field, mutation] of [
  ['event payload', '_zero_logging_outbox', 'payload', 'UPDATE _zero_logging_outbox SET payload=CAST(zeroblob(200000) AS TEXT)'],
  ['context payload', '_zero_logging_contexts', 'payload', 'UPDATE _zero_logging_contexts SET payload=CAST(zeroblob(40000) AS TEXT)'],
  ['context digest', '_zero_logging_contexts', 'digest', 'UPDATE _zero_logging_contexts SET digest=CAST(zeroblob(10000) AS TEXT)'],
  ['source identity', '_zero_logging_source', 'source_id', 'UPDATE _zero_logging_source SET source_id=CAST(zeroblob(10000) AS TEXT)'],
] as const) test('oversized NUL-prefixed logging ' + label + ' is rejected before JS materialization', () => {
  const f = fixture();
  try { f.raw.run(mutation); projectedRejection(f.raw, table, field); }
  finally { f.close(); }
});

test('bounded context-id projection cannot turn malformed source data into a valid legacy null-context event', () => {
  const f = fixture();
  try {
    const original = f.source.control({}).rows[0]!.event;
    f.raw.run('UPDATE _zero_logging_outbox SET payload=?,context_id=zeroblob(10000)', [JSON.stringify(original)]);
    projectedRejection(f.raw, '_zero_logging_outbox', 'context_id');
  } finally { f.close(); }
});

test('receipt result native UTF-8 ceiling is enforced in SQL before a malformed oversized TEXT reaches JS', () => {
  const f = fixture();
  try {
    const guard = DATABASE_RECEIPT_SCHEMA_OBJECTS.find(([name]) => name === '_zero_database_receipt_insert_guard_v1');
    if (!guard) throw new Error('Native receipt insert guard missing.');
    // Corrupt only this proven synthetic MEMORY source, then restore its exact
    // native guard. The malformed row cannot be produced by normal admission.
    f.raw.run('DROP TRIGGER _zero_database_receipt_insert_guard_v1');
    f.raw.run(`INSERT INTO _zero_database_operation_receipts
      (receipt_key,realm_fingerprint,operation_fingerprint,receipt_state,result_json,final_seq,result_version,schema_version,created_at,insertion_ordinal)
      VALUES(?,?,?,'retained',CAST(zeroblob(?) AS TEXT),0,2,2,1,1)`,
    ['synthetic-oversized', 'sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64), DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES + 1]);
    f.raw.run(guard[2]); insertReceipt(f.raw, 'synthetic-valid-second', 2, '{}');
    projectedRejection(f.raw, '_zero_database_operation_receipts', 'result_json');
  } finally { f.close(); }
});

test('oversized receipt identity is projected to refusal without transferring its NUL-prefixed tail', () => {
  const f = fixture();
  try {
    f.raw.run(`INSERT INTO _zero_database_operation_receipts
      (receipt_key,realm_fingerprint,operation_fingerprint,receipt_state,result_json,final_seq,result_version,schema_version,created_at,insertion_ordinal)
      VALUES(CAST(zeroblob(10000) AS TEXT),?,?,'retained','{}',0,2,2,1,1)`, ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)]);
    projectedRejection(f.raw, '_zero_database_operation_receipts', 'receipt_key');
  } finally { f.close(); }
});

test('malformed multiple native binding rows fail the bounded singleton preflight before shared whole-table identity validation', () => {
  const raw = new Database(':memory:');
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA ignore_check_constraints=ON');
    raw.run(`CREATE TABLE _zero_database_binding_v1 (
      singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
      format_version INTEGER NOT NULL CHECK (format_version = 1),
      database_ref TEXT NOT NULL CHECK (length(database_ref) = 64),
      instance_id TEXT NOT NULL CHECK (length(instance_id) = 36),
      realm_name TEXT NOT NULL CHECK (length(realm_name) BETWEEN 1 AND 128)
    ) WITHOUT ROWID`);
    for (const singleton of [1, 2]) raw.run('INSERT INTO _zero_database_binding_v1 VALUES(?,1,?,?,?)', [singleton, 'a'.repeat(64), crypto.randomUUID(), 'synthetic']);
    raw.run('PRAGMA ignore_check_constraints=OFF');
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) raw.run(`CREATE TRIGGER _zero_database_binding_${operation.toLowerCase()}_guard_v1
      BEFORE ${operation} ON _zero_database_binding_v1 BEGIN SELECT RAISE(ABORT, 'zero database binding is immutable'); END`);
    const metadata = objects(raw), before = raw.serialize(), prepare = spyOn(raw, 'prepare');
    try {
      expect(() => assertDatabaseMigrationSourceFramework(raw, metadata)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
      const bindingReads = prepare.mock.calls.map(([sql]) => sql).filter(sql => /FROM\s+(?:main\.)?_zero_database_binding_v1/.test(sql));
      expect(bindingReads).toHaveLength(1); expect(bindingReads[0]).toContain('LIMIT 2'); expect(raw.serialize()).toEqual(before);
    } finally { prepare.mockRestore(); }
  } finally { raw.close(); }
});

test('real native migration/sync/receipt/logging constructors produce admitted readonly metadata without admitting domain data', () => {
  const f = fixture();
  try {
    const admitted = inspect(f.raw);
    for (const name of ['_zero_migrations', '_migrations', '_zero_schema_history', '_zero_migration_artifacts', '_changes',
      '_zero_sync_log_state', '_change_sequence', '_zero_database_operation_receipts', '_zero_database_receipt_stats_v1',
      '_zero_logging_source', '_zero_logging_outbox', '_zero_logging_contexts']) expect(admitted.has(name)).toBe(true);
    expect(admitted.has('records')).toBe(false);
    expect(f.source.control({}).queued).toBe(1);
  } finally { f.close(); }
});

test('native structural classification checks fixed metadata without claiming payload attestation; the explicit helper stays deep', () => {
  const f = fixture();
  try {
    f.raw.run("UPDATE _zero_logging_outbox SET payload='malformed'"); const metadata = objects(f.raw), before = f.raw.serialize(), prepare = spyOn(f.raw, 'prepare');
    try {
      expect(assertDatabaseSourceFrameworkStructure(f.raw, metadata).has('_zero_logging_outbox')).toBe(true);
      const queries = prepare.mock.calls.map(([sql]) => sql);
      expect(queries.some(sql => /FROM main\._changes WHERE seq IS NOT 0/.test(sql))).toBe(false);
      expect(queries.some(sql => /FROM _zero_logging_(?:contexts|outbox).*ORDER BY/s.test(sql))).toBe(false);
      expect(queries.some(sql => /FROM _zero_database_operation_receipts ORDER BY/.test(sql))).toBe(false);
    } finally { prepare.mockRestore(); }
    expect(() => assertDatabaseMigrationSourceFramework(f.raw, metadata)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
    expect(f.raw.serialize()).toEqual(before);
    f.raw.run('UPDATE _zero_logging_source SET bytes=0');
    expect(() => assertDatabaseSourceFrameworkStructure(f.raw, metadata)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
  } finally { f.close(); }
});

test('retained and compacted receipt identities/accounting survive constructor-free admission unchanged', () => {
  const f = fixture();
  try {
    insertReceipt(f.raw, 'synthetic-retained', 1); insertReceipt(f.raw, 'synthetic-expired', 2);
    f.raw.run("UPDATE _zero_database_operation_receipts SET receipt_state='expired',result_json=NULL,final_seq=NULL WHERE receipt_key='synthetic-expired'");
    const bytes = f.raw.serialize(); expect(inspect(f.raw).has('_zero_database_operation_receipts')).toBe(true);
    expect(f.raw.serialize()).toEqual(bytes);
  } finally { f.close(); }
});

for (const [label, mutate] of [
  ['stats mismatch', (raw: Database) => raw.run('UPDATE _zero_database_receipt_stats_v1 SET total_keys=total_keys+1')],
  ['malformed retained result', (raw: Database) => insertReceipt(raw, 'synthetic-invalid-json', 1, 'not-json')],
  ['noncontiguous permanent identity', (raw: Database) => insertReceipt(raw, 'synthetic-gap', 2)],
] as const) test('receipt source fails closed without reconstruction: ' + label, () => {
  const f = fixture();
  try { mutate(f.raw); expect(() => inspect(f.raw)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' })); }
  finally { f.close(); }
});

for (const [label, sql] of [
  ['logging accounting', 'UPDATE _zero_logging_source SET queued=queued+1'],
  ['logging payload', "UPDATE _zero_logging_outbox SET payload='malformed'"],
  ['logging context digest', "UPDATE _zero_logging_contexts SET digest='substituted'"],
  ['missing logging context', 'DELETE FROM _zero_logging_contexts'],
  ['logging byte count', 'UPDATE _zero_logging_outbox SET bytes=bytes+1'],
  ['logging source identity', "UPDATE _zero_logging_source SET source_id='other-source'"],
  ['logging trigger substitution', 'DROP TRIGGER zero_logging_outbox_insert; CREATE TRIGGER zero_logging_outbox_insert AFTER INSERT ON _zero_logging_outbox BEGIN SELECT 1; END'],
  ['unexpected logging trigger', 'CREATE TRIGGER unexpected_source_code AFTER INSERT ON _zero_logging_source BEGIN SELECT 1; END'],
  ['sync fence substitution', 'DROP TRIGGER _zero_sync_changes_update_fence_v1; CREATE TRIGGER _zero_sync_changes_update_fence_v1 BEFORE UPDATE ON _changes BEGIN SELECT 1; END'],
  ['migration table drift', 'ALTER TABLE _zero_schema_history ADD COLUMN unexplained TEXT'],
] as const) test('readonly framework source rejection preserves malformed source: ' + label, () => {
  const f = fixture();
  try { f.raw.exec(sql); expect(() => inspect(f.raw)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' })); }
  finally { f.close(); }
});

test('unknown framework lookalikes stay unadmitted and malformed/case-colliding owned objects are rejected', () => {
  const raw = new Database(':memory:');
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('CREATE TABLE _zero_lookalike(id TEXT PRIMARY KEY)');
    expect(inspect(raw).has('_zero_lookalike')).toBe(false);
    raw.run('CREATE TABLE _ZERO_LOGGING_SOURCE(id INTEGER PRIMARY KEY,source_id TEXT)');
    expect(() => inspect(raw)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
  } finally { raw.close(); }
});

test('empty raw source and genuine raw native migration metadata require no ReactiveDB initializer', () => {
  const raw = new Database(':memory:'); let migrator: Migrator | undefined;
  try {
    raw.run('PRAGMA temp_store=MEMORY'); expect(inspect(raw).size).toBe(0);
    migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: [], createBackups: false, log() {} });
    const admitted = inspect(raw); expect(admitted.has('_zero_migrations')).toBe(true); expect(admitted.has('_changes')).toBe(false);
  } finally { migrator?.dispose(); raw.close(); }
});
