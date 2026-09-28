/**
 * data-table-source.ts
 *
 * Resolves DataTable rows from caller-owned arrays, reactive collections, or
 * lazy `/api/data` reads. This hook owns data-source wiring only; it does not
 * render table UI or build TanStack column definitions.
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useClientMaybe } from '../../frontend/client/client-context';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../../frontend/client/authorization-scope-hooks';
import type { LazyCollectionOptions } from '../../frontend/client/data-hooks';
import type { Row } from '../../sync/types';

const NOOP_UNSUBSCRIBE = () => {};
const EMPTY_RECORD: Record<string, never> = {};
const EMPTY_ARRAY: never[] = [];

export type DataTableFilterValue = string | number | boolean;
export type DataTableFilters = Record<string, DataTableFilterValue>;

export interface DataTableSourceActions<T extends Row> {
  insert: (row: T) => void;
  update: (id: string, partial: Partial<T>) => void;
  remove: (id: string) => void;
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
      refresh?: () => void;
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
    };

export interface UseDataTableSourceOptions<T extends Row> {
  source?: DataTableSource<T>;
  data?: T[];
  collection?: string;
  lazy?: boolean;
  filters?: DataTableFilters;
  lazyOptions?: LazyCollectionOptions;
}

export interface DataTableSourceState<T extends Row> {
  data: T[];
  sourceType: DataTableSource<T>['type'];
  table: string | null;
  isLoading: boolean;
  error: Error | string | null;
  refresh: () => void;
  actions: DataTableSourceActions<T> | null;
}

interface OptionalCollectionState<T extends Row> {
  data: T[] | null;
  actions: DataTableSourceActions<T> | null;
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

function useOptionalCollection<T extends Row>(
  table: string | null,
): OptionalCollectionState<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
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

  if (table && !client && typeof window !== 'undefined') {
    throw new Error(
      'DataTable with a collection or lazy source must be used within <AppProvider> or <ClientProvider>.',
    );
  }

  const collection = useMemo(
    () => table && client ? client.collection<T>(table) : null,
    [client, table],
  );

  const subscribe = useCallback(
    (callback: () => void) => authorizationBoundary.ready && collection
      ? collection.subscribe(callback)
      : NOOP_UNSUBSCRIBE,
    [authorizationBoundary.key, authorizationBoundary.ready, collection],
  );

  const byId = useSyncExternalStore(
    subscribe,
    () => authorizationBoundary.ready && collection
      ? collection.getAll()
      : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const rows = useMemo(
    () => authorizationBoundary.ready && collection ? Object.values(byId) : null,
    [authorizationBoundary.ready, byId, collection],
  );

  const insert = useCallback((row: T) => {
    if (isCurrentScope()) collection?.insert(row);
  }, [collection, isCurrentScope]);
  const update = useCallback(
    (id: string, partial: Partial<T>) => {
      if (isCurrentScope()) collection?.update(id, partial);
    },
    [collection, isCurrentScope],
  );
  const remove = useCallback((id: string) => {
    if (isCurrentScope()) collection?.remove(id);
  }, [collection, isCurrentScope]);
  const load = useCallback(
    (nextRows: T[], options?: { replace?: boolean }) => {
      if (isCurrentScope()) collection?.load(nextRows, options);
    },
    [collection, isCurrentScope],
  );
  const clear = useCallback(() => {
    if (isCurrentScope()) collection?.clear();
  }, [collection, isCurrentScope]);

  const actions = useMemo<DataTableSourceActions<T> | null>(
    () => collection ? { insert, update, remove, load, clear } : null,
    [clear, collection, insert, load, remove, update],
  );

  return { data: rows, actions };
}

/**
 * Resolve rows, mutation actions, loading, and refresh state for a DataTable.
 *
 * Full-sync and lazy sources use the frontend SDK client so auth headers,
 * refresh behavior, and optimistic store writes stay consistent with the rest
 * of Zero's frontend data layer.
 */
export function useDataTableSource<T extends Row = Row>(
  options: UseDataTableSourceOptions<T>,
): DataTableSourceState<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const resolved = resolveDataTableSource(options);
  const sourceType = resolved.type;
  const table = sourceType === 'collection' || sourceType === 'lazy'
    ? resolved.table
    : null;
  const collection = useOptionalCollection<T>(table);
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
      resolved.refresh?.();
    }
  }, [doLazyFetch, isCurrentScope, resolved, sourceType]);

  const dataActions = useMemo<DataTableSourceActions<T> | null>(() => {
    if (sourceType !== 'data' || !resolved.actions) return null;
    const actions = resolved.actions;
    return {
      insert: (row) => {
        if (isCurrentScope()) actions.insert?.(row);
      },
      update: (id, partial) => {
        if (isCurrentScope()) actions.update?.(id, partial);
      },
      remove: (id) => {
        if (isCurrentScope()) actions.remove?.(id);
      },
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
      refresh,
      actions: dataActions,
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
    refresh,
    actions: collection.actions,
  };
}
