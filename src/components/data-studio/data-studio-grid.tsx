'use client';

/** Schema-first virtual record grid. Callers own query, authority and revision-aware persistence. */
import * as React from 'react';
import { Database, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import type { DataStudioColumn, DataStudioRow, DataStudioTable, DataStudioValue } from '../../frontend/client/data-studio-client';
import { dataStudioCellValue } from '../../frontend/client/data-studio-client';
import { reportDataStudioFrontendFailure } from '../../frontend/client/data-studio-observability';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { DataStudioInlineCell } from './data-studio-inline-cell';
import { DataStudioColumnHeader, type DataStudioSchemaActions } from './data-studio-column-header';
import { useDataStudioColumnSizing } from './use-data-studio-column-sizing';
import { DATA_STUDIO_GRID_ROW_HEIGHT, useDataStudioVirtualGrid } from './data-studio-virtual-grid';

export interface DataStudioGridProps extends DataStudioSchemaActions {
  readonly table: DataStudioTable | null;
  readonly rows: readonly DataStudioRow[];
  readonly selectedRowId: string | null;
  readonly editable: boolean;
  readonly loading?: boolean;
  readonly sortColumnId?: string | null;
  readonly sortDirection?: 'asc' | 'desc';
  readonly onSelectRow: (rowId: string) => void;
  /** Inspection intent is separate from cell selection so mobile inline editing remains reachable. */
  readonly onInspectRow?: (rowId: string) => void;
  readonly onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  readonly onCommit: (row: DataStudioRow, column: DataStudioColumn, value: DataStudioValue) => Promise<unknown>;
  readonly onReload: () => Promise<unknown>;
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly loadMoreError?: string | null;
  readonly onLoadMore?: () => Promise<unknown>;
  readonly refreshRequired?: boolean;
  readonly refreshMessage?: string;
  /** Changes retire query-specific editors/focus while retaining this table's local column widths. */
  readonly queryKey?: string;
  readonly className?: string;
}

/** Render schema even without records; progressive loading never re-filters a server page. */
export function DataStudioGrid({ table, rows, selectedRowId, editable, loading = false,
  sortColumnId, sortDirection = 'asc', onSelectRow, onInspectRow, onSort, onCommit, onReload,
  hasMore = false, loadingMore = false, onLoadMore, loadMoreError,
  refreshRequired = false, refreshMessage, queryKey = '', className, ...schemaActions }: DataStudioGridProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const loadPending = React.useRef<object | null>(null);
  const mounted = React.useRef(false);
  const [localLoadError, setLocalLoadError] = React.useState(false);
  const [localLoadingMore, setLocalLoadingMore] = React.useState(false);
  const columns = table?.schema.columns ?? [];
  const sizing = useDataStudioColumnSizing(columns, rows, table?.tableId);
  const selectedIndex = rows.findIndex((row) => row.rowId === selectedRowId);
  const identity = `${table?.tableId ?? ''}:${queryKey}`;
  const currentIdentity = React.useRef(identity); currentIdentity.current = identity;
  const virtual = useDataStudioVirtualGrid(rootRef, rows.length, selectedIndex, identity);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => { loadPending.current = null; setLocalLoadingMore(false); setLocalLoadError(false); }, [identity]);
  const loadMore = React.useCallback(async () => {
    if (!mounted.current || loadPending.current || loadingMore || !hasMore || !onLoadMore || refreshRequired) return;
    const ticket = {}; loadPending.current = ticket; setLocalLoadError(false); setLocalLoadingMore(true);
    const capturedIdentity = identity;
    try { await onLoadMore(); }
    catch (cause) {
      reportDataStudioFrontendFailure('row-page.load', 'load', cause);
      if (mounted.current && currentIdentity.current === capturedIdentity) setLocalLoadError(true);
    } finally {
      if (loadPending.current === ticket) {
        loadPending.current = null;
        if (mounted.current && currentIdentity.current === capturedIdentity) setLocalLoadingMore(false);
      }
    }
  }, [hasMore, identity, loadingMore, onLoadMore, refreshRequired]);
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !onLoadMore || !hasMore || localLoadError || loadMoreError || refreshRequired) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void loadMore();
    }, { root: rootRef.current, rootMargin: '160px' });
    observer.observe(sentinel); return () => observer.disconnect();
  }, [hasMore, loadMore, loadMoreError, localLoadError, onLoadMore, refreshRequired, rows.length]);
  const navigate = (rowIndex: number, columnIndex: number, direction: -1 | 1) => {
    const ordinal = rowIndex * columns.length + columnIndex;
    const next = Math.max(0, Math.min(rows.length * columns.length - 1, ordinal + direction));
    virtual.navigate(Math.floor(next / columns.length), next % columns.length);
  };
  if (!table) return <GridState title="Choose a table" description="Select an organization table to browse its records." />;
  const addColumn = schemaActions.schemaEditable === true && !!schemaActions.onAddColumn;
  const span = Math.max(1, columns.length + Number(addColumn));
  const totalWidth = sizing.totalWidth + (addColumn ? 44 : 0);
  const rendered: React.ReactNode[] = [];
  let previous = -1;
  for (const rowIndex of virtual.indices) {
    const gap = rowIndex - previous - 1;
    if (gap > 0) rendered.push(<Spacer key={`gap-${rowIndex}`} height={gap * DATA_STUDIO_GRID_ROW_HEIGHT} span={span} />);
    const row = rows[rowIndex]!;
    const selected = row.rowId === selectedRowId;
    rendered.push(<TableRow key={`${identity}:${row.rowId}`} data-row-id={row.rowId}
      aria-rowindex={rowIndex + 2} data-state={selected ? 'selected' : undefined}
      aria-current={selected ? 'true' : undefined} onClick={event => {
        onSelectRow(row.rowId);
        const target = event.target;
        if (!editable || refreshRequired || !(target instanceof Element)
          || !target.closest('[data-data-studio-cell], input')) onInspectRow?.(row.rowId);
      }}
      onFocusCapture={() => virtual.onFocusRow(rowIndex)} style={{ height: DATA_STUDIO_GRID_ROW_HEIGHT }}>
      {columns.map((column, columnIndex) => <TableCell key={column.columnId}
        data-row-index={rowIndex} data-column-index={columnIndex}
        className="h-9 overflow-hidden border-r border-border/40 px-1 py-0 last:border-r-0">
        <DataStudioInlineCell value={dataStudioCellValue(row, column.columnId)} column={column}
          revision={row.revision} disabled={!editable || refreshRequired} selected={selected}
          onSelect={() => onSelectRow(row.rowId)} onCommit={(value) => onCommit(row, column, value)}
          onReload={onReload} onNavigate={(direction) => navigate(rowIndex, columnIndex, direction)} />
      </TableCell>)}
      {addColumn && <TableCell className="p-0" />}
    </TableRow>);
    previous = rowIndex;
  }
  if (previous < rows.length - 1) rendered.push(<Spacer key="tail" height={(rows.length - previous - 1) * DATA_STUDIO_GRID_ROW_HEIGHT} span={span} />);
  return <div ref={rootRef} data-slot="data-studio-grid" aria-busy={loading || loadingMore || localLoadingMore}
    className={cn('relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain', className)}
    >
    <Table containerClassName="overflow-visible" className="table-fixed" style={{ width: Math.max(totalWidth, 280), minWidth: '100%' }}
      aria-label={`${table.name} records`} aria-rowcount={hasMore ? -1 : rows.length + 1}>
      <colgroup>{sizing.headers.map(header => <col key={header.id} style={{ width: header.getSize() }} />)}
        {addColumn && <col style={{ width: 44 }} />}</colgroup>
      <TableHeader className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <TableRow>{columns.map((column, index) => <DataStudioColumnHeader key={`${identity}:${column.columnId}`}
          column={column} tableRevision={table.revision} index={index} count={columns.length}
          resizeHeader={sizing.headers[index]!}
          onWidthChange={(width) => sizing.setWidth(column.columnId, width)}
          sorted={sortColumnId === column.columnId} sortDirection={sortDirection} onSort={onSort} {...schemaActions} />)}
          {addColumn && <TableHead className="h-10 p-0 text-center">
            <button type="button" onClick={schemaActions.onAddColumn} aria-label="Add column"
              className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>{rows.length ? rendered : <TableRow><TableCell colSpan={span} className="h-56 p-0">
        <GridState title={loading ? 'Loading records' : columns.length ? 'No matching records' : 'No columns yet'}
          description={loading ? `Reading ${table.name} from this organization.` : columns.length ? 'Create a record or change the current search.' : 'Add a column to begin defining this table.'}
          loading={loading} />
      </TableCell></TableRow>}</TableBody>
    </Table>
    {refreshRequired && <div role="status" className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t bg-background/95 px-3 py-2 text-xs text-muted-foreground">
      <span>{refreshMessage ?? 'Records changed while loading. Refresh to continue from a consistent view.'}</span>
      <Button size="sm" variant="outline" onClick={() => { void Promise.resolve().then(onReload).catch((cause) => reportDataStudioFrontendFailure('row-page.load', 'load', cause)); }}><RefreshCw className="size-3.5" /> Refresh</Button>
    </div>}
    {hasMore && !refreshRequired && <div ref={sentinelRef} className="flex min-h-11 items-center justify-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground" role="status">
      {loadingMore || localLoadingMore ? <><LoaderCircle className="size-3.5 animate-spin" /> Loading more records…</> : (localLoadError || loadMoreError)
        ? <>More records could not be loaded. <Button size="sm" variant="ghost" onClick={() => { void loadMore(); }}>Retry</Button></>
        : <Button size="sm" variant="ghost" onClick={() => { void loadMore(); }}>Load more records</Button>}
    </div>}
    {onLoadMore && !hasMore && !loading && !loadingMore && !localLoadingMore && !refreshRequired && rows.length > 0 && (
      <div role="status" className="border-t px-3 py-2 text-center text-xs text-muted-foreground">
        All {rows.length.toLocaleString()} matching records loaded.
      </div>
    )}
  </div>;
}

function Spacer({ height, span }: { height: number; span: number }) {
  return <tr aria-hidden="true"><td colSpan={span} style={{ height, padding: 0, border: 0 }} /></tr>;
}

function GridState({ title, description, loading = false }: { title: string; description: string; loading?: boolean }) {
  return <div className="flex h-full min-h-48 items-center justify-center p-6 text-center"><div className="max-w-sm">
    <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Database className="size-4" aria-hidden="true" />}
    </span><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p>
  </div></div>;
}
