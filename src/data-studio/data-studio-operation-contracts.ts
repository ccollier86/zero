/**
 * Portable operation contracts shared by the Data Studio realm and services.
 * These shapes contain no database handles, tenant selectors, or callbacks.
 */

import type {
  DataStudioErrorCode,
  DataStudioOperationOutcome,
} from './data-studio-error';
import type {
  DataStudioRow,
  DataStudioRowValues,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioTableStatus,
} from './data-studio-contracts';

export const DATA_STUDIO_QUERY_NAMES = Object.freeze({
  listTables: 'data-studio.tables.list',
  getTable: 'data-studio.tables.get',
  listRows: 'data-studio.rows.list',
  getRow: 'data-studio.rows.get',
  listSchemaVersions: 'data-studio.schema-versions.list',
} as const);

export const DATA_STUDIO_COMMAND_NAMES = Object.freeze({
  createTable: 'data-studio.tables.create',
  updateTable: 'data-studio.tables.update',
  setTableStatus: 'data-studio.tables.set-status',
  createRow: 'data-studio.rows.create',
  replaceRow: 'data-studio.rows.replace',
  deleteRow: 'data-studio.rows.delete',
} as const);

export const DATA_STUDIO_MAX_TABLES = 100;
export const DATA_STUDIO_MAX_ROWS_PER_TABLE = 100_000;
export const DATA_STUDIO_MAX_SCHEMA_VERSIONS = 256;
export const DATA_STUDIO_MAX_PAGE_SIZE = 25;
export const DATA_STUDIO_DEFAULT_PAGE_SIZE = 25;
export const DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE = 10;
export const DATA_STUDIO_RESULT_BYTE_BUDGET = 768 * 1024;

export interface DataStudioActorInput {
  readonly userId: string;
  readonly membershipId: string;
}

export interface DataStudioTableCreateInput extends DataStudioActorInput {
  readonly tableId: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly schema: DataStudioSchema;
}

export interface DataStudioTableUpdateInput extends DataStudioActorInput {
  readonly tableId: string;
  readonly expectedRevision: number;
  readonly name?: string;
  readonly description?: string | null;
  readonly schema?: DataStudioSchema;
}

export interface DataStudioTableStatusInput extends DataStudioActorInput {
  readonly tableId: string;
  readonly expectedRevision: number;
  readonly status: DataStudioTableStatus;
}

export interface DataStudioRowCreateInput extends DataStudioActorInput {
  readonly rowId: string;
  readonly tableId: string;
  readonly values: DataStudioRowValues;
}

export interface DataStudioRowReplaceInput extends DataStudioActorInput {
  readonly rowId: string;
  readonly tableId: string;
  readonly expectedRevision: number;
  readonly values: DataStudioRowValues;
}

export interface DataStudioRowDeleteInput extends DataStudioActorInput {
  readonly rowId: string;
  readonly tableId: string;
  readonly expectedRevision: number;
}

export interface DataStudioTableListInput {
  readonly status: DataStudioTableStatus | 'all';
}

export interface DataStudioTableGetInput {
  readonly tableId?: string;
  readonly key?: string;
}

export type DataStudioFilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains';

export interface DataStudioRowFilter {
  readonly columnId: string;
  readonly operator: DataStudioFilterOperator;
  readonly value: string | number | boolean | null;
}

export interface DataStudioRowListInput {
  readonly tableId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search?: string;
  readonly filters?: readonly DataStudioRowFilter[];
  readonly sortColumnId?: string;
  readonly sortDirection?: 'asc' | 'desc';
}

export interface DataStudioRowGetInput {
  readonly tableId: string;
  readonly rowId: string;
}

export interface DataStudioSchemaVersionListInput {
  readonly tableId: string;
  readonly limit: number;
  readonly beforeRevision?: number;
}

export interface DataStudioRowPage {
  readonly rows: readonly DataStudioRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  /** Byte-aware continuation; null only when this query is exhausted. */
  readonly nextOffset: number | null;
}

export interface DataStudioRowDeleteResult {
  readonly deleted: true;
  readonly rowId: string;
}

export interface DataStudioOperationFailure {
  readonly ok: false;
  readonly code: DataStudioErrorCode;
  readonly retryable: boolean;
  readonly outcome: DataStudioOperationOutcome | null;
  readonly currentRevision?: number;
}

export interface DataStudioOperationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type DataStudioOperationResult<T> =
  | DataStudioOperationSuccess<T>
  | DataStudioOperationFailure;

export type DataStudioTableResult = DataStudioOperationResult<DataStudioTable>;
export type DataStudioRowResult = DataStudioOperationResult<DataStudioRow>;
export type DataStudioRowDeleteOperationResult = DataStudioOperationResult<
  DataStudioRowDeleteResult
>;
export type DataStudioTableListResult = DataStudioOperationResult<
  readonly DataStudioTableSummary[]
>;
export type DataStudioRowPageResult = DataStudioOperationResult<DataStudioRowPage>;
export type DataStudioSchemaVersionListResult = DataStudioOperationResult<
  readonly DataStudioSchemaVersion[]
>;
