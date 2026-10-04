import * as React from 'react';
import type { Table } from '@tanstack/react-table';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { Button } from '#zero/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import type { DataTableServerPage } from './data-table-server-types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizes?: number[];
  className?: string;
  /** Absent for local row models; a null value means the server page is not loaded yet. */
  serverPage?: DataTableServerPage | null;
  loading?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTablePagination<TData>({
  table,
  pageSizes = [10, 20, 50, 100],
  className,
  serverPage,
  loading = false,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const server = serverPage !== undefined;
  const totalRows = server ? serverPage?.total : table.getFilteredRowModel().rows.length;
  const count = server ? table.getRowModel().rows.length : Math.min(pageSize, Math.max(0, totalRows! - pageIndex * pageSize));
  const offset = serverPage?.mode === 'offset' ? serverPage.offset : pageIndex * pageSize;
  const start = offset + 1;
  const end = offset + count;
  const pageCount = totalRows === undefined ? undefined : Math.max(1, Math.ceil(totalRows / pageSize));
  const canPrevious = pageIndex > 0 && !loading;
  const canNext = !loading && (server
    ? Boolean(serverPage?.hasMore) && (serverPage?.mode !== 'cursor' || serverPage.nextCursor != null)
    : table.getCanNextPage());
  const canJumpToLast = pageCount !== undefined && serverPage?.mode !== 'cursor';

  return (
    <div
      data-slot="data-table-pagination"
      className={cn(
        'flex min-w-0 flex-col gap-3 px-2 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between',
        className,
      )}
    >
      {/* Row count */}
      <div className="min-w-0 text-sm text-muted-foreground sm:flex-1">
        {count > 0
          ? `Showing ${start}-${end}${totalRows === undefined ? '' : ` of ${totalRows}`}`
          : loading ? 'Loading records…' : 'No results'}
        {table.getFilteredSelectedRowModel().rows.length > 0 && (
          <span className="ml-2">
            ({table.getFilteredSelectedRowModel().rows.length} selected)
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end lg:gap-x-6">
        {/* Rows per page */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
          <Select
            disabled={loading}
            value={String(pageSize)}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger aria-label="Rows per page" className="h-8 w-[70px]">
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
          Page {pageIndex + 1}{pageCount === undefined ? '' : ` of ${pageCount}`}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label="First page"
            onClick={() => table.setPageIndex(0)}
            disabled={!canPrevious}
          >
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label="Previous page"
            onClick={() => table.previousPage()}
            disabled={!canPrevious}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label="Next page"
            onClick={() => table.nextPage()}
            disabled={!canNext}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          {canJumpToLast && <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label="Last page"
            onClick={() => table.setPageIndex(pageCount! - 1)}
            disabled={!canNext}
          >
            <ChevronsRight className="size-3.5" />
          </Button>}
        </div>
      </div>
    </div>
  );
}
