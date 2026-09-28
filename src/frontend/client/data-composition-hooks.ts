/**
 * data-composition-hooks.ts
 *
 * Composed React hooks for common Zero data-screen workflows. This file owns
 * UI-facing query and record state only; collection transport, auth headers,
 * optimistic mutation protocol, and backend authorization stay in the SDK and
 * sync/data plugins.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { IdentityKey } from '../../sync/identity';
import type { InsertInput } from '../../schema/infer';
import type { Row } from '../../sync/types';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';
import {
  buildDataPageQuery,
  normalizePage,
  normalizePageSize,
  stableValueKey,
  type DataFilterExpression,
  type DataFilterOperator,
  type DataFilterPrimitive,
  type DataFilterValue,
  type DataPageFilters,
  type DataPageInfo,
  type DataPageSort,
} from './query-params';
import { useClientMaybe } from './client-context';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useCollection, useRow } from './data-hooks';

export { buildDataPageQuery } from './query-params';
export type {
  DataFilterExpression,
  DataFilterOperator,
  DataFilterPrimitive,
  DataFilterValue,
  DataPageFilters,
  DataPageInfo,
  DataPageSort,
} from './query-params';

export interface DataPageOptions {
  filters?: DataPageFilters;
  sort?: DataPageSort | null;
  pageSize?: number;
  initialPage?: number;
  autoLoad?: boolean;
  replaceCollection?: boolean;
}

export interface DataPageResult<T extends Row> {
  rows: T[];
  page: number;
  pageSize: number;
  filters: DataPageFilters;
  sort: DataPageSort | null;
  loading: boolean;
  error: Error | null;
  pageInfo: DataPageInfo | null;
  hasMore: boolean;
  refresh: () => void;
  setPage: (page: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: DataPageSort | null) => void;
  setFilter: (field: string, value: DataFilterValue) => void;
  setFilters: (filters: DataPageFilters) => void;
  clearFilters: () => void;
}

interface DataPageResponse<T extends Row> {
  rows: T[];
  page?: DataPageInfo;
}

/**
 * Load and manage one paged `/api/data` result set.
 *
 * Rows are loaded into the reactive collection so live WebSocket changes keep
 * the current page fresh after the initial HTTP query.
 */
export function useDataPage<T extends Row = Row>(
  table: string,
  options: DataPageOptions = {},
): DataPageResult<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const collection = useCollection<T>(table);
  const [filters, setFiltersState] = useState<DataPageFilters>(options.filters ?? {});
  const [sort, setSortState] = useState<DataPageSort | null>(options.sort ?? null);
  const [page, setPageState] = useState(() => normalizePage(options.initialPage ?? 1));
  const [pageSize, setPageSizeState] = useState(() => normalizePageSize(options.pageSize));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pageInfo, setPageInfo] = useState<DataPageInfo | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const requestRef = useRef(0);
  const requestControllersRef = useRef(new Set<AbortController>());
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const filtersKey = stableValueKey(options.filters ?? {});
  const sortKey = stableValueKey(options.sort ?? null);
  const localFiltersKey = stableValueKey(filters);
  const query = useMemo(
    () => buildDataPageQuery(table, filters, sort, page, pageSize),
    [table, localFiltersKey, sort, page, pageSize],
  );

  useEffect(() => {
    setFiltersState(options.filters ?? {});
    setPageState(normalizePage(options.initialPage ?? 1));
  }, [filtersKey, options.initialPage]);

  useEffect(() => {
    setSortState(options.sort ?? null);
    setPageState(normalizePage(options.initialPage ?? 1));
  }, [sortKey, options.initialPage]);

  const refresh = useCallback(() => {
    if (!client
      || !authorizationBoundary.ready
      || options.autoLoad === false
      || !boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    const requestBoundaryKey = callbackBoundaryKey;
    requestControllersRef.current.add(controller);

    setLoadedBoundaryKey(requestBoundaryKey);
    setLoading(true);
    setError(null);

    client.fetch<DataPageResponse<T>>(query, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted
          || requestRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        collection.load(response.rows, { replace: options.replaceCollection ?? true });
        setPageInfo(response.page ?? {
          limit: pageSize,
          offset: (page - 1) * pageSize,
          count: response.rows.length,
          hasMore: response.rows.length >= pageSize,
          nextOffset: response.rows.length >= pageSize ? page * pageSize : null,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted
          || requestRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_DATA_PAGE_FAILED, {
          error: nextError,
          metadata: { table, query },
        });
      })
      .finally(() => {
        requestControllersRef.current.delete(controller);
        if (!controller.signal.aborted
          && requestRef.current === requestId
          && boundaryKeyRef.current === requestBoundaryKey
          && boundaryReadyRef.current) {
          setLoading(false);
        }
      });

    return () => {
      requestControllersRef.current.delete(controller);
      controller.abort();
    };
  }, [
    authorizationBoundary.key,
    authorizationBoundary.ready,
    callbackBoundaryKey,
    client,
    collection.load,
    options.autoLoad,
    options.replaceCollection,
    page,
    pageSize,
    query,
    table,
  ]);

  useEffect(() => {
    requestRef.current += 1;
    for (const controller of requestControllersRef.current) controller.abort();
    requestControllersRef.current.clear();
    setLoadedBoundaryKey(authorizationBoundary.key);
    setPageInfo(null);
    setError(null);
    if (!authorizationBoundary.ready) {
      setLoading(false);
      return;
    }
    const abort = refresh();
    return abort;
  }, [authorizationBoundary.key, authorizationBoundary.ready, refresh]);

  const setPage = useCallback((nextPage: number) => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    setPageState(normalizePage(nextPage));
  }, [callbackBoundaryKey]);

  const nextPage = useCallback(() => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    setPageState((current) => current + 1);
  }, [callbackBoundaryKey]);

  const previousPage = useCallback(() => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    setPageState((current) => normalizePage(current - 1));
  }, [callbackBoundaryKey]);

  const setPageSize = useCallback((nextPageSize: number) => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    setPageSizeState(normalizePageSize(nextPageSize));
    setPageState(1);
  }, [callbackBoundaryKey]);

  const setSort = useCallback((nextSort: DataPageSort | null) => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    setSortState(nextSort);
    setPageState(1);
  }, [callbackBoundaryKey]);

  const setFilter = useCallback((field: string, value: DataFilterValue) => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    setFiltersState((current) => ({ ...current, [field]: value }));
    setPageState(1);
  }, [callbackBoundaryKey]);

  const setFilters = useCallback((nextFilters: DataPageFilters) => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    setFiltersState(nextFilters);
    setPageState(1);
  }, [callbackBoundaryKey]);

  const clearFilters = useCallback(() => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    setFiltersState({});
    setPageState(1);
  }, [callbackBoundaryKey]);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;

  return {
    rows: visible ? collection.data : [],
    page: visible ? page : normalizePage(options.initialPage ?? 1),
    pageSize,
    filters: visible ? filters : options.filters ?? {},
    sort: visible ? sort : options.sort ?? null,
    loading: authorizationBoundary.ready && (!visible || loading),
    error: visible ? error : null,
    pageInfo: visible ? pageInfo : null,
    hasMore: visible ? pageInfo?.hasMore ?? false : false,
    refresh: () => { refresh(); },
    setPage,
    nextPage,
    previousPage,
    setPageSize,
    setSort,
    setFilter,
    setFilters,
    clearFilters,
  };
}

export interface RecordResult<T extends Row> {
  row: T | null;
  exists: boolean;
  update: (partial: Partial<T>) => void;
  remove: () => void;
}

/**
 * Compose `useRow()` and collection mutation helpers for one primary-key row.
 */
export function useRecord<T extends Row = Row>(table: string, id: string | null): RecordResult<T> {
  const row = useRow<T>(table, id ?? '');
  const collection = useCollection<T>(table);

  const update = useCallback(
    (partial: Partial<T>) => {
      if (id) collection.update(id, partial);
    },
    [collection.update, id],
  );

  const remove = useCallback(() => {
    if (id) collection.remove(id);
  }, [collection.remove, id]);

  return {
    row: id ? row : null,
    exists: !!id && row !== null,
    update,
    remove,
  };
}

export interface IdentityRecordResult<T extends Row> {
  row: T | null;
  id: string | null;
  exists: boolean;
  upsert: (row: InsertInput<T>) => void;
  update: (partial: Partial<T>) => void;
  remove: () => void;
}

/**
 * Compose natural-identity lookup and mutation helpers for relational tables.
 *
 * This uses Zero's deterministic natural identity support while preserving the
 * single-column sync primary key invariant.
 */
export function useRecordByIdentity<T extends Row = Row>(
  table: string,
  identity: IdentityKey | null,
): IdentityRecordResult<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const collection = useMemo(() => client?.collection<T>(table) ?? null, [client, table]);
  const data = useCollection<T>(table);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const canUseScope = useCallback(
    () => boundaryReadyRef.current && boundaryKeyRef.current === callbackBoundaryKey,
    [callbackBoundaryKey],
  );
  const identityKey = useMemo(
    () => authorizationBoundary.ready && identity && collection
      ? collection.identityKey(identity)
      : null,
    [authorizationBoundary.ready, collection, identity],
  );
  const row = useMemo(
    () => authorizationBoundary.ready && identity && collection
      ? collection.getByIdentity(identity)
      : null,
    [authorizationBoundary.ready, collection, data.byId, identity],
  );

  const upsert = useCallback((nextRow: InsertInput<T>) => {
    if (canUseScope()) collection?.upsertByIdentity(nextRow);
  }, [canUseScope, collection]);

  const update = useCallback((partial: Partial<T>) => {
    if (canUseScope() && identity) collection?.updateByIdentity(identity, partial);
  }, [canUseScope, collection, identity]);

  const remove = useCallback(() => {
    if (canUseScope() && identity) collection?.deleteByIdentity(identity);
  }, [canUseScope, collection, identity]);

  return {
    row,
    id: identityKey,
    exists: row !== null,
    upsert,
    update,
    remove,
  };
}
