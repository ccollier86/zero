'use client';

/** Table footer presentation and scoped control callbacks; source/controller retain query and count authority. */
import * as React from 'react';
import type { Table } from '@tanstack/react-table';
import { useReducedMotion } from 'motion/react';
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
import { selectedDataTablePageRows } from './data-table-selection';
import { DataTableRollingNumber } from './data-table-rolling-number';
import { DataTableNewRecordsButton } from './data-table-new-records-button';
import { DATA_TABLE_MOTION } from './data-table-motion-tokens';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizes?: number[];
  className?: string;
  /** Absent for local row models; a null value means the server page is not loaded yet. */
  serverPage?: DataTableServerPage | null;
  loading?: boolean;
  /** Authoritative newly held records; no count is inferred from reactive writes. */
  newCount?: number;
  onRevealNew?: () => void;
  /** Hover/focus intent only; the source owns authorization, admission, caching and cancellation. */
  onPrefetchPage?: (pageIndex: number) => void | Promise<void>;
  onPageNavigate?: (pageIndex: number, origin: 'pointer' | 'keyboard') => void;
  /** Optional table-focus arrow navigation, never a document/global listener. */
  keyboardNavigation?: boolean;
  motionEnabled?: boolean;
  /** Original count before filtering, only when genuinely known by the caller. */
  unfilteredTotal?: number;
  /** Complete-data matching total including held arrivals; does not fabricate extra navigable pages. */
  totalCountOverride?: number;
  /** Outer focus-scoped navigation can pass the same keyboard speed factor as the footer's local handler. */
  motionDurationFactor?: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DataTablePagination<TData>({
  table,
  pageSizes = [10, 20, 50, 100],
  className,
  serverPage,
  loading = false,
  newCount = 0,
  onRevealNew,
  onPrefetchPage,
  onPageNavigate,
  keyboardNavigation = false,
  motionEnabled = true,
  unfilteredTotal,
  totalCountOverride,
  motionDurationFactor,
}: DataTablePaginationProps<TData>) {
  const reduced = useReducedMotion();
  const animate = motionEnabled && !reduced;
  const [durationFactor, setDurationFactor] = React.useState(1);
  const prefetchScope = React.useRef({ table, callback: onPrefetchPage, mounted: true, revision: 0 });
  if (prefetchScope.current.table !== table || prefetchScope.current.callback !== onPrefetchPage) {
    prefetchScope.current = { table, callback: onPrefetchPage, mounted: prefetchScope.current.mounted, revision: prefetchScope.current.revision + 1 };
  }
  React.useEffect(() => { prefetchScope.current.mounted = true; return () => {
    prefetchScope.current.mounted = false; prefetchScope.current.revision++;
  }; }, []);
  const { pageIndex, pageSize } = table.getState().pagination;
  const server = serverPage !== undefined;
  const navigableTotal = server ? serverPage?.total : table.getFilteredRowModel().rows.length;
  const totalRows = !server && Number.isSafeInteger(totalCountOverride) && totalCountOverride! >= 0 ? totalCountOverride : navigableTotal;
  const count = table.getRowModel().rows.length;
  const [countReady, setCountReady] = React.useState(!loading || count > 0);
  if (!countReady && (!loading || count > 0)) setCountReady(true);
  const offset = serverPage?.mode === 'offset' ? serverPage.offset : pageIndex * pageSize;
  const start = offset + 1;
  const end = offset + count;
  const cursor = serverPage?.mode === 'cursor';
  const pageCount = navigableTotal === undefined || cursor ? undefined : Math.ceil(navigableTotal / pageSize);
  const canPrevious = pageIndex > 0;
  const canNext = (server
    ? Boolean(serverPage?.hasMore) && (serverPage?.mode !== 'cursor' || serverPage.nextCursor != null)
    : table.getCanNextPage());
  const canJumpToLast = pageCount !== undefined && pageCount > 0;
  const selectedCount = selectedDataTablePageRows(table).length;
  const countLabel = count > 0 ? cursor ? `${count} records on this page`
    : `Showing ${start}-${end}${totalRows === undefined ? '' : ` of ${totalRows}`}`
    : loading ? 'Loading records…' : 'No results';
  const visiblePage = pageCount === 0 ? 0 : pageIndex + 1;
  const pageLabel = `Page ${visiblePage}${pageCount === undefined ? '' : ` of ${pageCount}`}`;
  const heldCount = Number.isSafeInteger(newCount) && newCount > 0 ? newCount : 0;
  const navigate = (target: number, origin: 'pointer' | 'keyboard', relative?: -1 | 1) => {
    setDurationFactor(origin === 'keyboard' ? DATA_TABLE_MOTION.keyboardFactor : 1);
    if (relative === 1) table.nextPage(); else if (relative === -1) table.previousPage(); else table.setPageIndex(target);
    onPageNavigate?.(target, origin);
  };
  const prefetch = (target: number) => {
    const scope = prefetchScope.current, revision = scope.revision;
    if (!onPrefetchPage || !scope.mounted || scope.table !== table || scope.callback !== onPrefetchPage) return;
    const report = (cause: unknown) => {
      if (prefetchScope.current !== scope || !scope.mounted || scope.revision !== revision
        || (cause instanceof Error && cause.name === 'AbortError')) return;
      emitFrontendCode(OBS_CODES.FRONTEND_DATA_PAGE_FAILED, { metadata: { component: 'DataTablePagination', stage: 'prefetch' } });
    };
    try {
      void Promise.resolve(onPrefetchPage(target)).catch(report);
    } catch (cause) { report(cause); }
  };

  return (
    <div
      data-slot="data-table-pagination"
      data-motion={animate ? 'true' : 'false'}
      onKeyDown={event => {
        if (!keyboardNavigation || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
          || event.nativeEvent.isComposing || (event.target as HTMLElement).closest('input, textarea, select, [role="combobox"], [role="menu"], [contenteditable="true"]')) return;
        const next = event.key === 'ArrowRight' && canNext ? pageIndex + 1 : event.key === 'ArrowLeft' && canPrevious ? pageIndex - 1 : null;
        if (next !== null) { event.preventDefault(); navigate(next, 'keyboard', event.key === 'ArrowRight' ? 1 : -1); }
      }}
      className={cn(
        'flex min-w-0 flex-col gap-3 px-2 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between',
        className,
      )}
    >
      {/* Row count */}
      {pageCount !== undefined && pageCount > 0 && <div data-slot="data-table-page-track" aria-hidden="true">
        <div data-slot="data-table-page-progress" style={{ transform: `scaleX(${Math.min(pageIndex + 1, pageCount) / pageCount})` }} />
      </div>}
      <div data-slot="data-table-page-count" data-ready={countReady ? 'true' : 'false'} role="status" aria-label={countLabel}
        className="min-w-0 text-sm text-muted-foreground sm:flex-1">
        <span aria-hidden="true">{count > 0 ? cursor
          ? <><DataTableRollingNumber value={count} motionEnabled={animate} /> records on this page</>
          : <>Showing {start}-{end}
            {totalRows !== undefined && <> of <DataTableRollingNumber value={totalRows} motionEnabled={animate} /></>}</>
          : countLabel}</span>
        {unfilteredTotal !== undefined && Number.isSafeInteger(unfilteredTotal) && totalRows !== undefined && unfilteredTotal > totalRows && (
          <span> · filtered from {unfilteredTotal.toLocaleString('en-US')}</span>
        )}
        {selectedCount > 0 && (
          <span className="ml-2">
            ({selectedCount} selected)
          </span>
        )}
      </div>

      {heldCount > 0 && onRevealNew && <DataTableNewRecordsButton count={heldCount} onReveal={onRevealNew} motionEnabled={animate} />}

      <div data-slot="data-table-page-controls" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end lg:gap-x-6">
        {/* Rows per page */}
        <div data-slot="data-table-page-size" className="flex items-center gap-2">
          <span data-slot="data-table-page-size-label" className="text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
          <Select
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
        <div data-slot="data-table-page-number" role="group" aria-label={pageLabel} className="flex items-center text-sm text-muted-foreground whitespace-nowrap">
          <span aria-hidden="true">Page <DataTableRollingNumber value={visiblePage} motionEnabled={animate} durationFactor={motionDurationFactor ?? durationFactor} />
            {pageCount !== undefined && <> of <DataTableRollingNumber value={pageCount} motionEnabled={animate} /></>}</span>
        </div>

        {/* Navigation buttons */}
        <div data-slot="data-table-page-buttons" className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label="First page"
            onClick={() => navigate(0, 'pointer')}
            onPointerEnter={() => { if (canPrevious) prefetch(0); }} onFocus={() => { if (canPrevious) prefetch(0); }}
            disabled={!canPrevious}
          >
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label="Previous page"
            onClick={() => navigate(pageIndex - 1, 'pointer', -1)}
            onPointerEnter={() => { if (canPrevious) prefetch(pageIndex - 1); }} onFocus={() => { if (canPrevious) prefetch(pageIndex - 1); }}
            disabled={!canPrevious}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label="Next page"
            onClick={() => navigate(pageIndex + 1, 'pointer', 1)}
            onPointerEnter={() => { if (canNext) prefetch(pageIndex + 1); }} onFocus={() => { if (canNext) prefetch(pageIndex + 1); }}
            disabled={!canNext}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          {canJumpToLast && <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label="Last page"
            onClick={() => navigate(pageCount! - 1, 'pointer')}
            onPointerEnter={() => { if (canNext) prefetch(pageCount! - 1); }} onFocus={() => { if (canNext) prefetch(pageCount! - 1); }}
            disabled={!canNext}
          >
            <ChevronsRight className="size-3.5" />
          </Button>}
        </div>
      </div>
    </div>
  );
}
