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
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
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

type ResourceLoadTrigger = 'automatic' | 'manual';

/** @internal Shared gate that keeps manual refresh available when auto-load is disabled. */
export function shouldRunResourceLoad(
  autoLoad: boolean | undefined,
  trigger: ResourceLoadTrigger,
): boolean {
  return trigger === 'manual' || autoLoad !== false;
}

/** Return a generated-resource client for one resource, or null before hydration. */
export function useResourceClient<T extends Row = Row>(
  resource: string,
  options: ResourceClientOptions = {}
): ResourceClient<T> | null {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const prefix = options.prefix;
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  return useMemo(
    () => {
      if (!authorizationBoundary.ready || !client) return null;
      const resourceClient = client.resource<T>(resource, { prefix });
      const run = async <R,>(operation: () => Promise<R>): Promise<R> => {
        if (!boundaryReadyRef.current
          || boundaryKeyRef.current !== callbackBoundaryKey) {
          throw authorizationScopeUnavailableError();
        }
        const result = await operation();
        if (!boundaryReadyRef.current
          || boundaryKeyRef.current !== callbackBoundaryKey) {
          throw staleAuthorizationScopeError();
        }
        return result;
      };
      return {
        name: resourceClient.name,
        list: (listOptions) => run(() => resourceClient.list(listOptions)),
        get: (id, requestOptions) => run(() => resourceClient.get(id, requestOptions)),
        create: (input, requestOptions) => run(() => resourceClient.create(input, requestOptions)),
        update: (id, input, requestOptions) => run(() => (
          resourceClient.update(id, input, requestOptions)
        )),
        delete: (id, requestOptions) => run(() => resourceClient.delete(id, requestOptions)),
        remove: (id, requestOptions) => run(() => resourceClient.remove(id, requestOptions)),
      };
    },
    [
      authorizationBoundary.key,
      authorizationBoundary.ready,
      callbackBoundaryKey,
      client,
      prefix,
      resource,
    ],
  );
}

/** Load and manage one generated-resource list result. */
export function useResourceList<T extends Row = Row>(
  resource: string,
  options: UseResourceListOptions = {}
): ResourceListHookResult<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const resourceClient = useResourceClient<T>(resource, { prefix: options.prefix });
  const [rows, setRows] = useState<T[]>([]);
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

  useEffect(() => {
    setFiltersState(options.filters ?? {});
    setPageState(normalizePage(options.initialPage ?? 1));
  }, [filtersKey, options.initialPage]);

  useEffect(() => {
    setSortState(options.sort ?? null);
    setPageState(normalizePage(options.initialPage ?? 1));
  }, [sortKey, options.initialPage]);

  const runLoad = useCallback((trigger: ResourceLoadTrigger) => {
    if (!authorizationBoundary.ready
      || !resourceClient
      || !boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey
      || !shouldRunResourceLoad(options.autoLoad, trigger)) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    const requestBoundaryKey = callbackBoundaryKey;
    requestControllersRef.current.add(controller);

    setLoadedBoundaryKey(requestBoundaryKey);
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
        if (controller.signal.aborted
          || requestRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        setRows(response.rows);
        setPageInfo(response.page);
      })
      .catch((err) => {
        if (controller.signal.aborted
          || requestRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_RESOURCE_ACTION_FAILED, {
          error: nextError,
          metadata: { resource, action: 'list' },
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
    resourceClient,
    options.autoLoad,
    resource,
    filters,
    sort,
    page,
    pageSize,
  ]);

  const refresh = useCallback(() => {
    runLoad('manual');
  }, [runLoad]);

  useEffect(() => {
    requestRef.current += 1;
    for (const controller of requestControllersRef.current) controller.abort();
    requestControllersRef.current.clear();
    setLoadedBoundaryKey(authorizationBoundary.key);
    setRows([]);
    setPageInfo(null);
    setError(null);
    if (!authorizationBoundary.ready) {
      setLoading(false);
      return;
    }
    const abort = runLoad('automatic');
    return abort;
  }, [authorizationBoundary.key, authorizationBoundary.ready, runLoad]);

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

  const setFilter = useCallback((field: string, value: DataPageFilters[string]) => {
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
    rows: visible ? rows : [],
    page: visible ? page : normalizePage(options.initialPage ?? 1),
    pageSize,
    filters: visible ? filters : options.filters ?? {},
    sort: visible ? sort : options.sort ?? null,
    loading: authorizationBoundary.ready && (!visible || loading),
    error: visible ? error : null,
    pageInfo: visible ? pageInfo : null,
    hasMore: visible ? pageInfo?.hasMore ?? false : false,
    refresh,
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
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const resourceClient = useResourceClient<T>(resource, { prefix: options.prefix });
  const [row, setRow] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const requestRef = useRef(0);
  const requestControllersRef = useRef(new Set<AbortController>());
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  const runLoad = useCallback((trigger: ResourceLoadTrigger) => {
    if (!authorizationBoundary.ready
      || !resourceClient
      || !id
      || !boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey
      || !shouldRunResourceLoad(options.autoLoad, trigger)) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    const requestBoundaryKey = callbackBoundaryKey;
    requestControllersRef.current.add(controller);

    setLoadedBoundaryKey(requestBoundaryKey);
    setLoading(true);
    setError(null);

    resourceClient.get(id, { signal: controller.signal })
      .then((nextRow) => {
        if (controller.signal.aborted
          || requestRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        setRow(nextRow);
      })
      .catch((err) => {
        if (controller.signal.aborted
          || requestRef.current !== requestId
          || boundaryKeyRef.current !== requestBoundaryKey
          || !boundaryReadyRef.current) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_RESOURCE_ACTION_FAILED, {
          error: nextError,
          metadata: { resource, action: 'get' },
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
    resourceClient,
    id,
    options.autoLoad,
    resource,
  ]);

  const refresh = useCallback(() => {
    runLoad('manual');
  }, [runLoad]);

  useEffect(() => {
    requestRef.current += 1;
    for (const controller of requestControllersRef.current) controller.abort();
    requestControllersRef.current.clear();
    setLoadedBoundaryKey(authorizationBoundary.key);
    setRow(null);
    setError(null);
    if (!id || !authorizationBoundary.ready) {
      setLoading(false);
      return;
    }
    const abort = runLoad('automatic');
    return abort;
  }, [authorizationBoundary.key, authorizationBoundary.ready, id, runLoad]);

  const update = useCallback(async (partial: Partial<T>) => {
    if (!resourceClient
      || !id
      || !boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return null;
    const requestBoundaryKey = callbackBoundaryKey;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const isCurrent = () => !controller.signal.aborted
      && boundaryReadyRef.current
      && boundaryKeyRef.current === requestBoundaryKey;
    return runResourceAction(resource, 'update', setLoading, setError, async () => {
      const updated = await resourceClient.update(id, partial, { signal: controller.signal });
      if (!isCurrent()) throw staleAuthorizationScopeError();
      setRow(updated);
      return updated;
    }, isCurrent).finally(() => requestControllersRef.current.delete(controller));
  }, [callbackBoundaryKey, resourceClient, id, resource]);

  const remove = useCallback(async () => {
    if (!resourceClient
      || !id
      || !boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return null;
    const requestBoundaryKey = callbackBoundaryKey;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const isCurrent = () => !controller.signal.aborted
      && boundaryReadyRef.current
      && boundaryKeyRef.current === requestBoundaryKey;
    return runResourceAction(resource, 'delete', setLoading, setError, async () => {
      const deleted = await resourceClient.delete(id, { signal: controller.signal });
      if (!isCurrent()) throw staleAuthorizationScopeError();
      setRow(null);
      return deleted;
    }, isCurrent).finally(() => requestControllersRef.current.delete(controller));
  }, [callbackBoundaryKey, resourceClient, id, resource]);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;

  return {
    row: visible ? row : null,
    exists: visible && row !== null,
    loading: authorizationBoundary.ready && (!visible || loading),
    error: visible ? error : null,
    refresh,
    update,
    remove,
  };
}

/** Return generated-resource mutation helpers with shared loading/error state. */
export function useResourceActions<T extends Row = Row>(
  resource: string,
  options: ResourceClientOptions = {}
): ResourceActionsResult<T> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const resourceClient = useResourceClient<T>(resource, options);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const requestControllersRef = useRef(new Set<AbortController>());
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  useEffect(() => {
    for (const controller of requestControllersRef.current) controller.abort();
    requestControllersRef.current.clear();
    setLoadedBoundaryKey(authorizationBoundary.key);
    setLoading(false);
    setError(null);
  }, [authorizationBoundary.key]);

  const resetError = useCallback(() => {
    if (boundaryReadyRef.current
      && boundaryKeyRef.current === callbackBoundaryKey) setError(null);
  }, [callbackBoundaryKey]);

  const runAction = useCallback(async <R,>(
    action: string,
    actionFn: (signal: AbortSignal) => Promise<R>,
  ): Promise<R> => {
    if (!resourceClient
      || !boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) {
      throw authorizationScopeUnavailableError();
    }
    const requestBoundaryKey = callbackBoundaryKey;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const isCurrent = () => !controller.signal.aborted
      && boundaryReadyRef.current
      && boundaryKeyRef.current === requestBoundaryKey;
    try {
      return await runResourceAction(
        resource,
        action,
        setLoading,
        setError,
        () => actionFn(controller.signal),
        isCurrent,
      );
    } finally {
      requestControllersRef.current.delete(controller);
    }
  }, [callbackBoundaryKey, resource, resourceClient]);

  const create = useCallback(async (input: Partial<T>) => {
    if (!resourceClient) {
      if (!client) throw new Error('Zero client is not available yet.');
      throw authorizationScopeUnavailableError();
    }
    return runAction('create', (signal) => resourceClient.create(input, { signal }));
  }, [client, resourceClient, runAction]);

  const update = useCallback(async (id: string, input: Partial<T>) => {
    if (!resourceClient) {
      if (!client) throw new Error('Zero client is not available yet.');
      throw authorizationScopeUnavailableError();
    }
    return runAction('update', (signal) => resourceClient.update(id, input, { signal }));
  }, [client, resourceClient, runAction]);

  const remove = useCallback(async (id: string) => {
    if (!resourceClient) {
      if (!client) throw new Error('Zero client is not available yet.');
      throw authorizationScopeUnavailableError();
    }
    return runAction('delete', (signal) => resourceClient.delete(id, { signal }));
  }, [client, resourceClient, runAction]);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    loading: visible ? loading : false,
    error: visible ? error : null,
    resetError,
    create,
    update,
    remove,
  };
}

async function runResourceAction<T>(
  resource: string,
  action: string,
  setLoading: (loading: boolean) => void,
  setError: (error: Error | null) => void,
  actionFn: () => Promise<T>,
  isCurrent: () => boolean = () => true,
): Promise<T> {
  if (!isCurrent()) throw authorizationScopeUnavailableError();
  setLoading(true);
  setError(null);

  try {
    const result = await actionFn();
    if (!isCurrent()) throw staleAuthorizationScopeError();
    return result;
  } catch (err) {
    if (!isCurrent()) throw staleAuthorizationScopeError();
    const error = err instanceof Error ? err : new Error(String(err));
    setError(error);
    emitFrontendCode(OBS_CODES.FRONTEND_RESOURCE_ACTION_FAILED, {
      error,
      metadata: { resource, action },
    });
    throw error;
  } finally {
    if (isCurrent()) setLoading(false);
  }
}

function authorizationScopeUnavailableError(): Error {
  return new Error('Resource actions are unavailable during an authorization scope transition.');
}

function staleAuthorizationScopeError(): Error {
  return new Error('The authorization scope changed before the resource request completed.');
}
