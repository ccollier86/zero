'use client';

/** One React-owned native row, with acknowledged editors and non-interactive exiting presentation. */
import * as React from 'react';
import { flexRender, type Row as TableRow } from '@tanstack/react-table';
import type { FieldMeta } from '../../schema/field-types';
import type { Row } from '../../sync/types';
import type { DataTableGridProps } from './data-table-grid';
import { AnimatedCell } from './animated-cell';
import { EditableCell } from './editable-cell';
import { DataTableRowActions } from './data-table-row-actions';
import { handleDataTableRowKeyDown } from './data-table-row-interaction';
import { highlightDataTableText } from './data-table-search-highlight';
import { DataTableAnimatedText } from './data-table-animated-text';
import { formatEditableCellValue } from './editable-cell-value';
import { TableCell } from '#zero/components/ui/table';
import { Checkbox } from '#zero/components/animate-ui/components/radix/checkbox';
import { cn } from '#zero/lib/utils';

export interface ColumnPresentation {
  fieldMeta?: FieldMeta; isEditable?: boolean; flex?: boolean; wrap?: boolean; truncate?: boolean; customCell?: boolean;
}

export function DataTableGridRow<T extends Row>({ row, leaving, pending, fresh, rowRef, query, motionEnabled, cellMotion = 'typewriter',
  controls, selectable, actions, mutationRunner, highlightedRowId, getRowClassName, onRowClick, onRowDoubleClick,
  onCellSave, onCellAccepted, getNextEditableCell,
}: DataTableGridProps<T> & { row: TableRow<T>; leaving: boolean; pending: boolean; fresh: boolean;
  rowRef: React.Ref<HTMLTableRowElement>; query: string; motionEnabled: boolean }) {
  const { editingCell, setEditingCell } = controls;
  return <tr ref={rowRef} data-slot="table-row" data-row-id={row.id} data-table-leaving={leaving ? '' : undefined}
    data-table-fresh={fresh && motionEnabled ? '' : undefined} inert={leaving || pending ? true : undefined}
    aria-hidden={leaving || undefined} data-state={row.getIsSelected() ? 'selected' : undefined}
    data-highlighted={highlightedRowId === row.id ? '' : undefined} aria-current={highlightedRowId === row.id ? 'true' : undefined}
    tabIndex={onRowClick && !leaving && !pending ? 0 : undefined}
    className={cn('border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted data-[highlighted]:bg-accent',
      onRowClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', getRowClassName?.(row.original))}
    onClick={!leaving && !pending && onRowClick ? () => onRowClick(row.original) : undefined}
    onKeyDown={!leaving && !pending && onRowClick ? event => handleDataTableRowKeyDown(event, row.original, onRowClick) : undefined}
    onDoubleClick={!leaving && !pending && onRowDoubleClick ? () => onRowDoubleClick(row.original) : undefined}>
    {selectable && <TableCell onClick={event => event.stopPropagation()}>
      <Checkbox checked={row.getIsSelected()} disabled={leaving || pending}
        onCheckedChange={value => row.toggleSelected(!!value)} aria-label="Select row" />
    </TableCell>}
    {row.getVisibleCells().map(cell => {
      const meta = cell.column.columnDef.meta as ColumnPresentation | undefined, value = cell.getValue();
      const isEditing = editingCell?.rowId === row.id && editingCell.columnId === cell.column.id;
      const rendered = flexRender(cell.column.columnDef.cell, cell.getContext());
      const plainText = !meta?.customCell && (typeof value === 'string' || value == null)
        && ['text', 'textarea', 'email', 'phone', 'url'].includes(meta?.fieldMeta?.type ?? 'text');
      const text = typeof value === 'string' ? value : '';
      const content = plainText && typeof value === 'string' ? highlightDataTableText(text, query)
        : plainText && meta?.isEditable ? formatEditableCellValue(value, meta.fieldMeta) : rendered;
      const display = plainText ? <DataTableAnimatedText value={text}
        enabled={motionEnabled && cellMotion === 'typewriter' && !leaving && !isEditing}>{content}</DataTableAnimatedText> : content;
      const editableDisplay = plainText && !isEditing ? display : undefined;
      return <TableCell key={cell.id}
        onClick={meta?.isEditable ? event => event.stopPropagation() : undefined}>
        <AnimatedCell value={value} motionEnabled={motionEnabled && cellMotion !== false && !fresh && !leaving} className={cn('min-w-0 max-w-full',
          meta?.wrap && 'whitespace-normal break-words', meta?.truncate && !isEditing && 'overflow-hidden text-ellipsis whitespace-nowrap [&>*]:max-w-full')}>
          {meta?.isEditable ? <EditableCell value={value} rowId={row.id} columnId={cell.column.id} fieldMeta={meta.fieldMeta}
            displayValue={editableDisplay} isEditing={isEditing} mutationRunner={mutationRunner}
            onStartEdit={() => setEditingCell({ rowId: row.id, columnId: cell.column.id })} onSave={onCellSave} onAccepted={onCellAccepted}
            onCancel={() => setEditingCell(null)} onTabNext={() => { const next = getNextEditableCell(row.id, cell.column.id); if (next) setEditingCell(next); }} /> : display}
        </AnimatedCell>
      </TableCell>;
    })}
    {Boolean(actions?.length) && <TableCell onClick={event => event.stopPropagation()}>
      <DataTableRowActions rowId={row.id} row={row.original} actions={actions!} mutationRunner={mutationRunner} />
    </TableCell>}
  </tr>;
}
