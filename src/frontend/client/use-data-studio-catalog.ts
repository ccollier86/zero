'use client';

/**
 * use-data-studio-catalog.ts
 *
 * Owns authorization-fenced Data Studio catalog/detail reads and their cache
 * projection. Row paging and mutations remain separate concerns.
 */

import * as React from 'react';
import type { AuthorizationScopeBoundary } from './authorization-scope-hooks';
import type {
  DataStudioCacheSnapshot,
  DataStudioSdkSurface,
  DataStudioTableStatus,
} from './data-studio-client';
import {
  resolveDataStudioAccess,
  toDataStudioError,
} from './data-studio-controller-types';
import { reportDataStudioFrontendFailure } from './data-studio-observability';

const EMPTY_TABLES = Object.freeze([]);
const EMPTY_CACHE: DataStudioCacheSnapshot = Object.freeze({
  scopeKey: null,
  capabilities: null,
  tables: EMPTY_TABLES,
  tableDetails: Object.freeze({}),
  rowPages: Object.freeze({}),
});
const NOOP_UNSUBSCRIBE = () => {};

export function useDataStudioCatalog(input: {
  readonly surface: DataStudioSdkSurface | null;
  readonly boundary: AuthorizationScopeBoundary;
  readonly authenticated: boolean;
  readonly enabled: boolean;
  readonly tableStatus: DataStudioTableStatus | 'all';
  readonly selectedTableId: string | null;
  readonly initialTableId?: string | null;
  readonly setSelectedTableId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly onScopeReset: () => void;
}) {
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const [tableLoading, setTableLoading] = React.useState(false);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = React.useState<string | null>(null);
  const [catalogError, setCatalogError] = React.useState<Error | null>(null);
  const [tableError, setTableError] = React.useState<Error | null>(null);
  const catalogRequest = React.useRef(0);
  const tableRequest = React.useRef(0);
  const catalogAbort = React.useRef<AbortController | null>(null);
  const tableAbort = React.useRef<AbortController | null>(null);
  const boundaryKeyRef = React.useRef(input.boundary.key);
  const boundaryReadyRef = React.useRef(input.boundary.ready);
  const onScopeResetRef = React.useRef(input.onScopeReset);
  boundaryKeyRef.current = input.boundary.key;
  boundaryReadyRef.current = input.boundary.ready;
  onScopeResetRef.current = input.onScopeReset;

  const subscribe = React.useCallback(
    (callback: () => void) => input.surface && input.boundary.ready
      ? input.surface.cache.subscribe(callback)
      : NOOP_UNSUBSCRIBE,
    [input.boundary.key, input.boundary.ready, input.surface],
  );
  const getSnapshot = React.useCallback(
    () => input.surface?.cache.getSnapshot() ?? EMPTY_CACHE,
    [input.surface],
  );
  const cache = React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CACHE);
  const scopeAvailable = Boolean(input.surface) && input.boundary.ready && input.authenticated;
  const shouldLoad = input.enabled && scopeAvailable;
  const cacheVisible = shouldLoad
    && cache.scopeKey === input.boundary.key
    && loadedBoundaryKey === input.boundary.key;
  const capabilities = cacheVisible ? cache.capabilities : null;
  const access = React.useMemo(
    () => resolveDataStudioAccess(capabilities),
    [capabilities],
  );
  const tables = React.useMemo(() => {
    if (!cacheVisible || !access.canRead) return EMPTY_TABLES;
    return input.tableStatus === 'all'
      ? cache.tables
      : cache.tables.filter((table) => table.status === input.tableStatus);
  }, [access.canRead, cache.tables, cacheVisible, input.tableStatus]);

  const loadCatalog = React.useCallback(async (): Promise<void> => {
    if (!input.surface || !shouldLoad) return;
    const capturedKey = input.boundary.key;
    const requestId = ++catalogRequest.current;
    catalogAbort.current?.abort();
    const controller = new AbortController();
    catalogAbort.current = controller;
    input.surface.setScope(capturedKey);
    setLoadedBoundaryKey(capturedKey);
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const nextCapabilities = await input.surface.getCapabilities({ signal: controller.signal });
      if (nextCapabilities.enabled && nextCapabilities.permissions.read) {
        await input.surface.listTables(input.tableStatus, { signal: controller.signal });
      }
    } catch (cause) {
      if (!controller.signal.aborted && isCurrentRequest()) {
        setCatalogError(toDataStudioError(cause));
        reportDataStudioFrontendFailure('capabilities-and-catalog.load', 'load', cause);
      }
    } finally {
      if (isCurrentRequest()) setCatalogLoading(false);
      if (catalogAbort.current === controller) catalogAbort.current = null;
    }
    function isCurrentRequest(): boolean {
      return requestId === catalogRequest.current
        && boundaryReadyRef.current
        && boundaryKeyRef.current === capturedKey;
    }
  }, [input.boundary.key, input.surface, input.tableStatus, shouldLoad]);

  React.useEffect(() => {
    catalogRequest.current += 1;
    tableRequest.current += 1;
    catalogAbort.current?.abort();
    tableAbort.current?.abort();
    catalogAbort.current = null;
    tableAbort.current = null;
    setCatalogError(null);
    setTableError(null);
    onScopeResetRef.current();
    if (!scopeAvailable || !input.surface) {
      setLoadedBoundaryKey(null);
      setCatalogLoading(false);
      setTableLoading(false);
      return;
    }
    input.surface.setScope(input.boundary.key);
    setLoadedBoundaryKey(input.boundary.key);
    return () => {
      catalogRequest.current += 1;
      tableRequest.current += 1;
      catalogAbort.current?.abort();
      tableAbort.current?.abort();
      catalogAbort.current = null;
      tableAbort.current = null;
    };
  }, [input.boundary.key, input.surface, scopeAvailable]);

  React.useEffect(() => {
    if (!shouldLoad || !input.surface) return;
    void loadCatalog();
    return () => {
      catalogRequest.current += 1;
      catalogAbort.current?.abort();
      catalogAbort.current = null;
    };
  }, [input.surface, loadCatalog, shouldLoad]);

  React.useEffect(() => {
    if (tables.length === 0) {
      input.setSelectedTableId(null);
      return;
    }
    if (!tables.some((table) => table.tableId === input.selectedTableId)) {
      const preferred = input.initialTableId
        ? tables.find((table) => table.tableId === input.initialTableId)
        : null;
      input.setSelectedTableId(preferred?.tableId ?? tables[0]!.tableId);
    }
  }, [input.initialTableId, input.selectedTableId, input.setSelectedTableId, tables]);

  const selectedTableSummary = tables.find(
    (table) => table.tableId === input.selectedTableId,
  ) ?? null;
  const selectedTable = cacheVisible && input.selectedTableId
    ? cache.tableDetails[input.selectedTableId] ?? null
    : null;
  const loadTable = React.useCallback(async (): Promise<void> => {
    if (!input.surface || !shouldLoad || !selectedTableSummary || !access.canRead) return;
    const capturedKey = input.boundary.key;
    const capturedTableId = selectedTableSummary.tableId;
    const requestId = ++tableRequest.current;
    tableAbort.current?.abort();
    const controller = new AbortController();
    tableAbort.current = controller;
    setTableLoading(true);
    setTableError(null);
    try {
      await input.surface.getTable(capturedTableId, { signal: controller.signal });
    } catch (cause) {
      if (!controller.signal.aborted && isCurrentRequest()) {
        setTableError(toDataStudioError(cause));
        reportDataStudioFrontendFailure('table-detail.load', 'load', cause);
      }
    } finally {
      if (isCurrentRequest()) setTableLoading(false);
      if (tableAbort.current === controller) tableAbort.current = null;
    }
    function isCurrentRequest(): boolean {
      return requestId === tableRequest.current
        && boundaryReadyRef.current
        && boundaryKeyRef.current === capturedKey;
    }
  }, [access.canRead, input.boundary.key, input.surface, selectedTableSummary, shouldLoad]);

  React.useEffect(() => {
    tableRequest.current += 1;
    tableAbort.current?.abort();
    tableAbort.current = null;
    setTableError(null);
    if (!selectedTableSummary || !access.canRead) {
      setTableLoading(false);
      return;
    }
    if (cache.tableDetails[selectedTableSummary.tableId]?.revision === selectedTableSummary.revision) {
      setTableLoading(false);
      return;
    }
    void loadTable();
    return () => {
      tableRequest.current += 1;
      tableAbort.current?.abort();
      tableAbort.current = null;
    };
  }, [access.canRead, cache.tableDetails, loadTable, selectedTableSummary]);

  const refreshTableAfterMutation = React.useCallback(async (
    tableId: string,
    expectedScopeKey: string,
  ): Promise<void> => {
    if (!input.surface || !boundaryReadyRef.current
      || boundaryKeyRef.current !== expectedScopeKey) return;
    try {
      await input.surface.getTable(tableId);
    } catch (cause) {
      if (boundaryReadyRef.current && boundaryKeyRef.current === expectedScopeKey) {
        setTableError(toDataStudioError(cause));
        reportDataStudioFrontendFailure('table-summary.refresh', 'load', cause);
      }
    }
  }, [input.surface]);

  return {
    cache,
    cacheVisible,
    capabilities,
    access,
    tables,
    selectedTable,
    scopeAvailable,
    shouldLoad,
    catalogLoading,
    tableLoading,
    catalogError,
    tableError,
    setCatalogError,
    boundaryKeyRef,
    boundaryReadyRef,
    loadCatalog,
    loadTable,
    refreshTableAfterMutation,
  };
}
