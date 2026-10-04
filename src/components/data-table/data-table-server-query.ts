/** Query normalization and the authenticated `/api/data` DataTable adapter. */

import type { Client } from '../../frontend/client/sdk';
import {
  appendDataFilter,
  stableValueKey,
  type DataFilterExpression,
  type DataFilterOperator,
  type DataFilterPrimitive,
  type DataFilterValue,
} from '../../frontend/client/query-params';
import type { Row } from '../../sync/types';
import {
  DataTableServerSourceError,
  type DataTableServerAdapter,
  type DataTableServerQuery,
  type DataTableServerResult,
} from './data-table-server-types';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_FILTERS = 64;
const MAX_SEARCH_FIELDS = 16;
const MAX_SEARCH_LENGTH = 1_024;
const MAX_SORT_FIELDS = 8;
const FILTER_OPERATORS = new Set<DataFilterOperator>([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'contains', 'in',
]);

interface DataTableApiResponse<T extends Row> {
  rows: T[];
  page: {
    limit: number;
    offset: number;
    count: number;
    hasMore: boolean;
    nextOffset: number | null;
    total?: number;
  };
}

/** Snapshot and validate caller-owned query state before asynchronous use. */
export function normalizeDataTableServerQuery(
  query: DataTableServerQuery,
): DataTableServerQuery {
  const pagination = query.pagination;
  if ((pagination.mode !== 'offset' && pagination.mode !== 'cursor')
    || !Number.isSafeInteger(pagination.pageIndex)
    || pagination.pageIndex < 0
    || !Number.isSafeInteger(pagination.pageSize)
    || pagination.pageSize < 1
    || (pagination.cursor !== undefined
      && pagination.cursor !== null
      && typeof pagination.cursor !== 'string')) {
    throw invalidQuery();
  }
  if (pagination.mode === 'cursor'
    && pagination.pageIndex > 0
    && (pagination.cursor === undefined || pagination.cursor === null)) {
    throw invalidQuery();
  }
  if (typeof query.search !== 'string'
    || query.search.length > MAX_SEARCH_LENGTH
    || query.filters.length > MAX_FILTERS
    || query.sorting.length > MAX_SORT_FIELDS
    || (query.searchFields?.length ?? 0) > MAX_SEARCH_FIELDS) {
    throw invalidQuery();
  }

  const searchFields = [...new Set(query.searchFields ?? [])].sort();
  for (const field of searchFields) assertIdentifier(field);

  const filters = query.filters.map((filter) => {
    assertIdentifier(filter.id);
    return { id: filter.id, value: normalizeFilterValue(filter.value) };
  });
  filters.sort((left, right) => left.id.localeCompare(right.id));

  const sortingFields = new Set<string>();
  const sorting = query.sorting.map((sort) => {
    assertIdentifier(sort.id);
    if (sortingFields.has(sort.id)) throw invalidQuery();
    sortingFields.add(sort.id);
    return { id: sort.id, desc: sort.desc === true };
  });

  return {
    search: query.search,
    filters,
    sorting,
    pagination: {
      mode: pagination.mode,
      pageIndex: pagination.pageIndex,
      pageSize: pagination.pageSize,
      ...(pagination.cursor === undefined ? {} : { cursor: pagination.cursor }),
    },
    ...(searchFields.length === 0 ? {} : { searchFields }),
  };
}

/** Stable identity used to fence stale rows and out-of-order responses. */
export function dataTableServerQueryKey(
  table: string,
  query: DataTableServerQuery,
): string {
  return stableValueKey([table, normalizeDataTableServerQuery(query)]);
}

/** Encode one offset query for Zero's backwards-compatible `/api/data` route. */
export function buildDataTableServerQuery(
  table: string,
  queryInput: DataTableServerQuery,
): string {
  assertIdentifier(table);
  const query = normalizeDataTableServerQuery(queryInput);
  if (query.pagination.mode !== 'offset') {
    throw new DataTableServerSourceError(
      'Cursor pagination requires a custom DataTable server adapter.',
      'DATA_TABLE_SERVER_CURSOR_ADAPTER_REQUIRED',
    );
  }

  const offset = query.pagination.pageIndex * query.pagination.pageSize;
  if (!Number.isSafeInteger(offset)) throw invalidQuery();
  const params = new URLSearchParams({
    table,
    limit: String(query.pagination.pageSize),
    offset: String(offset),
  });
  const search = query.search.trim();
  if (search && !query.searchFields?.length) throw invalidQuery();
  if (search && query.searchFields?.length) {
    params.set('search', search);
    for (const field of query.searchFields) params.append('searchField', field);
  }

  const containsFields = new Set(query.searchFields ?? []);
  for (const filter of query.filters) {
    appendDataFilter(
      params,
      filter.id,
      defaultFilterOperator(filter.value as DataFilterValue, containsFields.has(filter.id)),
    );
  }
  for (const sort of query.sorting) {
    params.append('sort', `${sort.id}:${sort.desc ? 'desc' : 'asc'}`);
  }
  return `/api/data?${params}`;
}

/** Build the default authenticated adapter without exposing the SDK client publicly. */
export function createDataTableApiAdapter<T extends Row>(
  client: Client,
  table: string,
): DataTableServerAdapter<T> {
  return {
    async query(query, { signal }) {
      const response = await client.fetch<DataTableApiResponse<T>>(
        buildDataTableServerQuery(table, query),
        { signal },
      );
      return normalizeDataTableApiResponse<T>(response, {
        limit: query.pagination.pageSize,
        offset: query.pagination.pageIndex * query.pagination.pageSize,
      });
    },
  };
}

/** Validate and snapshot the built-in endpoint response. */
export function normalizeDataTableApiResponse<T extends Row>(
  value: unknown,
  expectedPage?: { limit: number; offset: number },
): DataTableServerResult<T> {
  if (!isRecord(value) || !Array.isArray(value.rows) || !isRecord(value.page)) {
    throw invalidResponse();
  }
  if (value.rows.some((row) => !isRecord(row))) throw invalidResponse();
  const page = value.page;
  if (!isNonNegativeInteger(page.offset)
    || !isPositiveInteger(page.limit)
    || !isNonNegativeInteger(page.count)
    || page.count !== value.rows.length
    || page.count > page.limit
    || typeof page.hasMore !== 'boolean'
    || (page.nextOffset !== null && !isNonNegativeInteger(page.nextOffset))
    || (page.hasMore && page.nextOffset !== page.offset + page.limit)
    || (!page.hasMore && page.nextOffset !== null)
    || (expectedPage !== undefined
      && (page.limit !== expectedPage.limit || page.offset !== expectedPage.offset))
    || (page.total !== undefined && !isNonNegativeInteger(page.total))) {
    throw invalidResponse();
  }
  return {
    rows: [...value.rows] as T[],
    page: {
      mode: 'offset',
      offset: page.offset,
      hasMore: page.hasMore,
      ...(page.total === undefined ? {} : { total: page.total }),
    },
  };
}

/** Validate a custom adapter result before it crosses into table state. */
export function normalizeDataTableServerResult<T extends Row>(
  value: unknown,
  expectedMode: 'offset' | 'cursor',
): DataTableServerResult<T> {
  if (!isRecord(value) || !Array.isArray(value.rows) || !isRecord(value.page)) {
    throw invalidResponse();
  }
  if (value.rows.some((row) => !isRecord(row))) throw invalidResponse();
  const page = value.page;
  if (page.mode !== expectedMode
    || typeof page.hasMore !== 'boolean'
    || (page.total !== undefined && !isNonNegativeInteger(page.total))) {
    throw invalidResponse();
  }
  if (page.mode === 'offset') {
    if (!isNonNegativeInteger(page.offset)) throw invalidResponse();
    return {
      rows: [...value.rows] as T[],
      page: {
        mode: 'offset',
        offset: page.offset,
        hasMore: page.hasMore,
        ...(page.total === undefined ? {} : { total: page.total }),
      },
    };
  }
  if (!isOptionalCursor(page.nextCursor) || !isOptionalCursor(page.previousCursor)) {
    throw invalidResponse();
  }
  return {
    rows: [...value.rows] as T[],
    page: {
      mode: 'cursor',
      hasMore: page.hasMore,
      ...(page.total === undefined ? {} : { total: page.total }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      ...(page.previousCursor === undefined ? {} : { previousCursor: page.previousCursor }),
    },
  };
}

function defaultFilterOperator(
  value: DataFilterValue,
  searchableText: boolean,
): DataFilterValue {
  return searchableText && typeof value === 'string'
    ? { op: 'contains', value }
    : value;
}

function normalizeFilterValue(value: unknown): DataFilterValue {
  if (isPrimitive(value)) return value;
  if (Array.isArray(value)) {
    if (!value.every(isPrimitive)) throw invalidQuery();
    return [...value];
  }
  if (!isRecord(value)
    || (value.op !== undefined && !FILTER_OPERATORS.has(value.op as DataFilterOperator))
    || !('value' in value)) throw invalidQuery();
  const normalized = normalizeFilterValue(value.value);
  if (isFilterExpression(normalized)) throw invalidQuery();
  return {
    ...(value.op === undefined ? {} : { op: value.op as DataFilterOperator }),
    value: normalized as DataFilterPrimitive | DataFilterPrimitive[],
  } satisfies DataFilterExpression;
}

function isFilterExpression(value: DataFilterValue): value is DataFilterExpression {
  return isRecord(value) && 'value' in value;
}

function isPrimitive(value: unknown): value is DataFilterPrimitive {
  return value === null
    || value === undefined
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean';
}

function isOptionalCursor(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function assertIdentifier(value: string): void {
  if (!IDENTIFIER.test(value) || value.length > 128) throw invalidQuery();
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidQuery(): DataTableServerSourceError {
  return new DataTableServerSourceError(
    'DataTable server query state is invalid.',
    'DATA_TABLE_SERVER_QUERY_INVALID',
  );
}

function invalidResponse(): DataTableServerSourceError {
  return new DataTableServerSourceError(
    'DataTable server adapter returned an invalid result.',
    'DATA_TABLE_SERVER_RESPONSE_INVALID',
  );
}
