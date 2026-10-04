'use client';

/** Optional controlled interaction state shared by local and server-backed tables. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
  Updater,
  VisibilityState,
} from '@tanstack/react-table';
import { stableValueKey } from '../../frontend/client/query-params';

export interface DataTableState {
  globalFilter: string;
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  pagination: PaginationState;
  rowSelection: RowSelectionState;
  columnVisibility: VisibilityState;
}

export interface DataTableInitialState extends Partial<Omit<DataTableState, 'pagination'>> {
  pagination?: Partial<PaginationState>;
}

export interface DataTableStateOptions {
  initialState?: DataTableInitialState;
  state?: Partial<DataTableState>;
  onStateChange?: (state: DataTableState) => void;
  pageSize?: number;
  /** Opaque authorization/source partition; never an untrusted tenant selector. */
  boundaryKey?: string;
}

/** Reset page-local selection whenever the query or page changes. */
export function applyDataTableStateChange<Key extends keyof DataTableState>(
  state: DataTableState,
  key: Key,
  update: Updater<DataTableState[Key]>,
): DataTableState {
  const value = typeof update === 'function'
    ? (update as (previous: DataTableState[Key]) => DataTableState[Key])(state[key])
    : update;
  const next = { ...state, [key]: value };
  if (key === 'globalFilter' || key === 'columnFilters' || key === 'sorting') {
    next.pagination = { ...state.pagination, pageIndex: 0 };
    next.rowSelection = {};
  }
  if (key === 'pagination') {
    const pagination = value as PaginationState;
    next.pagination = {
      pageIndex: pagination.pageSize !== state.pagination.pageSize ? 0 : Math.max(0, pagination.pageIndex),
      pageSize: Math.max(1, pagination.pageSize),
    };
    next.rowSelection = {};
  }
  return next;
}

/** Own only uncontrolled facets; every update reports the complete interaction state. */
export function useDataTableState(options: DataTableStateOptions = {}) {
  const [local, setLocal] = useState<DataTableState>(() => createInitialState(options));
  const scope = useRef(options.boundaryKey);
  const blockedSelection = useRef<string | undefined>(undefined);
  const blockedPagination = useRef<string | undefined>(undefined);
  const controlledSelectionKey = options.state?.rowSelection === undefined
    ? undefined : stableValueKey(options.state.rowSelection);
  const controlledPaginationKey = options.state?.pagination === undefined
    ? undefined : stableValueKey(options.state.pagination);
  const candidate = { ...local, ...options.state };
  const criteria = queryCriteriaKey(candidate);
  const previousCriteria = useRef(criteria);
  const changedCriteria = previousCriteria.current !== criteria;
  previousCriteria.current = criteria;
  const changedScope = scope.current !== options.boundaryKey;
  let base = local;
  if (changedScope || changedCriteria) {
    scope.current = options.boundaryKey;
    blockedSelection.current = controlledSelectionKey;
    blockedPagination.current = controlledPaginationKey;
    base = { ...local, pagination: { ...local.pagination, pageIndex: 0 }, rowSelection: {} };
    setLocal(base);
  }
  const state = { ...base, ...options.state };
  if (changedScope || changedCriteria || (blockedSelection.current !== undefined
    && blockedSelection.current === controlledSelectionKey)) {
    state.rowSelection = {};
  } else if (blockedSelection.current !== controlledSelectionKey) {
    blockedSelection.current = undefined;
  }
  if (changedScope || changedCriteria || (blockedPagination.current !== undefined
    && blockedPagination.current === controlledPaginationKey)) {
    state.pagination = { ...state.pagination, pageIndex: 0 };
  } else if (blockedPagination.current !== controlledPaginationKey) {
    blockedPagination.current = undefined;
  }
  const latest = useRef(state);
  latest.current = state;
  const onChange = useRef(options.onStateChange);
  onChange.current = options.onStateChange;
  const notifiedScope = useRef(options.boundaryKey);
  const notifiedCriteria = useRef(criteria);
  useEffect(() => {
    if (notifiedScope.current === options.boundaryKey && notifiedCriteria.current === criteria) return;
    notifiedScope.current = options.boundaryKey;
    notifiedCriteria.current = criteria;
    onChange.current?.(latest.current);
  }, [options.boundaryKey, criteria]);
  const update = useCallback(<Key extends keyof DataTableState>(
    key: Key,
    value: Updater<DataTableState[Key]>,
  ) => {
    if (key === 'rowSelection') blockedSelection.current = undefined;
    if (key === 'pagination' || key === 'globalFilter' || key === 'columnFilters' || key === 'sorting') {
      blockedPagination.current = undefined;
      blockedSelection.current = undefined;
    }
    const next = applyDataTableStateChange(latest.current, key, value);
    latest.current = next;
    notifiedCriteria.current = queryCriteriaKey(next);
    setLocal(next);
    onChange.current?.(next);
  }, []);
  const replace = useCallback((next: DataTableState) => {
    blockedSelection.current = undefined;
    blockedPagination.current = undefined;
    latest.current = next;
    notifiedCriteria.current = queryCriteriaKey(next);
    setLocal(next);
    onChange.current?.(next);
  }, []);
  return { state, update, replace };
}

function queryCriteriaKey(state: DataTableState): string {
  return stableValueKey([state.globalFilter, state.columnFilters, state.sorting, state.pagination.pageSize]);
}

function createInitialState(options: DataTableStateOptions): DataTableState {
  const initial = options.initialState;
  return {
    globalFilter: initial?.globalFilter ?? '',
    columnFilters: initial?.columnFilters ?? [],
    sorting: initial?.sorting ?? [],
    pagination: {
      pageIndex: initial?.pagination?.pageIndex ?? 0,
      pageSize: initial?.pagination?.pageSize ?? options.pageSize ?? 20,
    },
    rowSelection: initial?.rowSelection ?? {},
    columnVisibility: initial?.columnVisibility ?? {},
  };
}
