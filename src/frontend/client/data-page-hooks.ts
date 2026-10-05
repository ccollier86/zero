/** Owns one accepted paged query, request fences and its live record projection. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Row } from "../../sync/types";
import { OBS_CODES } from "../../observability/codes";
import { emitFrontendCode } from "./observability";
import { useClientMaybe } from "./client-context";
import { useAuthorizationScopeBoundary } from "./authorization-scope-hooks";
import { useCollection } from "./data-hooks";
import type { InternalClient } from "./sdk";
import { captureDataPageRows, projectDataPageRows, dataPageSyncChanges, type AcceptedDataPageRows } from "./data-page-projection";
import { buildDataPageQuery, normalizePage, normalizePageSize, stableValueKey, type DataPageFilters, type DataPageInfo, type DataPageSort, type DataFilterValue } from "./query-params";

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
  const sourceCollection = useMemo(() => client?.collection<T>(table) ?? null, [client, table]);
  const primaryKey = sourceCollection?.primaryKey
    ?? (client as InternalClient | null)?._syncClient?.tables[table]?._pk ?? 'id';
  const [accepted, setAccepted] = useState<AcceptedDataPageRows<T> | null>(null);
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
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
  const mountedRef = useRef(true);
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

  // Lifetime cleanup is independent of the automatic-load effect: manual
  // refreshes and retained callbacks must not keep writing a shared cache.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      for (const controller of requestControllersRef.current) controller.abort();
      requestControllersRef.current.clear();
    };
  }, []);

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
      || !mountedRef.current
      || !authorizationBoundary.ready
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
        if (!mountedRef.current || controller.signal.aborted
          || requestRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        // Validate response identity before admitting it to a shared cache.
        captureDataPageRows(response.rows, primaryKey, {}, requestBoundaryKey, query);
        collection.load(response.rows, { replace: options.replaceCollection ?? true });
        setAccepted(captureDataPageRows(
          response.rows, primaryKey, sourceCollection?.getAll() ?? {}, requestBoundaryKey, query,
        ));
        setPageInfo(response.page ?? {
          limit: pageSize,
          offset: (page - 1) * pageSize,
          count: response.rows.length,
          hasMore: response.rows.length >= pageSize,
          nextOffset: response.rows.length >= pageSize ? page * pageSize : null,
        });
      })
      .catch((err) => {
        if (!mountedRef.current || controller.signal.aborted
          || requestRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_DATA_PAGE_FAILED, {
          metadata: { surface: 'use-data-page', stage: 'query' },
        });
      })
      .finally(() => {
        requestControllersRef.current.delete(controller);
        if (mountedRef.current && !controller.signal.aborted
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
    options.replaceCollection,
    page,
    pageSize,
    query,
    primaryKey,
    sourceCollection,
    table,
  ]);

  // Only actual server changes invalidate query membership. Another consumer's
  // local cache load is not a deletion and must not erase this accepted page.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    setAccepted((current) => {
      if (!current || current.boundaryKey !== authorizationBoundary.key) return current;
      const changed = current.orderedIds.some((id) => collection.byId[id]
        && collection.byId[id] !== current.snapshot[id]);
      return changed ? { ...current, snapshot: Object.fromEntries(current.orderedIds.map((id) => [
        id, collection.byId[id] ?? current.snapshot[id]!,
      ])) } : current;
    });
  }, [authorizationBoundary.key, collection.byId]);
  useEffect(() => {
    const sync = (client as InternalClient | null)?._syncClient;
    if (!sync || !authorizationBoundary.ready) return;
    let queued = false;
    let disposed = false;
    const capturedBoundary = authorizationBoundary.key;
    const unsubscribe = sync.onMessage((message) => {
      if (disposed || !boundaryReadyRef.current || boundaryKeyRef.current !== capturedBoundary) return;
      if (!acceptedRef.current || acceptedRef.current.boundaryKey !== capturedBoundary) return;
      const changes = dataPageSyncChanges(message, table);
      if (!changes.length) return;
      const deleted = new Set(changes.filter((change) => change.op === 'delete').map((change) => change.rowId));
      if (deleted.size) setAccepted((current) => current?.boundaryKey === capturedBoundary
        ? { ...current, orderedIds: current.orderedIds.filter((id) => !deleted.has(id)) } : current);
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed && boundaryReadyRef.current && boundaryKeyRef.current === capturedBoundary) refreshRef.current();
      });
    });
    return () => { disposed = true; unsubscribe(); };
  }, [authorizationBoundary.key, authorizationBoundary.ready, client, table]);

  useEffect(() => {
    requestRef.current += 1;
    for (const controller of requestControllersRef.current) controller.abort();
    requestControllersRef.current.clear();
    setLoadedBoundaryKey(authorizationBoundary.key);
    setPageInfo(null);
    setAccepted(null);
    setError(null);
    if (!authorizationBoundary.ready) {
      setLoading(false);
      return;
    }
    if (options.autoLoad === false) { setLoading(false); return; }
    const abort = refresh();
    return abort;
  }, [authorizationBoundary.key, authorizationBoundary.ready, options.autoLoad, refresh]);

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
    rows: visible && accepted?.boundaryKey === authorizationBoundary.key && accepted.queryKey === query
      ? projectDataPageRows(accepted, collection.byId) : [],
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
