/**
 * data-studio-client-types.ts
 *
 * Browser-safe public contracts for the Data Studio HTTP SDK surface. This
 * module is type-only and owns neither transport nor cache behavior.
 */

import type {
  DataStudioRow,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioTableStatus,
} from '../../data-studio/data-studio-contracts';
import type { DataStudioReconciliationEvent } from './data-studio-sync';

export interface DataStudioCapabilities {
  readonly enabled: boolean;
  readonly scope: 'organization';
  readonly permissions: {
    readonly read: boolean;
    readonly write: boolean;
    readonly manage: boolean;
  };
  readonly limits: {
    readonly maxTables: number;
    readonly maxRowsPerTable: number;
    readonly maxColumns: number;
    readonly maxPageSize: number;
    readonly maxRowBytes: number;
  };
}

export interface DataStudioTableCreate {
  readonly name: string;
  readonly key?: string;
  readonly description?: string | null;
  readonly schema: DataStudioSchema;
}

export interface DataStudioTableUpdate {
  readonly expectedRevision: number;
  readonly name?: string;
  readonly description?: string | null;
  readonly schema?: DataStudioSchema;
}

export interface DataStudioRowQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
  /** Server-evaluated filters addressed by the column API key in the current schema revision. */
  readonly filters?: readonly DataStudioRowFilter[];
  readonly sortColumnId?: string;
  readonly sortDirection?: 'asc' | 'desc';
}

export type DataStudioRowFilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains';

export type DataStudioRowFilterValue = string | number | boolean | null;

export interface DataStudioRowFilter {
  readonly columnKey: string;
  readonly operator: DataStudioRowFilterOperator;
  readonly value: DataStudioRowFilterValue;
}

export interface DataStudioRowPage {
  /** Same-snapshot sequence used to reject shifted offset continuations. */
  readonly readSequence?: number;
  readonly rows: readonly DataStudioRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  /** Server-selected continuation; pages may be short because of response byte budgets. */
  readonly nextOffset: number | null;
}

export interface DataStudioSchemaVersionQuery {
  readonly limit?: number;
  readonly beforeRevision?: number;
}

export interface DataStudioRequestOptions {
  readonly signal?: AbortSignal;
}

export interface DataStudioMutationOptions extends DataStudioRequestOptions {
  /** Reuse this exact value when retrying an outcome-unknown operation. */
  readonly operationId?: string;
}

export interface DataStudioSdkSurfaceOptions {
  /** Optional read-only Sync signal source installed by createClient(). */
  readonly subscribeReconciliation?: (
    callback: (event: DataStudioReconciliationEvent) => void,
  ) => () => void;
}

export interface DataStudioMutationFailureBody {
  readonly error?: unknown;
  readonly code?: unknown;
  readonly retryable?: unknown;
  readonly requiresSameIdempotencyKey?: unknown;
}

export interface DataStudioCacheSnapshot {
  readonly scopeKey: string | null;
  readonly capabilities: DataStudioCapabilities | null;
  readonly tables: readonly DataStudioTableSummary[];
  readonly tableDetails: Readonly<Record<string, DataStudioTable>>;
  readonly rowPages: Readonly<Record<string, DataStudioRowPage>>;
}

export interface DataStudioSdkSurface {
  readonly cache: {
    getSnapshot(): DataStudioCacheSnapshot;
    /** Read and mark one row page as most-recent within the active scope. */
    getRowPage(key: string): DataStudioRowPage | undefined;
    subscribe(callback: () => void): () => void;
  };
  /** Partition and clear response data when the authorization scope changes. */
  setScope(scopeKey: string): void;
  clear(): void;
  /** Observe catalog/row invalidations from Zero Sync without enabling Sync writes. */
  subscribeReconciliation(
    callback: (event: DataStudioReconciliationEvent) => void,
  ): () => void;
  /** Invalidate cached row queries after a mutation, optionally retaining one page while it reloads. */
  invalidateRows(tableId: string, preserveQuery?: DataStudioRowQuery): void;
  getCapabilities(options?: DataStudioRequestOptions): Promise<DataStudioCapabilities>;
  listTables(
    status?: DataStudioTableStatus | 'all',
    options?: DataStudioRequestOptions,
  ): Promise<readonly DataStudioTableSummary[]>;
  getTable(tableId: string, options?: DataStudioRequestOptions): Promise<DataStudioTable>;
  createTable(
    input: DataStudioTableCreate,
    options?: DataStudioMutationOptions,
  ): Promise<DataStudioTable>;
  updateTable(
    tableId: string,
    input: DataStudioTableUpdate,
    options?: DataStudioMutationOptions,
  ): Promise<DataStudioTable>;
  setTableStatus(
    tableId: string,
    expectedRevision: number,
    status: DataStudioTableStatus,
    options?: DataStudioMutationOptions,
  ): Promise<DataStudioTable>;
  listRows(
    tableId: string,
    query?: DataStudioRowQuery,
    options?: DataStudioRequestOptions,
  ): Promise<DataStudioRowPage>;
  createRow(
    tableId: string,
    values: Readonly<Record<string, unknown>>,
    options?: DataStudioMutationOptions,
  ): Promise<DataStudioRow>;
  replaceRow(
    tableId: string,
    rowId: string,
    expectedRevision: number,
    values: Readonly<Record<string, unknown>>,
    options?: DataStudioMutationOptions,
  ): Promise<DataStudioRow>;
  deleteRow(
    tableId: string,
    rowId: string,
    expectedRevision: number,
    options?: DataStudioMutationOptions,
  ): Promise<{ readonly deleted: true; readonly rowId: string }>;
  listSchemaVersions(
    tableId: string,
    query?: DataStudioSchemaVersionQuery,
    options?: DataStudioRequestOptions,
  ): Promise<readonly DataStudioSchemaVersion[]>;
}
