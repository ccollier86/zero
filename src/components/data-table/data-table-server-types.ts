/** Public contracts for DataTable's isolated server-query source mode. */

import type {
  ColumnFiltersState,
  SortingState,
} from '@tanstack/react-table';
import type { Row } from '../../sync/types';

export type DataTableServerPaginationMode = 'offset' | 'cursor';

/** Controlled table state projected into one server read. */
export interface DataTableServerQuery {
  search: string;
  filters: ColumnFiltersState;
  sorting: SortingState;
  pagination: {
    mode: DataTableServerPaginationMode;
    pageIndex: number;
    pageSize: number;
    cursor?: string | null;
  };
  /** Explicit columns that the built-in endpoint may search with OR semantics. */
  searchFields?: string[];
}

interface DataTableServerPageBase {
  mode: DataTableServerPaginationMode;
  hasMore: boolean;
  /** Optional because obtaining an exact total can require a separate count. */
  total?: number;
}

/** Offset metadata returned by Zero's built-in `/api/data` adapter. */
export interface DataTableServerOffsetPage extends DataTableServerPageBase {
  mode: 'offset';
  offset: number;
}

/** Opaque cursor metadata supported by custom server adapters. */
export interface DataTableServerCursorPage extends DataTableServerPageBase {
  mode: 'cursor';
  nextCursor?: string | null;
  previousCursor?: string | null;
}

export type DataTableServerPage = DataTableServerOffsetPage | DataTableServerCursorPage;

/** One isolated server-query result; rows are never loaded into the shared collection. */
export interface DataTableServerResult<T extends Row> {
  rows: T[];
  page: DataTableServerPage;
}

export interface DataTableServerAdapterContext {
  signal: AbortSignal;
}

/** Authoritative live change, not a snapshot, optimistic write, or result-set join. Row IDs use the adapter's stable result identity. */
export interface DataTableServerChange {
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  rowId: string;
}

/** App-owned query transport for cursor APIs or non-Zero backends. */
export interface DataTableServerAdapter<T extends Row> {
  query(
    query: DataTableServerQuery,
    context: DataTableServerAdapterContext,
  ): Promise<DataTableServerResult<T>>;
  /** Confirm which genuine INSERT identities match these criteria, independently of pagination. Return only supplied IDs; unsupported sources omit this capability. */
  confirmInsertedRows?(
    query: DataTableServerQuery,
    rowIds: readonly string[],
    context: DataTableServerAdapterContext,
  ): Promise<readonly string[]>;
  /** Subscribe to genuine server changes for this captured query. Membership is confirmed by subsequent query results, not guessed locally. */
  subscribeChanges?(
    query: DataTableServerQuery,
    listener: (change: DataTableServerChange) => void,
    context: DataTableServerAdapterContext,
  ): () => void;
}

/** DataTable source that delegates filtering, sorting, and pagination to a server. */
export interface DataTableServerSource<T extends Row> {
  type: 'server';
  table: string;
  /** Declares pagination before the first result. Defaults to `offset`. */
  pagination?: DataTableServerPaginationMode;
  /** Required for cursor mode; optional override for offset mode. */
  adapter?: DataTableServerAdapter<T>;
  /** Refetch after relevant reactive collection changes. Defaults to true. */
  live?: boolean;
  /** Speculatively load known neighboring pages. Defaults to true; never invents cursors. */
  prefetch?: boolean;
  /** Optional row identity override; schema primary key is preferred by DataTable. */
  getRowId?: (row: T, index: number) => string | number;
}

export type DataTableServerSourceErrorCode =
  | 'DATA_TABLE_SERVER_CLIENT_REQUIRED'
  | 'DATA_TABLE_SERVER_CURSOR_ADAPTER_REQUIRED'
  | 'DATA_TABLE_SERVER_QUERY_INVALID'
  | 'DATA_TABLE_SERVER_QUERY_FAILED'
  | 'DATA_TABLE_SERVER_RESPONSE_INVALID';

/** Stable, content-free failure raised at the server-source boundary. */
export class DataTableServerSourceError extends Error {
  constructor(
    message: string,
    readonly code: DataTableServerSourceErrorCode,
  ) {
    super(message);
    this.name = 'DataTableServerSourceError';
  }
}
