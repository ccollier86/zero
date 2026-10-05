'use client';

/**
 * master-detail-page.tsx
 *
 * Renders Zero's reusable list/detail organism. This component owns UI
 * composition for table selection, detail rendering, and action placement; data
 * subscription and selection state live in dedicated helper files.
 */

import * as React from 'react';
import { useMemo, useCallback } from 'react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { Row } from '../../sync/types';
import { DataTableContent } from '../data-table/data-table';
import { useDataTableController } from '../data-table/use-data-table-controller';
import { invokeDataTableSourceWrite } from '../data-table/data-table-source-action-guard';
import type {
  DataTableSearchOptions,
  DataTableToolbarSlots,
} from '#zero/components/data-table';
import type { LazyCollectionOptions } from '../../frontend/client/data-hooks';
import type {
  DataTableFilters,
  DataTableSource,
  DataTableSourceState,
} from '../data-table/data-table-source';
import { getSchemaPrimaryKey, requireRowPrimaryKey } from '../data-table/row-identity';
import { AutoForm } from '../../components/forms';
import { Button } from '#zero/components/ui/button';
import { ListDetailLayout } from '#zero/components/ui/list-detail-layout';
import { DetailPanel } from '#zero/components/ui/detail-panel';
import {
  RecordNavigationBar,
  type NavigationAction,
  type RecordPrimaryAction,
} from '#zero/components/ui/record-navigation-bar';
import { Skeleton } from '#zero/components/ui/skeleton';
import { cn } from '#zero/lib/utils';
import {
  useMasterDetailSelection,
  type MasterDetailLiveActions,
} from './use-master-detail-state';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MasterDetailRenderContext<T extends Row = Row> {
  primaryKey: string;
  selectedId: string | null;
  selectedItem: T | null;
  selectedIndex: number;
  totalCount: number;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  selectId: (id: string | null) => void;
  selectItem: (item: T) => void;
  selectPrevious: () => void;
  selectNext: () => void;
  update: (changes: Partial<T>) => void | Promise<void>;
  liveActions: MasterDetailLiveActions<T> | null;
  sourceType: DataTableSourceState<T>['sourceType'];
  isLoading: boolean;
  error: Error | string | null;
  refresh: () => void;
}

export interface MasterDetailPageProps<T extends Row = Row> {
  // ── Schema & column config ──────────────────────────────────────
  /** Schema defining all fields for table + form generation. */
  schema: SchemaDescriptor;
  /** Field names shown as columns in the list table. */
  listColumns: string[];
  /** Primary key override. Defaults to `schema.primaryKey`. */
  primaryKey?: string;
  /** Field names editable in the detail form. Defaults to all schema fields. */
  editableFields?: string[];

  // ── Data source ─────────────────────────────────────────────────
  /** Explicit data source config shared with DataTableView. */
  source?: DataTableSource<T>;
  /** Static data array. */
  data?: T[];
  /**
   * Collection name for live reactive data (overrides `data` when `source` is omitted).
   * When provided, detail-form updates write to the collection unless `onUpdate`
   * is supplied.
   */
  collection?: string;
  /** Fetch the collection through `/api/data` before rendering rows. */
  lazy?: boolean;
  /** Lazy `/api/data` equality filters. Only used with `lazy` or lazy source. */
  filters?: DataTableFilters;
  /** Lazy `/api/data` ordering, limit, and offset options. */
  lazyOptions?: LazyCollectionOptions;

  // ── Selection ───────────────────────────────────────────────────
  /** Controlled selected row ID. Pass `null` to force no selection. */
  selectedId?: string | null;
  /** Initial selected row ID for uncontrolled usage. */
  defaultSelectedId?: string | null;
  /** Auto-select the first row when uncontrolled and no row is selected. Default: true. */
  autoSelectFirst?: boolean;
  /** Called whenever the selected row ID changes through this component. */
  onSelectedIdChange?: (id: string | null, item: T | null) => void;

  // ── Detail header ───────────────────────────────────────────────
  /** Custom header component rendered above the edit form in the detail panel. */
  detailHeader?: React.ComponentType<{ item: T }>;
  /** Custom empty state content when no record is selected. */
  emptyState?: React.ReactNode;
  /** Empty state text when no record is selected. */
  emptyStateText?: string;

  // ── Navigation bar ──────────────────────────────────────────────
  /** Factory function returning action buttons for the selected record. */
  navigationActions?: (selectedItem: T | null) => NavigationAction[];
  /** Primary action button config (right side of nav bar). */
  primaryAction?: RecordPrimaryAction;

  // ── Callbacks ───────────────────────────────────────────────────
  /** Called when a row is clicked / selected. */
  onSelect?: (item: T) => void;
  /** Called when the detail form is submitted. */
  onUpdate?: (id: string, changes: Partial<T>) => void | Promise<void>;
  /** Called when the generated detail form update fails. */
  onUpdateError?: (error: string) => void;

  // ── Table features ──────────────────────────────────────────────
  /** Enable search bar in the table toolbar. Default: true. */
  searchable?: boolean | DataTableSearchOptions;
  /** Controls and actions inserted into the list table's toolbar. */
  tableToolbarSlots?: DataTableToolbarSlots<T>;
  /** Accessible name for the list table's toolbar control group. */
  tableToolbarLabel?: string;
  /** Enable column sorting. Default: true. */
  sortable?: boolean;
  /** Enable pagination. Defaults to true for server sources, otherwise false. */
  paginated?: boolean | { pageSize?: number };

  // ── Form config ─────────────────────────────────────────────────
  /** Number of CSS grid columns in the detail form. Default: 2. */
  formColumns?: number;
  /** Submit button label. Default: 'Save Changes'. */
  submitLabel?: string;
  /** Content rendered in the sticky detail footer. */
  detailFooter?:
    | React.ReactNode
    | ((item: T | null, context: MasterDetailRenderContext<T>) => React.ReactNode);
  /** Custom detail body. When provided, replaces the generated AutoForm. */
  renderDetail?: (item: T, context: MasterDetailRenderContext<T>) => React.ReactNode;
  /** Content rendered below the detail body for the selected item. */
  detailContent?: (item: T, context: MasterDetailRenderContext<T>) => React.ReactNode;
  /** First-load table loading state for lazy or caller-owned loading sources. */
  loadingState?: React.ReactNode;
  /** First-load table error state for lazy or caller-owned error sources. */
  errorState?: (error: Error | string, retry: () => void) => React.ReactNode;

  // ── Layout ──────────────────────────────────────────────────────
  /** Width ratio for list panel. Default: '3fr'. */
  listWidth?: string;
  /** Width ratio for detail panel. Default: '2fr'. */
  detailWidth?: string;
  /** Desktop detail visibility; mobile record inspection remains available. Default: true. */
  detailVisible?: boolean;
  /** Enable a keyboard/pointer resizable desktop pane separator. Default: false. */
  resizable?: boolean;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

function MasterDetailPage<T extends Row = Row>({
  schema,
  listColumns,
  primaryKey: primaryKeyOverride,
  editableFields,
  source,
  data: dataProp,
  collection,
  lazy,
  filters,
  lazyOptions,
  selectedId: selectedIdProp,
  defaultSelectedId,
  autoSelectFirst,
  onSelectedIdChange,
  detailHeader: DetailHeader,
  emptyState,
  emptyStateText,
  navigationActions,
  primaryAction,
  onSelect,
  onUpdate,
  onUpdateError,
  searchable = true,
  tableToolbarSlots,
  tableToolbarLabel,
  sortable = true,
  paginated = source?.type === 'server',
  formColumns = 2,
  submitLabel = 'Save Changes',
  detailFooter,
  renderDetail,
  detailContent,
  loadingState,
  errorState,
  listWidth,
  detailWidth,
  detailVisible,
  resizable,
  className,
}: MasterDetailPageProps<T>) {
  const primaryKey = getSchemaPrimaryKey(schema, primaryKeyOverride);
  const tableOptions = {
    schema, columns: listColumns, primaryKey,
    data: dataProp,
    collection,
    source,
    lazy,
    filters,
    lazyOptions,
    searchable, sortable, paginated,
    toolbarSlots: tableToolbarSlots, toolbarLabel: tableToolbarLabel,
    loadingState, errorState,
  };
  const tableController = useDataTableController<T>(tableOptions);
  const partitionRef = React.useRef(tableController.partition);
  partitionRef.current = tableController.partition;
  const getRowId = source?.type === 'server' ? source.getRowId : undefined;
  const state = useMasterDetailSelection<T>({
    resolvedSource: tableController.resolved,
    primaryKey, getRowId, boundaryKey: tableController.partition,
    selectedId: selectedIdProp,
    defaultSelectedId,
    autoSelectFirst,
    onSelect,
    onSelectedIdChange,
  });
  const {
    data,
    selectedId,
    selectedItem,
    selectedIndex,
    totalCount,
    canSelectPrevious,
    canSelectNext,
    selectRow,
    selectId,
    selectPrevious,
    selectNext,
    liveActions,
    sourceType,
    isLoading,
    error,
    refresh,
  } = state;
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(selectedItem !== null);
  const previousSelectedIdRef = React.useRef(selectedId);
  React.useEffect(() => {
    const selectionChanged = previousSelectedIdRef.current !== selectedId;
    previousSelectedIdRef.current = selectedId;
    if (selectedId === null) {
      setMobileDetailOpen(false);
    } else if (selectionChanged) {
      setMobileDetailOpen(true);
    }
  }, [selectedId]);
  const selectRowAndOpenDetail = useCallback((row: T) => {
    setMobileDetailOpen(true);
    selectRow(row);
  }, [selectRow]);
  const selectIdAndOpenDetail = useCallback((id: string | null) => {
    setMobileDetailOpen(id !== null);
    selectId(id);
  }, [selectId]);
  const selectPreviousAndOpenDetail = useCallback(() => {
    setMobileDetailOpen(true);
    selectPrevious();
  }, [selectPrevious]);
  const selectNextAndOpenDetail = useCallback(() => {
    setMobileDetailOpen(true);
    selectNext();
  }, [selectNext]);
  const editableFieldSet = useMemo(
    () => editableFields ? new Set(editableFields) : null,
    [editableFields],
  );
  const formFieldOverrides = useMemo(
    () => editableFieldSet
      ? Object.fromEntries(
          schema.fieldNames.map((name) => [name, { hidden: !editableFieldSet.has(name) }]),
        )
      : undefined,
    [editableFieldSet, schema.fieldNames],
  );

  const submitDetailChanges = useCallback(
    async (item: T, changes: Partial<T>) => {
      const id = getRowId
        ? String(getRowId(item, data.indexOf(item)))
        : requireRowPrimaryKey(item, primaryKey);
      await invokeDataTableSourceWrite(
        'update',
        partitionRef.current === tableController.partition,
        onUpdate ? () => onUpdate(id, changes)
          : liveActions ? () => liveActions.update(id, changes) : undefined,
      );
      // Acceptance belongs to the result partition that started the write;
      // a late callback cannot report completion into a replacement source.
      if (partitionRef.current !== tableController.partition) {
        await invokeDataTableSourceWrite('update', false);
      }
    },
    [data, getRowId, liveActions, onUpdate, primaryKey, tableController.partition],
  );

  const renderContext = useMemo<MasterDetailRenderContext<T>>(
    () => ({
      primaryKey,
      selectedId,
      selectedItem,
      selectedIndex,
      totalCount,
      canSelectPrevious,
      canSelectNext,
      selectId: selectIdAndOpenDetail,
      selectItem: selectRowAndOpenDetail,
      selectPrevious: selectPreviousAndOpenDetail,
      selectNext: selectNextAndOpenDetail,
      update: (changes) => {
        if (!selectedItem) return;
        return submitDetailChanges(selectedItem, changes);
      },
      liveActions,
      sourceType,
      isLoading,
      error,
      refresh,
    }),
    [
      canSelectNext,
      canSelectPrevious,
      error,
      isLoading,
      liveActions,
      primaryKey,
      refresh,
      selectIdAndOpenDetail,
      selectNextAndOpenDetail,
      selectPreviousAndOpenDetail,
      selectRowAndOpenDetail,
      selectedId,
      selectedIndex,
      selectedItem,
      sourceType,
      submitDetailChanges,
      totalCount,
    ],
  );

  // ─── Navigation actions ───────────────────────────────────────────

  const navActions = useMemo(
    () => navigationActions?.(selectedItem) ?? [],
    [selectedItem, navigationActions],
  );

  const resolvedDetailFooter = useMemo(
    () => typeof detailFooter === 'function'
      ? detailFooter(selectedItem, renderContext)
      : detailFooter,
    [detailFooter, renderContext, selectedItem],
  );

  const listContent = useMemo(() => {
    if (!tableController.server && isLoading && data.length === 0) {
      return loadingState ?? <MasterDetailLoadingState />;
    }

    if (!tableController.server && error && data.length === 0) {
      return errorState
        ? errorState(error, refresh)
        : <MasterDetailErrorState error={error} onRetry={refresh} />;
    }

    return (
      <DataTableContent<T>
        {...tableOptions}
        controller={tableController}
        onRowClick={selectRowAndOpenDetail}
        highlightedRowId={selectedId ?? undefined}
        className="h-full"
      />
    );
  }, [
    tableController,
    tableOptions,
    data,
    error,
    errorState,
    isLoading,
    listColumns,
    loadingState,
    paginated,
    primaryKey,
    refresh,
    schema,
    searchable,
    tableToolbarSlots,
    tableToolbarLabel,
    selectRowAndOpenDetail,
    selectedId,
    sortable,
  ]);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}>
      <ListDetailLayout
        hasSelection={selectedItem != null}
        mobileDetailOpen={mobileDetailOpen}
        onMobileBack={() => setMobileDetailOpen(false)}
        selectedKey={selectedId ?? undefined}
        listWidth={listWidth}
        detailWidth={detailWidth}
        detailVisible={detailVisible}
        resizable={resizable}
        list={listContent}
        detail={
          <DetailPanel
            isEmpty={selectedItem == null}
            emptyState={
              emptyState ?? (emptyStateText ? (
                <p className="text-sm">{emptyStateText}</p>
              ) : undefined)
            }
            header={
              selectedItem && DetailHeader ? (
                <DetailHeader item={selectedItem} />
              ) : undefined
            }
            footer={resolvedDetailFooter}
          >
            {selectedItem && (
              <>
                {renderDetail ? (
                  renderDetail(selectedItem, renderContext)
                ) : (
                  <AutoForm
                    key={`${tableController.partition}:${selectedId}:${String(selectedItem.updatedAt ?? '')}`}
                    schema={schema}
                    mode="edit"
                    defaultValues={selectedItem as Record<string, unknown>}
                    columns={formColumns}
                    fields={formFieldOverrides}
                    includeFields={editableFields}
                    onSubmit={(values) => {
                      const changes = editableFieldSet
                        ? Object.fromEntries(
                            Object.entries(values).filter(([name]) => editableFieldSet.has(name)),
                          )
                        : values;
                      return submitDetailChanges(selectedItem, changes as Partial<T>);
                    }}
                    onError={(message) => {
                      if (partitionRef.current === tableController.partition) onUpdateError?.(message);
                    }}
                    submitLabel={submitLabel}
                    className="mt-2"
                  />
                )}
                {detailContent?.(selectedItem, renderContext)}
              </>
            )}
          </DetailPanel>
        }
        bottomBar={
          <RecordNavigationBar
            currentIndex={selectedIndex}
            totalCount={totalCount}
            onPrevious={selectPreviousAndOpenDetail}
            onNext={selectNextAndOpenDetail}
            actions={navActions}
            primaryAction={primaryAction}
          />
        }
      />
    </div>
  );
}

export { MasterDetailPage };
export const MasterDetailView = MasterDetailPage;

function MasterDetailLoadingState() {
  return (
    <div className="space-y-3 p-3">
      <Skeleton className="h-9 w-[min(18rem,100%)]" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

function MasterDetailErrorState({
  error,
  onRetry,
}: {
  error: Error | string;
  onRetry: () => void;
}) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">Unable to load records</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
