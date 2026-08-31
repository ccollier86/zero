/**
 * use-master-detail-state.ts
 *
 * Owns live data resolution and selected-row state for master-detail views.
 * This hook consumes the frontend SDK client and pure selection helpers; it
 * does not render UI, build forms, or know table column presentation.
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Row } from '../../sync/types';
import type { LazyCollectionOptions } from '../../frontend/client/data-hooks';
import {
  useDataTableSource,
  type DataTableFilters,
  type DataTableSource,
  type DataTableSourceActions,
  type DataTableSourceState,
} from '../data-table/data-table-source';
import { requireRowPrimaryKey } from '../data-table/row-identity';
import { resolveMasterDetailSelection } from './master-detail-selection';

export type MasterDetailLiveActions<T extends Row> = DataTableSourceActions<T>;

export interface UseMasterDetailStateOptions<T extends Row> {
  /** Explicit data source contract shared with DataTableView. */
  source?: DataTableSource<T>;
  /** Static rows used when `source` and `collection` are omitted. */
  data?: T[];
  /** Live collection name. Prefer `source` for new generic data-source code. */
  collection?: string;
  /** Fetch `collection` through `/api/data` before rendering rows. */
  lazy?: boolean;
  /** Lazy `/api/data` equality filters. */
  filters?: DataTableFilters;
  /** Lazy `/api/data` ordering, limit, and offset options. */
  lazyOptions?: LazyCollectionOptions;
  primaryKey: string;
  selectedId?: string | null;
  defaultSelectedId?: string | null;
  autoSelectFirst?: boolean;
  onSelect?: (item: T) => void;
  onSelectedIdChange?: (id: string | null, item: T | null) => void;
}

export interface UseMasterDetailStateReturn<T extends Row> {
  data: T[];
  selectedId: string | null;
  selectedItem: T | null;
  selectedIndex: number;
  totalCount: number;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  selectRow: (row: T) => void;
  selectId: (id: string | null) => void;
  selectPrevious: () => void;
  selectNext: () => void;
  liveActions: MasterDetailLiveActions<T> | null;
  sourceType: DataTableSourceState<T>['sourceType'];
  isLoading: boolean;
  error: Error | string | null;
  refresh: () => void;
}

/**
 * Resolve data and selection state for a master-detail component.
 *
 * Supports the same data-source contract as DataTableView, plus controlled
 * selection and uncontrolled selection with optional first-row auto-selection.
 */
export function useMasterDetailState<T extends Row>({
  source,
  data: dataProp,
  collection,
  lazy,
  filters,
  lazyOptions,
  primaryKey,
  selectedId: selectedIdProp,
  defaultSelectedId,
  autoSelectFirst = true,
  onSelect,
  onSelectedIdChange,
}: UseMasterDetailStateOptions<T>): UseMasterDetailStateReturn<T> {
  const resolvedSource = useDataTableSource<T>({
    source,
    data: dataProp,
    collection,
    lazy,
    filters,
    lazyOptions,
  });
  const data = resolvedSource.data;
  const isControlled = selectedIdProp !== undefined;
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    defaultSelectedId ?? null,
  );

  const selection = useMemo(
    () => resolveMasterDetailSelection(
      data,
      primaryKey,
      isControlled ? selectedIdProp : internalSelectedId,
      !isControlled && autoSelectFirst,
    ),
    [autoSelectFirst, data, internalSelectedId, isControlled, primaryKey, selectedIdProp],
  );

  useEffect(() => {
    if (isControlled || selection.selectedId === internalSelectedId) return;

    setInternalSelectedId(selection.selectedId);
    onSelectedIdChange?.(selection.selectedId, selection.selectedItem);
  }, [
    internalSelectedId,
    isControlled,
    onSelectedIdChange,
    selection.selectedId,
    selection.selectedItem,
  ]);

  const commitSelection = useCallback(
    (id: string | null, item: T | null) => {
      if (!isControlled) setInternalSelectedId(id);
      onSelectedIdChange?.(id, item);
      if (item) onSelect?.(item);
    },
    [isControlled, onSelect, onSelectedIdChange],
  );

  const selectRow = useCallback(
    (row: T) => {
      commitSelection(requireRowPrimaryKey(row, primaryKey), row);
    },
    [commitSelection, primaryKey],
  );

  const selectId = useCallback(
    (id: string | null) => {
      const next = resolveMasterDetailSelection(data, primaryKey, id, false);
      commitSelection(next.selectedId, next.selectedItem);
    },
    [commitSelection, data, primaryKey],
  );

  const selectPrevious = useCallback(() => {
    if (selection.selectedIndex > 0) {
      selectRow(data[selection.selectedIndex - 1]!);
    }
  }, [data, selectRow, selection.selectedIndex]);

  const selectNext = useCallback(() => {
    if (selection.selectedIndex >= 0 && selection.selectedIndex < data.length - 1) {
      selectRow(data[selection.selectedIndex + 1]!);
    }
  }, [data, selectRow, selection.selectedIndex]);

  return {
    data,
    selectedId: selection.selectedId,
    selectedItem: selection.selectedItem,
    selectedIndex: selection.selectedIndex,
    totalCount: data.length,
    canSelectPrevious: selection.selectedIndex > 0,
    canSelectNext: selection.selectedIndex >= 0 && selection.selectedIndex < data.length - 1,
    selectRow,
    selectId,
    selectPrevious,
    selectNext,
    liveActions: resolvedSource.actions,
    sourceType: resolvedSource.sourceType,
    isLoading: resolvedSource.isLoading,
    error: resolvedSource.error,
    refresh: resolvedSource.refresh,
  };
}
