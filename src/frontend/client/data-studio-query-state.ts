'use client';

/**
 * data-studio-query-state.ts
 *
 * Local React state and schema-aware query derivation for Data Studio rows.
 * Catalog loading and mutations remain outside this boundary.
 */

import * as React from 'react';
import type {
  DataStudioCapabilities,
  DataStudioRowFilter,
  DataStudioRowQuery,
  DataStudioTable,
  DataStudioTableStatus,
} from './data-studio-client';
import {
  clampDataStudioPageSize,
  isCompatibleDataStudioFilter,
  normalizeDataStudioPageSize,
  type UseDataStudioOptions,
} from './data-studio-controller-types';

export function useDataStudioQueryState(options: UseDataStudioOptions) {
  const requestedStatus = options.tableStatus ?? 'active';
  const requestedPageSize = normalizeDataStudioPageSize(options.pageSize);
  const [tableStatus, setTableStatusState] = React.useState(requestedStatus);
  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(
    options.initialTableId ?? null,
  );
  const [selectedRowId, setSelectedRowId] = React.useState<string | null>(null);
  const [search, setSearchState] = React.useState((options.initialSearch ?? '').slice(0, 200));
  const [filters, setFiltersState] = React.useState<readonly DataStudioRowFilter[]>(
    options.initialFilters ?? [],
  );
  const [debouncedSearch, setDebouncedSearch] = React.useState(
    (options.initialSearch ?? '').slice(0, 200),
  );
  const [sortColumnId, setSortColumnId] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');
  const [offset, setOffsetState] = React.useState(0);
  const [offsetHistory, setOffsetHistory] = React.useState<readonly number[]>([]);
  const selectedTableIdRef = React.useRef(selectedTableId);
  const tableStatusRef = React.useRef(tableStatus);
  selectedTableIdRef.current = selectedTableId;
  tableStatusRef.current = tableStatus;

  React.useEffect(() => setTableStatusState(requestedStatus), [requestedStatus]);
  React.useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => clearTimeout(timeout);
  }, [search]);

  const resetPage = React.useCallback(() => {
    setOffsetState(0);
    setOffsetHistory([]);
  }, []);
  const setTableStatus = React.useCallback((status: DataStudioTableStatus | 'all') => {
    setTableStatusState(status);
    resetPage();
  }, [resetPage]);
  const setSearch = React.useCallback((value: string) => {
    setSearchState(value.slice(0, 200));
    resetPage();
  }, [resetPage]);
  const setFilters = React.useCallback((value: readonly DataStudioRowFilter[]) => {
    setFiltersState(Object.freeze([...value]));
    resetPage();
  }, [resetPage]);
  const setSort = React.useCallback((columnId: string | null, direction = 'asc' as const) => {
    setSortColumnId(columnId);
    setSortDirection(direction);
    resetPage();
  }, [resetPage]);
  const selectTable = React.useCallback((tableId: string | null) => {
    setSelectedTableId(tableId);
    setSelectedRowId(null);
    resetPage();
    setFiltersState([]);
    setSortColumnId(null);
    setSortDirection('asc');
  }, [resetPage]);

  return {
    requestedPageSize,
    tableStatus,
    setTableStatusState,
    selectedTableId,
    setSelectedTableId,
    selectedRowId,
    setSelectedRowId,
    search,
    filters,
    setFiltersState,
    debouncedSearch,
    sortColumnId,
    setSortColumnId,
    sortDirection,
    setSortDirection,
    offset,
    setOffsetState,
    offsetHistory,
    setOffsetHistory,
    selectedTableIdRef,
    tableStatusRef,
    resetPage,
    setTableStatus,
    setSearch,
    setFilters,
    setSort,
    selectTable,
  };
}

export function useDataStudioRowQuery(input: {
  readonly capabilities: DataStudioCapabilities | null;
  readonly selectedTable: DataStudioTable | null;
  readonly filters: readonly DataStudioRowFilter[];
  readonly debouncedSearch: string;
  readonly sortColumnId: string | null;
  readonly sortDirection: 'asc' | 'desc';
  readonly offset: number;
  readonly requestedPageSize: number;
}): DataStudioRowQuery {
  const compatibleFilters = React.useMemo(() => input.selectedTable
    ? input.filters.filter((filter) => {
        const column = input.selectedTable!.schema.columns.find(
          (item) => item.key === filter.columnKey,
        );
        return column ? isCompatibleDataStudioFilter(filter, column) : false;
      })
    : [], [input.filters, input.selectedTable?.schemaRevision, input.selectedTable?.tableId]);
  const compatibleSortColumnId = React.useMemo(() => (
    input.selectedTable?.schema.columns.some((column) =>
      column.columnId === input.sortColumnId && column.type !== 'json')
      ? input.sortColumnId
      : null
  ), [input.selectedTable?.schemaRevision, input.selectedTable?.tableId, input.sortColumnId]);

  return React.useMemo<DataStudioRowQuery>(() => ({
    limit: clampDataStudioPageSize(
      input.requestedPageSize,
      input.capabilities?.limits.maxPageSize,
    ),
    offset: input.offset,
    ...(input.debouncedSearch ? { search: input.debouncedSearch } : {}),
    ...(compatibleFilters.length > 0 ? { filters: compatibleFilters } : {}),
    ...(compatibleSortColumnId
      ? { sortColumnId: compatibleSortColumnId, sortDirection: input.sortDirection }
      : {}),
  }), [
    input.capabilities?.limits.maxPageSize,
    input.debouncedSearch,
    input.offset,
    input.requestedPageSize,
    input.sortDirection,
    compatibleFilters,
    compatibleSortColumnId,
  ]);
}
