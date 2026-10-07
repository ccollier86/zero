/**
 * data-table-source.ts
 *
 * Resolves DataTable rows from caller-owned arrays, reactive collections,
 * lazy hydration, or isolated server pages. This hook owns data-source wiring
 * only; it does not render table UI or build TanStack column definitions.
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../../frontend/client/authorization-scope-hooks';
import type { LazyCollectionOptions } from '../../frontend/client/data-hooks';
import type { Row } from '../../sync/types';
import type {
  DataTableServerPage,
  DataTableServerQuery,
  DataTableServerSource,
} from './data-table-server-types';
import { invokeDataTableSourceWrite } from './data-table-source-action-guard';
import { useOptionalDataTableCollection } from './use-data-table-collection-source';
import { useDataTableServerSource } from './use-data-table-server-source';

const EMPTY_ARRAY: never[] = [];

export type DataTableFilterValue = string | number | boolean;
export type DataTableFilters = Record<string, DataTableFilterValue>;

export interface DataTableSourceActions<T extends Row> {
  insert: (row: T, options?: { signal?: AbortSignal }) => void | Promise<void>;
  update: (
    id: string,
    partial: Partial<T>,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
  remove: (id: string, options?: { signal?: AbortSignal }) => void | Promise<void>;
  load: (rows: T[], options?: { replace?: boolean }) => void;
  clear: () => void;
}

export type DataTableSource<T extends Row = Row> =
  | {
      type: 'data';
      data: T[];
      actions?: Partial<DataTableSourceActions<T>>;
      isLoading?: boolean;
      error?: Error | string | null;
      refresh?: () => void | Promise<void>;
    }
  | {
      type: 'collection';
      table: string;
    }
  | {
      type: 'lazy';
      table: string;
      filters?: DataTableFilters;
      options?: LazyCollectionOptions;
      replaceOnLoad?: boolean;
    }
  | DataTableServerSource<T>;

export interface UseDataTableSourceOptions<T extends Row> {
  source?: DataTableSource<T>;
  data?: T[];
  collection?: string;
  lazy?: boolean;
  filters?: DataTableFilters;
  lazyOptions?: LazyCollectionOptions;
  query?: DataTableServerQuery;
  primaryKey?: string;
  /** Skip separate live membership reads when held-arrival presentation is disabled. */
  confirmLiveInsertions?: boolean;
}

export interface DataTableSourceState<T extends Row> {
  data: T[];
  sourceType: DataTableSource<T>['type'];
  table: string | null;
  isLoading: boolean;
  error: Error | string | null;
  page: DataTableServerPage | null;
  refresh: () => void | Promise<void>;
  actions: DataTableSourceActions<T> | null;
  /** Server-only speculative reads; cursor targets must already be known. */
  prefetchPage?: (pageIndex: number) => Promise<void>;
  /** Previous-query server rows are presentation-only while the next page loads. */
  isPreviousData?: boolean;
  requestKey?: string | null;
  resolvedRequestKey?: string | null;
  resultRevision?: number;
  /** Live invalidation does not itself prove new-record insertion. */
  changeReason?: 'query' | 'refresh' | 'live' | null;
  /** Genuine live INSERTs whose query/page membership was confirmed by the current server response. */
  liveInsertedRowIds?: readonly string[];
  /** Query-matching INSERT identities confirmed separately from the current page, without merging lookup rows. */
  confirmedLiveInsertedRowIds?: readonly string[];
  /** Retire held server insertion evidence when the reading view reveals it. */
  clearLiveInsertions?: () => void;
}

/**
 * Build the lazy `/api/data` query string for a table request.
 *
 * Values are stringified at the transport boundary so callers can pass common
 * UI filter values without hand-normalizing them first.
 */
export function buildDataTableLazyQuery(
  table: string,
  filters?: DataTableFilters,
  opts?: LazyCollectionOptions,
): string {
  const params = new URLSearchParams({ table });

  if (filters) {
    for (const [field, value] of Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))) {
      params.append('filter', `${field}:${String(value)}`);
    }
  }
  if (opts?.order) params.set('order', opts.order);
  if (opts?.dir) params.set('dir', opts.dir);
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) params.set('offset', String(opts.offset));

  return params.toString();
}

function resolveDataTableSource<T extends Row>({
  source,
  data,
  collection,
  lazy,
  filters,
  lazyOptions,
}: UseDataTableSourceOptions<T>): DataTableSource<T> {
  if (source) return source;
  if (collection) {
    return lazy
      ? { type: 'lazy', table: collection, filters, options: lazyOptions }
      : { type: 'collection', table: collection };
  }
  return { type: 'data', data: data ?? (EMPTY_ARRAY as T[]) };
}

/**
 * Resolve rows, mutation actions, loading, and refresh state for a DataTable.
 *
 * Full-sync, lazy, and built-in server sources use the frontend SDK client so
 * auth headers, refresh behavior, and optimistic writes stay consistent with
 * the rest of Zero's frontend data layer.
 */
export function useDataTableSource<T extends Row = Row>(
  options: UseDataTableSourceOptions<T>,
): DataTableSourceState<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const resolved = resolveDataTableSource(options);
  const sourceType = resolved.type;
  const table = sourceType === 'collection' || sourceType === 'lazy' || sourceType === 'server'
    ? resolved.table
    : null;
  const collectionTable = resolveDataTableCollectionTable(sourceType, table, client);
  const collection = useOptionalDataTableCollection<T>(collectionTable);
  const server = useDataTableServerSource<T>({
    source: sourceType === 'server' ? resolved : null,
    query: options.query,
    primaryKey: options.primaryKey,
    confirmLiveInsertions: options.confirmLiveInsertions,
    liveRevision: collection.data,
  });
  const [isLazyLoading, setIsLazyLoading] = useState(false);
  const [lazyError, setLazyError] = useState<Error | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const loadedRef = useRef('');
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const isCurrentScope = useCallback(
    () => isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    ),
    [callbackBoundaryKey],
  );

  const lazyFilters = sourceType === 'lazy' ? resolved.filters : undefined;
  const lazyOptions = sourceType === 'lazy' ? resolved.options : undefined;
  const replaceOnLoad = sourceType === 'lazy'
    ? resolved.replaceOnLoad ?? !!resolved.filters
    : false;
  const lazyQuery = sourceType === 'lazy'
    ? buildDataTableLazyQuery(resolved.table, lazyFilters, lazyOptions)
    : '';

  const doLazyFetch = useCallback(() => {
    if (!client
      || !authorizationBoundary.ready
      || !isCurrentScope()
      || sourceType !== 'lazy'
      || !table
      || !collection.actions) return;

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    const requestBoundaryKey = callbackBoundaryKey;
    setLoadedBoundaryKey(requestBoundaryKey);
    setIsLazyLoading(true);
    setLazyError(null);

    client.fetch<{ rows: T[] }>(`/api/data?${lazyQuery}`, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted
          || requestIdRef.current !== requestId
          || !boundaryReadyRef.current
          || boundaryKeyRef.current !== requestBoundaryKey) return;
        collection.actions?.load(payload.rows, { replace: replaceOnLoad });
      })
      .catch((error) => {
        if (controller.signal.aborted
          || requestIdRef.current !== requestId
          || !boundaryReadyRef.current
          || boundaryKeyRef.current !== requestBoundaryKey) return;
        setLazyError(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
        if (controller.signal.aborted
          || requestIdRef.current !== requestId
          || !boundaryReadyRef.current
          || boundaryKeyRef.current !== requestBoundaryKey) return;
        setIsLazyLoading(false);
      });
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    callbackBoundaryKey,
    client,
    collection.actions,
    isCurrentScope,
    lazyQuery,
    replaceOnLoad,
    sourceType,
    table,
  ]);

  useEffect(() => {
    requestIdRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    loadedRef.current = '';
    setLoadedBoundaryKey(authorizationBoundary.key);
    setLazyError(null);
    setIsLazyLoading(false);
    if (!authorizationBoundary.ready || sourceType !== 'lazy' || !client) return;
    if (loadedRef.current === lazyQuery) return;
    loadedRef.current = lazyQuery;
    doLazyFetch();
    return () => {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    client,
    doLazyFetch,
    lazyQuery,
    sourceType,
  ]);

  const refresh = useCallback(() => {
    if (!isCurrentScope()) return;
    if (sourceType === 'lazy') {
      loadedRef.current = '';
      doLazyFetch();
    } else if (sourceType === 'data') {
      return resolved.refresh?.();
    }
  }, [doLazyFetch, isCurrentScope, resolved, sourceType]);

  const dataActions = useMemo<DataTableSourceActions<T> | null>(() => {
    if (sourceType !== 'data' || !resolved.actions) return null;
    const actions = resolved.actions;
    return {
      insert: (row, actionOptions) => invokeDataTableSourceWrite(
        'insert',
        isCurrentScope(),
        actions.insert ? () => actions.insert!(row, actionOptions) : undefined,
      ),
      update: (id, partial, actionOptions) => invokeDataTableSourceWrite(
        'update',
        isCurrentScope(),
        actions.update ? () => actions.update!(id, partial, actionOptions) : undefined,
      ),
      remove: (id, actionOptions) => invokeDataTableSourceWrite(
        'remove',
        isCurrentScope(),
        actions.remove ? () => actions.remove!(id, actionOptions) : undefined,
      ),
      load: (rows, loadOptions) => {
        if (isCurrentScope()) actions.load?.(rows, loadOptions);
      },
      clear: () => {
        if (isCurrentScope()) actions.clear?.();
      },
    };
  }, [isCurrentScope, resolved, sourceType]);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;

  if (sourceType === 'data') {
    return {
      data: visible ? resolved.data : EMPTY_ARRAY as T[],
      sourceType,
      table: null,
      isLoading: visible ? !!resolved.isLoading : authorizationBoundary.ready,
      error: visible ? resolved.error ?? null : null,
      page: null,
      refresh,
      actions: dataActions,
    };
  }

  if (sourceType === 'server') {
    return {
      data: server.data,
      sourceType,
      table,
      isLoading: server.isLoading,
      error: server.error,
      page: server.page,
      refresh: server.refresh,
      actions: collection.actions,
      prefetchPage: server.prefetchPage,
      isPreviousData: server.isPreviousData,
      requestKey: server.requestKey,
      resolvedRequestKey: server.resolvedRequestKey,
      resultRevision: server.resultRevision,
      changeReason: server.changeReason,
      liveInsertedRowIds: server.liveInsertedRowIds,
      confirmedLiveInsertedRowIds: server.confirmedLiveInsertedRowIds,
      clearLiveInsertions: server.clearLiveInsertions,
    };
  }

  return {
    data: visible ? collection.data ?? (EMPTY_ARRAY as T[]) : EMPTY_ARRAY as T[],
    sourceType,
    table,
    isLoading: sourceType === 'lazy'
      ? authorizationBoundary.ready && (!visible || isLazyLoading)
      : false,
    error: sourceType === 'lazy' && visible ? lazyError : null,
    page: null,
    refresh,
    actions: collection.actions,
  };
}

/** Server transports may target logical tables that have no ReactiveDB collection. */
export function resolveDataTableCollectionTable(
  sourceType: DataTableSource<Row>['type'],
  table: string | null,
  client: ReturnType<typeof useClientMaybe>,
): string | null {
  if (sourceType !== 'server') return table;
  if (!client || !table) return null;
  return (client as Partial<InternalClient>)._syncClient?.tables[table]
    ? table
    : null;
}
