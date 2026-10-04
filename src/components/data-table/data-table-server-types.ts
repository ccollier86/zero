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

/** App-owned query transport for cursor APIs or non-Zero backends. */
export interface DataTableServerAdapter<T extends Row> {
  query(
    query: DataTableServerQuery,
    context: DataTableServerAdapterContext,
  ): Promise<DataTableServerResult<T>>;
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
