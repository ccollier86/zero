/**
 * Read-only cold-open admission for existing actor storage. The source validator
 * accepts an admitted handle; its file helper opens ONLY a guarded readonly
 * handle BEFORE writable policy, hot loading, migration, or initialization.
 * A successful check is not a cached request-authority or full trigger proof.
 */

import { Database, type Statement } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { readMigrationLedgerState } from '../migrations/migration-ledger';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { snapshotDeclaredTables, stableStringify } from '../migrations/schema-snapshot';
import { inspectGuardianReferenceSchema } from '../schema/guardian-references';
import { quoteSqlIdentifier } from '../sync/identity';
import { canonicalDatabaseRowId } from '../sync/row-identity';
import type { TableSchema } from '../sync/types';
import { readDatabaseBindingIdentity, type DatabaseBindingIdentity } from './database-binding-identity';
import { DatabaseError } from './database-error';
import type { DatabaseRef } from './database-file';
import { openDatabaseFileIdentityGuard, type DatabaseFileIdentityProof } from './database-file-identity';
import {
  cloneDatabaseSerializableValue,
  isDatabaseTableName,
  type DatabaseSerializableScalar,
} from './database-operations';
import { assertCurrentDatabaseSourceFramework, assertCurrentDatabaseSourceFrameworkAfterManifest } from './database-realm-source-framework';
import { createDatabaseRealmOperationCatalog, type DatabaseRealm } from './database-realm';
import { assertDatabaseRealmCurrentMigrationSource, assertDatabaseRealmMigrationSource } from './database-realm-migration-tables';

export interface DatabaseOpenRowAdmission {
  readonly table: string;
  readonly id: string | number;
  readonly equals: Readonly<Record<string, DatabaseSerializableScalar>>;
  /** Explicit prepare-only creation: an existing mismatched row never passes. */
  readonly allowMissing?: true;
}

export interface DatabaseOpenAdmission {
  /** Prepare may run migrations only after identity and optional row proof. */
  readonly schema: 'prepare' | 'current';
  readonly row?: DatabaseOpenRowAdmission;
}

export interface DatabaseOpenAdmissionOptions {
  readonly database: Database;
  readonly realm: DatabaseRealm;
  readonly admission: DatabaseOpenAdmission;
  readonly databaseRef: DatabaseRef;
  readonly instanceId: string;
}

/** Native synchronous resolver; neither it nor its closure crosses actor IPC. */
export type DatabaseOpenAdmissionResolver = (id: string) => DatabaseOpenAdmission | undefined;

export interface DatabaseBindingAdmissionInspectionOptions {
  readonly filePath: string;
  readonly fileIdentity: DatabaseFileIdentityProof;
  readonly databaseRef: DatabaseRef;
  readonly realm: DatabaseRealm;
  readonly admission: DatabaseOpenAdmission;
  readonly instanceId?: string;
  readonly busyTimeoutMs?: number;
}

/** Strict callback/SQL-free input shared by trusted parent and actor admission. */
export function normalizeDatabaseOpenAdmission(
  value: unknown,
  realm?: DatabaseRealm,
): DatabaseOpenAdmission {
  try {
    const record = plainRecord(cloneDatabaseSerializableValue(value));
    exactFields(record, ['schema'], ['row']);
    if (record.schema !== 'prepare' && record.schema !== 'current') throw configInvalid();
    if (!Object.hasOwn(record, 'row')) return Object.freeze({ schema: record.schema });

    const row = plainRecord(record.row);
    exactFields(row, ['table', 'id', 'equals'], ['allowMissing']);
    const catalog = realm ? createDatabaseRealmOperationCatalog(realm) : undefined;
    if (!isDatabaseTableName(row.table)
      || catalog && (catalog.tables?.includes(row.table) !== true || !catalog.primaryKeys?.[row.table])
      || canonicalDatabaseRowId(row.id) === null) throw configInvalid();
    if (Object.hasOwn(row, 'allowMissing') && (row.allowMissing !== true || record.schema !== 'prepare')) {
      throw configInvalid();
    }
    const equals = plainRecord(row.equals);
    const entries = Object.entries(equals);
    if (entries.length === 0 || entries.some(([field, expected]) =>
      !isDatabaseTableName(field)
      || catalog && !catalog.columns?.[row.table as string]?.includes(field)
      || !(expected === null || ['string', 'number', 'boolean'].includes(typeof expected)))) {
      throw configInvalid();
    }
    return Object.freeze({
      schema: record.schema,
      row: Object.freeze({
        table: row.table,
        id: row.id as string | number,
        equals: Object.freeze({ ...equals }) as Readonly<Record<string, DatabaseSerializableScalar>>,
        ...(row.allowMissing === true ? { allowMissing: true as const } : {}),
      }),
    });
  } catch {
    throw configInvalid();
  }
}

/** Resolve once on the current stack; reject async/generator and promise outputs. */
export function resolveDatabaseOpenAdmission(
  resolver: DatabaseOpenAdmissionResolver | undefined,
  id: string,
  realm: DatabaseRealm,
): DatabaseOpenAdmission | undefined {
  if (resolver === undefined) return realm.migrationTableStages ? Object.freeze({ schema: 'prepare' }) : undefined;
  if (typeof resolver !== 'function' || utilTypes.isAsyncFunction(resolver)
    || utilTypes.isGeneratorFunction(resolver)) throw configInvalid();
  const value: unknown = resolver(id);
  if (utilTypes.isPromise(value)) {
    void Promise.resolve(value).catch(() => undefined);
    throw configInvalid();
  }
  return value === undefined ? realm.migrationTableStages ? Object.freeze({ schema: 'prepare' }) : undefined : normalizeDatabaseOpenAdmission(value, realm);
}

/** Pinned row identity may be strengthened, never retargeted or weakened. */
export function assertDatabaseOpenAdmissionTransition(
  previous: DatabaseOpenAdmission | undefined,
  next: DatabaseOpenAdmission | undefined,
): void {
  if (previous === undefined) return;
  if (next === undefined || previous.schema === 'current' && next.schema !== 'current') {
    throw schemaMismatch('admission-changed');
  }
  if (!previous.row) return;
  if (!next.row || previous.row.table !== next.row.table || previous.row.id !== next.row.id
    || stableStringify(previous.row.equals) !== stableStringify(next.row.equals)
    || previous.row.allowMissing !== true && next.row.allowMissing === true) {
    throw schemaMismatch('admission-changed');
  }
}

/** Exact proof that the actor received the same detached cold-bind contract. */
export function databaseOpenAdmissionFingerprint(admission: DatabaseOpenAdmission): string {
  return createHash('sha256').update('zero.database-open-admission.v1\0')
    .update(stableStringify(normalizeDatabaseOpenAdmission(admission))).digest('hex');
}

/**
 * Verify an existing physical source without the ordinary RW identity/WAL
 * recovery path. Creation and legacy adoption remain explicit preparation.
 */
export function inspectDatabaseBindingIdentityWithAdmission(
  options: DatabaseBindingAdmissionInspectionOptions,
): DatabaseBindingIdentity {
  const admission = normalizeDatabaseOpenAdmission(options.admission, options.realm);
  if (options.busyTimeoutMs !== undefined && (!Number.isSafeInteger(options.busyTimeoutMs)
    || options.busyTimeoutMs <= 0)) throw configInvalid();
  const guard = openDatabaseFileIdentityGuard(options.filePath, { access: 'read', expected: options.fileIdentity });
  let database: Database | null = null;
  let identity: DatabaseBindingIdentity | null = null;
  let failure: unknown = null;
  try {
    database = new Database(options.filePath, { readonly: true, strict: true });
    guard.assertCurrent();
    database.run('PRAGMA query_only=ON');
    if (options.busyTimeoutMs !== undefined) database.run(`PRAGMA busy_timeout=${options.busyTimeoutMs}`);
    identity = readDatabaseBindingIdentity(database, options.databaseRef, options.realm.name);
    assertDatabaseOpenAdmission({ database, realm: options.realm, admission,
      databaseRef: options.databaseRef, instanceId: options.instanceId ?? identity.instanceId });
    guard.assertCurrent();
  } catch (error) { failure = error; }
  const cleanup: unknown[] = [];
  if (database) {
    try { database.close(true); }
    catch (error) {
      cleanup.push(error);
      try { database.close(false); } catch (fallback) { cleanup.push(fallback); }
    }
  }
  try { guard.release(); } catch (error) { cleanup.push(error); }
  if (cleanup.length > 0) throw new DatabaseError('DATABASE_EXECUTOR_FAILED', 'Database admission cleanup failed.', {
    retryable: false, outcome: 'unknown', cause: new AggregateError(failure === null ? cleanup : [failure, ...cleanup]),
  });
  if (failure !== null) {
    if (failure instanceof DatabaseError) throw failure;
    throw schemaMismatch('source');
  }
  if (identity === null) throw schemaMismatch('binding');
  return identity;
}

/**
 * Validate one existing source snapshot without invoking any initializer.
 * The caller owns query_only configuration, handle closure, and inode guards.
 * "current" checks declared schemas and the available framework invariants;
 * it does not establish arbitrary migration-created trigger/view equivalence.
 */
export function assertDatabaseOpenAdmission(options: DatabaseOpenAdmissionOptions): void {
  const { database, realm, databaseRef, instanceId } = options;
  const admission = normalizeDatabaseOpenAdmission(options.admission, realm);
  const queryOnly = readOne<{ query_only: number }>(database, 'PRAGMA query_only');
  if (queryOnly?.query_only !== 1) throw configInvalid();
  try {
    database.transaction(() => {
      const identity = readDatabaseBindingIdentity(database, databaseRef, realm.name);
      if (identity.instanceId !== instanceId) throw schemaMismatch('binding');
      // Owner mismatch must precede EVERY mutating preparation branch, even
      // when explicit preparation is allowed to upgrade an old schema.
      if (admission.row) assertRow(database, realm, admission.row);
      if (realm.migrationTableStages) {
        if (admission.schema === 'current') assertDatabaseRealmCurrentMigrationSource(database, realm.migrationTableStages, realm.migrations);
        else assertDatabaseRealmMigrationSource(database, realm.migrationTableStages, realm.migrations);
      }
      if (admission.schema === 'prepare') return;
      assertCurrentLedger(database, realm);
      assertCurrentRealmSchema(database, realm);
      assertCurrentFrameworkSchema(database, realm);
    }).deferred();
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw schemaMismatch('source');
  }
}

function assertRow(database: Database, realm: DatabaseRealm, row: DatabaseOpenRowAdmission): void {
  const primaryKey = createDatabaseRealmOperationCatalog(realm).primaryKeys![row.table]!;
  const fields = Object.keys(row.equals);
  const object = readOne<{ type: string }>(database,
    'SELECT type FROM main.sqlite_schema WHERE name=? COLLATE BINARY', row.table);
  if (object === null && row.allowMissing === true) return;
  if (object?.type !== 'table') throw schemaMismatch('row');
  const selected = [...new Set([primaryKey, ...fields])];
  const actual = readOne<Record<string, unknown>>(database,
    `SELECT ${selected.map(quoteSqlIdentifier).join(', ')} FROM main.${quoteSqlIdentifier(row.table)} `
      + `WHERE ${quoteSqlIdentifier(primaryKey)} = ? LIMIT 1`, row.id);
  if (actual === null && row.allowMissing === true) return;
  if (!actual || canonicalDatabaseRowId(actual[primaryKey]) !== canonicalDatabaseRowId(row.id)
    || fields.some(field => actual[field] !== sqliteScalar(row.equals[field]!))) {
    throw schemaMismatch('row');
  }
}

/** SQLite/Bun represents bound JSON booleans as INTEGER 0/1, never JS booleans. */
function sqliteScalar(value: DatabaseSerializableScalar): string | number | null {
  return typeof value === 'boolean' ? Number(value) : value;
}

function assertCurrentLedger(database: Database, realm: DatabaseRealm): void {
  const object = readOne<{ type: string }>(database,
    "SELECT type FROM main.sqlite_schema WHERE name='_zero_migrations' COLLATE BINARY");
  if (object?.type !== 'table') throw schemaMismatch('ledger');
  const columns = readAll<{ name: string; type: string; pk: number; hidden: number }>(database,
    'PRAGMA main.table_xinfo(_zero_migrations)');
  const expected = [
    ['id', 'INTEGER'], ['version', 'TEXT'], ['description', 'TEXT'], ['checksum', 'TEXT'],
    ['safety', 'TEXT'], ['direction', 'TEXT'], ['batch', 'INTEGER'], ['status', 'TEXT'],
    ['applied_at', 'TEXT'], ['duration_ms', 'INTEGER'], ['error', 'TEXT'], ['schema_hash', 'TEXT'],
  ];
  if (columns.length !== expected.length || columns.some((column, index) =>
    column.name !== expected[index]![0] || column.type.toUpperCase() !== expected[index]![1]
    || column.pk !== (index === 0 ? 1 : 0) || column.hidden !== 0)) throw schemaMismatch('ledger');
  const states = readMigrationLedgerState(database);
  if (states.size !== realm.migrationChecksums.length) throw schemaMismatch('ledger');
  for (const migration of realm.migrationChecksums) {
    const state = states.get(migration.version);
    if (!state || state.status !== 'applied' || state.direction !== 'up'
      || state.checksum !== migration.checksum) throw schemaMismatch('ledger');
  }
}

function assertCurrentRealmSchema(database: Database, realm: DatabaseRealm): void {
  const expected = snapshotDeclaredTables(realm.tables as Record<string, TableSchema>);
  // The shared inspector is read-only but does not finalize its statements.
  // Own/finalize this invocation's exact statements before releasing the source.
  const statements: Statement[] = [];
  let actual: ReturnType<typeof inspectDatabaseSchema>;
  try {
    actual = inspectDatabaseSchema({
      prepare(sql: string) {
        const statement = database.prepare(sql);
        statements.push(statement);
        return statement;
      },
    } as Database);
  } finally {
    for (const statement of statements.reverse()) statement.finalize();
  }
  // Framework and undeclared migration-owned objects are not declared tables.
  actual = { tables: Object.fromEntries(Object.keys(expected.tables)
    .filter(table => Object.hasOwn(actual.tables, table))
    .map(table => [table, actual.tables[table]!])) };
  if (diffSchemaSnapshots(expected, actual).length > 0) throw schemaMismatch('realm');
  for (const [table, schema] of Object.entries(realm.tables)) {
    const columns = actual.tables[table]?.columnOrder;
    const expectedColumns = expected.tables[table]!.columnOrder;
    if (!columns || columns.some((column, index) => column !== expectedColumns[index])
      || inspectGuardianReferenceSchema(schema, { database, tableName: table }).length > 0) {
      throw schemaMismatch('realm');
    }
  }
}

function assertCurrentFrameworkSchema(database: Database, realm: DatabaseRealm): void {
  // SAME readonly transaction as the manifest proof above. No cross-open or
  // actor/request authority is cached; unopted F1 still proves its own history.
  if (realm.migrationTableStages) assertCurrentDatabaseSourceFrameworkAfterManifest(database, realm);
  else assertCurrentDatabaseSourceFramework(database, realm);
}

function readOne<T>(database: Database, sql: string, ...params: (string | number)[]): T | null {
  const statement = database.prepare(sql);
  try { return statement.get(...params) as T | null; }
  finally { statement.finalize(); }
}

function readAll<T>(database: Database, sql: string): T[] {
  const statement = database.prepare(sql);
  try { return statement.all() as T[]; }
  finally { statement.finalize(); }
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw configInvalid();
  return value as Record<string, unknown>;
}

function exactFields(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some(field => !Object.hasOwn(record, field))
    || Object.keys(record).some(field => !required.includes(field) && !optional.includes(field))) {
    throw configInvalid();
  }
}

function configInvalid(): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', 'Database open admission is invalid.',
    { retryable: false, outcome: 'not-started' });
}

function schemaMismatch(component: string): DatabaseError {
  return new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Database source does not satisfy open admission.',
    { retryable: false, outcome: 'not-started', details: { component: 'open-admission', reason: component } });
}
