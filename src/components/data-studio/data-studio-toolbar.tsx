'use client';

import * as React from 'react';
import { Filter, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react';
import type {
  DataStudioTableSummary,
  DataStudioTableStatus,
} from '../../frontend/client/data-studio-client';
import { Button } from '../ui/button';
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
      role="group"
      aria-label="Data Studio controls"
      className={cn(
        'flex flex-col gap-2 border-b bg-background p-2 sm:flex-row sm:flex-wrap sm:items-center',
        className,
      )}
    >
      <Select value={selectedTableId ?? undefined} disabled={busy} onValueChange={onTableChange}>
        <SelectTrigger className="h-8 min-w-0 sm:w-52" aria-label="Logical table">
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

      <div className="relative min-w-0 flex-1 sm:min-w-48">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={search}
          maxLength={200}
          disabled={busy}
          className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          placeholder="Search records"
          aria-label="Search records"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <Select value={tableStatus} disabled={busy} onValueChange={(value) => {
        onStatusChange(value as DataStudioTableStatus | 'all');
      }}>
        <SelectTrigger className="h-8 w-full sm:w-32" aria-label="Table status filter">
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

      <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground lg:inline" aria-live="polite">
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
    </div>
  );
}
