'use client';

import * as React from 'react';
import { useCallback } from 'react';
import { flexRender } from '@tanstack/react-table';
import { AnimatePresence, motion } from 'motion/react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { FieldMeta } from '../../schema/field-types';
import { encodeFieldValue } from '../../schema/field-codecs';
import type { Row } from '../../sync/types';
import { useCollection } from '../../frontend/client/hooks';
import { useDataTable, type UseDataTableReturn } from './use-data-table';
import { AnimatedCell } from './animated-cell';
import { EditableCell } from './editable-cell';
import { DataTableColumnHeader } from './data-table-column-header';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTableRowActions, type RowAction } from './data-table-row-actions';
import { DataTablePagination } from './data-table-pagination';
import { getSchemaPrimaryKey } from './row-identity';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/animate-ui/components/radix/checkbox';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTableProps<T extends Row = Row> {
  schema: SchemaDescriptor;
  /** Static data array — ignored if `collection` is provided. */
  data?: T[];
  /** Collection name — auto-wires to live-updating reactive data. */
  collection?: string;
  columns?: string[];
  /** Primary key override. Defaults to `schema.primaryKey`. */
  primaryKey?: string;
  editable?: string[];
  actions?: RowAction<T>[];
  searchable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  paginated?: boolean | { pageSize?: number };
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  onCellEdit?: (rowId: string, columnId: string, value: unknown) => void;
  /** Called when a row is clicked (for master-detail patterns). */
  onRowClick?: (row: T) => void;
  /** Row ID to highlight (visual feedback for selected state in master-detail). */
  highlightedRowId?: string;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTable<T extends Row = Row>({
  schema,
  data: dataProp,
  collection: collectionName,
  columns: visibleColumns,
  primaryKey: primaryKeyOverride,
  editable = [],
  actions,
  searchable = false,
  sortable = true,
  filterable = false,
  paginated = false,
  selectable = false,
  onSelectionChange,
  onCellEdit: onCellEditProp,
  onRowClick,
  highlightedRowId,
  className,
}: DataTableProps<T>) {
  const pageSize = typeof paginated === 'object' ? (paginated.pageSize ?? 20) : 20;
  const showPagination = !!paginated;
  const primaryKey = getSchemaPrimaryKey(schema, primaryKeyOverride);

  // When collection is provided, use live-updating reactive data
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const live = collectionName ? useCollection<T>(collectionName) : null;
  const data = live?.data ?? dataProp ?? [];

  // Auto-wire cell edits to collection.update when using collection prop
  const onCellEdit = React.useCallback(
    (rowId: string, columnId: string, value: unknown) => {
      const meta = schema.fields.get(columnId);
      const encodedValue = meta ? encodeFieldValue(meta, value) : value;
      if (live) {
        live.update(rowId, { [columnId]: encodedValue } as Partial<T>);
      }
      onCellEditProp?.(rowId, columnId, encodedValue);
    },
    [live, onCellEditProp, schema],
  );

  const dt = useDataTable<T>({
    schema,
    data,
    columns: visibleColumns,
    editable,
    selectable,
    pageSize,
    primaryKey,
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

  return (
    <div className={cn('space-y-3', className)}>
      {/* Toolbar */}
      {(searchable || filterable) && (
        <DataTableToolbar
          table={table}
          globalFilter={globalFilter}
          onGlobalFilterChange={setGlobalFilter}
          searchable={searchable}
        />
      )}

      {/* Table */}
      <ScrollArea className="rounded-md border">
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
                    className={cn(
                      'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted data-[highlighted]:bg-accent',
                      onRowClick && 'cursor-pointer',
                    )}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    layout
                  >
                    {/* Selection cell */}
                    {selectable && (
                      <TableCell>
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
                        <TableCell key={cell.id}>
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
                      <TableCell>
                        <DataTableRowActions row={row.original} actions={actions} />
                      </TableCell>
                    )}
                  </motion.tr>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={
                      (visibleColumns?.length ?? schema.fieldNames.length) +
                      (selectable ? 1 : 0) +
                      (actions?.length ? 1 : 0)
                    }
                    className="h-24 text-center text-muted-foreground"
                  >
                    No results.
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
