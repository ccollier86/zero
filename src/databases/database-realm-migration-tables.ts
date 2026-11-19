/** Optional actor-imported table stages. No callbacks, SQL payloads, repair or legacy adoption.
 * Original migration functions/checksums are never replaced. Only boundary DDL
 * joins their existing native transaction. Omitted stages preserve old behavior.
 */
import type { Database, Statement } from 'bun:sqlite';
import type { Migration, MigrationLedgerRecord } from '../migrations/types';
import { hashMigration, hashSchemaSnapshot, snapshotDeclaredTables, stableStringify } from '../migrations/schema-snapshot';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { readMigrationLedgerState } from '../migrations/migration-ledger';
import { isIsolatedDatabaseColumnDefinition, databaseColumnDefinitionDeclaresPrimaryKey, databaseColumnDefinitionAffinity } from '../sync/row-identity';
import { quoteSqlIdentifier } from '../sync/identity';
import type { TableSchema } from '../sync/types';
import { cloneDatabaseSerializableValue, isDatabaseTableName } from './database-operations';
import { databaseRealmColumnAdmissionIssue, databaseRealmRegistryAdmissionIssue, databaseRealmTableNameAdmissionIssue } from './database-realm-schema-admission';
import { orderDatabaseRealmTables, readDatabaseRealmReferencedTables } from './database-realm-table-order';
import { DatabaseError } from './database-error';
import { assertDatabaseMigrationSourceFramework, assertDatabaseSourceFrameworkStructure, assertDatabaseSourceSyncHistory } from './database-realm-source-framework';

export interface DatabaseRealmMigrationTableStage {
  readonly version: string;
  /** Exact cumulative application schema AFTER the original migration. */
  readonly tables: Readonly<Record<string, TableSchema>>;
  readonly prepare?: 'create-added-tables';
}
const admitted = new WeakSet<object>();
function config(): never { throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database migration table stages are invalid.', { outcome: 'not-started' }); }
function mismatch(): never { throw new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Database migration source is inconsistent.', { outcome: 'not-started' }); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return config();
  return value as Record<string, unknown>;
}
function tables(value: unknown): Readonly<Record<string, TableSchema>> {
  const source = record(value), result: Record<string, TableSchema> = Object.create(null), folded = new Set<string>();
  for (const [name, raw] of Object.entries(source)) {
    if (!isDatabaseTableName(name) || databaseRealmTableNameAdmissionIssue(name) || folded.has(name.toLowerCase())) return config();
    folded.add(name.toLowerCase()); const declaration = record(raw), columns: Record<string, string | string[]> = Object.create(null);
    const primary = Object.entries(declaration).filter(([key, definition]) => key !== '_identity' && databaseColumnDefinitionDeclaresPrimaryKey(definition)), fields = new Set<string>();
    if (primary.length !== 1 || !['TEXT', 'INTEGER'].includes(databaseColumnDefinitionAffinity(primary[0]![1]))) return config();
    for (const [column, definition] of Object.entries(declaration)) {
      if (column === '_identity') continue;
      if (!isDatabaseTableName(column) || fields.has(column.toLowerCase()) || typeof definition !== 'string' || Buffer.byteLength(definition)>8192
        || !isIsolatedDatabaseColumnDefinition(definition)
        || databaseRealmColumnAdmissionIssue({ table: name, column, definition, primaryKey: column === primary[0]![0] })) return config();
      columns[column] = definition;
      fields.add(column.toLowerCase());
    }
    if (declaration._identity !== undefined) {
      const identity = declaration._identity;
      if (!Array.isArray(identity) || !identity.length || identity.some(field => typeof field !== 'string' || !Object.hasOwn(columns, field)) || new Set(identity).size !== identity.length) return config();
      columns._identity = Object.freeze([...identity]) as unknown as string[];
    }
    result[name] = Object.freeze(columns);
  }
  if (databaseRealmRegistryAdmissionIssue(result)) return config();
  const names = new Set(Object.keys(result).map(name => name.toLowerCase()));
  for (const declaration of Object.values(result)) for (const definition of Object.values(declaration)) if (typeof definition === 'string'
    && readDatabaseRealmReferencedTables(definition).some(name => !names.has(name.toLowerCase()))) return config();
  return Object.freeze(Object.fromEntries(orderDatabaseRealmTables(Object.entries(result).map(([name, value]) => ({ name, value }))).map(entry => [entry.name, entry.value])));
}
export function admitDatabaseRealmMigrationTableStages(input: unknown, migrations: readonly Readonly<Migration>[], latest?: Readonly<Record<string, TableSchema>>): readonly DatabaseRealmMigrationTableStage[] | undefined {
  if (input === undefined) return undefined;
  let detached: unknown;
  try { detached = cloneDatabaseSerializableValue(input); } catch { return config(); }
  if (!Array.isArray(detached) || !detached.length || detached.length !== migrations.length) return config();
  let prior: Readonly<Record<string, TableSchema>> = {};
  const stages = detached.map((raw, index) => {
    const value = record(raw);
    if (Object.keys(value).some(key => !['version', 'tables', 'prepare'].includes(key)) || value.version !== migrations[index]!.version
      || Object.hasOwn(value, 'prepare') && value.prepare !== 'create-added-tables') return config();
    const schema = tables(value.tables);
    if (value.prepare && Object.entries(prior).some(([name, declaration]) => stableStringify(declaration) !== stableStringify(schema[name]))) return config();
    prior = schema;
    return Object.freeze({ version: value.version as string, tables: schema, ...(value.prepare ? { prepare: 'create-added-tables' as const } : {}) });
  });
  if (latest) {
    let admittedLatest: Readonly<Record<string, TableSchema>>;
    try { admittedLatest = tables(cloneDatabaseSerializableValue(latest)); } catch { return config(); }
    if (hashSchemaSnapshot(snapshotDeclaredTables(prior as Record<string, TableSchema>)) !== hashSchemaSnapshot(snapshotDeclaredTables(admittedLatest as Record<string, TableSchema>))) return config();
  }
  const result = Object.freeze(stages); admitted.add(result); return result;
}
export function databaseRealmMigrationTableStagesFingerprint(stages: readonly DatabaseRealmMigrationTableStage[]): readonly unknown[] {
  return Object.freeze(stages.map(stage => Object.freeze({ version: stage.version, schema: hashSchemaSnapshot(snapshotDeclaredTables(stage.tables as Record<string, TableSchema>)),
    ...(stage.prepare ? { prepare: stage.prepare } : {}) })));
}
/** Raw Migrator also admits/detaches its native option; no caller can manufacture a trusted brand. */
export function requireDatabaseRealmMigrationTableStages(input: readonly DatabaseRealmMigrationTableStage[] | undefined, migrations: readonly Readonly<Migration>[]): readonly DatabaseRealmMigrationTableStage[] | undefined {
  if (input === undefined) return undefined;
  if (admitted.has(input)) {
    if (input.length !== migrations.length || input.some((stage, index) => stage.version !== migrations[index]?.version)) return config();
    return input;
  }
  return admitDatabaseRealmMigrationTableStages(input, migrations);
}
function inspected(database: Database) {
  const statements: Statement[] = [];
  try { return inspectDatabaseSchema({ prepare(sql: string) { const statement = database.prepare(sql); statements.push(statement); return statement; } } as Database); }
  finally { for (const statement of statements.reverse()) statement.finalize(); }
}
function all<T>(database: Database, sql: string): T[] {
  const statement = database.prepare(sql); try { return statement.all() as T[]; } finally { statement.finalize(); }
}
/** Every statement is readonly. Call on the guarded source BEFORE writable
 * service/ledger constructors, and again under each pending migration lock.
 */
export function assertDatabaseRealmMigrationSource(database: Database, stages: readonly DatabaseRealmMigrationTableStage[], migrations: readonly Readonly<Migration>[]): number {
  return database.inTransaction ? inspectMigrationSource(database, stages, migrations, 'prepare')
    : database.transaction(() => inspectMigrationSource(database, stages, migrations, 'prepare')).deferred();
}
/** A native current/no-migrate purpose must have the entire exact prefix. This
 * does not rescan receipt/logging history; it owns current F1 Sync proof. */
export function assertDatabaseRealmCurrentMigrationSource(database: Database, stages: readonly DatabaseRealmMigrationTableStage[], migrations: readonly Readonly<Migration>[]): number {
  return database.inTransaction ? inspectMigrationSource(database, stages, migrations, 'current')
    : database.transaction(() => inspectMigrationSource(database, stages, migrations, 'current')).deferred();
}
function inspectMigrationSource(database: Database, stages: readonly DatabaseRealmMigrationTableStage[], migrations: readonly Readonly<Migration>[], purpose: 'prepare' | 'current'): number {
  try {
    const objects = all<{ type: string; name: string; tbl_name: string; sql: string | null }>(database,
      "SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name");
    const framework = assertDatabaseSourceFrameworkStructure(database, objects);
    let prefix = 0;
    if (objects.some(object => object.name === '_zero_migrations')) {
      const hashes = new Map(migrations.map(migration => [migration.version, hashMigration(migration)]));
      const events = database.prepare('SELECT version,checksum,direction,status FROM _zero_migrations ORDER BY id');
      try { for (const event of events.iterate() as IterableIterator<Pick<MigrationLedgerRecord, 'version' | 'checksum' | 'direction' | 'status'>>) {
        if (!hashes.has(event.version) || hashes.get(event.version) !== event.checksum || !['up', 'down'].includes(event.direction)
          || !['applied', 'rolled_back', 'failed'].includes(event.status)) return mismatch();
      } } finally { events.finalize(); }
      const states = readMigrationLedgerState(database);
      while (prefix < migrations.length && states.get(migrations[prefix]!.version)?.status === 'applied' && states.get(migrations[prefix]!.version)?.direction === 'up') prefix++;
      for (let index = prefix; index < migrations.length; index++) if (states.get(migrations[index]!.version)?.status === 'applied') return mismatch();
      const expected = new Map([...states].filter(([, state]) => state.status === 'applied' && state.direction === 'up').map(([version, state]) => [version, state.checksum]));
      const legacyCount = all<{ count: number }>(database, 'SELECT count(*) AS count FROM _migrations')[0]?.count;
      if (legacyCount !== expected.size) return mismatch();
      const legacyStatement = database.prepare('SELECT version,checksum FROM _migrations ORDER BY version LIMIT ?');
      let legacy: { version: string; checksum: string }[];
      try { legacy = legacyStatement.all(expected.size + 1) as typeof legacy; } finally { legacyStatement.finalize(); }
      if (legacy.length !== expected.size || legacy.some(row => expected.get(row.version) !== row.checksum)) return mismatch();
    } else if (objects.some(object => ['_migrations', '_zero_schema_history', '_zero_migration_artifacts'].includes(object.name))) return mismatch();
    const expected = prefix ? stages[prefix - 1]!.tables : {}, actual = inspected(database);
    const application = { tables: Object.fromEntries(Object.entries(actual.tables).filter(([name]) => !framework.has(name))) };
    if (Object.keys(application.tables).length !== Object.keys(expected).length || Object.keys(application.tables).some(name => !Object.hasOwn(expected, name))) return mismatch();
    if (diffSchemaSnapshots(snapshotDeclaredTables(expected as Record<string, TableSchema>), application).length) return mismatch();
    for (const [name, declaration] of Object.entries(expected)) if (Object.keys(declaration).filter(field => field !== '_identity')
      .some((field, index) => application.tables[name]!.columnOrder[index] !== field)) return mismatch();
    for (const object of objects) if (!framework.has(object.name) && !framework.has(object.tbl_name)
      && (object.type === 'table' ? !Object.hasOwn(expected, object.name) : !['index', 'trigger'].includes(object.type) || !Object.hasOwn(expected, object.tbl_name))) return mismatch();
    if (purpose === 'current' && prefix !== migrations.length) return mismatch();
    // No-op/default prepare is still exact structural/ledger/domain admission,
    // not an integrity audit of every permanent receipt or logging envelope.
    // A real pending migration must audit BEFORE any initializer/attempt write.
    if (purpose === 'prepare' && prefix < migrations.length) assertDatabaseMigrationSourceFramework(database, objects);
    else if (framework.has('_changes')) assertDatabaseSourceSyncHistory(database);
    return prefix;
  } catch (error) { if (error instanceof DatabaseError) throw error; return mismatch(); }
}
export function prepareDatabaseRealmMigrationTableStage(database: Database, stages: readonly DatabaseRealmMigrationTableStage[], migrations: readonly Readonly<Migration>[], version: string): void {
  const index = migrations.findIndex(migration => migration.version === version);
  if (!database.inTransaction || index < 0 || assertDatabaseRealmMigrationSource(database, stages, migrations) !== index) return mismatch();
  const stage = stages[index]!;
  if (stage.prepare) {
    const previous = index ? stages[index - 1]!.tables : {};
    for (const [name, declaration] of Object.entries(stage.tables)) if (!Object.hasOwn(previous, name)) {
      database.run(`CREATE TABLE ${quoteSqlIdentifier(name)} (${Object.entries(declaration)
        .filter(([column]) => column !== '_identity').map(([column, definition]) => `${quoteSqlIdentifier(column)} ${definition}`).join(',')})`);
      if (declaration._identity) database.run(`CREATE UNIQUE INDEX ${quoteSqlIdentifier(`idx_${name}_identity`)} ON ${quoteSqlIdentifier(name)} (${declaration._identity.map(quoteSqlIdentifier).join(',')})`);
    }
  }
}
export function assertDatabaseRealmMigrationTableStage(database: Database, stage: DatabaseRealmMigrationTableStage): void {
  const objects = all<{ type: string; name: string; tbl_name: string; sql: string | null }>(database,
    "SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name");
  const framework = assertDatabaseMigrationSourceFramework(database, objects), actual = inspected(database);
  const selected = { tables: Object.fromEntries(Object.entries(actual.tables).filter(([name]) => !framework.has(name))) };
  if (Object.keys(selected.tables).length !== Object.keys(stage.tables).length || Object.keys(selected.tables).some(name => !Object.hasOwn(stage.tables, name))) return mismatch();
  if (diffSchemaSnapshots(snapshotDeclaredTables(stage.tables as Record<string, TableSchema>), selected).length) return mismatch();
  for (const [name, declaration] of Object.entries(stage.tables)) if (Object.keys(declaration).filter(field => field !== '_identity')
    .some((field, index) => selected.tables[name]!.columnOrder[index] !== field)) return mismatch();
}
