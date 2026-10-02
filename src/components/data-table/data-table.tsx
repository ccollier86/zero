'use client';

/**
 * data-table.tsx
 *
 * Renders Zero's schema-aware table organism on top of TanStack Table. Data
 * source resolution, column state, toolbar UI, and cell editors live in
 * dedicated modules; this file composes them into the public DataTable API.
 */

import * as React from 'react';
import { useCallback } from 'react';
import { flexRender } from '@tanstack/react-table';
import { AnimatePresence, motion } from 'motion/react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { FieldMeta } from '../../schema/field-types';
import { encodeFieldValue } from '../../schema/field-codecs';
import type { Row } from '../../sync/types';
import { useDataTable } from './use-data-table';
import type {
  DataTableColumnOverrides,
  DataTableInitialState,
} from './use-data-table';
import {
  useDataTableSource,
  type DataTableFilters,
  type DataTableSource,
} from './data-table-source';
import { AnimatedCell } from './animated-cell';
import { EditableCell } from './editable-cell';
import { DataTableColumnHeader } from './data-table-column-header';
import {
  DataTableToolbar,
  type DataTableToolbarSlot,
  type DataTableToolbarSlots,
} from './data-table-toolbar';
import type { DataTableSearchOptions } from './data-table-search';
import { DataTableRowActions, type RowAction } from './data-table-row-actions';
import { DataTablePagination } from './data-table-pagination';
import { handleDataTableRowKeyDown } from './data-table-row-interaction';
import { getSchemaPrimaryKey } from './row-identity';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#zero/components/ui/table';
import { Checkbox } from '#zero/components/animate-ui/components/radix/checkbox';
import { ScrollArea, ScrollBar } from '#zero/components/ui/scroll-area';
import { Button } from '#zero/components/ui/button';
import { Skeleton } from '#zero/components/ui/skeleton';
import { cn } from '#zero/lib/utils';
import type { LazyCollectionOptions } from '../../frontend/client/data-hooks';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTableProps<T extends Row = Row> {
  schema: SchemaDescriptor;
  /** Explicit source config. Overrides legacy `data` / `collection` props. */
  source?: DataTableSource<T>;
  /** Static data array — ignored if `source` or `collection` is provided. */
  data?: T[];
  /** Collection name — auto-wires to live-updating reactive data. */
  collection?: string;
  /** Fetch the collection through `/api/data` before rendering rows. */
  lazy?: boolean;
  /** Lazy `/api/data` equality filters. Only used with `lazy` or lazy source. */
  filters?: DataTableFilters;
  /** Lazy `/api/data` ordering, limit, and offset options. */
  lazyOptions?: LazyCollectionOptions;
  columns?: string[];
  /** Primary key override. Defaults to `schema.primaryKey`. */
  primaryKey?: string;
  editable?: string[];
  columnOverrides?: DataTableColumnOverrides<T>;
  actions?: RowAction<T>[];
  searchable?: boolean | DataTableSearchOptions;
  sortable?: boolean;
  filterable?: boolean;
  filterColumns?: string[];
  paginated?: boolean | { pageSize?: number };
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  onCellEdit?: (rowId: string, columnId: string, value: unknown) => void;
  /** Called when a row is clicked (for master-detail patterns). */
  onRowClick?: (row: T) => void;
  /** Called when a row is double-clicked. */
  onRowDoubleClick?: (row: T) => void;
  /** Row ID to highlight (visual feedback for selected state in master-detail). */
  highlightedRowId?: string;
  /** Initial TanStack table state. */
  initialState?: DataTableInitialState;
  /** Extra toolbar controls rendered before built-in buttons. */
  toolbarActions?: DataTableToolbarSlot<T>;
  /** Composable left, right, and full-width toolbar insertion points. */
  toolbarSlots?: DataTableToolbarSlots<T>;
  /** Accessible name for this table's toolbar control group. */
  toolbarLabel?: string;
  toolbarClassName?: string;
  /** Force toolbar rendering when only export, column, or custom actions are needed. */
  showToolbar?: boolean;
  /** CSV filename for the built-in export action. Default: `export.csv`. */
  exportFilename?: string;
  showExport?: boolean;
  showColumnVisibility?: boolean;
  emptyState?: React.ReactNode;
  loadingState?: React.ReactNode;
  errorState?: (error: Error | string, retry: () => void) => React.ReactNode;
  getRowClassName?: (row: T) => string | undefined;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

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
  actions,
  searchable = false,
  sortable = true,
  filterable = false,
  filterColumns,
  paginated = false,
  selectable = false,
  onSelectionChange,
  onCellEdit: onCellEditProp,
  onRowClick,
  onRowDoubleClick,
  highlightedRowId,
  initialState,
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
  const pageSize = typeof paginated === 'object' ? (paginated.pageSize ?? 20) : 20;
  const showPagination = !!paginated;
  const primaryKey = getSchemaPrimaryKey(schema, primaryKeyOverride);
  const resolvedSource = useDataTableSource<T>({
    source,
    data: dataProp,
    collection: collectionName,
    lazy,
    filters,
    lazyOptions,
  });
  const data = resolvedSource.data;

  // Auto-wire cell edits to collection.update when using collection prop
  const onCellEdit = React.useCallback(
    (rowId: string, columnId: string, value: unknown) => {
      const meta = schema.fields.get(columnId);
      const encodedValue = meta ? encodeFieldValue(meta, value) : value;
      resolvedSource.actions?.update(rowId, { [columnId]: encodedValue } as Partial<T>);
      onCellEditProp?.(rowId, columnId, encodedValue);
    },
    [onCellEditProp, resolvedSource.actions, schema],
  );

  const dt = useDataTable<T>({
    schema,
    data,
    columns: visibleColumns,
    editable,
    selectable,
    pageSize,
    primaryKey,
    columnOverrides,
    initialState,
  });

  const {
    table,
    editingCell,
    setEditingCell,
    globalFilter,
    setGlobalFilter,
    rowSelection,
  } = dt;

  // Selection callback
  React.useEffect(() => {
    if (onSelectionChange) {
      const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
      onSelectionChange(selectedIds);
    }
  }, [rowSelection, onSelectionChange]);

  // ─── Cell edit handler ────────────────────────────────────────────

  const handleCellSave = useCallback(
    (rowId: string, columnId: string, value: unknown) => {
      setEditingCell(null);
      onCellEdit?.(rowId, columnId, value);
    },
    [setEditingCell, onCellEdit],
  );

  // ─── Tab navigation between editable cells ────────────────────────

  const getNextEditableCell = useCallback(
    (currentRowId: string, currentColumnId: string): { rowId: string; columnId: string } | null => {
      const rows = table.getRowModel().rows;
      const colIndex = editable.indexOf(currentColumnId);
      const rowIndex = rows.findIndex((r) => r.id === currentRowId);

      if (colIndex < editable.length - 1) {
        return { rowId: currentRowId, columnId: editable[colIndex + 1]! };
      }
      if (rowIndex < rows.length - 1) {
        return { rowId: rows[rowIndex + 1]!.id, columnId: editable[0]! };
      }
      return null;
    },
    [table, editable],
  );

  // ─── Render ───────────────────────────────────────────────────────

  const pageRows = table.getRowModel().rows;
  const hasToolbarSlots = !!(
    toolbarSlots?.controls
    || toolbarSlots?.actions
    || toolbarSlots?.supplemental
  );
  const shouldShowToolbar = showToolbar
    ?? (!!searchable || filterable || toolbarActions != null || hasToolbarSlots);
  const colSpan =
    (visibleColumns?.length ?? schema.fieldNames.length) +
    (selectable ? 1 : 0) +
    (actions?.length ? 1 : 0);

  if (resolvedSource.isLoading && data.length === 0) {
    return (
      <div className={cn('space-y-3', className)}>
        {loadingState ?? <DefaultLoadingState />}
      </div>
    );
  }

  if (resolvedSource.error && data.length === 0) {
    return (
      <div className={cn('space-y-3', className)}>
        {errorState
          ? errorState(resolvedSource.error, resolvedSource.refresh)
          : (
              <DefaultErrorState
                error={resolvedSource.error}
                onRetry={resolvedSource.refresh}
              />
            )}
      </div>
    );
  }

  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      {/* Toolbar */}
      {shouldShowToolbar && (
        <DataTableToolbar
          table={table}
          globalFilter={globalFilter}
          onGlobalFilterChange={setGlobalFilter}
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
        />
      )}

      {/* Table */}
      <ScrollArea className="w-full min-w-0 max-w-full rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {/* Selection column */}
                {selectable && (
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() && 'indeterminate')
                      }
                      onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} style={{ width: header.getSize() }}>
                    {header.isPlaceholder ? null : sortable ? (
                      <DataTableColumnHeader
                        column={header.column}
                        title={
                          typeof header.column.columnDef.header === 'string'
                            ? header.column.columnDef.header
                            : header.id
                        }
                      />
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
                {/* Actions column */}
                {actions && actions.length > 0 && (
                  <TableHead className="w-[50px]" />
                )}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            <AnimatePresence initial={false}>
              {pageRows.length > 0 ? (
                pageRows.map((row) => (
                  <motion.tr
                    key={row.id}
                    data-slot="table-row"
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    data-highlighted={highlightedRowId != null && row.id === highlightedRowId ? '' : undefined}
                    aria-current={highlightedRowId != null && row.id === highlightedRowId ? 'true' : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={cn(
                      'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted data-[highlighted]:bg-accent',
                      onRowClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      getRowClassName?.(row.original),
                    )}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    onKeyDown={onRowClick
                      ? (event) => handleDataTableRowKeyDown(event, row.original, onRowClick)
                      : undefined}
                    onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row.original) : undefined}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    layout
                  >
                    {/* Selection cell */}
                    {selectable && (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={row.getIsSelected()}
                          onCheckedChange={(value) => row.toggleSelected(!!value)}
                          aria-label="Select row"
                        />
                      </TableCell>
                    )}
                    {row.getVisibleCells().map((cell) => {
                      const colMeta = cell.column.columnDef.meta as
                        | { fieldMeta?: FieldMeta; isEditable?: boolean }
                        | undefined;
                      const isEditable = colMeta?.isEditable ?? false;
                      const cellValue = cell.getValue();
                      const isEditing =
                        editingCell?.rowId === row.id &&
                        editingCell?.columnId === cell.column.id;

                      return (
                        <TableCell
                          key={cell.id}
                          onClick={isEditable ? (event) => event.stopPropagation() : undefined}
                        >
                          <AnimatedCell value={cellValue}>
                            {isEditable ? (
                              <EditableCell
                                value={cellValue}
                                rowId={row.id}
                                columnId={cell.column.id}
                                fieldMeta={colMeta?.fieldMeta}
                                isEditing={isEditing}
                                onStartEdit={() =>
                                  setEditingCell({
                                    rowId: row.id,
                                    columnId: cell.column.id,
                                  })
                                }
                                onSave={handleCellSave}
                                onCancel={() => setEditingCell(null)}
                                onTabNext={() => {
                                  const next = getNextEditableCell(row.id, cell.column.id);
                                  if (next) setEditingCell(next);
                                }}
                              />
                            ) : (
                              flexRender(cell.column.columnDef.cell, cell.getContext())
                            )}
                          </AnimatedCell>
                        </TableCell>
                      );
                    })}
                    {/* Actions cell */}
                    {actions && actions.length > 0 && (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <DataTableRowActions row={row.original} actions={actions} />
                      </TableCell>
                    )}
                  </motion.tr>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={colSpan}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {emptyState ?? 'No results.'}
                  </TableCell>
                </TableRow>
              )}
            </AnimatePresence>
          </TableBody>
        </Table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Pagination */}
      {showPagination && <DataTablePagination table={table} />}
    </div>
  );
}

export const DataTableView = DataTable;

function DefaultLoadingState() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-[min(18rem,100%)]" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function DefaultErrorState({
  error,
  onRetry,
}: {
  error: Error | string;
  onRetry: () => void;
}) {
  const message = error instanceof Error ? error.message : error;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      <span className="min-w-0 truncate">{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
