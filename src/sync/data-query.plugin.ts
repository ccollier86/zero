/**
 * data-query.plugin.ts
 *
 * Owns the lazy-table HTTP query endpoint used by frontend lazy collections.
 * This file validates query parameters, builds safe SQLite reads, and enforces
 * sync read policy; it does not own table schemas, mutation behavior, or UI
 * loading state.
 */

import { Elysia, t } from 'elysia';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import { getSyncDB } from './sync.plugin';
import { allowAllSyncPolicy, evaluateSyncReadPolicy } from './sync-policy';
import type { SyncPolicy } from './sync-policy';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface DataQueryConfig {
  /** Set of table names that can be queried via /api/data */
  queryableTables: Set<string>;
  /** Column definitions per table for validation */
  tableColumns: Map<string, string[]>;
  /** Optional sync read policy reused for lazy HTTP reads. */
  policy?: SyncPolicy;
  /** Optional auth token service provider used to resolve HTTP auth context. */
  getTokenService?: () => TokenService | null;
  /** Default number of rows returned when limit is omitted. */
  defaultLimit?: number;
  /** Maximum number of rows a single request may return. */
  maxLimit?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of rows returned per request. */
const MAX_LIMIT = 1000;

/** Default limit when none specified. */
const DEFAULT_LIMIT = 500;

/** Pattern for valid SQL identifiers (column names, table names). */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type QueryParam = string | number | null;

type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'contains'
  | 'in';

interface QueryError {
  status: number;
  error: string;
}

interface FilterClause {
  sql: string;
  params: QueryParam[];
}

interface ParsedPage {
  limit: number;
  offset: number;
}

const FILTER_OPERATORS = new Set<FilterOperator>([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'contains',
  'in',
]);

const MAX_IN_VALUES = 50;

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Create the data query Elysia plugin.
 *
 * Registers `GET /api/data` — a generic query endpoint for lazy-synced tables.
 * Accepts query params:
 * - `table` (required) — which table to query
 * - `filter` (repeatable) — format `field:value`, applied as AND conditions
 * - `order` (optional) — column name, always DESC
 * - `limit` (optional) — max rows, capped at MAX_LIMIT
 *
 * Security:
 * - Table name validated against the allowed set (config.queryableTables)
 * - Column names in filter/order validated against known columns (config.tableColumns)
 * - Filter values passed as parameterized query params (never interpolated into SQL)
 * - Limit validated as positive integer
 */
export function createDataQueryPlugin(config: DataQueryConfig) {
  const policy = config.policy ?? allowAllSyncPolicy;
  const defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = config.maxLimit ?? MAX_LIMIT;

  return new Elysia({ name: 'data-query' })
    .use(createAuthMiddleware(config.getTokenService ?? (() => null)))
    .get('/api/data', ({ query, set, authContext }) => {
      const db = getSyncDB();
      if (!db) {
        set.status = 503;
        return { error: 'Database not ready' };
      }

      const { table } = query;

      // ─── Validate table ──────────────────────────────────
      if (!table) {
        set.status = 400;
        return { error: 'Missing required query parameter: table' };
      }

      if (!SAFE_IDENTIFIER.test(table)) {
        set.status = 400;
        return { error: `Invalid table name: ${table}` };
      }

      if (!db.hasTable(table)) {
        set.status = 400;
        return { error: `Unknown table: ${table}` };
      }

      if (!config.queryableTables.has(table)) {
        set.status = 403;
        return { error: `Table '${table}' is not queryable` };
      }

      const readDecision = evaluateSyncReadPolicy(policy, { table, authContext });
      if (!readDecision.ok) {
        set.status = 403;
        return { error: readDecision.reason ?? `Not allowed: ${table}` };
      }

      // Get the allowed columns for this table
      const allowedColumns = config.tableColumns.get(table);
      if (!allowedColumns || allowedColumns.length === 0) {
        set.status = 400;
        return { error: `No column metadata for table: ${table}` };
      }

      const allowedColumnSet = new Set(allowedColumns);

      // ─── Parse filters ───────────────────────────────────
      const filterResult = buildFilterClauses(query.filter, table, allowedColumnSet);
      if ('error' in filterResult) {
        set.status = filterResult.status;
        return { error: filterResult.error };
      }
      const filters = filterResult.clauses.map((clause) => clause.sql);
      const params = filterResult.clauses.flatMap((clause) => clause.params);

      // ─── Validate order column ───────────────────────────
      const orderResult = buildOrderClause(query.order, query.dir, table, allowedColumnSet);
      if ('error' in orderResult) {
        set.status = orderResult.status;
        return { error: orderResult.error };
      }

      // ─── Validate pagination ─────────────────────────────
      const pageResult = parsePagination(query.limit, query.offset, defaultLimit, maxLimit);
      if ('error' in pageResult) {
        set.status = pageResult.status;
        return { error: pageResult.error };
      }
      const { limit, offset } = pageResult;

      // ─── Build and execute query ─────────────────────────
      // Table name is validated against config.queryableTables (a known safe set).
      // Column names are validated against config.tableColumns (known safe set).
      // Only filter values use parameterized queries.
      const whereClause = filters.length > 0
        ? ` WHERE ${filters.join(' AND ')}`
        : '';

      const fetchLimit = limit + 1;
      const sql = `SELECT * FROM ${quoteIdentifier(table)}${whereClause}${orderResult.orderClause} LIMIT ? OFFSET ?`;
      params.push(fetchLimit, offset);

      const resultRows = db.prepare(sql).all(...(params as any[]));
      const hasMore = resultRows.length > limit;
      const rows = hasMore ? resultRows.slice(0, limit) : resultRows;

      return {
        rows,
        page: {
          limit,
          offset,
          count: rows.length,
          hasMore,
          nextOffset: hasMore ? offset + limit : null,
        },
      };
    }, {
      query: t.Object({
        table: t.String({ minLength: 1 }),
        filter: t.Optional(t.Union([t.String(), t.Array(t.String())])),
        order: t.Optional(t.String()),
        dir: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    });
}

/**
 * Build safe SQL filter fragments from repeatable filter query parameters.
 *
 * Supported forms:
 * - `field:value` keeps the historical equality behavior.
 * - `field:op:value` enables explicit operators such as `gt`, `contains`, or `in`.
 */
function buildFilterClauses(
  filterParams: string | string[] | undefined,
  table: string,
  allowedColumnSet: Set<string>
): { clauses: FilterClause[] } | QueryError {
  const clauses: FilterClause[] = [];
  if (!filterParams) return { clauses };

  const filterList = Array.isArray(filterParams) ? filterParams : [filterParams];

  for (const expression of filterList) {
    const parsed = parseFilterExpression(expression);
    if ('error' in parsed) return parsed;

    const { field, operator, value } = parsed;
    const column = validateColumn(field, table, allowedColumnSet, 'filter field');
    if ('error' in column) return column;

    const clause = buildOperatorClause(column.identifier, operator, value);
    if ('error' in clause) return clause;
    clauses.push(clause);
  }

  return { clauses };
}

function parseFilterExpression(
  expression: string
): { field: string; operator: FilterOperator; value: string } | QueryError {
  const colonIdx = expression.indexOf(':');
  if (colonIdx === -1) {
    return { status: 400, error: `Invalid filter format: ${expression}` };
  }

  const field = expression.slice(0, colonIdx);
  const remainder = expression.slice(colonIdx + 1);
  const opDelimiter = remainder.indexOf(':');

  if (opDelimiter !== -1) {
    const maybeOperator = remainder.slice(0, opDelimiter).toLowerCase();
    if (FILTER_OPERATORS.has(maybeOperator as FilterOperator)) {
      return {
        field,
        operator: maybeOperator as FilterOperator,
        value: remainder.slice(opDelimiter + 1),
      };
    }
  }

  return { field, operator: 'eq', value: remainder };
}

function buildOperatorClause(
  column: string,
  operator: FilterOperator,
  value: string
): FilterClause | QueryError {
  switch (operator) {
    case 'eq':
      return { sql: `${column} = ?`, params: [value] };
    case 'ne':
      return { sql: `${column} != ?`, params: [value] };
    case 'gt':
      return { sql: `${column} > ?`, params: [value] };
    case 'gte':
      return { sql: `${column} >= ?`, params: [value] };
    case 'lt':
      return { sql: `${column} < ?`, params: [value] };
    case 'lte':
      return { sql: `${column} <= ?`, params: [value] };
    case 'like':
      return { sql: `${column} LIKE ?`, params: [value] };
    case 'contains':
      return {
        sql: `${column} LIKE ? ESCAPE '\\'`,
        params: [`%${escapeLikeValue(value)}%`],
      };
    case 'in': {
      const values = value.split(',').map((part) => part.trim()).filter(Boolean);
      if (values.length === 0) {
        return { status: 400, error: 'Filter operator "in" requires at least one value' };
      }
      if (values.length > MAX_IN_VALUES) {
        return {
          status: 400,
          error: `Filter operator "in" supports at most ${MAX_IN_VALUES} values`,
        };
      }
      return {
        sql: `${column} IN (${values.map(() => '?').join(', ')})`,
        params: values,
      };
    }
  }
}

function buildOrderClause(
  orderParam: string | undefined,
  dirParam: string | undefined,
  table: string,
  allowedColumnSet: Set<string>
): { orderClause: string } | QueryError {
  if (!orderParam) return { orderClause: '' };

  const column = validateColumn(orderParam, table, allowedColumnSet, 'order column');
  if ('error' in column) return column;

  const direction = (dirParam ?? 'desc').toLowerCase();
  if (direction !== 'asc' && direction !== 'desc') {
    return { status: 400, error: 'Sort direction must be "asc" or "desc"' };
  }

  return { orderClause: ` ORDER BY ${column.identifier} ${direction.toUpperCase()}` };
}

function parsePagination(
  limitParam: number | undefined,
  offsetParam: number | undefined,
  defaultLimit: number,
  maxLimit: number
): ParsedPage | QueryError {
  const defaultLimitResult = parseInteger(defaultLimit, 'Default limit', 1);
  if ('error' in defaultLimitResult) return defaultLimitResult;

  const maxLimitResult = parseInteger(maxLimit, 'Max limit', 1);
  if ('error' in maxLimitResult) return maxLimitResult;

  const limitResult = limitParam === undefined
    ? { value: defaultLimitResult.value }
    : parseInteger(limitParam, 'Limit', 1);
  if ('error' in limitResult) return limitResult;

  const offsetResult = offsetParam === undefined
    ? { value: 0 }
    : parseInteger(offsetParam, 'Offset', 0);
  if ('error' in offsetResult) return offsetResult;

  return {
    limit: Math.min(limitResult.value, maxLimitResult.value),
    offset: offsetResult.value,
  };
}

function parseInteger(value: number, label: string, min: number): { value: number } | QueryError {
  if (!Number.isInteger(value) || value < min) {
    const description = min === 0 ? 'a non-negative integer' : 'a positive integer';
    return { status: 400, error: `${label} must be ${description}` };
  }
  return { value };
}

function validateColumn(
  column: string,
  table: string,
  allowedColumnSet: Set<string>,
  label: string
): { identifier: string } | QueryError {
  if (!SAFE_IDENTIFIER.test(column)) {
    return { status: 400, error: `Invalid ${label} name: ${column}` };
  }
  if (!allowedColumnSet.has(column)) {
    return { status: 400, error: `Unknown column '${column}' for table '${table}'` };
  }
  return { identifier: quoteIdentifier(column) };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
