/** Search and multi-sort planning shared by SQL and isolated actor reads. */

import {
  DATABASE_FIND_MAX_ORDER_FIELDS,
  isDatabaseTableName,
  type DatabaseFindFilter,
  type DatabaseFindOrder,
} from '../databases/database-operations';

type QueryParam = string | number | null;

export interface ResourceClientControlError {
  status: number;
  error: string;
}

export interface ResourceClientControlQuery {
  search?: string;
  searchField?: string | readonly string[];
  sort?: string | readonly string[];
  order?: string;
  dir?: string;
}

export const RESOURCE_CLIENT_CONTROL_LIMITS = Object.freeze({
  searchLength: 1_024,
  searchFieldCount: 16,
  sortCount: DATABASE_FIND_MAX_ORDER_FIELDS,
  sortExpressionLength: 256,
});

export function validateResourceClientControls(
  query: ResourceClientControlQuery | undefined,
): ResourceClientControlError | null {
  if (!query) return null;
  if (query.search !== undefined
    && query.search.length > RESOURCE_CLIENT_CONTROL_LIMITS.searchLength) {
    return { status: 400, error: 'Search text is too long' };
  }
  const fields = toList(query.searchField);
  if (fields.length > RESOURCE_CLIENT_CONTROL_LIMITS.searchFieldCount) {
    return {
      status: 400,
      error: `At most ${RESOURCE_CLIENT_CONTROL_LIMITS.searchFieldCount} search fields are allowed`,
    };
  }
  const sorts = toList(query.sort);
  if (sorts.length > RESOURCE_CLIENT_CONTROL_LIMITS.sortCount) {
    return {
      status: 400,
      error: `At most ${RESOURCE_CLIENT_CONTROL_LIMITS.sortCount} sort fields are allowed`,
    };
  }
  if (sorts.some((value) => (
    value.length > RESOURCE_CLIENT_CONTROL_LIMITS.sortExpressionLength
  ))) {
    return { status: 400, error: 'Invalid sort expression' };
  }
  if (sorts.length > 0 && query.order !== undefined) {
    return { status: 400, error: 'Use either sort or order/dir, not both' };
  }
  return null;
}

export function buildResourceSqlSearch(
  search: string | undefined,
  searchFields: string | readonly string[] | undefined,
  table: string,
  allowedColumns: Set<string>,
): { clause?: { sql: string; params: QueryParam[] } } | ResourceClientControlError {
  const value = search?.trim();
  if (!value) return {};
  const fields = toList(searchFields);
  if (fields.length === 0) return missingSearchFields();
  const columns = validateColumns(fields, table, allowedColumns, 'search field');
  if ('error' in columns) return columns;
  return {
    clause: {
      sql: `(${columns.fields.map((field) => `${quote(field)} LIKE ? ESCAPE '\\'`).join(' OR ')})`,
      params: columns.fields.map(() => `%${escapeLikeValue(value)}%`),
    },
  };
}

export function buildResourceFindSearch(
  search: string | undefined,
  searchFields: string | readonly string[] | undefined,
  table: string,
  allowedColumns: Set<string>,
): { filter?: DatabaseFindFilter } | ResourceClientControlError {
  const value = search?.trim();
  if (!value) return {};
  const fields = toList(searchFields);
  if (fields.length === 0) return missingSearchFields();
  const columns = validateColumns(fields, table, allowedColumns, 'search field');
  if ('error' in columns) return columns;
  return {
    filter: {
      type: 'anyOf',
      filters: columns.fields.map((field) => ({
        type: 'field' as const,
        field,
        operator: 'contains' as const,
        value,
      })),
    },
  };
}

export function buildResourceSqlOrder(
  sort: string | readonly string[] | undefined,
  legacyOrder: string | undefined,
  legacyDirection: string | undefined,
  table: string,
  allowedColumns: Set<string>,
): { orderClause: string } | ResourceClientControlError {
  const parsed = parseOrder(sort, legacyOrder, legacyDirection, table, allowedColumns);
  if ('error' in parsed) return parsed;
  if (parsed.order.length === 0) return { orderClause: '' };
  return {
    orderClause: ` ORDER BY ${parsed.order
      .map((item) => `${quote(item.field)} ${item.direction.toUpperCase()}`)
      .join(', ')}`,
  };
}

export function buildResourceFindOrder(
  sort: string | readonly string[] | undefined,
  legacyOrder: string | undefined,
  legacyDirection: string | undefined,
  table: string,
  allowedColumns: Set<string>,
): { order?: DatabaseFindOrder[] } | ResourceClientControlError {
  const parsed = parseOrder(sort, legacyOrder, legacyDirection, table, allowedColumns);
  if ('error' in parsed) return parsed;
  return parsed.order.length === 0 ? {} : { order: parsed.order };
}

function parseOrder(
  sort: string | readonly string[] | undefined,
  legacyOrder: string | undefined,
  legacyDirection: string | undefined,
  table: string,
  allowedColumns: Set<string>,
): { order: DatabaseFindOrder[] } | ResourceClientControlError {
  const sortList = toList(sort);
  const terms: Array<DatabaseFindOrder | ResourceClientControlError> = sortList.length > 0
    ? sortList.map(parseSortExpression)
    : [];
  if (sortList.length === 0 && legacyOrder) {
    const direction = normalizeDirection(legacyDirection ?? 'desc');
    if (typeof direction !== 'string') return direction;
    terms.push({ field: legacyOrder, direction });
  }
  const order: DatabaseFindOrder[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    if ('error' in term) return term;
    const column = validateColumn(term.field, table, allowedColumns, 'order column');
    if (column) return column;
    if (seen.has(term.field)) {
      return { status: 400, error: `Duplicate sort column '${term.field}'` };
    }
    seen.add(term.field);
    order.push(term);
  }
  return { order };
}

function parseSortExpression(
  value: string,
): DatabaseFindOrder | ResourceClientControlError {
  const separator = value.lastIndexOf(':');
  if (separator < 1) return { status: 400, error: 'Invalid sort expression' };
  const field = value.slice(0, separator);
  const direction = normalizeDirection(value.slice(separator + 1));
  return typeof direction === 'string'
    ? { field, direction }
    : direction;
}

function normalizeDirection(
  value: string,
): 'asc' | 'desc' | ResourceClientControlError {
  const direction = value.toLowerCase();
  return direction === 'asc' || direction === 'desc'
    ? direction
    : { status: 400, error: 'Sort direction must be "asc" or "desc"' };
}

function validateColumns(
  fields: string[],
  table: string,
  allowedColumns: Set<string>,
  label: string,
): { fields: string[] } | ResourceClientControlError {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const error = validateColumn(field, table, allowedColumns, label);
    if (error) return error;
    if (!seen.has(field)) unique.push(field);
    seen.add(field);
  }
  return { fields: unique };
}

function validateColumn(
  field: string,
  table: string,
  allowedColumns: Set<string>,
  label: string,
): ResourceClientControlError | null {
  if (!isDatabaseTableName(field)) {
    return { status: 400, error: `Invalid ${label} name` };
  }
  if (!allowedColumns.has(field)) {
    return { status: 400, error: `Unknown column '${field}' for table '${table}'` };
  }
  return null;
}

function toList(value: string | readonly string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as string];
}

function missingSearchFields(): ResourceClientControlError {
  return { status: 400, error: 'Search requires at least one search field' };
}

function quote(value: string): string {
  return `"${value}"`;
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
