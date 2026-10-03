/**
 * data-studio-contracts.ts
 *
 * Defines the browser-safe, closed Data Studio domain contract. This file owns
 * public data shapes and hard format limits only; it does not validate unknown
 * input, authorize requests, or access persistence.
 */

/** Version of the canonical logical-table schema document. */
export const DATA_STUDIO_SCHEMA_VERSION = 1 as const;

/** Maximum columns in one logical table. */
export const DATA_STUDIO_MAX_COLUMNS = 128;

/** Maximum UTF-8 bytes in one canonical schema document. */
export const DATA_STUDIO_MAX_SCHEMA_BYTES = 64 * 1024;

/** Maximum UTF-8 bytes in one canonical cell value. */
export const DATA_STUDIO_MAX_VALUE_BYTES = 64 * 1024;

/** Maximum UTF-8 bytes in one tracked aggregate row-value document. */
export const DATA_STUDIO_MAX_ROW_VALUES_BYTES = 256 * 1024;

/** Maximum nesting depth in a JSON cell value. */
export const DATA_STUDIO_MAX_VALUE_DEPTH = 32;

/** Maximum aggregate nodes visited while normalizing one cell value. */
export const DATA_STUDIO_MAX_VALUE_NODES = 4_096;

/** Maximum members in one JSON array or object. */
export const DATA_STUDIO_MAX_COLLECTION_ENTRIES = 1_024;

/** Maximum length of a stable logical column id. */
export const DATA_STUDIO_MAX_COLUMN_ID_LENGTH = 64;

/** Maximum length of a stable machine-addressable logical table key. */
export const DATA_STUDIO_MAX_TABLE_KEY_LENGTH = 64;

/** Maximum length of a logical column key. */
export const DATA_STUDIO_MAX_COLUMN_KEY_LENGTH = 64;

/** Maximum length of a logical column label. */
export const DATA_STUDIO_MAX_COLUMN_LABEL_LENGTH = 120;

/** Maximum length of a logical column description. */
export const DATA_STUDIO_MAX_COLUMN_DESCRIPTION_LENGTH = 500;

/** Closed set of logical column value types supported by the first schema version. */
export const DATA_STUDIO_COLUMN_TYPES = Object.freeze([
  'text',
  'number',
  'boolean',
  'date',
  'datetime',
  'json',
] as const);

export type DataStudioColumnType = (typeof DATA_STUDIO_COLUMN_TYPES)[number];

/** Closed discriminator stored beside canonical cell projections. */
export const DATA_STUDIO_CELL_VALUE_TYPES = Object.freeze([
  'null',
  ...DATA_STUDIO_COLUMN_TYPES,
] as const);

export type DataStudioCellValueType = (typeof DATA_STUDIO_CELL_VALUE_TYPES)[number];

/** Lifecycle states exposed for one logical table. */
export const DATA_STUDIO_TABLE_STATUSES = Object.freeze([
  'active',
  'archived',
] as const);

export type DataStudioTableStatus = (typeof DATA_STUDIO_TABLE_STATUSES)[number];

/** Strict JSON value accepted at the durable cell boundary. */
export type DataStudioValue =
  | null
  | boolean
  | number
  | string
  | readonly DataStudioValue[]
  | { readonly [key: string]: DataStudioValue };

/** Complete canonical row payload, keyed by stable logical column id. */
export type DataStudioRowValues = Readonly<Record<string, DataStudioValue>>;

/** One ordered column in a versioned logical-table schema. */
export interface DataStudioColumn {
  readonly columnId: string;
  readonly key: string;
  readonly label: string;
  readonly type: DataStudioColumnType;
  readonly required: boolean;
  readonly description?: string;
  readonly defaultValue?: DataStudioValue;
}

/** Canonical schema document stored on a logical table. */
export interface DataStudioSchema {
  readonly version: typeof DATA_STUDIO_SCHEMA_VERSION;
  /** Array order is the stable presentation order. */
  readonly columns: readonly DataStudioColumn[];
}

/** Public logical-table projection. */
export interface DataStudioTable {
  readonly tableId: string;
  /** Immutable machine key used by functions, workflows, and API clients. */
  readonly key: string;
  /** Renameable display name. */
  readonly name: string;
  readonly description: string | null;
  readonly status: DataStudioTableStatus;
  readonly schema: DataStudioSchema;
  /** Revision of `schema`; increments only when a new schema version is stored. */
  readonly schemaRevision: number;
  /** Optimistic metadata/schema revision, starting at one. */
  readonly revision: number;
  /** Same-transaction aggregate used for quotas and catalog UX. */
  readonly rowCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Bounded catalog projection; hydrate one table to obtain its full schema. */
export type DataStudioTableSummary = Readonly<Omit<DataStudioTable, 'schema'>>;

/** One logical cell. Absence of a cell is distinct from a stored null value. */
export interface DataStudioCell {
  readonly columnId: string;
  readonly value: DataStudioValue;
}

/** Public logical-row projection assembled from the row and private cell tables. */
export interface DataStudioRow {
  readonly rowId: string;
  readonly tableId: string;
  /** Schema revision against which this cell set was last validated. */
  readonly schemaRevision: number;
  /** Optimistic row/cell-set revision, starting at one. */
  readonly revision: number;
  readonly values: DataStudioRowValues;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Canonical cell storage payload and its bounded typed query projection. */
export interface DataStudioCellEncoding {
  readonly value: DataStudioValue;
  readonly valueJson: string;
  readonly valueType: DataStudioCellValueType;
  readonly textValue: string | null;
  readonly numberValue: number | null;
  readonly booleanValue: 0 | 1 | null;
}

/** Immutable historical schema projection for audit and deterministic replay. */
export interface DataStudioSchemaVersion {
  readonly schemaVersionId: string;
  readonly tableId: string;
  readonly schemaRevision: number;
  readonly schema: DataStudioSchema;
  readonly createdAt: number;
}

/** Mutation input for a complete logical cell set. */
export interface DataStudioCellInput {
  readonly columnId: string;
  readonly value: unknown;
}

/** Optimistic-concurrency input shared by table and row mutations. */
export interface DataStudioRevisionInput {
  readonly expectedRevision: number;
}
