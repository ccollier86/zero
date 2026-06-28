'use client';

import * as React from 'react';
import type { Table } from '@tanstack/react-table';
import { X, Columns3 } from 'lucide-react';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Search } from '@/components/animate-ui/icons/search';
import { Download } from '@/components/animate-ui/icons/download';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/animate-ui/components/radix/dropdown-menu';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  searchable?: boolean;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTableToolbar<TData>({
  table,
  globalFilter,
  onGlobalFilterChange,
  searchable = true,
  className,
}: DataTableToolbarProps<TData>) {
  const activeFilters = table.getState().columnFilters;
  const hasFilters = activeFilters.length > 0 || globalFilter.length > 0;

  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <div className="flex flex-1 items-center gap-2">
        {/* Global search */}
        {searchable && (
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <Search size={16} />
            </span>
            <Input
              placeholder="Search..."
              value={globalFilter}
              onChange={(e) => onGlobalFilterChange(e.target.value)}
              className="h-8 w-[200px] pl-8 lg:w-[280px]"
            />
            {globalFilter && (
              <button
                onClick={() => onGlobalFilterChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Active filter pills */}
        {activeFilters.map((filter) => (
          <Badge key={filter.id} variant="secondary" className="gap-1">
            {filter.id}: {String(filter.value)}
            <button
              onClick={() => table.getColumn(filter.id)?.setFilterValue(undefined)}
              className="ml-0.5 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}

        {/* Clear all filters */}
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

      <div className="flex items-center gap-2">
        {/* Column visibility */}
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
              .filter((col) => col.getCanHide())
              .map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(value) => col.toggleVisibility(!!value)}
                >
                  {typeof col.columnDef.header === 'string'
                    ? col.columnDef.header
                    : col.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* CSV Export */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={() => exportCsv(table)}
        >
          <AnimateIcon animateOnHover><Download size={14} /></AnimateIcon>
          Export
        </Button>
      </div>
    </div>
  );
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

function exportCsv<TData>(table: Table<TData>) {
  const headers = table
    .getVisibleFlatColumns()
    .map((col) =>
      typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id,
    );

  const rows = table.getFilteredRowModel().rows.map((row) =>
    table.getVisibleFlatColumns().map((col) => {
      const value = row.getValue(col.id);
      return escapeCsv(String(value ?? ''));
    }),
  );

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
