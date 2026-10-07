'use client';

/** Shares source queries, interaction state and accepted row models across table organisms. */

import * as React from 'react';
import type { Row } from '../../sync/types';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { stableValueKey } from '../../frontend/client/query-params';
import type { DataTableProps } from './data-table-types';
import { useDataTable, type UseDataTableReturn } from './use-data-table';
import { useDataTableState, type DataTableState } from './data-table-state';
import { useDataTableSource, type DataTableSourceState } from './data-table-source';
import { useDataTableCursorHistory, useDataTableAcceptedCursors } from './data-table-cursor-history';
import { dataTableServerSourceIdentity } from './data-table-server-source-identity';
import { useDataTableMutationRunner, type DataTableMutationRunner } from './data-table-mutation';
import { getSchemaPrimaryKey } from './row-identity';
import { selectedDataTablePageRows } from './data-table-selection';
import { useDataTableLiveWindow } from './use-data-table-live-window';
import { useDataTableCollectionInserts } from './use-data-table-collection-inserts';
import type { InternalClient } from '../../frontend/client/sdk';

/** Internal composition result; not an additional public table API. */
export interface DataTableController<T extends Row> {
  dt: UseDataTableReturn<T>;
  current: DataTableState;
  resolved: DataTableSourceState<T>;
  partition: string;
  primaryKey: string;
  mutationRunner: DataTableMutationRunner;
  server: boolean;
  live: ReturnType<typeof useDataTableLiveWindow<T>>;
  queryKey: string;
}

/** Build one query/source/result owner; presentation consumers must not fetch a second copy. */
export function useDataTableController<T extends Row>(options: DataTableProps<T>): DataTableController<T> {
  const { schema, source, collection, searchable = false, paginated = source?.type === 'server' } = options;
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const server = source?.type === 'server';
  const primaryKey = getSchemaPrimaryKey(schema, options.primaryKey);
  const sourceTable = source && 'table' in source ? source.table : collection;
  const mode = server ? source.pagination ?? 'offset' : 'offset';
  const partition = stableValueKey([
    boundary.key, boundary.ready, source?.type ?? (collection ? 'collection' : 'data'), sourceTable,
    server ? dataTableServerSourceIdentity(source, client) : null, mode, primaryKey,
  ]);
  const pageSize = typeof paginated === 'object' ? paginated.pageSize ?? 20 : 20;
  const interaction = useDataTableState({
    initialState: options.initialState, state: options.state,
    onStateChange: options.onStateChange, pageSize, boundaryKey: partition, paginationMode: mode,
  });
  const current = interaction.state;
  const queryShape = stableValueKey([
    partition, current.globalFilter, current.columnFilters, current.sorting, current.pagination.pageSize,
  ]);
  const cursors = useDataTableCursorHistory(queryShape);
  const searchFields = typeof searchable === 'object' && searchable.fields
    ? searchable.fields
    : (options.columns ?? schema.fieldNames).filter((name) => {
        const type = schema.fields.get(name)?.type;
        return type === 'text' || type === 'email' || type === 'phone' || type === 'url' || type === 'textarea';
      });
  const resolved = useDataTableSource<T>({
    source, data: options.data, collection, lazy: options.lazy,
    filters: options.filters, lazyOptions: options.lazyOptions, primaryKey,
    confirmLiveInsertions: options.liveUpdates !== false,
    query: {
      search: searchable ? current.globalFilter : '',
      filters: current.columnFilters,
      sorting: current.sorting,
      pagination: {
        mode, ...current.pagination,
        ...(mode === 'cursor' ? { cursor: cursors.current.cursors.get(current.pagination.pageIndex) ?? null } : {}),
      },
      searchFields,
    },
  });
  useDataTableAcceptedCursors(cursors, current.pagination.pageIndex, resolved.page);
  const collectionInserts = useDataTableCollectionInserts(client as InternalClient | null,
    resolved.sourceType === 'collection' ? resolved.table : null, boundary.key, boundary.ready, queryShape);
  const live = useDataTableLiveWindow<T>({ props: options, data: resolved.data, sourceType: resolved.sourceType,
    boundary: partition, criteria: queryShape, state: current, primaryKey, loading: resolved.isLoading,
    insertedRowIds: resolved.sourceType === 'collection' ? collectionInserts : resolved.liveInsertedRowIds,
    confirmedInsertedRowIds: resolved.confirmedLiveInsertedRowIds,
    clearConfirmedInsertions: resolved.clearLiveInsertions });
  const dt = useDataTable<T>({
    schema, data: live.data, columns: options.columns, editable: options.editable,
    selectable: options.selectable, pageSize, primaryKey,
    columnOverrides: options.columnOverrides, state: current,
    onStateChange: interaction.replace, paginated: !!paginated,
    sortable: options.sortable, manualQuery: server, boundaryKey: partition,
    rowCount: server ? resolved.page?.total : undefined,
    pageCount: server && resolved.page?.total === undefined ? -1 : undefined,
    searchableFields: typeof searchable === 'object' ? searchable.fields : undefined,
    getRowId: server ? source.getRowId : undefined,
    paginationMode: mode,
  });
  const mutationRunner = useDataTableMutationRunner({ refresh: resolved.refresh, boundaryKey: partition });
  const selectedIds = selectedDataTablePageRows(dt.table).map((row) => row.id);
  const selectionKey = stableValueKey(selectedIds);
  const selectionNotification = React.useRef({ callback: options.onSelectionChange, ids: selectedIds });
  selectionNotification.current = { callback: options.onSelectionChange, ids: selectedIds };
  React.useEffect(() => {
    const { callback, ids } = selectionNotification.current;
    callback?.(ids);
  }, [selectionKey]);

  return { dt, current, resolved, partition, primaryKey, mutationRunner, server, live, queryKey: queryShape };
}
