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
import type { Row } from '../../sync/types';
import { shouldUseSsrFallback, useClientMaybe } from './client-context';

const NOOP_UNSUB = () => {};
const EMPTY_RECORD: Record<string, never> = {};
const EMPTY_ARRAY: never[] = [];

export interface CollectionResult<T extends Row> {
  /** All rows as an array. */
  data: T[];
  /** All rows as a map (id -> row) for O(1) lookups. */
  byId: Record<string, T>;
  /** Number of rows. */
  count: number;
  /** Insert a new row. */
  insert: (row: T) => void;
  /** Update a row by ID. */
  update: (id: string, partial: Partial<T>) => void;
  /** Remove a row by ID. */
  remove: (id: string) => void;
  /** Bulk-load rows into the store. Merges by default. */
  load: (rows: T[], options?: { replace?: boolean }) => void;
  /** Clear all rows from this table in the local store. */
  clear: () => void;
}

/**
 * Subscribe to one reactive collection and expose optimistic mutations.
 *
 * Full-sync tables are hydrated through the sync snapshot. Lazy tables can use
 * `load()` directly or through `useLazyCollection()`.
 */
export function useCollection<T extends Row = Row>(name: string): CollectionResult<T> {
  const client = useClientMaybe();
  const col = useMemo(() => client?.collection<T>(name) ?? null, [client, name]);

  const subscribe = useCallback(
    (cb: () => void) => col ? col.subscribe(cb) : NOOP_UNSUB,
    [col],
  );

  const byId = useSyncExternalStore(
    subscribe,
    () => col ? col.getAll() : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const data = useMemo(() => col ? Object.values(byId) : EMPTY_ARRAY as T[], [byId, col]);

  const insert = useCallback((row: T) => col?.insert(row), [col]);
  const update = useCallback((id: string, partial: Partial<T>) => col?.update(id, partial), [col]);
  const remove = useCallback((id: string) => col?.remove(id), [col]);
  const load = useCallback((rows: T[], options?: { replace?: boolean }) => col?.load(rows, options), [col]);
  const clear = useCallback(() => col?.clear(), [col]);

  shouldUseSsrFallback(client, 'useCollection');

  return { data, byId, count: data.length, insert, update, remove, load, clear };
}

export interface LazyCollectionResult<T extends Row> extends CollectionResult<T> {
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
export function useLazyCollection<T extends Row = Row>(
  table: string,
  filters?: Record<string, string>,
  options?: LazyCollectionOptions,
): LazyCollectionResult<T> {
  const client = useClientMaybe();
  const collection = useCollection<T>(table);
  const { load } = collection;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadedRef = useRef<string>('');
  const requestIdRef = useRef(0);

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
    if (!client) return;
    const requestId = ++requestIdRef.current;

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

    client.get<{ rows: T[] }>(`/api/data?${params}`)
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        load(data.rows, { replace: !!filters });
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setIsLoading(false);
      });
  }, [client, table, filterKey, options?.order, options?.dir, options?.limit, options?.offset, load]);

  useEffect(() => {
    if (!client) return;
    if (loadedRef.current === cacheKey) return;
    loadedRef.current = cacheKey;
    doFetch();
  }, [client, cacheKey, doFetch]);

  const refresh = useCallback(() => {
    loadedRef.current = '';
    doFetch();
  }, [doFetch]);

  shouldUseSsrFallback(client, 'useLazyCollection');

  return { ...collection, isLoading, error, refresh };
}

/**
 * Subscribe to one row in a reactive collection.
 *
 * Returns null when the row is not loaded or does not exist.
 */
export function useRow<T extends Row = Row>(name: string, id: string): T | null {
  const client = useClientMaybe();
  const col = useMemo(() => client?.collection<T>(name) ?? null, [client, name]);

  const subscribe = useCallback(
    (cb: () => void) => col ? col.subscribe(cb) : NOOP_UNSUB,
    [col],
  );

  const row = useSyncExternalStore(
    subscribe,
    () => col ? col.getOne(id) : null,
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
  const col = useMemo(() => client?.collection<T>(name) ?? null, [client, name]);

  const subscribe = useCallback(
    (cb: () => void) => col ? col.subscribe(cb) : NOOP_UNSUB,
    [col],
  );

  const rows = useSyncExternalStore(
    subscribe,
    () => col ? col.getAll() : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const result = useMemo(
    () => col ? Object.values(rows).filter(predicate) : EMPTY_ARRAY as T[],
    [rows, predicate, col],
  );

  shouldUseSsrFallback(client, 'useQuery');

  return result;
}

/**
 * Subscribe to the SDK WebSocket connection state.
 */
export function useStatus(): { connected: boolean } {
  const client = useClientMaybe();

  const subscribe = useCallback(
    (cb: () => void) => client ? client.onConnectionChange(cb) : NOOP_UNSUB,
    [client],
  );

  const connected = useSyncExternalStore(
    subscribe,
    () => client ? client.connected : false,
    () => false,
  );

  const status = useMemo(() => ({ connected }), [connected]);

  shouldUseSsrFallback(client, 'useStatus');

  return status;
}
