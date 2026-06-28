import * as React from 'react';
import type { Table } from '@tanstack/react-table';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizes?: number[];
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTablePagination<TData>({
  table,
  pageSizes = [10, 20, 50, 100],
  className,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const totalRows = table.getFilteredRowModel().rows.length;
  const start = pageIndex * pageSize + 1;
  const end = Math.min(start + pageSize - 1, totalRows);

  return (
    <div className={cn('flex items-center justify-between px-2 py-2', className)}>
      {/* Row count */}
      <div className="flex-1 text-sm text-muted-foreground">
        {totalRows > 0
          ? `Showing ${start}-${end} of ${totalRows}`
          : 'No results'}
        {table.getFilteredSelectedRowModel().rows.length > 0 && (
          <span className="ml-2">
            ({table.getFilteredSelectedRowModel().rows.length} selected)
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 lg:gap-6">
        {/* Rows per page */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page info */}
        <div className="flex items-center text-sm text-muted-foreground whitespace-nowrap">
          Page {pageIndex + 1} of {table.getPageCount() || 1}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
