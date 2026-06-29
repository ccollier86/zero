/**
 * query-params.ts
 *
 * Owns frontend query-string encoding for Zero data/resource list APIs. This
 * file is transport-neutral and React-free; it does not fetch data, mutate
 * stores, or interpret backend authorization policy.
 */

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

/** Pagination metadata returned by `/api/data` and generated resource lists. */
export interface DataPageInfo {
  limit: number;
  offset: number;
  count: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/** Build a stable key for filter/sort objects used in React dependencies. */
export function stableValueKey(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, next]) => `${JSON.stringify(key)}:${stableValueKey(next)}`)
    .join(',')}}`;
}

/** Normalize a 1-based page number for list hooks. */
export function normalizePage(page: number): number {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

/** Normalize a positive page size, defaulting to 50. */
export function normalizePageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize)) return 50;
  return Math.max(1, Math.floor(pageSize));
}

/** Append Zero filter query parameters to an existing URLSearchParams object. */
export function appendDataFilter(
  params: URLSearchParams,
  field: string,
  filter: DataFilterValue
): void {
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

/** Append all filter expressions to a URLSearchParams object. */
export function appendDataFilters(
  params: URLSearchParams,
  filters: DataPageFilters
): void {
  for (const [field, filter] of Object.entries(filters)) {
    appendDataFilter(params, field, filter);
  }
}

/**
 * Build the `/api/data` query string for table-backed list reads.
 *
 * Exported for tests and integrations that need identical query encoding
 * without running React hooks.
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

  appendDataFilters(params, filters);

  if (sort?.field) {
    params.set('order', sort.field);
    params.set('dir', sort.dir ?? 'desc');
  }

  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return `/api/data?${params}`;
}

/** Build the generated-resource list route with Zero filter/sort pagination. */
export function buildResourceListQuery(
  resource: string,
  options: {
    filters?: DataPageFilters;
    sort?: DataPageSort | null;
    limit?: number;
    offset?: number;
    prefix?: string;
  } = {}
): string {
  const prefix = normalizeResourcePrefix(options.prefix ?? '/api/resources');
  const params = new URLSearchParams();
  appendDataFilters(params, options.filters ?? {});

  if (options.sort?.field) {
    params.set('order', options.sort.field);
    params.set('dir', options.sort.dir ?? 'desc');
  }
  if (options.limit !== undefined) params.set('limit', String(normalizePageSize(options.limit)));
  if (options.offset !== undefined) params.set('offset', String(Math.max(0, Math.floor(options.offset))));

  const query = params.toString();
  const path = `${prefix}/${encodeURIComponent(resource)}`;
  return query ? `${path}?${query}` : path;
}

/** Normalize generated resource route prefixes for frontend clients. */
export function normalizeResourcePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') : `/${trimmed.replace(/\/+$/, '')}`;
}
