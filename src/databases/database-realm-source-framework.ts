/** Constructor-free admission of framework-owned source metadata. No schema
 * creation, legacy import, recovery write, provider or process is started here.
 * Unknown application/domain objects are NOT admitted by this helper. */
import type { Database } from 'bun:sqlite';
import type { DatabaseRealm } from './database-realm';
import { DatabaseError } from './database-error';
import { readDatabaseBindingIdentity } from './database-binding-identity';
import { normalizeDatabaseRef } from './database-file';
import { assertExactIdentityAnchorSQLiteTables } from '../auth/identity-projection-schema';
import { hasGuardianPresenceRealm } from '../presence/presence-realm';
import { presenceProjectionSchemaReady } from '../presence/presence-projection-schema';
import { DATABASE_RECEIPT_SCHEMA_OBJECTS, databaseReceiptSchemaReady, assertDatabaseReceiptRow, type DatabaseReceiptRow } from './database-receipt-schema';
import { DATABASE_WRITER_MAX_RECEIPT_KEYS, DATABASE_WRITER_MAX_RECEIPTS, DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES } from './database-receipt-contract';
import { DATABASE_IDEMPOTENCY_KEY_MAX_LENGTH, isDatabaseIdempotencyKey } from './database-operations';
import { CHANGE_LOG_TRIGGER_DEFINITIONS } from '../sync/reactive-db-change-log';
import { normalizeSchemaSql } from '../sync/reactive-db-table-contract';
import { validateChangeLogStateRow, validateRetainedHistory, type ChangeLogStateRow } from '../sync/reactive-db-change-codec';
import type { ChangeRow } from '../sync/types';
import { decodeLoggingSourceEvent } from '../logging/logging-source-codec';
import { loggingByteLength, loggingId, LOGGING_MAX_EVENT_BYTES } from '../logging/logging-validation';
import { loggingDigest } from '../logging/logging-hash';
import { LOGGING_SOURCE_HARD_BYTES, LOGGING_SOURCE_HARD_EVENTS } from '../logging/logging-source-limits';

export interface DatabaseSourceSchemaObject { readonly type: string; readonly name: string; readonly tbl_name: string; readonly sql: string | null }
type Definition = readonly [name: string, type: 'table' | 'index' | 'trigger', sql: string];
function mismatch(reason: string): never {
  throw new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Database source does not satisfy open admission.',
    { retryable: false, outcome: 'not-started', details: { component: 'open-admission', reason } });
}
function one<T>(database: Database, sql: string, ...params: (string | number)[]): T | null {
  const statement = database.prepare(sql); try { return statement.get(...params) as T | null; } finally { statement.finalize(); }
}
function all<T>(database: Database, sql: string): T[] {
  const statement = database.prepare(sql); try { return statement.all() as T[]; } finally { statement.finalize(); }
}
function shape(sql: string): string {
  return normalizeSchemaSql(sql.replace(/\bCREATE\s+(TABLE|INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\s+/gi, 'CREATE $1 ').replace(/\bmain\./g, ''));
}
function matchesNativeDefinition(name: string, sql: string, expected: string): boolean {
  const actual = shape(sql), canonical = shape(expected);
  if (actual === canonical) return true;
  // LoggingSourceOutbox's native legacy upgrade appends context_id with ALTER
  // TABLE. SQLite preserves the old newline before its closing parenthesis,
  // putting whitespace BEFORE this one comma. Admit only that known native
  // shape; do not normalize arbitrary punctuation/literals or rebuild evidence.
  return name === '_zero_logging_outbox' && actual === canonical.replace('UNIQUE, context_id INTEGER )', 'UNIQUE , context_id INTEGER)');
}
/** SQL-side native codec ceilings, before Bun allocates a returned JS value.
 * These mirror LoggingSourceOutbox.page()/loggingId(), not new storage quotas. */
const LOGGING_SOURCE_PAYLOAD_CHARACTERS = 32768;
const LOGGING_SOURCE_CONTEXT_CHARACTERS = 8192;
const LOGGING_ID_CHARACTERS = 200;
function boundedText(expression: string, maximum: number): string {
  // SQLite TEXT length stops at NUL. The UTF-8 bound prevents a malformed
  // NUL-prefixed tail from bypassing the character ceiling before JS decoding.
  // Four bytes per Unicode scalar is an upper bound, not a new valid-row limit.
  return `CASE WHEN typeof(${expression})='text' AND length(CAST(${expression} AS BLOB))<=${maximum * 4}
    AND length(${expression})<=${maximum} THEN ${expression} ELSE NULL END`;
}
function boundedInteger(expression: string): string { return `CASE WHEN typeof(${expression})='integer' THEN ${expression} ELSE NULL END`; }
const BINDING = '_zero_database_binding_v1';
const bindingObjects: readonly Definition[] = [
  [BINDING, 'table', `CREATE TABLE ${BINDING} (
    singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
    format_version INTEGER NOT NULL CHECK (format_version = 1),
    database_ref TEXT NOT NULL CHECK (length(database_ref) = 64),
    instance_id TEXT NOT NULL CHECK (length(instance_id) = 36),
    realm_name TEXT NOT NULL CHECK (length(realm_name) BETWEEN 1 AND 128)
  ) WITHOUT ROWID`],
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).map(operation => [`_zero_database_binding_${operation.toLowerCase()}_guard_v1`, 'trigger',
    `CREATE TRIGGER _zero_database_binding_${operation.toLowerCase()}_guard_v1 BEFORE ${operation} ON ${BINDING} BEGIN
      SELECT RAISE(ABORT, 'zero database binding is immutable'); END`] as const),
];
const migrationObjects: readonly Definition[] = [
  ['_zero_migrations', 'table', `CREATE TABLE _zero_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, description TEXT NOT NULL,
    checksum TEXT NOT NULL, safety TEXT NOT NULL, direction TEXT NOT NULL, batch INTEGER NOT NULL,
    status TEXT NOT NULL, applied_at TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, error TEXT, schema_hash TEXT
  )`],
  ['idx_zero_migrations_version', 'index', 'CREATE INDEX idx_zero_migrations_version ON _zero_migrations(version, id)'],
  ['idx_zero_migrations_batch', 'index', 'CREATE INDEX idx_zero_migrations_batch ON _zero_migrations(batch)'],
  ['_migrations', 'table', `CREATE TABLE _migrations (
    version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0
  )`],
  ['_zero_schema_history', 'table', `CREATE TABLE _zero_schema_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, migration_version TEXT NOT NULL, direction TEXT NOT NULL,
    schema_hash TEXT NOT NULL, schema_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`],
  ['idx_zero_schema_history_migration', 'index', 'CREATE INDEX idx_zero_schema_history_migration ON _zero_schema_history(migration_version)'],
  ['idx_zero_schema_history_hash', 'index', 'CREATE INDEX idx_zero_schema_history_hash ON _zero_schema_history(schema_hash)'],
  ['_zero_migration_artifacts', 'table', `CREATE TABLE _zero_migration_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, migration_version TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, hash TEXT, created_at TEXT NOT NULL
  )`],
  ['idx_zero_migration_artifacts_migration', 'index', 'CREATE INDEX idx_zero_migration_artifacts_migration ON _zero_migration_artifacts(migration_version)'],
];
const loggingObjects: readonly Definition[] = [
  ['_zero_logging_source', 'table', `CREATE TABLE _zero_logging_source (
    id INTEGER PRIMARY KEY CHECK(id=1), source_id TEXT NOT NULL, queued INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0
  )`],
  ['_zero_logging_outbox', 'table', `CREATE TABLE _zero_logging_outbox (
    event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, bytes INTEGER NOT NULL, ordinal INTEGER NOT NULL UNIQUE, context_id INTEGER
  )`],
  ['_zero_logging_contexts', 'table', `CREATE TABLE _zero_logging_contexts (
    id INTEGER PRIMARY KEY, digest TEXT NOT NULL UNIQUE, payload TEXT NOT NULL
  )`],
  ['zero_logging_source_order', 'index', 'CREATE INDEX zero_logging_source_order ON _zero_logging_outbox(ordinal)'],
  ['zero_logging_source_context', 'index', 'CREATE INDEX zero_logging_source_context ON _zero_logging_outbox(context_id)'],
  ['zero_logging_outbox_insert', 'trigger', `CREATE TRIGGER zero_logging_outbox_insert AFTER INSERT ON _zero_logging_outbox BEGIN
    UPDATE _zero_logging_source SET queued=queued+1, bytes=bytes+NEW.bytes WHERE id=1; END`],
  ['zero_logging_outbox_delete', 'trigger', `CREATE TRIGGER zero_logging_outbox_delete AFTER DELETE ON _zero_logging_outbox BEGIN
    UPDATE _zero_logging_source SET queued=queued-1, bytes=bytes-OLD.bytes WHERE id=1; END`],
];

/** Exact group validation rejects unknown triggers/indexes attached to an owned
 * table too; a returned table name is never permission to hide arbitrary code. */
function admitGroup(database: Database, objects: readonly DatabaseSourceSchemaObject[], definitions: readonly Definition[],
  admitted: Set<string>, allowEmptyPartial = false): boolean {
  const names = new Set(definitions.map(([name]) => name));
  const tables = new Set(definitions.filter(([, type]) => type === 'table').map(([name]) => name));
  const related = objects.filter(object => [...names].some(name => name.toLowerCase() === object.name.toLowerCase())
    || [...tables].some(name => name.toLowerCase() === object.tbl_name.toLowerCase()));
  if (!related.length) return false;
  let missing = false;
  for (const [name, type, sql] of definitions) {
    const selected = related.filter(object => object.name.toLowerCase() === name.toLowerCase());
    if (!selected.length) { missing = true; continue; }
    const actual = selected[0]!;
    if (selected.length !== 1 || actual.name !== name || actual.type !== type || !actual.sql || !matchesNativeDefinition(name, actual.sql, sql)) mismatch('framework-object');
    admitted.add(name);
  }
  for (const object of related) {
    if (names.has(object.name)) continue;
    if (object.type === 'index' && object.sql === null && tables.has(object.tbl_name)
      && object.name.startsWith('sqlite_autoindex_' + object.tbl_name + '_')) admitted.add(object.name);
    else mismatch('framework-object');
  }
  if (missing) {
    if (!allowEmptyPartial || definitions.some(([name, type]) => type === 'table' && admitted.has(name)
      && one(database, `SELECT 1 FROM "${name}" LIMIT 1`))) mismatch('framework-partial');
  }
  return !missing;
}

/** Same current F1 row/history invariants, now shared without constructing a
 * ReactiveDB, Migrator or receipt/logging installer on the inspected source. */
export function assertCurrentDatabaseSourceFramework(database: Database, realm: DatabaseRealm): void {
  assertCurrentFramework(database, realm, false);
}
/** Same-snapshot native handoff only: the manifest classifier already proved
 * retained Sync history. Recheck fixed metadata, never cache file authority. */
export function assertCurrentDatabaseSourceFrameworkAfterManifest(database: Database, realm: DatabaseRealm): void {
  assertCurrentFramework(database, realm, true);
}
function assertCurrentFramework(database: Database, realm: DatabaseRealm, syncAlreadyProven: boolean): void {
  if (realm.guardianAnchorRequirements.length) assertExactIdentityAnchorSQLiteTables(database, { membership: realm.guardianAnchorRequirements.includes('membership') });
  if (!databaseReceiptSchemaReady(database)) mismatch('receipts');
  if (hasGuardianPresenceRealm(realm) && !presenceProjectionSchemaReady(database)) mismatch('presence');
  if (syncAlreadyProven) readCurrentDatabaseSourceSyncState(database); else assertDatabaseSourceSyncHistory(database);
}

/** @internal Native retained-format proof, including full-prefix/no-op opens. */
export function assertDatabaseSourceSyncHistory(database: Database): void {
  const state = readCurrentDatabaseSourceSyncState(database);
  const statement = database.prepare('SELECT *,typeof(format_version) AS format_version_type FROM main._changes WHERE seq IS NOT 0 ORDER BY seq');
  try { validateRetainedHistory(state, statement.iterate() as IterableIterator<ChangeRow>); } finally { statement.finalize(); }
}
/** Fixed native format metadata only. Full F1 replay history remains a separate
 * proof, performed once by current admission or by an explicit deep audit. */
function readCurrentDatabaseSourceSyncState(database: Database): ChangeLogStateRow {
  const states = all<ChangeLogStateRow>(database, 'SELECT singleton,schema_version,write_format,min_reader_format,seq,prune_through FROM main._zero_sync_log_state LIMIT 2');
  if (states.length !== 1) mismatch('sync');
  const state = validateChangeLogStateRow(states[0]!);
  const sentinels = all<ChangeRow>(database, 'SELECT *,typeof(format_version) AS format_version_type FROM main._changes WHERE seq=0 LIMIT 2');
  const sentinel = sentinels[0];
  if (sentinels.length !== 1 || !sentinel || sentinel.seq !== 0 || sentinel.tbl !== '_zero_sync_fence' || sentinel.op !== 'INSERT'
    || sentinel.row_id !== 'format-v1' || sentinel.data !== null || sentinel.previous_data !== null || sentinel.ts !== 0 || sentinel.origin !== null
    || sentinel.format_version !== 1 || sentinel.format_version_type !== 'integer') mismatch('sync');
  const sequence = all<{ singleton: number; seq: number }>(database, 'SELECT singleton,seq FROM main._change_sequence LIMIT 2');
  if (sequence.length !== 1 || sequence[0]!.singleton !== 1 || !Number.isSafeInteger(sequence[0]!.seq)
    || sequence[0]!.seq < 0 || sequence[0]!.seq > state.seq) mismatch('sync');
  return state;
}

function admitSync(database: Database, objects: readonly DatabaseSourceSchemaObject[], admitted: Set<string>, retainedRows: boolean): void {
  const tables = ['_changes', '_zero_sync_log_state', '_change_sequence'];
  const fences = CHANGE_LOG_TRIGGER_DEFINITIONS.map(([name]) => name);
  const related = objects.filter(object => tables.some(name => name.toLowerCase() === object.name.toLowerCase() || name.toLowerCase() === object.tbl_name.toLowerCase())
    || fences.some(name => name.toLowerCase() === object.name.toLowerCase()));
  if (!related.length) return;
  for (const table of tables) {
    const object = related.find(object => object.name === table);
    if (!object || object.type !== 'table' || !object.sql) mismatch('sync');
    admitted.add(table);
  }
  for (const [name, sql] of CHANGE_LOG_TRIGGER_DEFINITIONS) {
    const object = related.find(object => object.name === name);
    if (!object || object.type !== 'trigger' || !object.sql || shape(object.sql) !== shape(sql)) mismatch('sync');
    admitted.add(name);
  }
  if (related.some(object => !admitted.has(object.name))) mismatch('sync');
  const stateSql = `CREATE TABLE _zero_sync_log_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1), schema_version INTEGER NOT NULL, write_format INTEGER NOT NULL,
    min_reader_format INTEGER NOT NULL, seq INTEGER NOT NULL CHECK ( seq >= 0 AND seq <= 9007199254740991 ),
    prune_through INTEGER NOT NULL CHECK ( prune_through >= 0 AND prune_through <= seq )
  ) STRICT`;
  const sequenceSql = 'CREATE TABLE _change_sequence ( singleton INTEGER PRIMARY KEY CHECK (singleton = 1), seq INTEGER NOT NULL CHECK (seq >= 0) )';
  if (shape(related.find(object => object.name === '_zero_sync_log_state')!.sql!) !== shape(stateSql)
    || shape(related.find(object => object.name === '_change_sequence')!.sql!) !== shape(sequenceSql)) mismatch('sync');
  const expected = new Map([['seq', ['INTEGER', 0, 1]], ['tbl', ['TEXT', 1, 0]], ['op', ['TEXT', 1, 0]], ['row_id', ['TEXT', 1, 0]],
    ['data', ['TEXT', 0, 0]], ['previous_data', ['TEXT', 0, 0]], ['ts', ['INTEGER', 1, 0]], ['origin', ['TEXT', 0, 0]], ['format_version', ['', 0, 0]]]);
  const columns = all<{ name: string; type: string; notnull: number; pk: number; hidden: number; dflt_value: unknown }>(database, 'PRAGMA main.table_xinfo(_changes)');
  if (columns.length !== expected.size || columns.some(column => {
    const wanted = expected.get(column.name); return !wanted || column.type.toUpperCase() !== wanted[0] || column.notnull !== wanted[1]
      || column.pk !== wanted[2] || column.hidden !== 0 || column.dflt_value !== null;
  })) mismatch('sync');
  const changeSql = related.find(object => object.name === '_changes')!.sql!;
  if (/\bcollate\b|\bautoincrement\b/i.test(changeSql) || all(database, 'PRAGMA main.index_list(_changes)').length) mismatch('sync');
  if (retainedRows) assertDatabaseSourceSyncHistory(database); else readCurrentDatabaseSourceSyncState(database);
}

function assertLoggingRows(database: Database, retainedRows: boolean): void {
  const sources = all<{ id: number; source_id: string; queued: number; bytes: number }>(database,
    `SELECT id,${boundedText('source_id', LOGGING_ID_CHARACTERS)} AS source_id,${boundedInteger('queued')} AS queued,${boundedInteger('bytes')} AS bytes FROM _zero_logging_source LIMIT 2`);
  if (sources.length !== 1 || sources[0]!.id !== 1) mismatch('logging-source');
  const source = sources[0]!; loggingId(source.source_id);
  if (!Number.isSafeInteger(source.queued) || source.queued < 0 || source.queued > LOGGING_SOURCE_HARD_EVENTS
    || !Number.isSafeInteger(source.bytes) || source.bytes < 0 || source.bytes > LOGGING_SOURCE_HARD_BYTES
    || source.bytes < source.queued || source.bytes > source.queued * LOGGING_MAX_EVENT_BYTES) mismatch('logging-source');
  if (!retainedRows) return;
  const contexts = database.prepare(`SELECT id,${boundedText('digest', 64)} AS digest,
    ${boundedText('payload', LOGGING_SOURCE_CONTEXT_CHARACTERS)} AS payload FROM _zero_logging_contexts ORDER BY id LIMIT ?`);
  let contextCount = 0;
  try { for (const row of contexts.iterate(LOGGING_SOURCE_HARD_EVENTS + 1) as IterableIterator<{ id: number; digest: string; payload: string }>) {
    if (++contextCount > LOGGING_SOURCE_HARD_EVENTS || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.payload !== 'string' || row.payload.length > LOGGING_SOURCE_CONTEXT_CHARACTERS
      || loggingDigest(JSON.parse(row.payload)) !== row.digest) mismatch('logging-context');
  } } finally { contexts.finalize(); }
  const events = database.prepare(`SELECT ${boundedText('o.event_id', LOGGING_ID_CHARACTERS)} AS event_id,
    ${boundedText('o.payload', LOGGING_SOURCE_PAYLOAD_CHARACTERS)} AS payload,${boundedInteger('o.bytes')} AS bytes,
    ${boundedInteger('o.ordinal')} AS ordinal,${boundedInteger('o.context_id')} AS context_id,typeof(o.context_id) AS context_id_type,
    ${boundedText('c.payload', LOGGING_SOURCE_CONTEXT_CHARACTERS)} AS context
    FROM _zero_logging_outbox o LEFT JOIN _zero_logging_contexts c ON c.id=o.context_id ORDER BY o.ordinal LIMIT ?`);
  let count = 0, bytes = 0, ordinal = 0;
  try { for (const row of events.iterate(LOGGING_SOURCE_HARD_EVENTS + 1) as IterableIterator<{ event_id: string; payload: string; bytes: number; ordinal: number; context_id: number | null; context_id_type: string; context: string | null }>) {
    if (++count > LOGGING_SOURCE_HARD_EVENTS || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > LOGGING_MAX_EVENT_BYTES
      || typeof row.payload !== 'string' || row.payload.length > LOGGING_SOURCE_PAYLOAD_CHARACTERS || !Number.isSafeInteger(row.ordinal) || row.ordinal <= ordinal
      || !['null', 'integer'].includes(row.context_id_type)
      || row.context_id !== null && (!Number.isSafeInteger(row.context_id) || row.context_id < 1 || row.context === null)) mismatch('logging-outbox');
    ordinal = row.ordinal; bytes += row.bytes;
    if (bytes > LOGGING_SOURCE_HARD_BYTES) mismatch('logging-outbox');
    const event = decodeLoggingSourceEvent(row.payload, row.context);
    if (event.id !== row.event_id || event.sourceId !== source.source_id || loggingByteLength(event) !== row.bytes) mismatch('logging-outbox');
  } } finally { events.finalize(); }
  if (count !== source.queued || bytes !== source.bytes) mismatch('logging-accounting');
}

function assertReceiptRows(database: Database, retainedRows: boolean): void {
  const stats = all<{ singleton: number; schema_version: number; total_keys: number; retained_results: number; retained_result_bytes: number }>(database,
    'SELECT * FROM _zero_database_receipt_stats_v1 LIMIT 2');
  const stat = stats[0];
  if (stats.length !== 1 || !stat || stat.singleton !== 1 || stat.schema_version !== 1
    || !Number.isSafeInteger(stat.total_keys) || stat.total_keys < 0 || stat.total_keys > DATABASE_WRITER_MAX_RECEIPT_KEYS
    || !Number.isSafeInteger(stat.retained_results) || stat.retained_results < 0 || stat.retained_results > DATABASE_WRITER_MAX_RECEIPTS
    || stat.retained_results > stat.total_keys
    || !Number.isSafeInteger(stat.retained_result_bytes) || stat.retained_result_bytes < stat.retained_results
    || stat.retained_result_bytes > DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES
    || stat.retained_result_bytes > stat.retained_results * DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES) mismatch('receipts');
  if (!retainedRows) return;
  const statement = database.prepare(`SELECT ${boundedText('receipt_key', DATABASE_IDEMPOTENCY_KEY_MAX_LENGTH)} AS receipt_key,
    ${boundedText('realm_fingerprint', 71)} AS realm_fingerprint,${boundedText('operation_fingerprint', 71)} AS operation_fingerprint,
    ${boundedText('receipt_state', 8)} AS receipt_state,
    CASE WHEN typeof(result_json)='text' AND length(CAST(result_json AS BLOB))<=${DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES} THEN result_json ELSE NULL END AS result_json,
    final_seq,result_version,schema_version,created_at,insertion_ordinal,
    typeof(receipt_key) AS receipt_key_type,typeof(realm_fingerprint) AS realm_fingerprint_type,
    typeof(operation_fingerprint) AS operation_fingerprint_type,typeof(receipt_state) AS receipt_state_type,typeof(result_json) AS result_json_type,
    typeof(final_seq) AS final_seq_type,typeof(result_version) AS result_version_type,typeof(schema_version) AS schema_version_type,
    typeof(created_at) AS created_at_type,typeof(insertion_ordinal) AS insertion_ordinal_type
    FROM _zero_database_operation_receipts ORDER BY insertion_ordinal LIMIT ?`);
  let keys = 0, retained = 0, bytes = 0;
  try { for (const row of statement.iterate(DATABASE_WRITER_MAX_RECEIPT_KEYS + 1) as IterableIterator<DatabaseReceiptRow>) {
    if (++keys > DATABASE_WRITER_MAX_RECEIPT_KEYS || !isDatabaseIdempotencyKey(row.receipt_key)) mismatch('receipts');
    assertDatabaseReceiptRow(row, row.receipt_key);
    if (row.insertion_ordinal !== keys) mismatch('receipts');
    if (row.receipt_state === 'retained') {
      retained++; bytes += Buffer.byteLength(row.result_json!, 'utf8'); JSON.parse(row.result_json!);
      if (retained > DATABASE_WRITER_MAX_RECEIPTS || bytes > DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES) mismatch('receipts');
    }
  } } finally { statement.finalize(); }
  if (keys !== stat.total_keys || retained !== stat.retained_results || bytes !== stat.retained_result_bytes) mismatch('receipts');
}

/** Returns only explicitly validated framework names; neither prefixes nor a
 * framework-looking name grant admission. Domain-stage classification remains
 * the caller's responsibility. */
export function assertDatabaseMigrationSourceFramework(database: Database,
  objects: readonly DatabaseSourceSchemaObject[]): ReadonlySet<string> {
  return assertFramework(database, objects, true);
}
/** Native current/no-op classification, not a retained-payload audit. Exact
 * objects and fixed metadata remain mandatory; owning receipt/logging reads
 * validate their payloads. Current F1 Sync history is checked separately once.
 * This is never selected by caller configuration or serialized policy data. */
export function assertDatabaseSourceFrameworkStructure(database: Database,
  objects: readonly DatabaseSourceSchemaObject[]): ReadonlySet<string> {
  return assertFramework(database, objects, false);
}
function assertFramework(database: Database, objects: readonly DatabaseSourceSchemaObject[], retainedRows: boolean): ReadonlySet<string> {
  const admitted = new Set<string>();
  try {
    if (admitGroup(database, objects, bindingObjects, admitted)) {
      const rows = all<{ database_ref: string | null; realm_name: string | null; bounded_instance: number }>(database,
        `SELECT ${boundedText('database_ref', 64)} AS database_ref,${boundedText('realm_name', 128)} AS realm_name,
          CASE WHEN typeof(instance_id)='text' AND length(CAST(instance_id AS BLOB))=36 AND length(instance_id)=36
            THEN 1 ELSE 0 END AS bounded_instance FROM ${BINDING} LIMIT 2`);
      const row = rows[0];
      if (rows.length !== 1 || !row || row.database_ref === null || row.realm_name === null || row.bounded_instance !== 1) mismatch('binding');
      readDatabaseBindingIdentity(database, normalizeDatabaseRef(row.database_ref), row.realm_name);
    }
    admitGroup(database, objects, migrationObjects, admitted, true);
    admitSync(database, objects, admitted, retainedRows);
    if (admitGroup(database, objects, DATABASE_RECEIPT_SCHEMA_OBJECTS, admitted)) { if (!databaseReceiptSchemaReady(database)) mismatch('receipts'); assertReceiptRows(database, retainedRows); }
    if (admitGroup(database, objects, loggingObjects, admitted)) assertLoggingRows(database, retainedRows);
    for (const object of objects) {
      if (object.name === 'sqlite_sequence' && object.type === 'table' && object.sql === 'CREATE TABLE sqlite_sequence(name,seq)') admitted.add(object.name);
    }
    return admitted;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    return mismatch('framework-state');
  }
}
