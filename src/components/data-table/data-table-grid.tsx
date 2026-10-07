'use client';

/** Native table composition, with motion isolated from source and mutation authority. */
import * as React from 'react';
import { flexRender } from '@tanstack/react-table';
import type { Row } from '../../sync/types';
import type { UseDataTableReturn } from './use-data-table';
import type { DataTableMutationContext, DataTableMutationRunner } from './data-table-mutation';
import { DataTableColumnHeader } from './data-table-column-header';
import type { RowAction } from './data-table-row-actions';
import { DataTableGridRow, type ColumnPresentation } from './data-table-grid-row';
import { DataTableSkeletonRows } from './data-table-grid-skeleton';
import { DataTableSkeletonReveal } from './data-table-skeleton-reveal';
import { useDataTableMotion } from './use-data-table-motion';
import { DataTableMotionSnapshotBridge } from './data-table-motion-snapshot';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#zero/components/ui/table';
import { Checkbox } from '#zero/components/animate-ui/components/radix/checkbox';
import { ScrollArea, ScrollBar } from '#zero/components/ui/scroll-area';
import { Button } from '#zero/components/ui/button';

export interface DataTableGridProps<T extends Row> {
  controls: UseDataTableReturn<T>; selectable: boolean; sortable: boolean;
  tableLayout?: 'auto' | 'fixed'; actions?: RowAction<T>[]; mutationRunner: DataTableMutationRunner;
  highlightedRowId?: string; emptyState?: React.ReactNode; loadingState?: React.ReactNode;
  loading?: boolean; error?: boolean; previousData?: boolean; motionEnabled?: boolean; queryKey?: string; query?: string;
  cellMotion?: 'typewriter' | 'highlight' | false;
  navigationOrigin?: 'pointer' | 'keyboard'; onBusyChange?: (busy: boolean) => void;
  freshRowIds?: ReadonlySet<string>; onClearFilters?: () => void;
  getRowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void; onRowDoubleClick?: (row: T) => void;
  onCellSave: (rowId: string, columnId: string, value: unknown, context?: DataTableMutationContext) => void | Promise<void>;
  onCellAccepted: () => void;
  getNextEditableCell: (rowId: string, columnId: string) => { rowId: string; columnId: string } | null;
}

export function DataTableGrid<T extends Row>(props: DataTableGridProps<T>) {
  const { controls, selectable, sortable, tableLayout = 'auto', actions, loading = false,
    motionEnabled = true, query = '', queryKey = '', emptyState, loadingState } = props;
  const { table } = controls, columns = table.getVisibleLeafColumns(), pagination = table.getState().pagination;
  const motion = useDataTableMotion({ rows: table.getRowModel().rows, queryKey, ...pagination, loading,
    error: props.error, enabled: motionEnabled, navigationOrigin: props.navigationOrigin,
    onBusyChange: props.onBusyChange, freshRowIds: props.freshRowIds, allowSkeleton: !controls.editingCell && loadingState === undefined });
  const hasActions = Boolean(actions?.length), colSpan = columns.length + Number(selectable) + Number(hasActions);
  const animated = motionEnabled && !motion.reducedMotion;
  const blocked = Boolean(props.previousData) || motion.pending && !controls.editingCell;
  return <ScrollArea data-slot="data-table-grid" data-motion={animated ? 'true' : 'false'}
    className="w-full min-w-0 max-w-full rounded-md border" aria-busy={loading || motion.pending || undefined}>
    <div ref={motion.containerRef} data-slot="data-table-height-frame" className="relative">
      <Table className={tableLayout === 'fixed' ? 'table-fixed' : undefined}>
        {tableLayout === 'fixed' && <colgroup>
          {selectable && <col style={{ width: 40 }} />}
          {columns.map(column => <col key={column.id} style={columnStyle(column.getSize(), column.columnDef.meta as ColumnPresentation)} />)}
          {hasActions && <col style={{ width: 50 }} />}
        </colgroup>}
        <TableHeader>
          {table.getHeaderGroups().map(group => <TableRow key={group.id}>
            {selectable && <TableHead className="w-[40px]"><Checkbox
              checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
              disabled={blocked || motion.showSkeleton}
              onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)} aria-label="Select all rows on this page" /></TableHead>}
            {group.headers.map(header => <TableHead key={header.id}
              style={tableLayout === 'auto' ? columnStyle(header.getSize(), header.column.columnDef.meta as ColumnPresentation) : undefined}
              aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}>
              {header.isPlaceholder ? null : sortable ? <DataTableColumnHeader column={header.column} motionEnabled={animated}
                title={typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : header.id} />
                : flexRender(header.column.columnDef.header, header.getContext())}
            </TableHead>)}
            {hasActions && <TableHead className="w-[50px]" />}
          </TableRow>)}
        </TableHeader>
        <DataTableMotionSnapshotBridge frameKey={motion.frameKey} capture={motion.snapshotBeforeUpdate} commit={motion.commitSnapshot}>
          <TableBody ref={motion.bodyRef} data-skeleton-visible={motion.showSkeleton ? '' : undefined} aria-hidden={motion.showSkeleton || undefined}>
            {motion.rows.map(({ row, leaving }) => <DataTableGridRow {...props} key={row.id} row={row}
              leaving={leaving} pending={blocked || motion.showSkeleton} fresh={Boolean(props.freshRowIds?.has(row.id))}
              query={query} motionEnabled={animated} rowRef={motion.rowRef(row.id)}
              />)}
            {!motion.rows.length && !motion.showSkeleton && <TableRow data-slot="data-table-empty" aria-live="polite">
              <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                {loading ? loadingState ?? 'Loading records…' : emptyState ?? 'No results.'}
                {!loading && props.onClearFilters && <Button type="button" size="sm" variant="ghost" onClick={props.onClearFilters}>Clear filters</Button>}
              </TableCell>
            </TableRow>}
          </TableBody>
          {motion.showSkeleton && <TableBody data-slot="data-table-skeleton-body" role="presentation">
            <DataTableSkeletonRows columns={columns} count={pagination.pageSize} selectable={selectable} hasActions={hasActions} />
          </TableBody>}
        </DataTableMotionSnapshotBridge>
      </Table>
      <DataTableSkeletonReveal active={motion.initialReveal && animated} body={motion.bodyRef} frame={motion.containerRef}
        types={[...(selectable ? ['boolean'] : []), ...columns.map(column => (column.columnDef.meta as ColumnPresentation)?.fieldMeta?.type), ...(hasActions ? ['boolean'] : [])]} />
    </div>
    <ScrollBar orientation="horizontal" />
  </ScrollArea>;
}

function columnStyle(width: number, meta: ColumnPresentation | undefined): React.CSSProperties | undefined {
  return meta?.flex ? undefined : { width };
}
