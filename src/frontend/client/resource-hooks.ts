/**
 * resource-hooks.ts
 *
 * React hooks for generated Zero resource CRUD routes. These hooks own
 * UI-facing loading/error state and delegate transport to the SDK resource
 * client; they do not evaluate policy, manage WebSocket sync, or mutate
 * collection stores directly.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Row } from '../../sync/types';
import { OBS_CODES } from '../../observability/codes';
import { useClientMaybe } from './client-context';
import { emitFrontendCode } from './observability';
import type {
  ResourceClient,
  ResourceClientOptions,
  ResourceDeleteResult,
} from './resource-client';
import {
  normalizePage,
  normalizePageSize,
  stableValueKey,
  type DataPageFilters,
  type DataPageInfo,
  type DataPageSort,
} from './query-params';

export interface UseResourceListOptions {
  filters?: DataPageFilters;
  sort?: DataPageSort | null;
  pageSize?: number;
  initialPage?: number;
  autoLoad?: boolean;
  prefix?: string;
}

export interface ResourceListHookResult<T extends Row> {
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
  setFilter: (field: string, value: DataPageFilters[string]) => void;
  setFilters: (filters: DataPageFilters) => void;
  clearFilters: () => void;
}

export interface UseResourceRecordOptions {
  autoLoad?: boolean;
  prefix?: string;
}

export interface ResourceRecordResult<T extends Row> {
  row: T | null;
  exists: boolean;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  update: (partial: Partial<T>) => Promise<T | null>;
  remove: () => Promise<ResourceDeleteResult | null>;
}

export interface ResourceActionsResult<T extends Row> {
  loading: boolean;
  error: Error | null;
  resetError: () => void;
  create: (input: Partial<T>) => Promise<T>;
  update: (id: string, input: Partial<T>) => Promise<T>;
  remove: (id: string) => Promise<ResourceDeleteResult>;
}

/** Return a generated-resource client for one resource, or null before hydration. */
export function useResourceClient<T extends Row = Row>(
  resource: string,
  options: ResourceClientOptions = {}
): ResourceClient<T> | null {
  const client = useClientMaybe();
  const prefix = options.prefix;
  return useMemo(
    () => client?.resource<T>(resource, { prefix }) ?? null,
    [client, resource, prefix],
  );
}

/** Load and manage one generated-resource list result. */
export function useResourceList<T extends Row = Row>(
  resource: string,
  options: UseResourceListOptions = {}
): ResourceListHookResult<T> {
  const resourceClient = useResourceClient<T>(resource, { prefix: options.prefix });
  const [rows, setRows] = useState<T[]>([]);
  const [filters, setFiltersState] = useState<DataPageFilters>(options.filters ?? {});
  const [sort, setSortState] = useState<DataPageSort | null>(options.sort ?? null);
  const [page, setPageState] = useState(() => normalizePage(options.initialPage ?? 1));
  const [pageSize, setPageSizeState] = useState(() => normalizePageSize(options.pageSize));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pageInfo, setPageInfo] = useState<DataPageInfo | null>(null);
  const requestRef = useRef(0);
  const filtersKey = stableValueKey(options.filters ?? {});
  const sortKey = stableValueKey(options.sort ?? null);

  useEffect(() => {
    setFiltersState(options.filters ?? {});
    setPageState(normalizePage(options.initialPage ?? 1));
  }, [filtersKey, options.initialPage]);

  useEffect(() => {
    setSortState(options.sort ?? null);
    setPageState(normalizePage(options.initialPage ?? 1));
  }, [sortKey, options.initialPage]);

  const refresh = useCallback(() => {
    if (!resourceClient || options.autoLoad === false) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    resourceClient.list({
      filters,
      sort,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      signal: controller.signal,
    })
      .then((response) => {
        if (requestRef.current !== requestId) return;
        setRows(response.rows);
        setPageInfo(response.page);
      })
      .catch((err) => {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_RESOURCE_ACTION_FAILED, {
          error: nextError,
          metadata: { resource, action: 'list' },
        });
      })
      .finally(() => {
        if (!controller.signal.aborted && requestRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [resourceClient, options.autoLoad, resource, filters, sort, page, pageSize]);

  useEffect(() => {
    const abort = refresh();
    return abort;
  }, [refresh]);

  const setPage = useCallback((nextPage: number) => {
    setPageState(normalizePage(nextPage));
  }, []);

  const nextPage = useCallback(() => {
    setPageState((current) => current + 1);
  }, []);

  const previousPage = useCallback(() => {
    setPageState((current) => normalizePage(current - 1));
  }, []);

  const setPageSize = useCallback((nextPageSize: number) => {
    setPageSizeState(normalizePageSize(nextPageSize));
    setPageState(1);
  }, []);

  const setSort = useCallback((nextSort: DataPageSort | null) => {
    setSortState(nextSort);
    setPageState(1);
  }, []);

  const setFilter = useCallback((field: string, value: DataPageFilters[string]) => {
    setFiltersState((current) => ({ ...current, [field]: value }));
    setPageState(1);
  }, []);

  const setFilters = useCallback((nextFilters: DataPageFilters) => {
    setFiltersState(nextFilters);
    setPageState(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState({});
    setPageState(1);
  }, []);

  return {
    rows,
    page,
    pageSize,
    filters,
    sort,
    loading,
    error,
    pageInfo,
    hasMore: pageInfo?.hasMore ?? false,
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

/** Load and mutate one generated-resource row. */
export function useResourceRecord<T extends Row = Row>(
  resource: string,
  id: string | null,
  options: UseResourceRecordOptions = {}
): ResourceRecordResult<T> {
  const resourceClient = useResourceClient<T>(resource, { prefix: options.prefix });
  const [row, setRow] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(() => {
    if (!resourceClient || !id || options.autoLoad === false) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    resourceClient.get(id, { signal: controller.signal })
      .then((nextRow) => {
        if (requestRef.current !== requestId) return;
        setRow(nextRow);
      })
      .catch((err) => {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_RESOURCE_ACTION_FAILED, {
          error: nextError,
          metadata: { resource, action: 'get' },
        });
      })
      .finally(() => {
        if (!controller.signal.aborted && requestRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [resourceClient, id, options.autoLoad, resource]);

  useEffect(() => {
    if (!id) {
      requestRef.current += 1;
      setRow(null);
      setLoading(false);
      return;
    }
    const abort = refresh();
    return abort;
  }, [id, refresh]);

  const update = useCallback(async (partial: Partial<T>) => {
    if (!resourceClient || !id) return null;
    return runResourceAction(resource, 'update', setLoading, setError, async () => {
      const updated = await resourceClient.update(id, partial);
      setRow(updated);
      return updated;
    });
  }, [resourceClient, id, resource]);

  const remove = useCallback(async () => {
    if (!resourceClient || !id) return null;
    return runResourceAction(resource, 'delete', setLoading, setError, async () => {
      const deleted = await resourceClient.delete(id);
      setRow(null);
      return deleted;
    });
  }, [resourceClient, id, resource]);

  return {
    row,
    exists: row !== null,
    loading,
    error,
    refresh: () => { refresh(); },
    update,
    remove,
  };
}

/** Return generated-resource mutation helpers with shared loading/error state. */
export function useResourceActions<T extends Row = Row>(
  resource: string,
  options: ResourceClientOptions = {}
): ResourceActionsResult<T> {
  const resourceClient = useResourceClient<T>(resource, options);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const resetError = useCallback(() => setError(null), []);

  const create = useCallback(async (input: Partial<T>) => {
    if (!resourceClient) throw new Error('Zero client is not available yet.');
    return runResourceAction(resource, 'create', setLoading, setError, () =>
      resourceClient.create(input));
  }, [resourceClient, resource]);

  const update = useCallback(async (id: string, input: Partial<T>) => {
    if (!resourceClient) throw new Error('Zero client is not available yet.');
    return runResourceAction(resource, 'update', setLoading, setError, () =>
      resourceClient.update(id, input));
  }, [resourceClient, resource]);

  const remove = useCallback(async (id: string) => {
    if (!resourceClient) throw new Error('Zero client is not available yet.');
    return runResourceAction(resource, 'delete', setLoading, setError, () =>
      resourceClient.delete(id));
  }, [resourceClient, resource]);

  return { loading, error, resetError, create, update, remove };
}

async function runResourceAction<T>(
  resource: string,
  action: string,
  setLoading: (loading: boolean) => void,
  setError: (error: Error | null) => void,
  actionFn: () => Promise<T>
): Promise<T> {
  setLoading(true);
  setError(null);

  try {
    return await actionFn();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    setError(error);
    emitFrontendCode(OBS_CODES.FRONTEND_RESOURCE_ACTION_FAILED, {
      error,
      metadata: { resource, action },
    });
    throw error;
  } finally {
    setLoading(false);
  }
}
