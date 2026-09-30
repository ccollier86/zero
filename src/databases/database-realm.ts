/**
 * database-realm.ts
 *
 * Side-effect-free application code loaded independently by database actors.
 * A realm contains immutable schema/migration registries plus named handlers;
 * none of its functions ever cross the public operation or IPC boundary.
 */

import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
  createMigrationRegistry,
  type Migration,
  type MigrationRegistry,
} from '../migrations/migrator';
import {
  hashMigration,
  hashSchemaSnapshot,
  snapshotDeclaredTables,
  stableStringify,
} from '../migrations/schema-snapshot';
import type { ReactiveDB } from '../sync/reactive-db';
import {
  attachGuardianTableReferences,
  getGuardianAnchorRequirements,
  getGuardianTableReferences,
  GUARDIAN_TABLE_REFERENCES,
  inspectGuardianReferenceSchema,
  type GuardianFieldReference,
  type GuardianReferenceKind,
} from '../schema/guardian-references';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type Row,
  type SyncTableMutationValidator,
  type TableSchema,
} from '../sync/types';
import { DatabaseError } from './database-error';
import {
  cloneDatabaseHandlerResult,
  invalidDatabaseHandlerResult,
} from './database-handler-result-validation';
import {
  databaseRealmColumnAdmissionIssue,
  databaseRealmRegistryAdmissionIssue,
  databaseRealmTableNameAdmissionIssue,
} from './database-realm-schema-admission';
import type { DatabaseReadQueryContext } from './database-read-query-capability';
import {
  createDatabaseWriteCommandSession,
  type DatabaseWriteCommandContext,
} from './database-write-command-capability';
import {
  databaseColumnDefinitionAffinity,
  databaseColumnDefinitionDeclaresPrimaryKey,
  isSupportedDatabaseRowIdentityAffinity,
  isIsolatedDatabaseColumnDefinition,
} from '../sync/row-identity';
import {
  cloneDatabaseSerializableValue,
  isDatabaseRegistryName,
  isDatabaseTableName,
  type DatabaseOperationCatalog,
  type DatabaseSerializableValue,
} from './database-operations';

/** Domain separator for deterministic realm fingerprints. */
export const DATABASE_REALM_FINGERPRINT_VERSION = 1 as const;

/** Maximum UTF-8 bytes accepted in one table column definition. */
export const DATABASE_REALM_SQL_DEFINITION_MAX_BYTES = 8_192;

/** Maximum UTF-8 bytes accepted in a migration description. */
export const DATABASE_REALM_MIGRATION_DESCRIPTION_MAX_BYTES = 1_024;

const REALM_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const MIGRATION_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const MIGRATION_SAFETY = new Set(['safe', 'guarded', 'destructive', 'manual']);
const REALM_FIELDS = new Set([
  'name',
  'version',
  'tables',
  'migrations',
  'queries',
  'commands',
]);
const MIGRATION_FIELDS = new Set([
  'version',
  'description',
  'safety',
  'downSafety',
  'backupRequired',
  'up',
  'down',
]);
const VALIDATOR_FIELDS = new Set([
  'primaryKey',
  'fieldNames',
  'decodeRow',
  'encodeRow',
  'validateRow',
]);
const textEncoder = new TextEncoder();

export type {
  DatabaseReadQueryConnection,
  DatabaseReadQueryContext,
  DatabaseReadQueryStatement,
} from './database-read-query-capability';
export type {
  DatabaseWriteCommandCapability,
  DatabaseWriteCommandContext,
} from './database-write-command-capability';

/** Synchronous actor-local registered query. */
export type DatabaseReadQueryHandler<
  TInput extends DatabaseSerializableValue = DatabaseSerializableValue,
  TOutput extends DatabaseSerializableValue = DatabaseSerializableValue,
> = (
  context: DatabaseReadQueryContext,
  input: TInput,
) => TOutput;

/** Synchronous actor-local registered command. */
export type DatabaseWriteCommandHandler<
  TInput extends DatabaseSerializableValue = DatabaseSerializableValue,
  TOutput extends DatabaseSerializableValue = DatabaseSerializableValue,
> = (
  context: DatabaseWriteCommandContext,
  input: TInput,
) => TOutput;

export type DatabaseReadQueryRegistry = Readonly<
  Record<string, DatabaseReadQueryHandler<any, any>>
>;

export type DatabaseWriteCommandRegistry = Readonly<
  Record<string, DatabaseWriteCommandHandler<any, any>>
>;

export interface DatabaseRealmDefinition<
  TQueries extends DatabaseReadQueryRegistry = DatabaseReadQueryRegistry,
  TCommands extends DatabaseWriteCommandRegistry = DatabaseWriteCommandRegistry,
> {
  /** Stable deployment-independent realm identity. */
  readonly name: string;
  /** Explicit application schema/behavior version. */
  readonly version: string;
  /** ReactiveDB tables initialized in every file using this realm. */
  readonly tables: Readonly<Record<string, TableSchema>>;
  /** Ordered application migrations. */
  readonly migrations?: readonly Migration[];
  /** Named synchronous read handlers imported inside reader actors. */
  readonly queries?: TQueries;
  /** Named synchronous write handlers imported inside writer actors. */
  readonly commands?: TCommands;
}

/** One immutable migration checksum entry used by actor handshakes. */
export interface DatabaseRealmMigrationChecksum {
  readonly version: string;
  readonly checksum: string;
}

/** Validated immutable database realm imported by parent and actor processes. */
export interface DatabaseRealm<
  TQueries extends DatabaseReadQueryRegistry = DatabaseReadQueryRegistry,
  TCommands extends DatabaseWriteCommandRegistry = DatabaseWriteCommandRegistry,
> {
  readonly name: string;
  readonly version: string;
  readonly tables: Readonly<Record<string, Readonly<TableSchema>>>;
  readonly migrations: MigrationRegistry;
  readonly queries: Readonly<TQueries>;
  readonly commands: Readonly<TCommands>;
  /** Framework-owned identity anchors required by this actor realm. */
  readonly guardianAnchorRequirements: readonly GuardianReferenceKind[];
  readonly schemaChecksum: string;
  readonly migrationChecksums: readonly DatabaseRealmMigrationChecksum[];
  /** SHA-256 over realm identity, schema/migrations, and registered names. */
  readonly fingerprint: string;
}

/**
 * Validate and detach an app-owned realm definition.
 *
 * Handler function references stay process-local. The actor imports this module
 * itself, while only handler names and serializable input cross IPC.
 */
export function defineDatabaseRealm<
  TQueries extends DatabaseReadQueryRegistry = DatabaseReadQueryRegistry,
  TCommands extends DatabaseWriteCommandRegistry = DatabaseWriteCommandRegistry,
>(
  definition: DatabaseRealmDefinition<TQueries, TCommands>,
): DatabaseRealm<TQueries, TCommands> {
  const record = configRecord(definition, 'database realm');
  assertOnlyFields(record, REALM_FIELDS, 'database realm');

  const name = requireRegistryName(record.name, 'realm name');
  const version = requireRealmVersion(record.version);
  const tables = cloneTableRegistry(record.tables);
  const migrations = cloneMigrationRegistry(record.migrations);
  const queries = cloneHandlerRegistry(
    record.queries,
    'query',
  ) as TQueries;
  const commands = cloneHandlerRegistry(
    record.commands,
    'command',
  ) as TCommands;
  const guardianAnchorRequirements = Object.freeze([
    ...(Object.values(tables).some((table) =>
      getGuardianAnchorRequirements(table).includes('user'))
      ? ['user' as const]
      : []),
    ...(Object.values(tables).some((table) =>
      getGuardianAnchorRequirements(table).includes('membership'))
      ? ['membership' as const]
      : []),
  ]);

  for (const queryName of Object.keys(queries)) {
    if (Object.prototype.hasOwnProperty.call(commands, queryName)) {
      throw configInvalid(
        `Database handler name "${queryName}" is registered as both a query and command.`,
      );
    }
  }

  const schemaChecksum = hashSchemaSnapshot(snapshotDeclaredTables(
    tables as Record<string, TableSchema>,
  ));
  const migrationChecksums = Object.freeze(migrations.map((migration) =>
    Object.freeze({
      version: migration.version,
      checksum: hashMigration(migration),
    })));
  const fingerprint = createRealmFingerprint({
    name,
    version,
    schemaChecksum,
    migrationChecksums,
    queries: Object.keys(queries).sort(),
    commands: Object.keys(commands).sort(),
    guardianReferences: Object.fromEntries(
      Object.entries(tables).map(([table, schema]) => [
        table,
        getGuardianTableReferences(schema),
      ]),
    ),
  });

  return Object.freeze({
    name,
    version,
    tables,
    migrations,
    queries: queries as Readonly<TQueries>,
    commands: commands as Readonly<TCommands>,
    guardianAnchorRequirements,
    schemaChecksum,
    migrationChecksums,
    fingerprint,
  });
}

/** Build a detached, deeply frozen actor-local admission snapshot. */
export function createDatabaseRealmOperationCatalog(
  realm: DatabaseRealm,
): DatabaseOperationCatalog {
  const columns = Object.create(null) as Record<string, readonly string[]>;
  const primaryKeys = Object.create(null) as Record<string, string>;
  for (const [tableName, schema] of Object.entries(realm.tables)) {
    const tableColumns = Object.keys(schema).filter((name) => name !== '_identity');
    columns[tableName] = Object.freeze(tableColumns);
    const primaryKey = tableColumns.find((column) =>
      databaseColumnDefinitionDeclaresPrimaryKey(schema[column]));
    if (primaryKey) primaryKeys[tableName] = primaryKey;
  }
  return Object.freeze({
    tables: Object.freeze(Object.keys(realm.tables)),
    queries: Object.freeze(Object.keys(realm.queries)),
    commands: Object.freeze(Object.keys(realm.commands)),
    columns: Object.freeze(columns),
    primaryKeys: Object.freeze(primaryKeys),
  });
}

/** Invoke a registered read handler and enforce its synchronous payload contract. */
export function runDatabaseRealmQuery(
  realm: DatabaseRealm,
  context: DatabaseReadQueryContext,
  name: string,
  input: DatabaseSerializableValue,
): DatabaseSerializableValue {
  if (!isDatabaseRegistryName(name)
    || !Object.prototype.hasOwnProperty.call(realm.queries, name)) {
    throw new DatabaseError(
      'DATABASE_OPERATION_UNSUPPORTED',
      'Database query is not registered.',
    );
  }
  const handler = realm.queries[name]!;
  const output = handler(context, cloneDatabaseSerializableValue(input));
  assertSynchronousResult(output, 'query');
  return cloneDatabaseHandlerResult(output);
}

/** Invoke a registered command and enforce its synchronous payload contract. */
export function runDatabaseRealmCommand(
  realm: DatabaseRealm,
  database: ReactiveDB,
  name: string,
  input: DatabaseSerializableValue,
): DatabaseSerializableValue {
  if (!isDatabaseRegistryName(name)
    || !Object.prototype.hasOwnProperty.call(realm.commands, name)) {
    throw new DatabaseError(
      'DATABASE_OPERATION_UNSUPPORTED',
      'Database command is not registered.',
    );
  }
  const handler = realm.commands[name]!;
  const detachedInput = cloneDatabaseSerializableValue(input);
  const session = createDatabaseWriteCommandSession(database);
  try {
    return database.transaction(() => {
      const output = handler(session.context, detachedInput);
      assertSynchronousResult(output, 'command');
      // Result validation participates in the transaction so an invalid or
      // asynchronous handler result cannot commit its preceding writes.
      const result = cloneDatabaseHandlerResult(output);
      // Revoke before a root transaction can deliver post-commit callbacks.
      // The outer writer transaction keeps the same ordering in production,
      // while direct internal callers receive the same non-escapable lifetime.
      session.close();
      return result;
    });
  } finally {
    session.close();
  }
}

function cloneTableRegistry(
  value: unknown,
): Readonly<Record<string, Readonly<TableSchema>>> {
  const record = configRecord(value, 'database realm tables');
  const tables = Object.create(null) as Record<string, Readonly<TableSchema>>;
  const caseInsensitiveNames = new Set<string>();

  for (const [name, schemaValue] of Object.entries(record)) {
    if (!isDatabaseTableName(name)) {
      throw configInvalid(`Invalid database realm table name "${name}".`);
    }
    const nameIssue = databaseRealmTableNameAdmissionIssue(name);
    if (nameIssue) throw configInvalid(nameIssue);
    const folded = name.toLowerCase();
    if (caseInsensitiveNames.has(folded)) {
      throw configInvalid('Database realm table names must be unique ignoring case.');
    }
    caseInsensitiveNames.add(folded);
    tables[name] = cloneTableSchema(name, schemaValue);
  }

  const registryIssue = databaseRealmRegistryAdmissionIssue(tables);
  if (registryIssue) throw configInvalid(registryIssue);

  return Object.freeze(tables);
}

function cloneTableSchema(tableName: string, value: unknown): Readonly<TableSchema> {
  const source = configObject(value, `schema for table ${tableName}`);
  const keys = safeOwnKeys(source, `schema for table ${tableName}`);
  const clone: TableSchema = {};
  const columns = new Set<string>();
  const caseInsensitiveColumns = new Set<string>();
  let identity: readonly string[] | undefined;
  let validator: Readonly<SyncTableMutationValidator> | undefined;
  let guardianReferences: ReturnType<typeof getGuardianTableReferences> | undefined;
  let primaryKeys = 0;
  let primaryKey: string | null = null;
  let primaryKeyDefinition: string | null = null;

  for (const key of keys) {
    const descriptor = safeOwnDescriptor(source, key, `schema for table ${tableName}`);
    if (typeof key === 'symbol') {
      if (!('value' in descriptor)) {
        throw configInvalid('Database realm table schema symbols must be data properties.');
      }
      if (key === GUARDIAN_TABLE_REFERENCES && guardianReferences === undefined) {
        if (descriptor.enumerable || descriptor.configurable || descriptor.writable) {
          throw configInvalid(
            'Database realm Guardian metadata must be immutable and non-enumerable.',
          );
        }
        guardianReferences = cloneGuardianReferences(descriptor.value, tableName);
        continue;
      }
      if (!descriptor.enumerable
        || key !== SYNC_TABLE_MUTATION_VALIDATOR
        || validator !== undefined) {
        throw configInvalid('Database realm table schema contains an unsupported symbol.');
      }
      validator = cloneMutationValidator(descriptor.value, tableName);
      continue;
    }
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw configInvalid('Database realm table schemas must use enumerable data properties.');
    }
    if (key === '_identity') {
      identity = cloneIdentity(descriptor.value, tableName);
      continue;
    }
    if (!isDatabaseTableName(key)) {
      throw configInvalid(`Invalid column name in database realm table "${tableName}".`);
    }
    const folded = key.toLowerCase();
    if (caseInsensitiveColumns.has(folded)) {
      throw configInvalid(
        `Database realm table "${tableName}" has case-insensitive duplicate columns.`,
      );
    }
    caseInsensitiveColumns.add(folded);
    if (typeof descriptor.value !== 'string'
      || descriptor.value.trim().length === 0
      || descriptor.value.length > DATABASE_REALM_SQL_DEFINITION_MAX_BYTES
      || descriptor.value.includes('\0')
      || !isWellFormedUnicode(descriptor.value)) {
      throw configInvalid(
        `Database realm table "${tableName}" has an invalid SQL column definition.`,
      );
    }
    if (textEncoder.encode(descriptor.value).byteLength
      > DATABASE_REALM_SQL_DEFINITION_MAX_BYTES) {
      throw configInvalid(
        `Database realm table "${tableName}" has an oversized SQL column definition.`,
      );
    }
    if (!isIsolatedDatabaseColumnDefinition(descriptor.value)) {
      throw configInvalid(
        `Database realm table "${tableName}" column "${key}" must describe exactly one isolated SQL column.`,
      );
    }
    if (databaseColumnDefinitionDeclaresPrimaryKey(descriptor.value)) {
      primaryKeys += 1;
      primaryKey = key;
      primaryKeyDefinition = descriptor.value;
    }
    columns.add(key);
    clone[key] = descriptor.value;
  }

  if (columns.size === 0) {
    throw configInvalid(`Database realm table "${tableName}" must declare columns.`);
  }
  if (primaryKeys !== 1) {
    throw configInvalid(
      `Database realm table "${tableName}" must declare exactly one primary-key column.`,
    );
  }
  const primaryKeyAffinity = databaseColumnDefinitionAffinity(
    primaryKeyDefinition,
  );
  if (!isSupportedDatabaseRowIdentityAffinity(primaryKeyAffinity)) {
    throw configInvalid(
      `Database realm table "${tableName}" primary-key column "${primaryKey}" `
      + 'must declare TEXT or INTEGER affinity.',
    );
  }
  for (const column of columns) {
    const definition = clone[column];
    if (typeof definition !== 'string') continue;
    const admissionIssue = databaseRealmColumnAdmissionIssue({
      table: tableName,
      column,
      definition,
      primaryKey: column === primaryKey,
    });
    if (admissionIssue) throw configInvalid(admissionIssue);
  }
  if (identity) {
    for (const field of identity) {
      if (!columns.has(field)) {
        throw configInvalid(
          `Database realm table "${tableName}" identity references an unknown column.`,
        );
      }
      if (field === primaryKey) {
        throw configInvalid(
          `Database realm table "${tableName}" identity cannot include its primary key.`,
        );
      }
    }
    clone._identity = [...identity];
    Object.freeze(clone._identity);
  }
  if (validator) {
    if (validator.primaryKey !== primaryKey) {
      throw configInvalid(
        `Database realm table "${tableName}" validator primary key does not match its schema.`,
      );
    }
    for (const field of validator.fieldNames) {
      if (!columns.has(field)) {
        throw configInvalid(
          `Database realm table "${tableName}" validator references an unknown field.`,
        );
      }
    }
    clone[SYNC_TABLE_MUTATION_VALIDATOR] = validator;
  }
  if (guardianReferences && guardianReferences.length > 0) {
    for (const reference of guardianReferences) {
      if (!columns.has(reference.field)) {
        throw configInvalid(
          `Database realm table "${tableName}" Guardian reference uses an unknown field.`,
        );
      }
    }
    attachGuardianTableReferences(clone, guardianReferences);
    const declarationIssue = inspectGuardianReferenceSchema(clone)[0];
    if (declarationIssue) {
      throw configInvalid(
        `Database realm table "${tableName}" Guardian field "${declarationIssue.field}" does not declare its exact managed foreign key.`,
      );
    }
  }
  return Object.freeze(clone);
}

function cloneGuardianReferences(
  value: unknown,
  tableName: string,
): readonly GuardianFieldReference[] {
  const metadata = configRecord(value, `Guardian metadata for table ${tableName}`);
  assertOnlyFields(
    metadata,
    new Set(['fields', 'anchorRequirements']),
    `Guardian metadata for table ${tableName}`,
  );
  const entries = configArray(
    metadata.fields,
    `Guardian fields for table ${tableName}`,
  );
  const references = entries.map((entry, index): GuardianFieldReference => {
    const reference = configRecord(
      entry,
      `Guardian field ${index} for table ${tableName}`,
    );
    assertOnlyFields(
      reference,
      new Set(['field', 'kind', 'table', 'column', 'onDelete']),
      `Guardian field ${index} for table ${tableName}`,
    );
    if (!isDatabaseTableName(reference.field)
      || reference.onDelete !== 'restrict'
      || (reference.kind !== 'user' && reference.kind !== 'membership')
      || (reference.kind === 'user'
        && (reference.table !== 'users' || reference.column !== 'user_id'))
      || (reference.kind === 'membership'
        && (reference.table !== 'tenant_memberships'
          || reference.column !== 'membership_id'))) {
      throw configInvalid(`Guardian field ${index} for table ${tableName} is invalid.`);
    }
    return Object.freeze({
      field: reference.field,
      kind: reference.kind,
      table: reference.table,
      column: reference.column,
      onDelete: 'restrict',
    }) as GuardianFieldReference;
  });
  if (references.length === 0) {
    throw configInvalid(`Guardian metadata for table ${tableName} is empty.`);
  }
  const declared = configArray(
    metadata.anchorRequirements,
    `Guardian requirements for table ${tableName}`,
  );
  const expected = [
    ...(references.some((reference) => reference.kind === 'user'
      || reference.kind === 'membership') ? ['user'] : []),
    ...(references.some((reference) => reference.kind === 'membership')
      ? ['membership']
      : []),
  ];
  if (declared.length !== expected.length
    || declared.some((requirement, index) => requirement !== expected[index])) {
    throw configInvalid(`Guardian requirements for table ${tableName} are invalid.`);
  }
  return Object.freeze(references);
}

function cloneIdentity(value: unknown, tableName: string): readonly string[] {
  const values = configArray(value, `identity for table ${tableName}`);
  if (values.length === 0) {
    throw configInvalid(`Database realm table "${tableName}" identity must not be empty.`);
  }
  const seen = new Set<string>();
  const identity = values.map((field) => {
    if (!isDatabaseTableName(field)) {
      throw configInvalid(`Database realm table "${tableName}" has an invalid identity field.`);
    }
    if (seen.has(field)) {
      throw configInvalid(`Database realm table "${tableName}" has a duplicate identity field.`);
    }
    seen.add(field);
    return field;
  });
  return Object.freeze(identity);
}

function cloneMutationValidator(
  value: unknown,
  tableName: string,
): Readonly<SyncTableMutationValidator> {
  const record = configRecord(value, `mutation validator for table ${tableName}`);
  assertOnlyFields(record, VALIDATOR_FIELDS, `mutation validator for table ${tableName}`);
  const primaryKey = record.primaryKey;
  if (!isDatabaseTableName(primaryKey)) {
    throw configInvalid(`Database realm table "${tableName}" has an invalid validator key.`);
  }
  const fieldNames = cloneIdentityLikeFields(record.fieldNames, tableName);
  const decodeRow = requireSynchronousFunction(record.decodeRow, 'decodeRow');
  const encodeRow = requireSynchronousFunction(record.encodeRow, 'encodeRow');
  const validateRow = requireSynchronousFunction(record.validateRow, 'validateRow');

  return Object.freeze({
    primaryKey,
    fieldNames,
    decodeRow: decodeRow as (row: Row) => Row,
    encodeRow: encodeRow as (row: Row) => Row,
    validateRow: validateRow as SyncTableMutationValidator['validateRow'],
  });
}

function cloneIdentityLikeFields(value: unknown, tableName: string): readonly string[] {
  const values = configArray(value, `validator fields for table ${tableName}`);
  const seen = new Set<string>();
  const fields = values.map((field) => {
    if (!isDatabaseTableName(field) || seen.has(field)) {
      throw configInvalid(`Database realm table "${tableName}" has invalid validator fields.`);
    }
    seen.add(field);
    return field;
  });
  return Object.freeze(fields);
}

function cloneMigrationRegistry(value: unknown): MigrationRegistry {
  if (value === undefined) return createMigrationRegistry([]);
  const entries = configArray(value, 'database realm migrations');
  const migrations = entries.map((entry, index) => {
    const record = configRecord(entry, `database migration ${index}`);
    assertOnlyFields(record, MIGRATION_FIELDS, `database migration ${index}`);
    const version = requireMigrationVersion(record.version);
    const description = record.description;
    if (typeof description !== 'string'
      || description.trim().length === 0
      || description.length > DATABASE_REALM_MIGRATION_DESCRIPTION_MAX_BYTES
      || !isWellFormedUnicode(description)
      || textEncoder.encode(description).byteLength
        > DATABASE_REALM_MIGRATION_DESCRIPTION_MAX_BYTES) {
      throw configInvalid('Database migration description is invalid.');
    }
    if (record.safety !== undefined && !MIGRATION_SAFETY.has(record.safety as string)) {
      throw configInvalid('Database migration safety is invalid.');
    }
    if (record.downSafety !== undefined
      && !MIGRATION_SAFETY.has(record.downSafety as string)) {
      throw configInvalid('Database migration downSafety is invalid.');
    }
    if (record.backupRequired !== undefined
      && typeof record.backupRequired !== 'boolean') {
      throw configInvalid('Database migration backupRequired must be a boolean.');
    }
    const up = requireSynchronousFunction(record.up, 'migration up');
    const down = record.down === undefined
      ? undefined
      : requireSynchronousFunction(record.down, 'migration down');

    return {
      version,
      description,
      ...(record.safety === undefined ? {} : { safety: record.safety as Migration['safety'] }),
      ...(record.downSafety === undefined
        ? {}
        : { downSafety: record.downSafety as Migration['downSafety'] }),
      ...(record.backupRequired === undefined
        ? {}
        : { backupRequired: record.backupRequired as boolean }),
      up: up as Migration['up'],
      ...(down === undefined ? {} : { down: down as NonNullable<Migration['down']> }),
    } satisfies Migration;
  });
  try {
    return createMigrationRegistry(migrations);
  } catch (cause) {
    throw configInvalid('Database migration registry is invalid.', cause);
  }
}

function cloneHandlerRegistry(
  value: unknown,
  kind: 'query' | 'command',
): Readonly<Record<string, DatabaseReadQueryHandler | DatabaseWriteCommandHandler>> {
  if (value === undefined) return Object.freeze({});
  const record = configRecord(value, `database ${kind} registry`);
  const handlers = Object.create(null) as Record<
    string,
    DatabaseReadQueryHandler | DatabaseWriteCommandHandler
  >;

  for (const [name, handler] of Object.entries(record)) {
    if (!isDatabaseRegistryName(name)) {
      throw configInvalid(`Invalid database ${kind} registry name "${name}".`);
    }
    handlers[name] = requireSynchronousFunction(
      handler,
      `${kind} ${name}`,
    ) as DatabaseReadQueryHandler | DatabaseWriteCommandHandler;
  }
  return Object.freeze(handlers);
}

function createRealmFingerprint(input: {
  name: string;
  version: string;
  schemaChecksum: string;
  migrationChecksums: readonly DatabaseRealmMigrationChecksum[];
  queries: readonly string[];
  commands: readonly string[];
  guardianReferences: Readonly<Record<string, unknown>>;
}): string {
  const canonical = stableStringify({
    fingerprintVersion: DATABASE_REALM_FINGERPRINT_VERSION,
    ...input,
  });
  return `sha256:${createHash('sha256')
    .update('zero.database-realm.v1\0', 'utf8')
    .update(canonical, 'utf8')
    .digest('hex')}`;
}

function requireRegistryName(value: unknown, label: string): string {
  if (!isDatabaseRegistryName(value)) {
    throw configInvalid(`Invalid database ${label}.`);
  }
  return value;
}

function requireRealmVersion(value: unknown): string {
  if (typeof value !== 'string' || !REALM_VERSION_PATTERN.test(value)) {
    throw configInvalid('Invalid database realm version.');
  }
  return value;
}

function requireMigrationVersion(value: unknown): string {
  if (typeof value !== 'string' || !MIGRATION_VERSION_PATTERN.test(value)) {
    throw configInvalid('Invalid database migration version.');
  }
  return value;
}

function requireSynchronousFunction(value: unknown, label: string): Function {
  if (typeof value !== 'function' || isProxy(value)) {
    throw configInvalid(`Database ${label} must be a synchronous function.`);
  }
  let tag: string;
  try {
    tag = Object.prototype.toString.call(value);
  } catch (cause) {
    throw configInvalid(`Database ${label} could not be inspected.`, cause);
  }
  if (tag === '[object AsyncFunction]'
    || tag === '[object GeneratorFunction]'
    || tag === '[object AsyncGeneratorFunction]') {
    throw configInvalid(`Database ${label} must be synchronous and non-generating.`);
  }
  return value;
}

function assertSynchronousResult(value: unknown, kind: 'query' | 'command'): void {
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    let then: unknown;
    try {
      then = (value as { then?: unknown }).then;
    } catch (cause) {
      throw invalidDatabaseHandlerResult(cause);
    }
    if (typeof then === 'function') {
      void Promise.resolve(value).catch(() => {});
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        `Database ${kind} handlers must return synchronously.`,
      );
    }
  }
}

function configRecord(value: unknown, label: string): Record<string, unknown> {
  const object = configObject(value, label);
  const keys = safeOwnKeys(object, label);
  if (keys.some((key) => typeof key !== 'string')) {
    throw configInvalid(`${label} must not contain symbol fields.`);
  }
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = safeOwnDescriptor(object, key, label);
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw configInvalid(`${label} must use enumerable data properties.`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

function configObject(value: unknown, label: string): object {
  if (value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || isProxy(value)) {
    throw configInvalid(`${label} must be a plain object.`);
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch (cause) {
    throw configInvalid(`${label} could not be inspected.`, cause);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw configInvalid(`${label} must be a plain object.`);
  }
  return value;
}

function configArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value)) {
    throw configInvalid(`${label} must be an array.`);
  }
  const keys = safeOwnKeys(value, label);
  if (keys.length !== value.length + 1 || !keys.includes('length')) {
    throw configInvalid(`${label} must be dense and unextended.`);
  }
  const clone: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = safeOwnDescriptor(value, String(index), label);
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw configInvalid(`${label} must contain data elements.`);
    }
    clone.push(descriptor.value);
  }
  return clone;
}

function assertOnlyFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw configInvalid(`${label} contains an unknown field.`);
    }
  }
}

function safeOwnKeys(value: object, label: string): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch (cause) {
    throw configInvalid(`${label} could not be inspected.`, cause);
  }
}

function safeOwnDescriptor(
  value: object,
  key: PropertyKey,
  label: string,
): PropertyDescriptor {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new Error('missing descriptor');
    return descriptor;
  } catch (cause) {
    throw configInvalid(`${label} could not be inspected.`, cause);
  }
}

function isProxy(value: object): boolean {
  try {
    return utilTypes.isProxy(value);
  } catch {
    return true;
  }
}

function isWellFormedUnicode(value: string): boolean {
  const candidate = value as string & { isWellFormed?: () => boolean };
  if (typeof candidate.isWellFormed === 'function') return candidate.isWellFormed();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function configInvalid(message: string, cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    message,
    cause === undefined ? undefined : { cause },
  );
}
