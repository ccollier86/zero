'use client';

/** Compose the packaged schema-first Studio; scoped data and mutations stay in its controller. */
import * as React from 'react';
import { AlertTriangle, Database, LoaderCircle, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { resolveDataStudioAccess, type DataStudioAccess, type UseDataStudioResult } from '../../frontend/client/data-studio-controller-types';
import type { DataStudioColumn, DataStudioRow, DataStudioTableStatus, DataStudioValue } from '../../frontend/client/data-studio-client';
import { reportDataStudioFrontendFailure } from '../../frontend/client/data-studio-observability';
import { Button } from '../ui/button';
import { ListDetailLayout } from '../ui/list-detail-layout';
import { cn } from '../../lib/utils';
import { DataStudioGrid } from './data-studio-grid';
import { DataStudioFilterControl } from './data-studio-filter-control';
import { DataStudioInspector } from './data-studio-inspector';
import { DataStudioToolbar } from './data-studio-toolbar';
import { DataStudioWorkspaceActions } from './data-studio-workspace-actions';
import { DataStudioWorkspaceDialogs } from './data-studio-workspace-dialogs';

export interface DataStudioWorkspaceProps {
  readonly controller: UseDataStudioResult;
  /** UI-only narrowing; never grants server permission. */
  readonly capabilities?: Partial<DataStudioAccess>;
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
  readonly emptyState?: React.ReactNode;
  /** Optional controlled desktop inspector visibility. */
  readonly detailsOpen?: boolean;
  /** The default prioritizes the grid; opening details never replaces its schema headers. */
  readonly defaultDetailsOpen?: boolean;
  readonly onDetailsOpenChange?: (open: boolean) => void;
  readonly resizableDetails?: boolean;
}

/** Retire drafts, confirmations and callbacks synchronously on table/authority replacement. */
export function DataStudioWorkspace(props: DataStudioWorkspaceProps) {
  const boundary = JSON.stringify([props.controller.scopeKey, props.controller.selectedTableId]);
  return <DataStudioWorkspaceBody key={boundary} {...props} />;
}

function DataStudioWorkspaceBody({
  controller: c, capabilities: narrowing, title = 'Data Studio',
  description = 'Create tables and edit your workspace’s records.', className, emptyState,
  detailsOpen, defaultDetailsOpen = false, onDetailsOpenChange, resizableDetails = true,
}: DataStudioWorkspaceProps) {
  const access = React.useMemo(() => resolveDataStudioAccess(c.capabilities, narrowing), [c.capabilities, narrowing]);
  const [localDetails, setLocalDetails] = React.useState(defaultDetailsOpen);
  const showDetails = detailsOpen ?? localDetails;
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false);
  const mobileRecord = React.useRef(false);
  const [createTableOpen, setCreateTableOpen] = React.useState(false);
  const [schemaOpen, setSchemaOpen] = React.useState(false);
  const [startWithNewColumn, setStartWithNewColumn] = React.useState(false);
  const [createRowOpen, setCreateRowOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<DataStudioRow | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<{ status: DataStudioTableStatus; revision: number } | null>(null);
  const setDetails = (open: boolean) => {
    if (detailsOpen === undefined) setLocalDetails(open);
    onDetailsOpenChange?.(open);
  };
  React.useEffect(() => {
    if (mobileRecord.current && !c.selectedRow) setMobileDetailOpen(false);
  }, [c.selectedRow]);
  const inspect = () => { setDetails(true); mobileRecord.current = !!c.selectedRow; setMobileDetailOpen(true); };
  const openSchema = (add = false) => { setStartWithNewColumn(add); setSchemaOpen(true); };
  const refresh = React.useCallback(() => {
    void Promise.all([c.reload(), c.reloadRows()]).catch(cause => reportDataStudioFrontendFailure('row-page.load', 'load', cause));
  }, [c.reload, c.reloadRows]);
  const table = c.selectedTable;
  const schemaEditable = access.canManage && table?.status === 'active' && !c.isMutating;
  const canAddColumn = !!table && table.schema.columns.length < (c.capabilities?.limits.maxColumns ?? 128);
  const writeSchema = (columns: readonly DataStudioColumn[], revision?: number) => {
    if (!table || !schemaEditable) return Promise.reject(new Error('Table editing is currently unavailable.'));
    return c.updateSchema({ ...table.schema, columns }, { expectedRevision: revision ?? table.revision });
  };
  const updateColumn = (next: DataStudioColumn, revision?: number) => {
    if (!table?.schema.columns.some(column => column.columnId === next.columnId)) {
      return Promise.reject(new Error('This column is no longer available.'));
    }
    return writeSchema(table.schema.columns.map(column => column.columnId === next.columnId ? next : column), revision);
  };
  const moveColumn = (id: string, direction: 'left' | 'right', revision?: number) => {
    const columns = [...(table?.schema.columns ?? [])], from = columns.findIndex(column => column.columnId === id);
    const to = from + (direction === 'left' ? -1 : 1);
    if (from < 0 || to < 0 || to >= columns.length) return Promise.reject(new Error('This column cannot move further.'));
    [columns[from], columns[to]] = [columns[to]!, columns[from]!];
    return writeSchema(columns, revision);
  };
  const removeColumn = (id: string, revision?: number) => writeSchema(
    table?.schema.columns.filter(column => column.columnId !== id) ?? [], revision,
  );
  if (c.status !== 'ready' || !access.canRead) return <DataStudioBoundaryState status={c.status === 'ready' ? 'denied' : c.status} error={c.error}
    onRetry={() => { void c.reload().catch(cause => reportDataStudioFrontendFailure('capabilities-and-catalog.load', 'load', cause)); }}
    className={className}>{emptyState}</DataStudioBoundaryState>;

  const list = <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <div className="shrink-0">
      <DataStudioToolbar tables={c.tables} selectedTableId={c.selectedTableId} tableStatus={c.tableStatus}
        search={c.search} loadedCount={c.rows.length} totalRows={c.totalRows}
        canManage={access.canManage} loading={c.isLoading || c.isLoadingRows} busy={c.isMutating}
        filterControl={<DataStudioFilterControl columns={table?.schema.columns ?? []} filters={c.filters}
          disabled={c.isMutating} onChange={c.setFilters} />}
        onTableChange={c.selectTable} onStatusChange={c.setTableStatus} onSearchChange={c.setSearch}
        onCreateTable={() => setCreateTableOpen(true)} onRefresh={refresh} />
    </div>
    {(c.error || c.mutationError) && <div role="alert"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <span className="min-w-0 break-words">{(c.mutationError ?? c.error)?.message}</span>
      <Button size="sm" variant="outline" onClick={refresh}>Refresh</Button>
    </div>}
    <DataStudioGrid queryKey={c.rowWindowKey}
      className="min-h-0 min-w-0 flex-1" table={table} rows={c.rows} selectedRowId={c.selectedRowId}
      editable={access.canWrite && table?.status === 'active' && !c.isMutating}
      schemaEditable={schemaEditable} onAddColumn={canAddColumn ? () => openSchema(true) : undefined}
      onUpdateColumn={updateColumn} onMoveColumn={moveColumn} onRemoveColumn={removeColumn}
      loading={c.isLoadingRows} sortColumnId={c.sortColumnId} sortDirection={c.sortDirection}
      onSelectRow={c.selectRow}
      onInspectRow={() => { mobileRecord.current = true; setMobileDetailOpen(true); }}
      onSort={c.setSort} onCommit={(row, column, value) => c.updateCell(row, column.columnId, value)}
      onReload={c.reloadRows} hasMore={c.hasMoreRows} loadingMore={c.isLoadingMore}
      onLoadMore={c.loadMoreRows} loadMoreError={c.loadMoreError?.message}
      refreshRequired={c.rowsNeedRefresh} />
  </div>;
  const detail = <DataStudioInspector table={table} row={c.selectedRow} canManage={access.canManage}
    busy={c.isMutating} onEditSchema={() => openSchema()}
    onChangeStatus={() => { if (table) setStatusTarget({ status: table.status === 'active' ? 'archived' : 'active', revision: table.revision }); }} />;
  return <section data-slot="data-studio"
    className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden', className)}
    aria-busy={c.isLoading || c.isLoadingRows || c.isMutating}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Database className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0"><h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p></div>
      </div>
      <Button size="sm" variant="outline" disabled={!table} aria-expanded={showDetails}
        onClick={() => { setDetails(!showDetails); mobileRecord.current = false; setMobileDetailOpen(!showDetails); }}>
        {showDetails ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
        {showDetails ? 'Hide details' : 'Show details'}
      </Button>
    </header>
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-sm">
      <ListDetailLayout list={list} detail={detail}
        hasSelection={c.selectedRow !== null || mobileDetailOpen} mobileDetailOpen={mobileDetailOpen}
        onMobileBack={() => setMobileDetailOpen(false)} mobileBackLabel="Back to records"
        selectedKey={c.selectedRow?.rowId ?? table?.tableId}
        listWidth="minmax(0, 1fr)" detailWidth="minmax(18rem, 22rem)"
        detailVisible={showDetails} resizable={resizableDetails}
        bottomBar={<div className="min-w-0 p-2"><DataStudioWorkspaceActions controller={c} access={access}
          onAddRecord={() => setCreateRowOpen(true)} onAddColumn={() => openSchema(true)}
          onEditSchema={() => openSchema()} onInspect={inspect}
          onDeleteRecord={() => setDeleteTarget(c.selectedRow)}
          onChangeStatus={() => { if (table) setStatusTarget({ status: table.status === 'active' ? 'archived' : 'active', revision: table.revision }); }}
        /></div>} />
    </div>
    <DataStudioWorkspaceDialogs controller={c} createTableOpen={createTableOpen} onCreateTableOpen={setCreateTableOpen}
      schemaOpen={schemaOpen} startWithNewColumn={startWithNewColumn} onSchemaOpen={setSchemaOpen}
      createRowOpen={createRowOpen} onCreateRowOpen={setCreateRowOpen}
      deleteTarget={deleteTarget} onDeleteClose={() => setDeleteTarget(null)}
      statusTarget={statusTarget} onStatusClose={() => setStatusTarget(null)} />
  </section>;
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
