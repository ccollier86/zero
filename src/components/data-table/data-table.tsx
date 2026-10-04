'use client';

/** Composes table state, data-source policy, mutation lifecycle, and presentation. */

import * as React from 'react';
import { encodeFieldValue } from '../../schema/field-codecs';
import type { Row } from '../../sync/types';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { stableValueKey } from '../../frontend/client/query-params';
import { useDataTable } from './use-data-table';
import { useDataTableState } from './data-table-state';
import { useDataTableSource } from './data-table-source';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTablePagination } from './data-table-pagination';
import { DataTableGrid } from './data-table-grid';
import { useDataTableCursorHistory, useDataTableAcceptedCursors } from './data-table-cursor-history';
import { dataTableServerSourceIdentity } from './data-table-server-source-identity';
import { DataTableBulkActions } from './data-table-bulk-actions';
import { useDataTableMutationRunner, type DataTableMutationContext } from './data-table-mutation';
import { getSchemaPrimaryKey } from './row-identity';
import type { DataTableProps } from './data-table-types';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';

export type { DataTableProps } from './data-table-types';

/** The same controls serve arrays, complete reactive collections, and server queries. */
export function DataTable<T extends Row = Row>({
  schema,
  source,
  data: dataProp,
  collection: collectionName,
  lazy = false,
  filters,
  lazyOptions,
  columns: visibleColumns,
  primaryKey: primaryKeyOverride,
  editable = [],
  columnOverrides,
  tableLayout = 'auto',
  actions,
  bulkActions,
  searchable = false,
  sortable = true,
  filterable = false,
  filterColumns,
  paginated = source?.type === 'server',
  selectable = false,
  onSelectionChange,
  onCellEdit,
  onCellCommit,
  onRowClick,
  onRowDoubleClick,
  highlightedRowId,
  initialState,
  state,
  onStateChange,
  toolbarActions,
  toolbarSlots,
  toolbarLabel,
  toolbarClassName,
  showToolbar,
  exportFilename = 'export.csv',
  showExport = true,
  showColumnVisibility = true,
  emptyState,
  loadingState,
  errorState,
  getRowClassName,
  className,
}: DataTableProps<T>) {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const server = source?.type === 'server';
  const sourceTable = source && 'table' in source ? source.table : collectionName;
  const mode = server ? source.pagination ?? 'offset' : 'offset';
  const partition = stableValueKey([
    boundary.key, source?.type ?? (collectionName ? 'collection' : 'data'), sourceTable,
    server ? dataTableServerSourceIdentity(source) : null, mode,
  ]);
  const pageSize = typeof paginated === 'object' ? paginated.pageSize ?? 20 : 20;
  const primaryKey = getSchemaPrimaryKey(schema, primaryKeyOverride);
  const interaction = useDataTableState({ initialState, state, onStateChange, pageSize, boundaryKey: partition });
  const current = interaction.state;
  const queryShape = stableValueKey([partition, current.globalFilter, current.columnFilters, current.sorting, current.pagination.pageSize]);
  const cursors = useDataTableCursorHistory(queryShape);
  const searchFields = typeof searchable === 'object' && searchable.fields
    ? searchable.fields
    : (visibleColumns ?? schema.fieldNames).filter((name) => {
        const type = schema.fields.get(name)?.type;
        return type === 'text' || type === 'email' || type === 'url' || type === 'textarea';
      });
  const resolved = useDataTableSource<T>({
    source, data: dataProp, collection: collectionName, lazy, filters, lazyOptions, primaryKey,
    query: {
      search: searchable ? current.globalFilter : '',
      filters: current.columnFilters,
      sorting: current.sorting,
      pagination: {
        mode,
        ...current.pagination,
        ...(mode === 'cursor' ? { cursor: cursors.current.cursors.get(current.pagination.pageIndex) ?? null } : {}),
      },
      searchFields,
    },
  });
  useDataTableAcceptedCursors(cursors, current.pagination.pageIndex, resolved.page);
  const dt = useDataTable<T>({
    schema, data: resolved.data, columns: visibleColumns, editable, selectable, pageSize,
    primaryKey, columnOverrides, state: current, onStateChange: interaction.replace,
    paginated: !!paginated, sortable, manualQuery: server, boundaryKey: partition,
    rowCount: server ? resolved.page?.total : undefined,
    pageCount: server && resolved.page?.total === undefined ? -1 : undefined,
    searchableFields: typeof searchable === 'object' ? searchable.fields : undefined,
    getRowId: server ? source.getRowId : undefined,
  });
  const mutationRunner = useDataTableMutationRunner({ refresh: resolved.refresh, boundaryKey: partition });
  const partitionRef = React.useRef(partition);
  partitionRef.current = partition;

  const selectedIds = dt.table.getSelectedRowModel().rows.map((row) => row.id);
  const selectionKey = stableValueKey(selectedIds);
  const selectionNotification = React.useRef({ callback: onSelectionChange, ids: selectedIds });
  selectionNotification.current = { callback: onSelectionChange, ids: selectedIds };
  React.useEffect(() => {
    const { callback, ids } = selectionNotification.current;
    callback?.(ids);
  }, [selectionKey]);

  const saveCell = React.useCallback(async (
    rowId: string,
    columnId: string,
    value: unknown,
    context?: DataTableMutationContext,
  ) => {
    const capturedPartition = partition;
    const meta = schema.fields.get(columnId);
    const encoded = meta ? encodeFieldValue(meta, value) : value;
    if (onCellCommit) {
      await onCellCommit(rowId, columnId, encoded, context);
    } else if (resolved.actions) {
      await resolved.actions.update(rowId, { [columnId]: encoded } as Partial<T>, { signal: context?.signal });
      // Preserve the legacy collection auto-write plus edit notification contract.
      if (partitionRef.current === capturedPartition && !context?.signal.aborted) {
        await onCellEdit?.(rowId, columnId, encoded, context);
      }
    } else if (onCellEdit) {
      await onCellEdit(rowId, columnId, encoded, context);
    } else {
      throw new Error('Inline editing requires a source update operation or onCellEdit.');
    }
  }, [onCellEdit, onCellCommit, partition, resolved.actions, schema]);

  const acceptCell = React.useCallback(() => {
    if (partitionRef.current === partition) dt.setEditingCell(null);
  }, [dt.setEditingCell, partition]);

  const nextEditableCell = React.useCallback((rowId: string, columnId: string) => {
    if (partitionRef.current !== partition) return null;
    const rows = dt.table.getRowModel().rows;
    const columns = dt.table.getVisibleLeafColumns().filter((column) => (
      column.columnDef.meta as { isEditable?: boolean } | undefined
    )?.isEditable).map((column) => column.id);
    const columnIndex = columns.indexOf(columnId);
    const rowIndex = rows.findIndex((row) => row.id === rowId);
    if (columnIndex < 0 || rowIndex < 0) return null;
    if (columnIndex < columns.length - 1) return { rowId, columnId: columns[columnIndex + 1]! };
    if (rowIndex < rows.length - 1) return { rowId: rows[rowIndex + 1]!.id, columnId: columns[0]! };
    return null;
  }, [dt.table, partition]);

  const showControls = showToolbar ?? Boolean(searchable || filterable || toolbarActions != null
    || toolbarSlots?.controls || toolbarSlots?.actions || toolbarSlots?.supplemental || bulkActions?.length);
  const selectionRows = dt.table.getSelectedRowModel().rows;

  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      {showControls && <DataTableToolbar
        table={dt.table}
        globalFilter={current.globalFilter}
        onGlobalFilterChange={dt.setGlobalFilter}
        searchable={searchable}
        filterable={filterable}
        filterColumns={filterColumns}
        showColumnVisibility={showColumnVisibility}
        showExport={showExport}
        exportFilename={exportFilename}
        actions={toolbarActions}
        slots={toolbarSlots}
        ariaLabel={toolbarLabel}
        className={toolbarClassName}
      />}
      {bulkActions?.length && selectionRows.length > 0 ? <DataTableBulkActions
        actions={bulkActions}
        selection={{ scope: 'page', rows: selectionRows.map((row) => row.original), rowIds: selectionRows.map((row) => row.id) }}
        mutationRunner={mutationRunner}
      /> : null}
      {resolved.error && (errorState
        ? errorState(resolved.error, resolved.refresh)
        : <DataTableErrorState error={resolved.error} onRetry={resolved.refresh} />)}
      {resolved.isLoading && resolved.data.length > 0 && <p role="status" className="text-xs text-muted-foreground">Updating records…</p>}
      <DataTableGrid
        key={partition}
        controls={dt} selectable={selectable} sortable={sortable} tableLayout={tableLayout}
        actions={actions} mutationRunner={mutationRunner} highlightedRowId={highlightedRowId}
        emptyState={emptyState} loadingState={loadingState} loading={resolved.isLoading}
        getRowClassName={getRowClassName} onRowClick={onRowClick} onRowDoubleClick={onRowDoubleClick}
        onCellSave={saveCell} onCellAccepted={acceptCell} getNextEditableCell={nextEditableCell}
      />
      {paginated && <DataTablePagination table={dt.table} serverPage={server ? resolved.page : undefined} loading={resolved.isLoading} />}
    </div>
  );
}

export const DataTableView = DataTable;

function DataTableErrorState({ error, onRetry }: { error: Error | string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <span className="min-w-0 truncate">{error instanceof Error ? error.message : error}</span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}
