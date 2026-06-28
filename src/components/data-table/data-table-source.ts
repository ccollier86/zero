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
    (callback: () => void) => collection ? collection.subscribe(callback) : NOOP_UNSUBSCRIBE,
    [collection],
  );

  const byId = useSyncExternalStore(
    subscribe,
    () => collection ? collection.getAll() : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const rows = useMemo(
    () => collection ? Object.values(byId) : null,
    [byId, collection],
  );

  const insert = useCallback((row: T) => collection?.insert(row), [collection]);
  const update = useCallback(
    (id: string, partial: Partial<T>) => collection?.update(id, partial),
    [collection],
  );
  const remove = useCallback((id: string) => collection?.remove(id), [collection]);
  const load = useCallback(
    (nextRows: T[], options?: { replace?: boolean }) => collection?.load(nextRows, options),
    [collection],
  );
  const clear = useCallback(() => collection?.clear(), [collection]);

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
  const resolved = resolveDataTableSource(options);
  const sourceType = resolved.type;
  const table = sourceType === 'collection' || sourceType === 'lazy'
    ? resolved.table
    : null;
  const collection = useOptionalCollection<T>(table);
  const [isLazyLoading, setIsLazyLoading] = useState(false);
  const [lazyError, setLazyError] = useState<Error | null>(null);
  const loadedRef = useRef('');
  const requestIdRef = useRef(0);

  const lazyFilters = sourceType === 'lazy' ? resolved.filters : undefined;
  const lazyOptions = sourceType === 'lazy' ? resolved.options : undefined;
  const replaceOnLoad = sourceType === 'lazy'
    ? resolved.replaceOnLoad ?? !!resolved.filters
    : false;
  const lazyQuery = sourceType === 'lazy'
    ? buildDataTableLazyQuery(resolved.table, lazyFilters, lazyOptions)
    : '';

  const doLazyFetch = useCallback(() => {
    if (!client || sourceType !== 'lazy' || !table || !collection.actions) return;

    const requestId = ++requestIdRef.current;
    setIsLazyLoading(true);
    setLazyError(null);

    client.get<{ rows: T[] }>(`/api/data?${lazyQuery}`)
      .then((payload) => {
        if (requestIdRef.current !== requestId) return;
        collection.actions?.load(payload.rows, { replace: replaceOnLoad });
      })
      .catch((error) => {
        if (requestIdRef.current !== requestId) return;
        setLazyError(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setIsLazyLoading(false);
      });
  }, [client, collection.actions, lazyQuery, replaceOnLoad, sourceType, table]);

  useEffect(() => {
    if (sourceType !== 'lazy' || !client) return;
    if (loadedRef.current === lazyQuery) return;
    loadedRef.current = lazyQuery;
    doLazyFetch();
  }, [client, doLazyFetch, lazyQuery, sourceType]);

  const refresh = useCallback(() => {
    if (sourceType === 'lazy') {
      loadedRef.current = '';
      doLazyFetch();
    } else if (sourceType === 'data') {
      resolved.refresh?.();
    }
  }, [doLazyFetch, resolved, sourceType]);

  if (sourceType === 'data') {
    const actions = resolved.actions
      ? {
          insert: resolved.actions.insert ?? (() => {}),
          update: resolved.actions.update ?? (() => {}),
          remove: resolved.actions.remove ?? (() => {}),
          load: resolved.actions.load ?? (() => {}),
          clear: resolved.actions.clear ?? (() => {}),
        }
      : null;

    return {
      data: resolved.data,
      sourceType,
      table: null,
      isLoading: !!resolved.isLoading,
      error: resolved.error ?? null,
      refresh,
      actions,
    };
  }

  return {
    data: collection.data ?? (EMPTY_ARRAY as T[]),
    sourceType,
    table,
    isLoading: sourceType === 'lazy' ? isLazyLoading : false,
    error: sourceType === 'lazy' ? lazyError : null,
    refresh,
    actions: collection.actions,
  };
}
