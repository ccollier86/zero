'use client';

/** Composes table state, data-source policy, mutation lifecycle, and presentation. */

import * as React from 'react';
import { toast } from 'sonner';
import { encodeFieldValue } from '../../schema/field-codecs';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import type { Row } from '../../sync/types';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTablePagination } from './data-table-pagination';
import { DataTableGrid } from './data-table-grid';
import { DataTableBulkActions } from './data-table-bulk-actions';
import { selectedDataTablePageRows } from './data-table-selection';
import type { DataTableMutationContext } from './data-table-mutation';
import { useDataTableController, type DataTableController } from './use-data-table-controller';
import type { DataTableProps } from './data-table-types';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';

export type { DataTableProps } from './data-table-types';

/** The same controls serve arrays, complete reactive collections, and server queries. */
export function DataTable<T extends Row = Row>(props: DataTableProps<T>) {
  const controller = useDataTableController(props);
  return <DataTableContent {...props} controller={controller} />;
}

/** Internal view for organisms that already own the shared query/result controller. */
export function DataTableContent<T extends Row = Row>({
  controller,
  schema,
  source,
  tableLayout = 'auto',
  actions,
  bulkActions,
  searchable = false,
  sortable = true,
  filterable = false,
  filterColumns,
  paginated = source?.type === 'server',
  selectable = false,
  onCellEdit,
  onCellCommit,
  onRowClick,
  onRowDoubleClick,
  highlightedRowId,
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
}: DataTableProps<T> & { controller: DataTableController<T> }) {
  const { dt, current, resolved, partition, mutationRunner, server } = controller;
  const partitionRef = React.useRef(partition);
  partitionRef.current = partition;

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
        try {
          await onCellEdit?.(rowId, columnId, encoded, context);
        } catch {
          // The source update already succeeded. A follow-up error must not
          // make the mutation runner repeat that accepted write on Retry.
          if (partitionRef.current === capturedPartition && !context?.signal.aborted) {
            emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
              metadata: { surface: 'data-table', stage: 'accepted-callback' },
            });
            toast.error('The change was saved, but a follow-up action failed.');
          }
        }
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
  const selectionRows = selectedDataTablePageRows(dt.table);

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
