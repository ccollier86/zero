/**
 * data-table-toolbar.tsx
 *
 * Renders DataTable search, generated field filters, column visibility, export,
 * and caller-provided toolbar actions. This file owns toolbar UI only; it does
 * not fetch data or mutate table rows.
 */

'use client';

import * as React from 'react';
import type { Column, Table } from '@tanstack/react-table';
import { X, Columns3 } from 'lucide-react';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { Search } from '#zero/components/animate-ui/icons/search';
import { Download } from '#zero/components/animate-ui/icons/download';
import { Input } from '#zero/components/ui/input';
import { Button } from '#zero/components/ui/button';
import { Badge } from '#zero/components/ui/badge';
import type { FieldMeta } from '../../schema/field-types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '#zero/components/animate-ui/components/radix/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  searchable?: boolean;
  filterable?: boolean;
  filterColumns?: string[];
  showColumnVisibility?: boolean;
  showExport?: boolean;
  exportFilename?: string;
  actions?: React.ReactNode;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTableToolbar<TData>({
  table,
  globalFilter,
  onGlobalFilterChange,
  searchable = true,
  filterable = false,
  filterColumns,
  showColumnVisibility = true,
  showExport = true,
  exportFilename = 'export.csv',
  actions,
  className,
}: DataTableToolbarProps<TData>) {
  const activeFilters = table.getState().columnFilters;
  const hasFilters = activeFilters.length > 0 || globalFilter.length > 0;
  const filterColumnSet = React.useMemo(
    () => filterColumns ? new Set(filterColumns) : null,
    [filterColumns],
  );
  const filterableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanFilter())
    .filter((column) => !filterColumnSet || filterColumnSet.has(column.id));

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                <Search size={16} />
              </span>
              <Input
                placeholder="Search..."
                value={globalFilter}
                onChange={(event) => onGlobalFilterChange(event.target.value)}
                className="h-8 w-[min(18rem,100%)] pl-8"
              />
              {globalFilter && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => onGlobalFilterChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}

          {activeFilters.map((filter) => (
            <Badge key={filter.id} variant="secondary" className="gap-1">
              {getColumnLabel(table.getColumn(filter.id), filter.id)}: {String(filter.value)}
              <button
                type="button"
                aria-label={`Clear ${filter.id} filter`}
                onClick={() => table.getColumn(filter.id)?.setFilterValue(undefined)}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                table.resetColumnFilters();
                onGlobalFilterChange('');
              }}
              className="h-7 text-xs"
            >
              Clear
            </Button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {actions}

          {showColumnVisibility && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1">
                  <Columns3 className="size-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[150px]">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    >
                      {getColumnLabel(column, column.id)}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {showExport && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => exportCsv(table, exportFilename)}
            >
              <AnimateIcon animateOnHover><Download size={14} /></AnimateIcon>
              Export
            </Button>
          )}
        </div>
      </div>

      {filterable && filterableColumns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filterableColumns.map((column) => (
            <ColumnFilter key={column.id} column={column} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Filter Controls ────────────────────────────────────────────────────────

function ColumnFilter<TData>({ column }: { column: Column<TData, unknown> }) {
  const meta = (column.columnDef.meta as { fieldMeta?: FieldMeta } | undefined)?.fieldMeta;
  const label = getColumnLabel(column, column.id);
  const value = column.getFilterValue();

  if (meta?.type === 'boolean') {
    return (
      <Select
        value={value === undefined ? '__all' : String(value)}
        onValueChange={(next) => {
          column.setFilterValue(next === '__all' ? undefined : next === 'true');
        }}
      >
        <SelectTrigger className="h-8 w-[9rem]">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{label}: All</SelectItem>
          <SelectItem value="true">{label}: Yes</SelectItem>
          <SelectItem value="false">{label}: No</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if ((meta?.type === 'select' || meta?.type === 'enum' || meta?.type === 'combobox') && meta.options) {
    return (
      <Select
        value={typeof value === 'string' ? value : '__all'}
        onValueChange={(next) => {
          column.setFilterValue(next === '__all' ? undefined : next);
        }}
      >
        <SelectTrigger className="h-8 w-[12rem]">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{label}: All</SelectItem>
          {meta.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (meta?.type === 'number') {
    return (
      <Input
        type="number"
        value={value == null ? '' : String(value)}
        placeholder={label}
        onChange={(event) => {
          const next = event.target.value;
          column.setFilterValue(next === '' ? undefined : Number(next));
        }}
        className="h-8 w-[10rem]"
      />
    );
  }

  if (meta?.type === 'date' || meta?.type === 'datetime') {
    return (
      <Input
        type="date"
        value={typeof value === 'string' ? value : ''}
        placeholder={label}
        onChange={(event) => {
          column.setFilterValue(event.target.value || undefined);
        }}
        className="h-8 w-[10rem]"
      />
    );
  }

  return (
    <Input
      value={value == null ? '' : String(value)}
      placeholder={label}
      onChange={(event) => {
        column.setFilterValue(event.target.value || undefined);
      }}
      className="h-8 w-[12rem]"
    />
  );
}

function getColumnLabel<TData>(
  column: Column<TData, unknown> | undefined,
  fallback: string,
): string {
  if (!column) return fallback;
  return typeof column.columnDef.header === 'string'
    ? column.columnDef.header
    : fallback;
}

// ─── CSV Export ─────────────────────────────────────────────────────────────

function exportCsv<TData>(table: Table<TData>, filename: string) {
  const headers = table
    .getVisibleFlatColumns()
    .map((column) =>
      typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
    );

  const rows = table.getFilteredRowModel().rows.map((row) =>
    table.getVisibleFlatColumns().map((column) => {
      const value = row.getValue(column.id);
      return escapeCsv(String(value ?? ''));
    }),
  );

  const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
