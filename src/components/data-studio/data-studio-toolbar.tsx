'use client';

/** Search-first catalog and record controls; data loading stays in the controller. */

import * as React from 'react';
import { Filter, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import type {
  DataStudioTableSummary,
  DataStudioTableStatus,
} from '../../frontend/client/data-studio-client';
import { Button } from '../ui/button';
import { DataTableControls } from '../data-table/data-table-controls';
import { DataTableSearch } from '../data-table/data-table-search';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../../lib/utils';

export interface DataStudioToolbarProps {
  readonly tables: readonly DataStudioTableSummary[];
  readonly selectedTableId: string | null;
  readonly tableStatus: DataStudioTableStatus | 'all';
  readonly search: string;
  readonly loadedCount: number;
  readonly totalRows: number;
  readonly canManage: boolean;
  /** Extensible server-backed row-filter control. */
  readonly filterControl?: React.ReactNode;
  readonly loading?: boolean;
  readonly busy?: boolean;
  readonly onTableChange: (tableId: string) => void;
  readonly onStatusChange: (status: DataStudioTableStatus | 'all') => void;
  readonly onSearchChange: (value: string) => void;
  readonly onCreateTable: () => void;
  readonly onRefresh: () => void;
  readonly className?: string;
}

/** Compact server-backed table, search, and lifecycle controls. */
export function DataStudioToolbar({
  tables,
  selectedTableId,
  tableStatus,
  search,
  loadedCount,
  totalRows,
  canManage,
  filterControl,
  loading = false,
  busy = false,
  onTableChange,
  onStatusChange,
  onSearchChange,
  onCreateTable,
  onRefresh,
  className,
}: DataStudioToolbarProps) {
  return (
    <div
      data-slot="data-studio-toolbar"
      className={cn(
        'min-w-0 border-b bg-background px-3 py-2.5 sm:px-4',
        className,
      )}
    >
      <DataTableControls
        aria-label="Data Studio controls"
        search={(
          <DataTableSearch
            value={search}
            onValueChange={onSearchChange}
            label="Search records"
            placeholder="Search records…"
            maxLength={200}
            disabled={busy}
            collapsedWidth={112}
            expandedWidth={216}
            className="max-w-full"
          />
        )}
        controls={(
          <>
            <Select
              value={selectedTableId ?? undefined}
              disabled={busy}
              onValueChange={onTableChange}
            >
              <SelectTrigger className="h-8 min-w-0 w-52 max-w-full" aria-label="Logical table">
                <SelectValue placeholder={loading ? 'Loading tables…' : 'Choose a table'} />
              </SelectTrigger>
              <SelectContent>
                {tables.map((table) => (
                  <SelectItem key={table.tableId} value={table.tableId}>
                    {table.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={tableStatus} disabled={busy} onValueChange={(value) => {
              onStatusChange(value as DataStudioTableStatus | 'all');
            }}>
              <SelectTrigger className="h-8 w-32" aria-label="Table status filter">
                <Filter className="size-3.5" aria-hidden="true" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value="all">All tables</SelectItem>
              </SelectContent>
            </Select>

            {filterControl}
          </>
        )}
        actions={(
          <>
            <span
              className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground lg:inline"
              aria-live="polite"
            >
              {loadedCount} of {totalRows}
            </span>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2"
              disabled={loading || busy}
              aria-label="Refresh Data Studio"
              onClick={onRefresh}
            >
              {loading
                ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                : <RefreshCw className="size-3.5" aria-hidden="true" />}
              <span className="sr-only sm:not-sr-only">Refresh</span>
            </Button>

            {canManage && (
              <Button
                type="button"
                size="sm"
                className="h-8"
                aria-haspopup="dialog"
                disabled={busy}
                onClick={onCreateTable}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                New table
              </Button>
            )}
          </>
        )}
      />
    </div>
  );
}
