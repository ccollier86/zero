/**
 * data-hooks.ts
 *
 * React hooks for reactive collection reads, optimistic mutations, lazy data
 * loading, and sync connection status. This file owns UI-facing subscription
 * state only; WebSocket transport and mutation protocol remain inside the SDK.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { InsertInput, PrimaryKeyOf } from '../../schema/infer';
import type { Row } from '../../sync/types';
import { shouldUseSsrFallback, useClientMaybe } from './client-context';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';

const NOOP_UNSUB = () => {};
const EMPTY_RECORD: Record<string, never> = {};
const EMPTY_ARRAY: never[] = [];

export interface CollectionResult<
  T extends Row,
  TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
> {
  /** All rows as an array. */
  data: T[];
  /** All rows as a map (id -> row) for O(1) lookups. */
  byId: Record<string, T>;
  /** Number of rows. */
  count: number;
  /** Insert a new row. */
  insert: (row: InsertInput<T, TPrimaryKey>) => void;
  /** Update a row by ID. */
  update: (id: string, partial: Partial<T>) => void;
  /** Remove a row by ID. */
  remove: (id: string) => void;
  /** Bulk-load rows into the store. Merges by default. */
  load: (rows: InsertInput<T, TPrimaryKey>[], options?: { replace?: boolean }) => void;
  /** Clear all rows from this table in the local store. */
  clear: () => void;
}

/**
 * Subscribe to one reactive collection and expose optimistic mutations.
 *
 * Full-sync tables are hydrated through the sync snapshot. Lazy tables can use
 * `load()` directly or through `useLazyCollection()`.
 */
export function useCollection<
  T extends Row = Row,
  TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
>(name: string): CollectionResult<T, TPrimaryKey> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const col = useMemo(
    () => client?.collection<T, TPrimaryKey>(name) ?? null,
    [client, name],
  );
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  const subscribe = useCallback(
    (cb: () => void) => authorizationBoundary.ready && col
      ? col.subscribe(cb)
      : NOOP_UNSUB,
    [authorizationBoundary.key, authorizationBoundary.ready, col],
  );

  const byId = useSyncExternalStore(
    subscribe,
    () => authorizationBoundary.ready && col
      ? col.getAll()
      : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const data = useMemo(
    () => authorizationBoundary.ready && col
      ? Object.values(byId)
      : EMPTY_ARRAY as T[],
    [authorizationBoundary.ready, byId, col],
  );

  const canWrite = useCallback(
    () => boundaryReadyRef.current && boundaryKeyRef.current === callbackBoundaryKey,
    [callbackBoundaryKey],
  );

  const insert = useCallback((row: InsertInput<T, TPrimaryKey>) => {
    if (canWrite()) col?.insert(row);
  }, [canWrite, col]);
  const update = useCallback((id: string, partial: Partial<T>) => {
    if (canWrite()) col?.update(id, partial);
  }, [canWrite, col]);
  const remove = useCallback((id: string) => {
    if (canWrite()) col?.remove(id);
  }, [canWrite, col]);
  const load = useCallback(
    (rows: InsertInput<T, TPrimaryKey>[], options?: { replace?: boolean }) => {
      if (canWrite()) col?.load(rows, options);
    },
    [canWrite, col],
  );
  const clear = useCallback(() => {
    if (canWrite()) col?.clear();
  }, [canWrite, col]);

  shouldUseSsrFallback(client, 'useCollection');

  return { data, byId, count: data.length, insert, update, remove, load, clear };
}

export interface LazyCollectionResult<
  T extends Row,
  TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
> extends CollectionResult<T, TPrimaryKey> {
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

export interface LazyCollectionOptions {
  /** Column to sort by. Defaults to backend table order when omitted. */
  order?: string;
  /** Sort direction for `order`. Defaults to `desc` on the backend. */
  dir?: 'asc' | 'desc';
  /** Maximum number of rows to fetch. Capped by backend `/api/data` limits. */
  limit?: number;
  /** Number of matching rows to skip for offset pagination. */
  offset?: number;
}

/**
 * Fetch a lazy table through `/api/data`, load rows into the local collection,
 * and continue receiving live changes for loaded rows.
 */
export function useLazyCollection<
  T extends Row = Row,
  TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
>(
  table: string,
  filters?: Record<string, string>,
  options?: LazyCollectionOptions,
): LazyCollectionResult<T, TPrimaryKey> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const collection = useCollection<T, TPrimaryKey>(table);
  const { load } = collection;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const loadedRef = useRef<string>('');
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  const filterKey = filters
    ? Object.entries(filters).sort().map(([key, value]) => `${key}:${value}`).join('|')
    : '';
  const cacheKey = [
    table,
    filterKey,
    options?.order ?? '',
    options?.dir ?? '',
    options?.limit ?? '',
    options?.offset ?? '',
  ].join('|');

  const doFetch = useCallback(() => {
    if (!client
      || !authorizationBoundary.ready
      || !boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    const requestBoundaryKey = callbackBoundaryKey;

    const params = new URLSearchParams({ table });
    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        params.append('filter', `${field}:${value}`);
      }
    }
    if (options?.order) params.set('order', options.order);
    if (options?.dir) params.set('dir', options.dir);
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));

    setIsLoading(true);
    setError(null);
    setLoadedBoundaryKey(requestBoundaryKey);

    client.fetch<{ rows: T[] }>(`/api/data?${params}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted
          || requestIdRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        load(data.rows, { replace: !!filters });
      })
      .catch((err) => {
        if (controller.signal.aborted
          || requestIdRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (controller.signal.aborted
          || requestIdRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
        setIsLoading(false);
      });
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    callbackBoundaryKey,
    client,
    filterKey,
    load,
    options?.dir,
    options?.limit,
    options?.offset,
    options?.order,
    table,
  ]);

  useEffect(() => {
    requestIdRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    loadedRef.current = '';
    setLoadedBoundaryKey(authorizationBoundary.key);
    setError(null);
    if (!client || !authorizationBoundary.ready) {
      setIsLoading(false);
      return;
    }
    if (loadedRef.current === cacheKey) return;
    loadedRef.current = cacheKey;
    doFetch();
    return () => {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [authorizationBoundary.key, authorizationBoundary.ready, client, cacheKey, doFetch]);

  const refresh = useCallback(() => {
    if (!boundaryReadyRef.current) return;
    loadedRef.current = '';
    doFetch();
  }, [doFetch]);

  shouldUseSsrFallback(client, 'useLazyCollection');

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    ...collection,
    isLoading: authorizationBoundary.ready && (!visible || isLoading),
    error: visible ? error : null,
    refresh,
  };
}

/**
 * Subscribe to one row in a reactive collection.
 *
 * Returns null when the row is not loaded or does not exist.
 */
export function useRow<T extends Row = Row>(name: string, id: string): T | null {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const col = useMemo(() => client?.collection<T>(name) ?? null, [client, name]);

  const subscribe = useCallback(
    (cb: () => void) => authorizationBoundary.ready && col
      ? col.subscribe(cb)
      : NOOP_UNSUB,
    [authorizationBoundary.key, authorizationBoundary.ready, col],
  );

  const row = useSyncExternalStore(
    subscribe,
    () => authorizationBoundary.ready && col ? col.getOne(id) : null,
    () => null,
  );

  shouldUseSsrFallback(client, 'useRow');

  return row;
}

/**
 * Subscribe to rows matching a local predicate.
 *
 * The predicate runs against rows already available in the client store; use
 * `useLazyCollection()` or `/api/data` for server-side filtering.
 */
export function useQuery<T extends Row = Row>(
  name: string,
  predicate: (row: T) => boolean,
): T[] {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const col = useMemo(() => client?.collection<T>(name) ?? null, [client, name]);

  const subscribe = useCallback(
    (cb: () => void) => authorizationBoundary.ready && col
      ? col.subscribe(cb)
      : NOOP_UNSUB,
    [authorizationBoundary.key, authorizationBoundary.ready, col],
  );

  const rows = useSyncExternalStore(
    subscribe,
    () => authorizationBoundary.ready && col
      ? col.getAll()
      : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const result = useMemo(
    () => authorizationBoundary.ready && col
      ? Object.values(rows).filter(predicate)
      : EMPTY_ARRAY as T[],
    [authorizationBoundary.ready, rows, predicate, col],
  );

  shouldUseSsrFallback(client, 'useQuery');

  return result;
}

/**
 * Subscribe to the SDK WebSocket connection state.
 */
export function useStatus(): { connected: boolean } {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);

  const subscribe = useCallback(
    (cb: () => void) => authorizationBoundary.ready && client
      ? client.onConnectionChange(cb)
      : NOOP_UNSUB,
    [authorizationBoundary.key, authorizationBoundary.ready, client],
  );

  const connected = useSyncExternalStore(
    subscribe,
    () => authorizationBoundary.ready && client ? client.connected : false,
    () => false,
  );

  const status = useMemo(() => ({ connected }), [connected]);

  shouldUseSsrFallback(client, 'useStatus');

  return status;
}
