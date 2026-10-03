/**
 * data-studio-query.ts
 *
 * Browser-safe Data Studio query serialization, cache identity, and logical
 * row projection helpers. This module performs no requests.
 */

import type {
  DataStudioColumn,
  DataStudioRow,
  DataStudioValue,
} from '../../data-studio/data-studio-contracts';
import type {
  DataStudioRowFilterOperator,
  DataStudioRowQuery,
} from './data-studio-client-types';

const DATA_STUDIO_FILTER_OPERATORS: ReadonlySet<DataStudioRowFilterOperator> = new Set([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
]);

/** Stable cache key shared by the transport and row hooks. */
export function dataStudioRowQueryKey(
  tableId: string,
  query: DataStudioRowQuery = {},
): string {
  return JSON.stringify([
    tableId,
    query.limit ?? null,
    query.offset ?? null,
    query.search ?? null,
    query.filters?.map((filter) => [
      filter.columnKey,
      filter.operator,
      filter.value,
    ]) ?? null,
    query.sortColumnId ?? null,
    query.sortDirection ?? null,
  ]);
}

export function rowQueryString(query: DataStudioRowQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1)) {
    throw new TypeError('Data Studio row limit must be a positive integer.');
  }
  if (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0)) {
    throw new TypeError('Data Studio row offset must be a non-negative integer.');
  }
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.search) {
    if (query.search.length > 200) throw new TypeError('Data Studio search exceeds 200 characters.');
    params.set('search', query.search);
  }
  if (query.filters?.length) {
    if (query.filters.length > 8) throw new TypeError('Data Studio supports at most 8 row filters.');
    for (const filter of query.filters) {
      if (typeof filter.columnKey !== 'string'
        || filter.columnKey.length < 1
        || filter.columnKey.length > 64
        || !DATA_STUDIO_FILTER_OPERATORS.has(filter.operator)
        || (filter.value !== null
          && typeof filter.value !== 'string'
          && typeof filter.value !== 'number'
          && typeof filter.value !== 'boolean')
        || (typeof filter.value === 'number' && !Number.isFinite(filter.value))
        || (filter.value === null
          && filter.operator !== 'eq'
          && filter.operator !== 'ne')) {
        throw new TypeError('Data Studio row filter is invalid.');
      }
    }
    const serializedFilters = JSON.stringify(query.filters);
    if (serializedFilters.length > 8_192) {
      throw new TypeError('Data Studio row filters exceed the transport limit.');
    }
    params.set('filter', serializedFilters);
  }
  if (query.sortColumnId) params.set('sortColumnId', query.sortColumnId);
  if (query.sortDirection) params.set('sortDirection', query.sortDirection);
  return params.size > 0 ? `?${params.toString()}` : '';
}

/** Convert a logical row's column-id map to the API's stable column-key map. */
export function dataStudioRowValuesByKey(
  row: Pick<DataStudioRow, 'values'>,
  columns: readonly DataStudioColumn[],
): Readonly<Record<string, DataStudioValue>> {
  const values: Record<string, DataStudioValue> = {};
  for (const column of columns) {
    if (Object.hasOwn(row.values, column.columnId)) {
      values[column.key] = row.values[column.columnId]!;
    }
  }
  return values;
}

/** Read a cell by stable column id, preserving absent versus stored-null. */
export function dataStudioCellValue(
  row: Pick<DataStudioRow, 'values'>,
  columnId: string,
): DataStudioValue | undefined {
  return Object.hasOwn(row.values, columnId) ? row.values[columnId] : undefined;
}
