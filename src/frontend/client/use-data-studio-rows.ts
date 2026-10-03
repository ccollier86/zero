'use client';

/**
 * use-data-studio-rows.ts
 *
 * Owns the active Data Studio row page, request fencing, selection projection,
 * and post-mutation invalidation. It never performs Sync writes.
 */

import * as React from 'react';
import type { AuthorizationScopeBoundary } from './authorization-scope-hooks';
import {
  dataStudioRowQueryKey,
  type DataStudioRow,
  type DataStudioRowPage,
  type DataStudioRowQuery,
  type DataStudioSdkSurface,
  type DataStudioTable,
} from './data-studio-client';
import { toDataStudioError } from './data-studio-controller-types';
import { reportDataStudioFrontendFailure } from './data-studio-observability';

const EMPTY_ROWS: readonly DataStudioRow[] = Object.freeze([]);

interface RetainedVisibleRowPage {
  readonly boundaryKey: string;
  readonly queryKey: string;
  readonly page: DataStudioRowPage;
}

export function useDataStudioRows(input: {
  readonly surface: DataStudioSdkSurface | null;
  readonly boundary: AuthorizationScopeBoundary;
  readonly scopeAvailable: boolean;
  readonly shouldLoad: boolean;
  readonly canRead: boolean;
  readonly cacheVisible: boolean;
  readonly selectedTable: DataStudioTable | null;
  readonly selectedTableIdRef: React.MutableRefObject<string | null>;
  readonly boundaryKeyRef: React.MutableRefObject<string>;
  readonly boundaryReadyRef: React.MutableRefObject<boolean>;
  readonly rowQuery: DataStudioRowQuery;
  readonly selectedRowId: string | null;
  readonly setSelectedRowId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly offset: number;
  readonly offsetHistory: readonly number[];
  readonly setOffsetState: React.Dispatch<React.SetStateAction<number>>;
  readonly setOffsetHistory: React.Dispatch<React.SetStateAction<readonly number[]>>;
}) {
  const [rowsLoading, setRowsLoading] = React.useState(false);
  const [rowsError, setRowsError] = React.useState<Error | null>(null);
  const rowsRequest = React.useRef(0);
  const rowsAbort = React.useRef<AbortController | null>(null);
  const activeRowQueryKeyRef = React.useRef<string | null>(null);
  const activeRowQueryRef = React.useRef<DataStudioRowQuery>({});
  const loadRowsRef = React.useRef<() => Promise<DataStudioRowPage | void>>(async () => {});
  const retainedVisiblePageRef = React.useRef<RetainedVisibleRowPage | null>(null);
  const rowQueryKey = input.selectedTable
    ? dataStudioRowQueryKey(input.selectedTable.tableId, input.rowQuery)
    : null;
  activeRowQueryKeyRef.current = rowQueryKey;
  activeRowQueryRef.current = input.rowQuery;
  const cachedPage = input.cacheVisible && rowQueryKey
    ? input.surface?.cache.getRowPage(rowQueryKey)
    : undefined;
  const retainedVisiblePage = retainedVisiblePageRef.current;
  const visiblePageIdentityMatches = retainedVisiblePage !== null
    && retainedVisiblePage.boundaryKey === input.boundary.key
    && retainedVisiblePage.queryKey === rowQueryKey;
  const visiblePage = cachedPage ?? (visiblePageIdentityMatches
    ? retainedVisiblePage.page
    : undefined);
  const rows = input.canRead ? visiblePage?.rows ?? EMPTY_ROWS : EMPTY_ROWS;

  React.useLayoutEffect(() => {
    if (!input.cacheVisible || !input.canRead || !rowQueryKey) {
      retainedVisiblePageRef.current = null;
    } else if (cachedPage) {
      // Record only a page which React actually committed. Mutating this ref
      // during render would let an abandoned concurrent render discard the
      // page belonging to the still-visible query.
      retainedVisiblePageRef.current = {
        boundaryKey: input.boundary.key,
        queryKey: rowQueryKey,
        page: cachedPage,
      };
    } else {
      const retained = retainedVisiblePageRef.current;
      if (retained && (retained.boundaryKey !== input.boundary.key
        || retained.queryKey !== rowQueryKey)) {
        // Never carry a stale projection across a scope, table, filter, sort,
        // search, or pagination transition. Retention exists only to bridge
        // invalidation/refetch of the exact page already on screen.
        retainedVisiblePageRef.current = null;
      }
    }
  }, [
    cachedPage,
    input.boundary.key,
    input.cacheVisible,
    input.canRead,
    rowQueryKey,
  ]);

  React.useEffect(() => {
    rowsRequest.current += 1;
    rowsAbort.current?.abort();
    rowsAbort.current = null;
    setRowsError(null);
    if (!input.scopeAvailable || !input.surface) setRowsLoading(false);
    return () => {
      rowsRequest.current += 1;
      rowsAbort.current?.abort();
      rowsAbort.current = null;
    };
  }, [input.boundary.key, input.scopeAvailable, input.surface]);

  const loadRows = React.useCallback(async (): Promise<DataStudioRowPage | void> => {
    const capturedTableId = input.selectedTable?.tableId;
    if (!input.surface || !input.shouldLoad || !capturedTableId || !input.canRead) return;
    const capturedKey = input.boundary.key;
    const capturedQueryKey = dataStudioRowQueryKey(capturedTableId, input.rowQuery);
    if (input.selectedTableIdRef.current !== capturedTableId
      || activeRowQueryKeyRef.current !== capturedQueryKey) return;
    const requestId = ++rowsRequest.current;
    rowsAbort.current?.abort();
    const controller = new AbortController();
    rowsAbort.current = controller;
    setRowsLoading(true);
    setRowsError(null);
    try {
      return await input.surface.listRows(capturedTableId, input.rowQuery, {
        signal: controller.signal,
      });
    } catch (cause) {
      if (!controller.signal.aborted && isCurrentRequest()) {
        setRowsError(toDataStudioError(cause));
        reportDataStudioFrontendFailure('row-page.load', 'load', cause);
      }
    } finally {
      if (isCurrentRequest()) setRowsLoading(false);
      if (rowsAbort.current === controller) rowsAbort.current = null;
    }
    function isCurrentRequest(): boolean {
      return requestId === rowsRequest.current
        && input.boundaryReadyRef.current
        && input.boundaryKeyRef.current === capturedKey;
    }
  }, [
    input.boundary.key,
    input.canRead,
    input.rowQuery,
    input.selectedTable?.tableId,
    input.shouldLoad,
    input.surface,
  ]);
  loadRowsRef.current = loadRows;

  const refreshRowsAfterMutation = React.useCallback(async (
    tableId: string,
    expectedScopeKey: string,
  ): Promise<DataStudioRowPage | void> => {
    if (!input.surface || !input.boundaryReadyRef.current
      || input.boundaryKeyRef.current !== expectedScopeKey) return;
    if (input.selectedTableIdRef.current !== tableId) {
      input.surface.invalidateRows(tableId);
      return;
    }
    input.surface.invalidateRows(tableId, activeRowQueryRef.current);
    return loadRowsRef.current();
  }, [input.surface]);

  React.useEffect(() => {
    rowsRequest.current += 1;
    rowsAbort.current?.abort();
    rowsAbort.current = null;
    input.setSelectedRowId(null);
    setRowsError(null);
    if (!input.selectedTable || !input.canRead) {
      setRowsLoading(false);
      return;
    }
    void loadRows();
    return () => {
      rowsRequest.current += 1;
      rowsAbort.current?.abort();
      rowsAbort.current = null;
    };
  }, [input.canRead, input.selectedTable?.tableId, input.setSelectedRowId, loadRows, rowQueryKey]);

  React.useEffect(() => {
    if (rows.length === 0) {
      input.setSelectedRowId(null);
      return;
    }
    if (!rows.some((row) => row.rowId === input.selectedRowId)) {
      input.setSelectedRowId(rows[0]!.rowId);
    }
  }, [input.selectedRowId, input.setSelectedRowId, rows]);

  React.useEffect(() => {
    if (!visiblePage || visiblePage.rows.length > 0
      || input.offset <= 0 || input.offset < visiblePage.total) return;
    const previous = input.offsetHistory.at(-1) ?? 0;
    input.setOffsetHistory((history) => Object.freeze(history.slice(0, -1)));
    input.setOffsetState(previous);
  }, [
    visiblePage,
    input.offset,
    input.offsetHistory,
    input.setOffsetHistory,
    input.setOffsetState,
  ]);

  const selectedRowIndex = rows.findIndex((row) => row.rowId === input.selectedRowId);
  const selectedRow = selectedRowIndex >= 0 ? rows[selectedRowIndex]! : null;
  return {
    rows,
    cachedPage: visiblePage,
    rowsLoading,
    rowsError,
    loadRows,
    loadRowsRef,
    activeRowQueryRef,
    refreshRowsAfterMutation,
    selectedRowIndex,
    selectedRow,
  };
}
