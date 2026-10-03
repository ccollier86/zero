'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Database, LoaderCircle } from 'lucide-react';
import type {
  DataStudioColumn,
  DataStudioRow,
  DataStudioTable,
  DataStudioValue,
} from '../../frontend/client/data-studio-client';
import { dataStudioCellValue } from '../../frontend/client/data-studio-client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { cn } from '../../lib/utils';
import { DataStudioInlineCell } from './data-studio-inline-cell';

export interface DataStudioGridProps {
  readonly table: DataStudioTable | null;
  readonly rows: readonly DataStudioRow[];
  readonly selectedRowId: string | null;
  readonly editable: boolean;
  readonly loading?: boolean;
  readonly sortColumnId?: string | null;
  readonly sortDirection?: 'asc' | 'desc';
  readonly onSelectRow: (rowId: string) => void;
  readonly onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  readonly onCommit: (
    row: DataStudioRow,
    column: DataStudioColumn,
    value: DataStudioValue,
  ) => Promise<unknown>;
  readonly onReload: () => Promise<unknown>;
  readonly className?: string;
}

/** Render the server-paged logical row grid with true in-cell editing. */
export function DataStudioGrid({
  table,
  rows,
  selectedRowId,
  editable,
  loading = false,
  sortColumnId,
  sortDirection = 'asc',
  onSelectRow,
  onSort,
  onCommit,
  onReload,
  className,
}: DataStudioGridProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const columns = table?.schema.columns ?? [];
  const navigate = React.useCallback((ordinal: number, direction: -1 | 1) => {
    const cells = rootRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-data-studio-cell="true"]:not(:disabled)',
    );
    if (!cells?.length) return;
    const target = Math.max(0, Math.min(cells.length - 1, ordinal + direction));
    cells.item(target).focus();
  }, []);

  if (!table) {
    return (
      <GridState
        icon={<Database className="size-5" aria-hidden="true" />}
        title="Choose a table"
        description="Select an organization table to browse its records."
      />
    );
  }

  if (loading && rows.length === 0) {
    return (
      <GridState
        icon={<LoaderCircle className="size-5 animate-spin" aria-hidden="true" />}
        title="Loading records"
        description={`Reading ${table.name} from this organization.`}
      />
    );
  }

  if (columns.length === 0) {
    return (
      <GridState
        icon={<Database className="size-5" aria-hidden="true" />}
        title="No columns yet"
        description="Add a column in the Schema inspector before creating records."
      />
    );
  }

  if (rows.length === 0) {
    return (
      <GridState
        icon={<Database className="size-5" aria-hidden="true" />}
        title="No matching records"
        description="Create a record or change the current search."
      />
    );
  }

  return (
    <div
      ref={rootRef}
      data-slot="data-studio-grid"
      className={cn('relative min-h-0 overflow-auto', className)}
      aria-busy={loading}
    >
      <Table className="table-fixed" aria-label={`${table.name} records`}>
        <TableHeader className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <TableRow>
            {columns.map((column) => {
              if (column.type === 'json') {
                return (
                  <TableHead key={column.columnId} className="min-w-36 px-2 first:pl-3">
                    <span className="block truncate">{column.label}</span>
                    <span className="sr-only">{column.type}; sorting unavailable</span>
                  </TableHead>
                );
              }
              const sorted = sortColumnId === column.columnId;
              const nextDirection = sorted && sortDirection === 'asc' ? 'desc' : 'asc';
              const SortIcon = sorted
                ? sortDirection === 'asc' ? ArrowUp : ArrowDown
                : ArrowUpDown;
              return (
                <TableHead
                  key={column.columnId}
                  className="min-w-36 px-2 first:pl-3"
                  aria-sort={sorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {onSort ? (
                    <button
                      type="button"
                      className="flex max-w-full items-center gap-1 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                      onClick={() => onSort(column.columnId, nextDirection)}
                      aria-label={`Sort by ${column.label}${sorted ? `, currently ${sortDirection}` : ''}`}
                    >
                      <span className="truncate">{column.label}</span>
                      <SortIcon className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                    </button>
                  ) : <span className="block truncate">{column.label}</span>}
                  <span className="sr-only">{column.type}</span>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => {
            const selected = row.rowId === selectedRowId;
            return (
              <TableRow
                key={row.rowId}
                data-state={selected ? 'selected' : undefined}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelectRow(row.rowId)}
              >
                {columns.map((column, columnIndex) => {
                  const ordinal = (rowIndex * columns.length) + columnIndex;
                  return (
                    <TableCell
                      key={column.columnId}
                      className="h-9 min-w-36 overflow-hidden px-1 py-0 first:pl-2"
                    >
                      <DataStudioInlineCell
                        value={dataStudioCellValue(row, column.columnId)}
                        column={column}
                        revision={row.revision}
                        disabled={!editable}
                        selected={selected}
                        onSelect={() => onSelectRow(row.rowId)}
                        onCommit={(value) => onCommit(row, column, value)}
                        onReload={onReload}
                        onNavigate={(direction) => navigate(ordinal, direction)}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {loading && rows.length > 0 && (
        <div className="pointer-events-none absolute right-3 top-12 z-30 flex items-center gap-1 rounded-full border bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm" role="status">
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          Refreshing
        </div>
      )}
    </div>
  );
}

function GridState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full min-h-56 items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {icon}
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
