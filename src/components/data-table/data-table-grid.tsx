'use client';

/** Table presentation, stable column layout, row interaction, and editor composition. */

import * as React from 'react';
import { flexRender } from '@tanstack/react-table';
import { AnimatePresence, motion } from 'motion/react';
import type { FieldMeta } from '../../schema/field-types';
import type { Row } from '../../sync/types';
import type { UseDataTableReturn } from './use-data-table';
import type { DataTableMutationContext, DataTableMutationRunner } from './data-table-mutation';
import { AnimatedCell } from './animated-cell';
import { EditableCell } from './editable-cell';
import { DataTableColumnHeader } from './data-table-column-header';
import { DataTableRowActions, type RowAction } from './data-table-row-actions';
import { handleDataTableRowKeyDown } from './data-table-row-interaction';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#zero/components/ui/table';
import { Checkbox } from '#zero/components/animate-ui/components/radix/checkbox';
import { ScrollArea, ScrollBar } from '#zero/components/ui/scroll-area';
import { cn } from '#zero/lib/utils';

interface ColumnPresentation {
  fieldMeta?: FieldMeta;
  isEditable?: boolean;
  flex?: boolean;
  wrap?: boolean;
  truncate?: boolean;
}

export interface DataTableGridProps<T extends Row> {
  controls: UseDataTableReturn<T>;
  selectable: boolean;
  sortable: boolean;
  tableLayout?: 'auto' | 'fixed';
  actions?: RowAction<T>[];
  mutationRunner: DataTableMutationRunner;
  highlightedRowId?: string;
  emptyState?: React.ReactNode;
  loadingState?: React.ReactNode;
  loading?: boolean;
  getRowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  onCellSave: (rowId: string, columnId: string, value: unknown, context?: DataTableMutationContext) => void | Promise<void>;
  onCellAccepted: () => void;
  getNextEditableCell: (rowId: string, columnId: string) => { rowId: string; columnId: string } | null;
}

/** Render only the current row model; query and mutation policy stay in controllers. */
export function DataTableGrid<T extends Row>({
  controls,
  selectable,
  sortable,
  tableLayout = 'auto',
  actions,
  mutationRunner,
  highlightedRowId,
  emptyState,
  loadingState,
  loading,
  getRowClassName,
  onRowClick,
  onRowDoubleClick,
  onCellSave,
  onCellAccepted,
  getNextEditableCell,
}: DataTableGridProps<T>) {
  const { table, editingCell, setEditingCell } = controls;
  const rows = table.getRowModel().rows;
  const columns = table.getVisibleLeafColumns();
  const hasActions = Boolean(actions?.length);
  const colSpan = columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <ScrollArea className="w-full min-w-0 max-w-full rounded-md border" aria-busy={loading || undefined}>
      <Table className={tableLayout === 'fixed' ? 'table-fixed' : undefined}>
        {tableLayout === 'fixed' && (
          <colgroup>
            {selectable && <col style={{ width: 40 }} />}
            {columns.map((column) => (
              <col key={column.id} style={columnStyle(column.getSize(), column.columnDef.meta as ColumnPresentation)} />
            ))}
            {hasActions && <col style={{ width: 50 }} />}
          </colgroup>
        )}
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {selectable && (
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all rows on this page"
                  />
                </TableHead>
              )}
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  style={tableLayout === 'auto' ? columnStyle(header.getSize(), header.column.columnDef.meta as ColumnPresentation) : undefined}
                  aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}
                >
                  {header.isPlaceholder ? null : sortable ? (
                    <DataTableColumnHeader
                      column={header.column}
                      title={typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : header.id}
                    />
                  ) : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
              {hasActions && <TableHead className="w-[50px]" />}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          <AnimatePresence initial={false}>
            {rows.length > 0 ? rows.map((row) => (
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
                onKeyDown={onRowClick ? (event) => handleDataTableRowKeyDown(event, row.original, onRowClick) : undefined}
                onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row.original) : undefined}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                layout
              >
                {selectable && (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Checkbox checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(!!value)} aria-label="Select row" />
                  </TableCell>
                )}
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as ColumnPresentation | undefined;
                  const value = cell.getValue();
                  const isEditing = editingCell?.rowId === row.id && editingCell.columnId === cell.column.id;
                  return (
                    <TableCell key={cell.id} onClick={meta?.isEditable ? (event) => event.stopPropagation() : undefined}>
                      <AnimatedCell
                        value={value}
                        className={cn(
                          'min-w-0 max-w-full',
                          meta?.wrap && 'whitespace-normal break-words',
                          meta?.truncate && !isEditing && 'overflow-hidden text-ellipsis whitespace-nowrap [&>*]:max-w-full',
                        )}
                      >
                        {meta?.isEditable ? (
                          <EditableCell
                            value={value}
                            rowId={row.id}
                            columnId={cell.column.id}
                            fieldMeta={meta.fieldMeta}
                            isEditing={isEditing}
                            mutationRunner={mutationRunner}
                            onStartEdit={() => setEditingCell({ rowId: row.id, columnId: cell.column.id })}
                            onSave={onCellSave}
                            onAccepted={onCellAccepted}
                            onCancel={() => setEditingCell(null)}
                            onTabNext={() => {
                              const next = getNextEditableCell(row.id, cell.column.id);
                              if (next) setEditingCell(next);
                            }}
                          />
                        ) : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </AnimatedCell>
                    </TableCell>
                  );
                })}
                {hasActions && (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <DataTableRowActions rowId={row.id} row={row.original} actions={actions!} mutationRunner={mutationRunner} />
                  </TableCell>
                )}
              </motion.tr>
            )) : (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  {loading ? loadingState ?? 'Loading records…' : emptyState ?? 'No results.'}
                </TableCell>
              </TableRow>
            )}
          </AnimatePresence>
        </TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function columnStyle(width: number, meta: ColumnPresentation | undefined): React.CSSProperties | undefined {
  return meta?.flex ? undefined : { width };
}
