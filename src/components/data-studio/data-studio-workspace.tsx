'use client';

import * as React from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Database, LoaderCircle, Trash2 } from 'lucide-react';
import {
  resolveDataStudioAccess,
  type DataStudioAccess,
  type UseDataStudioResult,
} from '../../frontend/client/data-studio-hooks';
import type {
  DataStudioColumn,
  DataStudioValue,
} from '../../frontend/client/data-studio-client';
import { Button } from '../ui/button';
import { ListDetailLayout } from '../ui/list-detail-layout';
import { RecordNavigationBar } from '../ui/record-navigation-bar';
import { cn } from '../../lib/utils';
import {
  DataStudioConfirmDialog,
  DataStudioRowDialog,
  DataStudioTableDialog,
} from './data-studio-dialogs';
import { DataStudioGrid } from './data-studio-grid';
import { DataStudioFilterControl } from './data-studio-filter-control';
import { DataStudioInspector } from './data-studio-inspector';
import { DataStudioToolbar } from './data-studio-toolbar';

export interface DataStudioWorkspaceProps {
  readonly controller: UseDataStudioResult;
  /** UI-only narrowing. `true` never widens a permission denied by the server. */
  readonly capabilities?: Partial<DataStudioAccess>;
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
  readonly emptyState?: React.ReactNode;
}

/** Adaptive organization Table Studio composed around one ListDetailLayout. */
export function DataStudioWorkspace({
  controller,
  capabilities: capabilityNarrowing,
  title = 'Data Studio',
  description = 'Build logical tables and work with organization records.',
  className,
  emptyState,
}: DataStudioWorkspaceProps) {
  const access = React.useMemo(
    () => resolveDataStudioAccess(controller.capabilities, capabilityNarrowing),
    [capabilityNarrowing, controller.capabilities],
  );
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false);
  const [createTableOpen, setCreateTableOpen] = React.useState(false);
  const [editTableOpen, setEditTableOpen] = React.useState(false);
  const [createRowOpen, setCreateRowOpen] = React.useState(false);
  const [deleteRowOpen, setDeleteRowOpen] = React.useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);

  React.useEffect(() => {
    if (!controller.selectedRow) setMobileDetailOpen(false);
  }, [controller.selectedRow]);

  const selectRow = React.useCallback((rowId: string) => {
    controller.selectRow(rowId);
    setMobileDetailOpen(true);
  }, [controller.selectRow]);

  const refresh = React.useCallback(() => {
    void Promise.all([controller.reload(), controller.reloadRows()]);
  }, [controller.reload, controller.reloadRows]);

  if (controller.status !== 'ready') {
    return (
      <DataStudioBoundaryState
        status={controller.status}
        error={controller.error}
        onRetry={() => { void controller.reload(); }}
        className={className}
      >
        {emptyState}
      </DataStudioBoundaryState>
    );
  }

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <DataStudioToolbar
        tables={controller.tables}
        selectedTableId={controller.selectedTableId}
        tableStatus={controller.tableStatus}
        search={controller.search}
        loadedCount={controller.rows.length}
        totalRows={controller.totalRows}
        canManage={access.canManage}
        filterControl={(
          <DataStudioFilterControl
            columns={controller.selectedTable?.schema.columns ?? []}
            filters={controller.filters}
            disabled={controller.isMutating}
            onChange={controller.setFilters}
          />
        )}
        loading={controller.isLoading || controller.isLoadingRows}
        busy={controller.isMutating}
        onTableChange={controller.selectTable}
        onStatusChange={controller.setTableStatus}
        onSearchChange={controller.setSearch}
        onCreateTable={() => setCreateTableOpen(true)}
        onRefresh={refresh}
      />
      {(controller.error || controller.mutationError) && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 truncate">
            {(controller.mutationError ?? controller.error)?.message}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={refresh}>Retry</Button>
        </div>
      )}
      <DataStudioGrid
        className="min-h-0 flex-1"
        table={controller.selectedTable}
        rows={controller.rows}
        selectedRowId={controller.selectedRowId}
        editable={access.canWrite
          && controller.selectedTable?.status === 'active'
          && !controller.isMutating}
        loading={controller.isLoadingRows}
        sortColumnId={controller.sortColumnId}
        sortDirection={controller.sortDirection}
        onSelectRow={selectRow}
        onSort={controller.setSort}
        onCommit={(row, column, value) => controller.updateCell(row, column.columnId, value)}
        onReload={controller.reloadRows}
      />
    </div>
  );

  const detail = (
    <DataStudioInspector
      table={controller.selectedTable}
      row={controller.selectedRow}
      canManage={access.canManage}
      busy={controller.isMutating}
      onEditSchema={() => setEditTableOpen(true)}
      onChangeStatus={() => setStatusDialogOpen(true)}
    />
  );

  return (
    <section
      data-slot="data-studio"
      className={cn('flex min-h-[36rem] flex-col gap-3', className)}
      aria-busy={controller.isLoading || controller.isLoadingRows || controller.isMutating}
    >
      <header className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
            <p className="truncate text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-sm">
        <ListDetailLayout
          list={list}
          detail={detail}
          hasSelection={controller.selectedRow !== null}
          mobileDetailOpen={mobileDetailOpen}
          onMobileBack={() => setMobileDetailOpen(false)}
          mobileBackLabel="Back to records"
          selectedKey={controller.selectedRow?.rowId ?? controller.selectedTable?.tableId}
          listWidth="minmax(0, 3fr)"
          detailWidth="minmax(18rem, 2fr)"
          bottomBar={(
            <div className="flex min-w-0 flex-col gap-1 p-2 lg:flex-row lg:items-center">
              <RecordNavigationBar
                className="min-w-0 flex-1"
                currentIndex={Math.max(0, controller.selectedRowIndex)}
                totalCount={controller.rows.length}
                onPrevious={() => {
                  controller.selectPreviousRow();
                  setMobileDetailOpen(true);
                }}
                onNext={() => {
                  controller.selectNextRow();
                  setMobileDetailOpen(true);
                }}
                actions={access.canWrite
                  && controller.selectedTable?.status === 'active'
                  && controller.selectedRow ? [{
                  icon: <Trash2 className="size-4" aria-hidden="true" />,
                  label: 'Delete record',
                  variant: 'destructive',
                  disabled: controller.isMutating,
                  onClick: () => setDeleteRowOpen(true),
                }] : []}
                primaryAction={access.canWrite && controller.selectedTable?.status === 'active' ? {
                  label: 'New record',
                  ariaHasPopup: 'dialog',
                  disabled: controller.isMutating,
                  onClick: () => setCreateRowOpen(true),
                } : undefined}
              />
              <div className="flex shrink-0 items-center justify-center gap-1 px-1 text-xs text-muted-foreground" aria-label="Record pages">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={controller.previousOffset === null || controller.isLoadingRows}
                  aria-label="Previous record page"
                  onClick={controller.goToPreviousPage}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
                <span className="min-w-20 text-center tabular-nums">
                  {controller.totalRows === 0
                    ? '0 records'
                    : `${Math.min(controller.offset + 1, controller.totalRows)}–${Math.min(controller.offset + controller.rows.length, controller.totalRows)} of ${controller.totalRows}`}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={controller.nextOffset === null || controller.isLoadingRows}
                  aria-label="Next record page"
                  onClick={controller.goToNextPage}
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        />
      </div>

      <DataStudioTableDialog
        open={createTableOpen}
        busy={controller.isMutating}
        onOpenChange={setCreateTableOpen}
        onCreate={controller.createTable}
      />
      <DataStudioTableDialog
        key={controller.selectedTable?.tableId ?? 'no-table'}
        open={editTableOpen}
        table={controller.selectedTable}
        busy={controller.isMutating}
        onOpenChange={setEditTableOpen}
        onUpdate={controller.updateTable}
      />
      <DataStudioRowDialog
        open={createRowOpen}
        table={controller.selectedTable}
        busy={controller.isMutating}
        onOpenChange={setCreateRowOpen}
        onCreate={controller.createRow}
      />
      <DataStudioConfirmDialog
        open={deleteRowOpen}
        title="Delete record?"
        description="This permanently removes the selected logical record from this organization."
        confirmLabel="Delete record"
        destructive
        busy={controller.isMutating}
        onOpenChange={setDeleteRowOpen}
        onConfirm={() => controller.deleteRow()}
      />
      <DataStudioConfirmDialog
        open={statusDialogOpen}
        title={controller.selectedTable?.status === 'active' ? 'Archive table?' : 'Restore table?'}
        description={controller.selectedTable?.status === 'active'
          ? 'Archived tables become read-only and leave the active catalog.'
          : 'Restoring makes this table available for record changes again.'}
        confirmLabel={controller.selectedTable?.status === 'active' ? 'Archive table' : 'Restore table'}
        destructive={controller.selectedTable?.status === 'active'}
        busy={controller.isMutating}
        onOpenChange={setStatusDialogOpen}
        onConfirm={() => controller.changeTableStatus(
          controller.selectedTable?.status === 'active' ? 'archived' : 'active',
        )}
      />
    </section>
  );
}

function DataStudioBoundaryState({
  status,
  error,
  onRetry,
  className,
  children,
}: {
  status: UseDataStudioResult['status'];
  error: Error | null;
  onRetry: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  if (children && (status === 'disabled' || status === 'denied' || status === 'idle')) {
    return <div className={className}>{children}</div>;
  }
  const loading = status === 'loading';
  const title = loading
    ? 'Loading Data Studio'
    : status === 'disabled'
      ? 'Data Studio is disabled'
      : status === 'denied'
        ? 'Data Studio access required'
        : status === 'error'
          ? 'Data Studio is unavailable'
          : 'Sign in to Data Studio';
  const description = error?.message ?? (
    status === 'denied'
      ? 'Your organization role does not include permission to read logical tables.'
      : status === 'disabled'
        ? 'Enable Data Studio in the server application before using this workspace.'
        : status === 'idle'
          ? 'An authenticated organization session is required.'
          : 'Loading the active organization catalog.'
  );
  return (
    <div className={cn('flex min-h-72 items-center justify-center rounded-xl border bg-background p-6 text-center', className)}>
      <div className="max-w-sm">
        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {loading
            ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            : <AlertTriangle className="size-5" aria-hidden="true" />}
        </span>
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {status === 'error' && (
          <Button type="button" size="sm" variant="outline" className="mt-4" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

/** Type-level assertion that grid mutations remain column/value driven. */
export type DataStudioCellCommit = (
  rowId: string,
  column: DataStudioColumn,
  value: DataStudioValue,
) => Promise<unknown>;
