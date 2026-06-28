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
import type { Row } from '../../sync/types';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';
import { useClientMaybe } from './client-context';
import { useCollection, useRow } from './data-hooks';

export type DataFilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'contains'
  | 'in';

export type DataFilterPrimitive = string | number | boolean | null | undefined;

export interface DataFilterExpression {
  op?: DataFilterOperator;
  value: DataFilterPrimitive | DataFilterPrimitive[];
}

export type DataFilterValue = DataFilterPrimitive | DataFilterPrimitive[] | DataFilterExpression;
export type DataPageFilters = Record<string, DataFilterValue>;

export interface DataPageSort {
  field: string;
  dir?: 'asc' | 'desc';
}

export interface DataPageOptions {
  filters?: DataPageFilters;
  sort?: DataPageSort | null;
  pageSize?: number;
  initialPage?: number;
  autoLoad?: boolean;
  replaceCollection?: boolean;
}

export interface DataPageInfo {
  limit: number;
  offset: number;
  count: number;
  hasMore: boolean;
  nextOffset: number | null;
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

function stableValueKey(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, next]) => `${JSON.stringify(key)}:${stableValueKey(next)}`)
    .join(',')}}`;
}

function normalizePage(page: number): number {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function normalizePageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize)) return 50;
  return Math.max(1, Math.floor(pageSize));
}

function appendFilter(params: URLSearchParams, field: string, filter: DataFilterValue): void {
  if (Array.isArray(filter)) {
    const values = filter.filter((value) => value !== null && value !== undefined);
    if (values.length > 0) params.append('filter', `${field}:in:${values.map(String).join(',')}`);
    return;
  }

  if (filter && typeof filter === 'object') {
    const expression = filter as DataFilterExpression;
    if (Array.isArray(expression.value)) {
      const values = expression.value.filter((value) => value !== null && value !== undefined);
      if (values.length > 0) params.append('filter', `${field}:${expression.op ?? 'in'}:${values.map(String).join(',')}`);
      return;
    }
    if (expression.value !== null && expression.value !== undefined) {
      const op = expression.op ?? 'eq';
      params.append('filter', op === 'eq'
        ? `${field}:${String(expression.value)}`
        : `${field}:${op}:${String(expression.value)}`);
    }
    return;
  }

  if (filter !== null && filter !== undefined) {
    params.append('filter', `${field}:${String(filter)}`);
  }
}

/**
 * Build the `/api/data` query string for `useDataPage`.
 *
 * Exported for tests and advanced integrations that need identical query
 * encoding without running the React hook.
 */
export function buildDataPageQuery(
  table: string,
  filters: DataPageFilters,
  sort: DataPageSort | null,
  page: number,
  pageSize: number,
): string {
  const limit = normalizePageSize(pageSize);
  const offset = (normalizePage(page) - 1) * limit;
  const params = new URLSearchParams({ table });

  for (const [field, filter] of Object.entries(filters)) {
    appendFilter(params, field, filter);
  }

  if (sort?.field) {
    params.set('order', sort.field);
    params.set('dir', sort.dir ?? 'desc');
  }

  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return `/api/data?${params}`;
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
  const collection = useCollection<T>(table);
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
    if (!client || options.autoLoad === false) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    client.fetch<DataPageResponse<T>>(query, { signal: controller.signal })
      .then((response) => {
        if (requestRef.current !== requestId) return;
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
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        emitFrontendCode(OBS_CODES.FRONTEND_DATA_PAGE_FAILED, {
          error: nextError,
          metadata: { table, query },
        });
      })
      .finally(() => {
        if (!controller.signal.aborted && requestRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [client, collection.load, options.autoLoad, options.replaceCollection, page, pageSize, query, table]);

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

  const setFilter = useCallback((field: string, value: DataFilterValue) => {
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
    rows: collection.data,
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
  upsert: (row: T) => void;
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
  const collection = useMemo(() => client?.collection<T>(table) ?? null, [client, table]);
  const data = useCollection<T>(table);
  const identityKey = useMemo(
    () => identity && collection ? collection.identityKey(identity) : null,
    [collection, identity],
  );
  const row = useMemo(
    () => identity && collection ? collection.getByIdentity(identity) : null,
    [collection, data.byId, identity],
  );

  const upsert = useCallback((nextRow: T) => {
    collection?.upsertByIdentity(nextRow);
  }, [collection]);

  const update = useCallback((partial: Partial<T>) => {
    if (identity) collection?.updateByIdentity(identity, partial);
  }, [collection, identity]);

  const remove = useCallback(() => {
    if (identity) collection?.deleteByIdentity(identity);
  }, [collection, identity]);

  return {
    row,
    id: identityKey,
    exists: row !== null,
    upsert,
    update,
    remove,
  };
}
