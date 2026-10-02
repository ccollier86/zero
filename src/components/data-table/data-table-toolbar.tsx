/**
 * data-table-toolbar.tsx
 *
 * Composes DataTable search, generated filters, active-filter feedback,
 * caller-provided control slots, column visibility, and export actions. This
 * file owns toolbar layout only; filter controls, search interaction, export
 * mechanics, and table state remain in their dedicated modules.
 */

'use client';

import * as React from 'react';
import type { ColumnFiltersState, Table } from '@tanstack/react-table';
import { Columns3, X } from 'lucide-react';

import { Download } from '@/components/animate-ui/icons/download';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/animate-ui/components/radix/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DataTableColumnFilter,
  getDataTableColumnLabel,
} from './data-table-column-filter';
import { exportDataTableCsv } from './data-table-export';
import {
  DataTableSearch,
  type DataTableSearchOptions,
} from './data-table-search';

export interface DataTableToolbarContext<TData> {
  /** TanStack instance for advanced, table-aware controls. */
  table: Table<TData>;
  /** Current global search query. */
  query: string;
  /** Update the global search query. */
  setQuery: (value: string) => void;
  /** Active TanStack column filters. */
  columnFilters: ColumnFiltersState;
  /** Number of active column filters, excluding global search. */
  activeFilterCount: number;
  /** Whether one or more column filters are active. */
  hasActiveFilters: boolean;
  /** Whether the global search query is non-empty. */
  hasActiveSearch: boolean;
  /** Clear global search and every client-side column filter. */
  clearAll: () => void;
  /** IDs of rows currently selected by TanStack. */
  selectedRowIds: readonly string[];
  /** Original row values currently selected by TanStack. */
  selectedRows: readonly TData[];
  /** Number of currently selected rows. */
  selectedRowCount: number;
}

export type DataTableToolbarSlot<TData> =
  | React.ReactNode
  | ((context: DataTableToolbarContext<TData>) => React.ReactNode);

/** Flexible insertion points around the built-in table controls. */
export interface DataTableToolbarSlots<TData> {
  /** Controls beside search and generated schema filters. */
  controls?: DataTableToolbarSlot<TData>;
  /** Actions before the built-in Columns and Export buttons. */
  actions?: DataTableToolbarSlot<TData>;
  /** Full-width content below the primary toolbar row. */
  supplemental?: DataTableToolbarSlot<TData>;
}

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  searchable?: boolean | DataTableSearchOptions;
  filterable?: boolean;
  filterColumns?: string[];
  showColumnVisibility?: boolean;
  showExport?: boolean;
  exportFilename?: string;
  /** Legacy right-side action outlet. Prefer `slots.actions` for new code. */
  actions?: DataTableToolbarSlot<TData>;
  slots?: DataTableToolbarSlots<TData>;
  /** Accessible name for this group of table controls. */
  ariaLabel?: string;
  className?: string;
}

/** Render a responsive, composable control plane for a DataTable. */
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
  slots,
  ariaLabel = 'Table controls',
  className,
}: DataTableToolbarProps<TData>) {
  const activeFilters = table.getState().columnFilters;
  const filterColumnSet = React.useMemo(
    () => filterColumns ? new Set(filterColumns) : null,
    [filterColumns],
  );
  const filterableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanFilter())
    .filter((column) => !filterColumnSet || filterColumnSet.has(column.id));
  const clearAll = React.useCallback(() => {
    table.resetColumnFilters(true);
    onGlobalFilterChange('');
  }, [onGlobalFilterChange, table]);
  const selectedRows = table.getSelectedRowModel().rows;
  const context = React.useMemo<DataTableToolbarContext<TData>>(() => ({
    table,
    query: globalFilter,
    setQuery: onGlobalFilterChange,
    columnFilters: activeFilters,
    activeFilterCount: activeFilters.length,
    hasActiveFilters: activeFilters.length > 0,
    hasActiveSearch: globalFilter.length > 0,
    clearAll,
    selectedRowIds: selectedRows.map((row) => row.id),
    selectedRows: selectedRows.map((row) => row.original),
    selectedRowCount: selectedRows.length,
  }), [activeFilters, clearAll, globalFilter, onGlobalFilterChange, selectedRows, table]);
  const controlsSlot = resolveToolbarSlot(slots?.controls, context);
  const actionsSlot = resolveToolbarSlot(slots?.actions, context);
  const legacyActions = resolveToolbarSlot(actions, context);
  const supplementalSlot = resolveToolbarSlot(slots?.supplemental, context);
  const searchOptions = typeof searchable === 'object' ? searchable : undefined;
  const showSearch = searchable !== false;
  const showSecondary = supplementalSlot != null || activeFilters.length > 0;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="data-table-toolbar"
      className={cn('flex flex-col gap-2', className)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          data-slot="data-table-toolbar-left"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        >
          {showSearch && (
            <DataTableSearch
              value={globalFilter}
              onValueChange={onGlobalFilterChange}
              placeholder={searchOptions?.placeholder}
              label={searchOptions?.ariaLabel}
              collapsedWidth={searchOptions?.collapsedWidth}
              expandedWidth={searchOptions?.expandedWidth}
              disabled={searchOptions?.disabled}
            />
          )}

          {filterable && filterableColumns.map((column) => (
            <DataTableColumnFilter key={column.id} column={column} />
          ))}

          {controlsSlot}
        </div>

        <div
          data-slot="data-table-toolbar-right"
          className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end"
        >
          {actionsSlot}
          {legacyActions}

          {showColumnVisibility && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1">
                  <Columns3 className="size-3.5" aria-hidden="true" />
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
                      {getDataTableColumnLabel(column, column.id)}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {showExport && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => exportDataTableCsv(table, exportFilename)}
            >
              <AnimateIcon animateOnHover>
                <Download size={14} />
              </AnimateIcon>
              Export
            </Button>
          )}
        </div>
      </div>

      {showSecondary && (
        <div
          data-slot="data-table-toolbar-below"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {supplementalSlot}

          {activeFilters.map((filter) => {
            const label = getDataTableColumnLabel(
              table.getColumn(filter.id),
              filter.id,
            );
            return (
              <Badge key={filter.id} variant="secondary" className="gap-1">
                {label}: {formatFilterValue(filter.value)}
                <button
                  type="button"
                  aria-label={`Clear ${label} filter`}
                  onClick={() => table.getColumn(filter.id)?.setFilterValue(undefined)}
                  className="ml-0.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            );
          })}

          {(activeFilters.length > 0 || globalFilter.length > 0) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-7 text-xs"
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function resolveToolbarSlot<TData>(
  slot: DataTableToolbarSlot<TData> | undefined,
  context: DataTableToolbarContext<TData>,
): React.ReactNode {
  return typeof slot === 'function' ? slot(context) : slot;
}

function formatFilterValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return String(value ?? '');
}
