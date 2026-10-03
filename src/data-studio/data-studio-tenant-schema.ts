/**
 * data-studio-tenant-schema.ts
 *
 * Defines the fixed Fabric-safe tenant tables used to store logical Data
 * Studio tables, rows, and cells. It performs no DDL or runtime registration.
 */

import {
  GUARDIAN_MEMBERSHIP_REFERENCE,
  GUARDIAN_USER_REFERENCE,
  attachGuardianTableReferences,
  type GuardianFieldReference,
} from '../schema/guardian-references';
import type { TableSchema } from '../sync/types';
import {
  DATA_STUDIO_MAX_COLUMN_ID_LENGTH,
  DATA_STUDIO_MAX_ROW_VALUES_BYTES,
  DATA_STUDIO_MAX_SCHEMA_BYTES,
  DATA_STUDIO_MAX_TABLE_KEY_LENGTH,
  DATA_STUDIO_MAX_VALUE_BYTES,
} from './data-studio-contracts';

/** Tracked logical-table catalog. */
export const DATA_STUDIO_TABLES_TABLE_NAME = 'data_studio_tables' as const;

/** Tracked row invalidation/catalog table. */
export const DATA_STUDIO_ROWS_TABLE_NAME = 'data_studio_rows' as const;

/** Private cell-value table; row revisions provide the public Sync signal. */
export const DATA_STUDIO_CELLS_TABLE_NAME = '_data_studio_cells' as const;

/** Private immutable history of every accepted logical schema revision. */
export const DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME = '_data_studio_schema_versions' as const;

/** Private per-column counts used for bounded schema compatibility checks. */
export const DATA_STUDIO_COLUMN_STATS_TABLE_NAME = '_data_studio_column_stats' as const;

const ATTRIBUTION_REFERENCES = Object.freeze([
  guardianReference('created_by_user_id', GUARDIAN_USER_REFERENCE),
  guardianReference('created_by_membership_id', GUARDIAN_MEMBERSHIP_REFERENCE),
  guardianReference('updated_by_user_id', GUARDIAN_USER_REFERENCE),
  guardianReference('updated_by_membership_id', GUARDIAN_MEMBERSHIP_REFERENCE),
]);

const CELL_ATTRIBUTION_REFERENCES = Object.freeze([
  guardianReference('updated_by_user_id', GUARDIAN_USER_REFERENCE),
  guardianReference('updated_by_membership_id', GUARDIAN_MEMBERSHIP_REFERENCE),
]);

/** Fixed physical schema for logical table metadata and canonical schemas. */
export const DATA_STUDIO_TABLES_SCHEMA = freezeTableSchema({
  table_id: 'text primary key',
  key: `text not null collate nocase unique check(key = lower(trim(key)) and length(key) between 1 and ${DATA_STUDIO_MAX_TABLE_KEY_LENGTH} and substr(key, 1, 1) glob '[a-z]' and key not glob '*[^a-z0-9_-]*')`,
  name: 'text not null check(name = trim(name) and length(name) between 1 and 120)',
  description: 'text check(description is null or length(description) between 1 and 2000)',
  status: "text not null default 'active' check(status in ('active','archived'))",
  schema_json: `text not null check(length(schema_json) between 1 and ${DATA_STUDIO_MAX_SCHEMA_BYTES})`,
  schema_revision: "integer not null default 1 check(typeof(schema_revision) = 'integer' and schema_revision >= 1)",
  revision: "integer not null default 1 check(typeof(revision) = 'integer' and revision >= schema_revision)",
  row_count: "integer not null default 0 check(typeof(row_count) = 'integer' and row_count >= 0)",
  created_by_user_id: guardianColumn('user'),
  created_by_membership_id: guardianColumn('membership'),
  updated_by_user_id: guardianColumn('user'),
  updated_by_membership_id: guardianColumn('membership'),
  created_at: "integer not null check(typeof(created_at) = 'integer' and created_at >= 0)",
  updated_at: "integer not null check(typeof(updated_at) = 'integer' and updated_at >= created_at)",
  archived_at: "integer check(archived_at is null or (typeof(archived_at) = 'integer' and archived_at >= created_at)) check((status = 'active' and archived_at is null) or (status = 'archived' and archived_at is not null))",
}, ATTRIBUTION_REFERENCES);

/**
 * Fixed physical schema for logical rows.
 *
 * Every cell mutation must update this row and increment `revision` in the same
 * transaction. Its lightweight public projection then emits one tracked
 * reconciliation signal; canonical values and indexed cell projections remain
 * behind the dedicated bounded API and private implementation state.
 */
export const DATA_STUDIO_ROWS_SCHEMA = freezeTableSchema({
  _identity: ['table_id', 'row_id'],
  record_id: 'text primary key',
  table_id: `text references ${DATA_STUDIO_TABLES_TABLE_NAME}(table_id) on delete restrict not null`,
  row_id: 'text not null',
  schema_revision: "integer not null check(typeof(schema_revision) = 'integer' and schema_revision >= 1)",
  values_json: `text not null check(length(values_json) between 2 and ${DATA_STUDIO_MAX_ROW_VALUES_BYTES})`,
  revision: "integer not null default 1 check(typeof(revision) = 'integer' and revision >= 1)",
  created_by_user_id: guardianColumn('user'),
  created_by_membership_id: guardianColumn('membership'),
  updated_by_user_id: guardianColumn('user'),
  updated_by_membership_id: guardianColumn('membership'),
  created_at: "integer not null check(typeof(created_at) = 'integer' and created_at >= 0)",
  updated_at: "integer not null check(typeof(updated_at) = 'integer' and updated_at >= created_at)",
}, ATTRIBUTION_REFERENCES);

/** Immutable schema history; services append before publishing a new current revision. */
export const DATA_STUDIO_SCHEMA_VERSIONS_SCHEMA = freezeTableSchema({
  _identity: ['table_id', 'schema_revision'],
  schema_version_id: 'text primary key',
  table_id: `text references ${DATA_STUDIO_TABLES_TABLE_NAME}(table_id) on delete restrict not null`,
  schema_revision: "integer not null check(typeof(schema_revision) = 'integer' and schema_revision >= 1)",
  schema_json: `text not null check(length(schema_json) between 1 and ${DATA_STUDIO_MAX_SCHEMA_BYTES})`,
  created_by_user_id: guardianColumn('user'),
  created_by_membership_id: guardianColumn('membership'),
  created_at: "integer not null check(typeof(created_at) = 'integer' and created_at >= 0)",
}, Object.freeze([
  guardianReference('created_by_user_id', GUARDIAN_USER_REFERENCE),
  guardianReference('created_by_membership_id', GUARDIAN_MEMBERSHIP_REFERENCE),
]));

/** Fixed private schema for canonical logical cell values. */
export const DATA_STUDIO_CELLS_SCHEMA = freezeTableSchema({
  _identity: ['row_record_id', 'column_id'],
  cell_id: 'text primary key',
  row_record_id: `text references ${DATA_STUDIO_ROWS_TABLE_NAME}(record_id) on delete restrict not null`,
  column_id: `text not null check(length(column_id) between 1 and ${DATA_STUDIO_MAX_COLUMN_ID_LENGTH})`,
  value_json: `text not null check(length(value_json) between 1 and ${DATA_STUDIO_MAX_VALUE_BYTES})`,
  value_type: "text not null check(value_type in ('null','text','number','boolean','date','datetime','json'))",
  text_value: 'text',
  number_value: 'real',
  boolean_value: `integer check(boolean_value is null or boolean_value in (0, 1)) check(
    (value_type = 'null' and text_value is null and number_value is null and boolean_value is null)
    or (value_type in ('text','date','datetime') and text_value is not null and number_value is null and boolean_value is null)
    or (value_type = 'number' and text_value is null and number_value is not null and boolean_value is null)
    or (value_type = 'boolean' and text_value is null and number_value is null and boolean_value is not null)
    or (value_type = 'json' and text_value is null and number_value is null and boolean_value is null)
  )`,
  updated_by_user_id: guardianColumn('user'),
  updated_by_membership_id: guardianColumn('membership'),
  updated_at: "integer not null check(typeof(updated_at) = 'integer' and updated_at >= 0)",
}, CELL_ATTRIBUTION_REFERENCES);

/** Derived counts maintained atomically with row/cell mutations. */
export const DATA_STUDIO_COLUMN_STATS_SCHEMA = freezeTableSchema({
  _identity: ['table_id', 'column_id'],
  stat_id: 'text primary key',
  table_id: `text references ${DATA_STUDIO_TABLES_TABLE_NAME}(table_id) on delete restrict not null`,
  // Schema admission treats column ids case-insensitively. Keep the permanent
  // reservation index on the same equivalence relation so a retired id cannot
  // be reintroduced later with only a case change.
  column_id: `text collate nocase not null check(length(column_id) between 1 and ${DATA_STUDIO_MAX_COLUMN_ID_LENGTH})`,
  value_count: "integer not null default 0 check(typeof(value_count) = 'integer' and value_count >= 0)",
  non_null_count: "integer not null default 0 check(typeof(non_null_count) = 'integer' and non_null_count >= 0 and non_null_count <= value_count)",
  updated_at: "integer not null check(typeof(updated_at) = 'integer' and updated_at >= 0)",
}, Object.freeze([]));

/** Exact fixed table fragment for a Data Studio tenant realm. */
export const DATA_STUDIO_TENANT_TABLES = Object.freeze({
  [DATA_STUDIO_TABLES_TABLE_NAME]: DATA_STUDIO_TABLES_SCHEMA,
  [DATA_STUDIO_ROWS_TABLE_NAME]: DATA_STUDIO_ROWS_SCHEMA,
  [DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME]: DATA_STUDIO_SCHEMA_VERSIONS_SCHEMA,
  [DATA_STUDIO_CELLS_TABLE_NAME]: DATA_STUDIO_CELLS_SCHEMA,
  [DATA_STUDIO_COLUMN_STATS_TABLE_NAME]: DATA_STUDIO_COLUMN_STATS_SCHEMA,
});

function guardianColumn(kind: 'user' | 'membership'): string {
  const reference = kind === 'user'
    ? GUARDIAN_USER_REFERENCE
    : GUARDIAN_MEMBERSHIP_REFERENCE;
  return `text references ${reference.table}(${reference.column}) on delete ${reference.onDelete} not null`;
}

function guardianReference(
  field: string,
  reference: typeof GUARDIAN_USER_REFERENCE | typeof GUARDIAN_MEMBERSHIP_REFERENCE,
): GuardianFieldReference {
  return Object.freeze({ field, ...reference });
}

function freezeTableSchema(
  schema: TableSchema,
  references: readonly GuardianFieldReference[],
): Readonly<TableSchema> {
  if (schema._identity) Object.freeze(schema._identity);
  attachGuardianTableReferences(schema, references);
  return Object.freeze(schema);
}
