'use client';

/** Scope-fenced bounded progressive reads and coherent reactive prefix reconciliation. */
import * as React from 'react';
import { createDataStudioOperationId, dataStudioRowQueryKey, type DataStudioRowPage } from './data-studio-client';
import { toDataStudioError } from './data-studio-controller-types';
import { reportDataStudioFrontendFailure } from './data-studio-observability';
import {
  appendDataStudioRowPage, DataStudioWindowChangedError, type DataStudioRowWindow,
} from './data-studio-row-window';
import type { DataStudioRowsInput } from './use-data-studio-rows';

interface WindowState {
  readonly key: string;
  readonly window: DataStudioRowWindow | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: Error | null;
  readonly loadMoreError: Error | null;
  readonly requiresRefresh: boolean;
}
const emptyState = (key: string): WindowState => ({
  key, window: null, loading: false, loadingMore: false,
  error: null, loadMoreError: null, requiresRefresh: false,
});

/** HTTP batch ownership is separate from the shared cache; raw cached rows are never membership. */
export function useDataStudioProgressiveRows(input: DataStudioRowsInput & { readonly enabled: boolean }) {
  const available = input.enabled && input.canRead && input.cacheVisible
    && input.shouldLoad && input.scopeAvailable && input.boundary.ready;
  const tableId = input.selectedTable?.tableId ?? null;
  // Presentation-only identity for the actual service instance. This token is
  // not sent as a database selector, credential or mutation receipt.
  const sourceIdentity = React.useMemo(() => createDataStudioOperationId(), [input.surface]);
  const queryKey = tableId ? dataStudioRowQueryKey(tableId, { ...input.rowQuery, offset: 0 }) : '';
  const key = JSON.stringify([sourceIdentity, input.boundary.key, tableId, input.selectedTable?.schemaRevision, queryKey, available]);
  const [state, setState] = React.useState(() => emptyState(key));
  const stateRef = React.useRef(state);
  const keyRef = React.useRef(key);
  const mounted = React.useRef(false);
  const request = React.useRef(0);
  const pending = React.useRef<{
    key: string; abort: AbortController; promise: Promise<DataStudioRowPage | void>;
  } | null>(null);
  keyRef.current = key;
  const active = state.key === key && available ? state : emptyState(key);
  const activeRowQueryRef = React.useRef(input.rowQuery);
  activeRowQueryRef.current = { ...input.rowQuery, offset: 0 };
  const loadRowsRef = React.useRef<() => Promise<DataStudioRowPage | void>>(async () => {});
  const commit = React.useCallback((next: WindowState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  React.useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      pending.current?.abort.abort();
      pending.current = null;
    };
  }, []);

  const run = React.useCallback((append: boolean): Promise<DataStudioRowPage | void> => {
    const surface = input.surface;
    if (!mounted.current || !available || !surface || !tableId
      || keyRef.current !== key || input.selectedTableIdRef.current !== tableId) return Promise.resolve();
    const previous = stateRef.current.key === key ? stateRef.current : emptyState(key);
    if (append && previous.requiresRefresh) return loadRowsRef.current();
    if (append && (!previous.window || previous.window.page.nextOffset === null)) return Promise.resolve();
    if (append && pending.current?.key === key) return pending.current.promise;
    pending.current?.abort.abort();
    const abort = new AbortController();
    const capturedRequest = ++request.current;
    commit({ ...previous, loading: !append, loadingMore: append, error: null, loadMoreError: null });
    const isCurrent = () => mounted.current && !abort.signal.aborted
      && request.current === capturedRequest && keyRef.current === key
      && input.boundaryReadyRef.current && input.boundaryKeyRef.current === input.boundary.key
      && input.selectedTableIdRef.current === tableId;
    const read = async (offset: number) => {
      const page = await surface.listRows(tableId, { ...input.rowQuery, offset }, { signal: abort.signal });
      if (!isCurrent()) return;
      if (page.rows.some(row => row.tableId !== tableId)) throw new DataStudioWindowChangedError();
      return page;
    };
    const promise = (async () => {
      try {
        let window: DataStudioRowWindow | null = null;
        if (append) {
          const page = await read(previous.window!.page.nextOffset!);
          if (!page) return;
          window = appendDataStudioRowPage(previous.window, page);
        } else {
          const target = Math.max(previous.window?.rows.length ?? 0, input.rowQuery.limit ?? 50);
          // At most one restart on drift. Continuous writes must not cause an
          // unbounded retry loop or publication of mixed-snapshot offsets.
          for (let attempt = 0; attempt < 2; attempt += 1) {
            window = null;
            try {
              do {
                const page = await read(window?.page.nextOffset ?? 0);
                if (!page) return;
                window = appendDataStudioRowPage(window, page);
              } while (window.page.nextOffset !== null && window.rows.length < target);
              break;
            } catch (cause) {
              if (!(cause instanceof DataStudioWindowChangedError) || attempt === 1) throw cause;
            }
          }
        }
        if (!isCurrent() || !window) return;
        commit({ ...emptyState(key), window });
        return window.page;
      } catch (cause) {
        if (!isCurrent()) return;
        const error = toDataStudioError(cause);
        const changed = cause instanceof DataStudioWindowChangedError;
        commit({ ...previous, loading: false, loadingMore: false,
          error: append ? null : error, loadMoreError: append ? error : null,
          requiresRefresh: changed });
        if (!changed) reportDataStudioFrontendFailure('row-page.load', 'load', cause);
      } finally {
        if (pending.current?.abort === abort) pending.current = null;
      }
    })();
    pending.current = { key, abort, promise };
    return promise;
  }, [available, commit, input.boundary.key, input.rowQuery, input.surface, key, tableId]);

  const loadRows = React.useCallback(() => run(false), [run]);
  loadRowsRef.current = loadRows;
  const loadMoreRows = React.useCallback(async () => { await run(true); }, [run]);
  React.useEffect(() => {
    pending.current?.abort.abort();
    pending.current = null;
    request.current += 1;
    commit(emptyState(key));
    if (input.enabled) input.setSelectedRowId(null);
    if (available) void loadRowsRef.current();
    return () => {
      pending.current?.abort.abort();
      pending.current = null;
      request.current += 1;
    };
  }, [available, commit, input.enabled, input.setSelectedRowId, key]);

  const rows = active.window?.rows ?? EMPTY_ROWS;
  React.useEffect(() => {
    if (!input.enabled || !available) return;
    input.setSelectedRowId(current => rows.some(row => row.rowId === current)
      ? current : rows[0]?.rowId ?? null);
  }, [available, input.enabled, input.setSelectedRowId, rows]);
  const refreshRowsAfterMutation = React.useCallback(async (id: string, expectedScopeKey: string) => {
    if (!mounted.current || !input.surface || !input.boundaryReadyRef.current
      || input.boundaryKeyRef.current !== expectedScopeKey) return;
    input.surface.invalidateRows(id);
    if (input.selectedTableIdRef.current === id) return loadRowsRef.current();
  }, [input.surface]);
  const selectedRowIndex = rows.findIndex(row => row.rowId === input.selectedRowId);
  return {
    rows, cachedPage: active.window?.page,
    rowsLoading: active.loading, rowsError: active.error,
    loadRows, loadRowsRef, activeRowQueryRef, refreshRowsAfterMutation,
    selectedRowIndex, selectedRow: selectedRowIndex < 0 ? null : rows[selectedRowIndex]!,
    loadMoreRows, hasMoreRows: active.window?.page.nextOffset != null,
    isLoadingMore: active.loadingMore, loadMoreError: active.loadMoreError,
    rowsNeedRefresh: active.requiresRefresh, rowWindowKey: key,
  };
}

const EMPTY_ROWS = Object.freeze([]);
