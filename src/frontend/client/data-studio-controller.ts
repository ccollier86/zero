'use client';

/**
 * data-studio-controller.ts
 *
 * Composes Data Studio's focused read, query, reconciliation, and mutation
 * hooks into the stable browser controller returned to React consumers.
 */

import * as React from 'react';
import type { DataStudioMutationError } from './data-studio-client';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { shouldUseSsrFallback, useClientMaybe } from './client-context';
import {
  resolveDataStudioStatus,
  type UseDataStudioOptions,
  type UseDataStudioResult,
} from './data-studio-controller-types';
import { DataStudioOperationTracker } from './data-studio-operation-tracker';
import {
  useDataStudioQueryState,
  useDataStudioRowQuery,
} from './data-studio-query-state';
import { useDataStudioCatalog } from './use-data-studio-catalog';
import { useDataStudioMutations } from './use-data-studio-mutations';
import { useDataStudioReconciliation } from './use-data-studio-reconciliation';
import { useDataStudioRows } from './use-data-studio-rows';

/** Load and operate the active organization's logical tables and rows. */
export function useDataStudio(options: UseDataStudioOptions = {}): UseDataStudioResult {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const surface = client?.dataStudio ?? null;
  const enabled = options.enabled !== false;
  const query = useDataStudioQueryState(options);
  const [mutationError, setMutationError] = React.useState<
    DataStudioMutationError | Error | null
  >(null);
  const [pendingMutations, setPendingMutations] = React.useState(0);
  const operationTracker = React.useRef(new DataStudioOperationTracker());
  const resetScopeState = React.useCallback(() => {
    operationTracker.current.clear();
    operationTracker.current = new DataStudioOperationTracker();
    setPendingMutations(0);
    setMutationError(null);
    query.setSelectedRowId(null);
    query.setOffsetState(0);
    query.setOffsetHistory([]);
  }, [query.setOffsetHistory, query.setOffsetState, query.setSelectedRowId]);
  const catalog = useDataStudioCatalog({
    surface,
    boundary,
    authenticated: client?.isAuthenticated === true,
    enabled,
    tableStatus: query.tableStatus,
    selectedTableId: query.selectedTableId,
    initialTableId: options.initialTableId,
    setSelectedTableId: query.setSelectedTableId,
    onScopeReset: resetScopeState,
  });

  const schemaQueryRevision = React.useRef<{
    readonly tableId: string;
    readonly schemaRevision: number;
  } | null>(null);
  React.useEffect(() => {
    if (!catalog.selectedTable) return;
    const previous = schemaQueryRevision.current;
    schemaQueryRevision.current = {
      tableId: catalog.selectedTable.tableId,
      schemaRevision: catalog.selectedTable.schemaRevision,
    };
    if (!previous || (previous.tableId === catalog.selectedTable.tableId
      && previous.schemaRevision === catalog.selectedTable.schemaRevision)) return;
    query.setFiltersState([]);
    query.setSortColumnId(null);
    query.setSortDirection('asc');
    query.setOffsetState(0);
    query.setOffsetHistory([]);
  }, [
    catalog.selectedTable,
    query.setFiltersState,
    query.setOffsetHistory,
    query.setOffsetState,
    query.setSortColumnId,
    query.setSortDirection,
  ]);

  const rowQuery = useDataStudioRowQuery({
    capabilities: catalog.capabilities,
    selectedTable: catalog.selectedTable,
    filters: query.filters,
    debouncedSearch: query.debouncedSearch,
    sortColumnId: query.sortColumnId,
    sortDirection: query.sortDirection,
    offset: query.offset,
    requestedPageSize: query.requestedPageSize,
  });
  const rowState = useDataStudioRows({
    surface,
    boundary,
    scopeAvailable: catalog.scopeAvailable,
    shouldLoad: catalog.shouldLoad,
    canRead: catalog.access.canRead,
    cacheVisible: catalog.cacheVisible,
    selectedTable: catalog.selectedTable,
    selectedTableIdRef: query.selectedTableIdRef,
    boundaryKeyRef: catalog.boundaryKeyRef,
    boundaryReadyRef: catalog.boundaryReadyRef,
    rowQuery,
    selectedRowId: query.selectedRowId,
    setSelectedRowId: query.setSelectedRowId,
    offset: query.offset,
    offsetHistory: query.offsetHistory,
    setOffsetState: query.setOffsetState,
    setOffsetHistory: query.setOffsetHistory,
  });

  const loadCatalogRef = React.useRef(catalog.loadCatalog);
  const loadTableRef = React.useRef(catalog.loadTable);
  loadCatalogRef.current = catalog.loadCatalog;
  loadTableRef.current = catalog.loadTable;
  useDataStudioReconciliation({
    surface,
    boundary,
    scopeAvailable: catalog.scopeAvailable,
    canRead: catalog.access.canRead,
    boundaryKeyRef: catalog.boundaryKeyRef,
    boundaryReadyRef: catalog.boundaryReadyRef,
    selectedTableIdRef: query.selectedTableIdRef,
    activeRowQueryRef: rowState.activeRowQueryRef,
    tableStatusRef: query.tableStatusRef,
    loadCatalogRef,
    loadTableRef,
    loadRowsRef: rowState.loadRowsRef,
    refreshTableAfterMutation: catalog.refreshTableAfterMutation,
  });

  const mutations = useDataStudioMutations({
    surface,
    access: catalog.access,
    selectedTable: catalog.selectedTable,
    selectedRow: rowState.selectedRow,
    tableStatus: query.tableStatus,
    boundaryKey: boundary.key,
    boundaryKeyRef: catalog.boundaryKeyRef,
    boundaryReadyRef: catalog.boundaryReadyRef,
    selectedTableIdRef: query.selectedTableIdRef,
    operationTracker,
    setPendingMutations,
    setMutationError,
    setCatalogError: catalog.setCatalogError,
    setTableStatusState: query.setTableStatusState,
    setSelectedTableId: query.setSelectedTableId,
    setSelectedRowId: query.setSelectedRowId,
    refreshRowsAfterMutation: rowState.refreshRowsAfterMutation,
    refreshTableAfterMutation: catalog.refreshTableAfterMutation,
  });

  const selectPreviousRow = React.useCallback(() => {
    if (rowState.selectedRowIndex > 0) {
      query.setSelectedRowId(rowState.rows[rowState.selectedRowIndex - 1]!.rowId);
    }
  }, [query.setSelectedRowId, rowState.rows, rowState.selectedRowIndex]);
  const selectNextRow = React.useCallback(() => {
    if (rowState.selectedRowIndex >= 0
      && rowState.selectedRowIndex < rowState.rows.length - 1) {
      query.setSelectedRowId(rowState.rows[rowState.selectedRowIndex + 1]!.rowId);
    }
  }, [query.setSelectedRowId, rowState.rows, rowState.selectedRowIndex]);
  const setOffset = React.useCallback((value: number) => {
    const next = Math.max(0, Math.floor(value));
    if (next === query.offset) return;
    query.setOffsetHistory((history) => next > query.offset
      ? Object.freeze([...history, query.offset])
      : Object.freeze(history.slice(0, Math.max(0, history.lastIndexOf(next)))));
    query.setOffsetState(next);
  }, [query.offset, query.setOffsetHistory, query.setOffsetState]);
  const previousOffset = query.offsetHistory.at(-1) ?? null;
  const nextOffset = rowState.cachedPage?.nextOffset ?? null;
  const goToPreviousPage = React.useCallback(() => {
    const previous = query.offsetHistory.at(-1);
    if (previous === undefined) return;
    query.setOffsetHistory((history) => Object.freeze(history.slice(0, -1)));
    query.setOffsetState(previous);
  }, [query.offsetHistory, query.setOffsetHistory, query.setOffsetState]);
  const goToNextPage = React.useCallback(() => {
    if (nextOffset === null || nextOffset <= query.offset) return;
    query.setOffsetHistory((history) => Object.freeze([...history, query.offset]));
    query.setOffsetState(nextOffset);
  }, [nextOffset, query.offset, query.setOffsetHistory, query.setOffsetState]);
  const reload = React.useCallback(async (): Promise<void> => {
    await Promise.all([catalog.loadCatalog(), catalog.loadTable()]);
  }, [catalog.loadCatalog, catalog.loadTable]);

  shouldUseSsrFallback(client, 'useDataStudio');
  return {
    status: resolveDataStudioStatus({
      enabled,
      shouldLoad: catalog.shouldLoad,
      loading: catalog.catalogLoading,
      capabilities: catalog.capabilities,
      error: catalog.catalogError,
    }),
    capabilities: catalog.capabilities,
    access: catalog.access,
    tables: catalog.tables,
    selectedTableId: query.selectedTableId,
    selectedTable: catalog.selectedTable,
    rows: rowState.rows,
    totalRows: rowState.cachedPage?.total ?? 0,
    selectedRowId: query.selectedRowId,
    selectedRow: rowState.selectedRow,
    selectedRowIndex: rowState.selectedRowIndex,
    tableStatus: query.tableStatus,
    search: query.search,
    filters: query.filters,
    sortColumnId: query.sortColumnId,
    sortDirection: query.sortDirection,
    offset: query.offset,
    previousOffset,
    nextOffset,
    pageSize: rowQuery.limit ?? query.requestedPageSize,
    isLoading: catalog.catalogLoading,
    isLoadingRows: catalog.tableLoading || rowState.rowsLoading,
    isMutating: pendingMutations > 0,
    error: catalog.catalogError ?? catalog.tableError ?? rowState.rowsError,
    mutationError,
    selectTable: query.selectTable,
    selectRow: query.setSelectedRowId,
    selectPreviousRow,
    selectNextRow,
    setTableStatus: query.setTableStatus,
    setSearch: query.setSearch,
    setFilters: query.setFilters,
    setSort: query.setSort,
    setOffset,
    goToPreviousPage,
    goToNextPage,
    reload,
    reloadRows: rowState.loadRows,
    ...mutations,
  };
}
