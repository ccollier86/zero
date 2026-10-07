'use client';

/** Schema-shaped loading presentation; placeholders never own records or query state. */
import type * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { Skeleton } from '#zero/components/ui/skeleton';
import { TableCell, TableRow } from '#zero/components/ui/table';
import type { Row } from '../../sync/types';

export function DataTableSkeletonCell({ index, type, overlay = false }: { index: number; type?: string; overlay?: boolean }) {
  return <span data-slot={overlay ? 'data-table-skeleton-overlay' : undefined}
    style={{ '--zero-table-skeleton-index': index } as React.CSSProperties}>
    <Skeleton data-slot="data-table-skeleton" className={type === 'boolean' ? 'size-4' : type === 'enum' || type === 'select'
      ? 'h-5 w-16 rounded-full' : type === 'number' ? 'ml-auto h-3 w-12' : 'h-3 w-3/4'} />
  </span>;
}

export function DataTableSkeletonRows<T extends Row>({ columns, count, selectable, hasActions }: {
  columns: Column<T>[]; count: number; selectable: boolean; hasActions: boolean;
}) {
  return Array.from({ length: Math.min(100, Math.max(1, count)) }, (_, index) => <TableRow key={`skeleton-${index}`} aria-hidden="true">
    {selectable && <TableCell><DataTableSkeletonCell index={index} type="boolean" /></TableCell>}
    {columns.map(column => <TableCell key={column.id}><DataTableSkeletonCell index={index}
      type={(column.columnDef.meta as { fieldMeta?: { type?: string } })?.fieldMeta?.type} /></TableCell>)}
    {hasActions && <TableCell><DataTableSkeletonCell index={index} type="boolean" /></TableCell>}
  </TableRow>);
}
