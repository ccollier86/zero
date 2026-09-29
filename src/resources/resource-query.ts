/**
 * resource-query.ts
 *
 * Builds safe SQL read plans for generated resource list routes. This file
 * owns query-string and policy-constraint translation only; it does not
 * evaluate policies, mutate ReactiveDB, or mount HTTP routes.
 */

import type { ResourceDataConstraint, ResourcePolicyScalar } from './resource-policy-types';
import {
  DATABASE_FIND_MAX_FILTERS,
  DATABASE_FIND_MAX_ROWS,
  DATABASE_OPERATION_MAX_NAME_LENGTH,
  isDatabaseTableName,
  type DatabaseFindFilter,
  type DatabaseFindInput,
} from '../databases/database-operations';

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

/** Query input accepted by generated resource list routes. */
export interface ResourceListQueryInput {
  filter?: string | string[];
  order?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

/** Options used to build a safe resource list SQL plan. */
export interface ResourceListQueryPlanOptions {
  table: string;
  /** Complete server columns available to trusted policy constraints. */
  columns: readonly string[];
  /** Columns returned by SQL. Omit for the legacy `SELECT *` behavior. */
  selectColumns?: readonly string[];
  /** Columns client-authored filters may reference. Defaults to `columns`. */
  filterColumns?: readonly string[];
  /** Columns client-authored sorts may reference. Defaults to `columns`. */
  sortColumns?: readonly string[];
  /**
   * Server-owned realm/policy constraints. Unlike caller-authored `query`
   * filters, equality here is storage-class and BINARY exact so a declared
   * SQLite affinity or collation cannot broaden an authorization predicate.
   */
  constraints?: readonly ResourceDataConstraint[];
  query?: ResourceListQueryInput;
  defaultLimit?: number;
  maxLimit?: number;
}

/** Structured query planning failure. */
export interface ResourceQueryError {
  status: number;
  error: string;
}

/** Executable SQL read plan for a paginated list request. */
export interface ResourceListQueryPlan {
  sql: string;
  params: QueryParam[];
  limit: number;
  offset: number;
}

/** Actor-safe equivalent of the SQL list plan, including one-row lookahead. */
export interface ResourceListFindPlan {
  input: DatabaseFindInput;
  limit: number;
  offset: number;
}

interface FilterClause {
  sql: string;
  params: QueryParam[];
}

const DEFAULT_RESOURCE_LIMIT = 100;
const MAX_RESOURCE_LIMIT = 1000;
const MAX_IN_VALUES = 50;

/** Public query-string limits shared by generated Resource and `/api/data` routes. */
export const RESOURCE_QUERY_LIMITS = Object.freeze({
  identifierLength: DATABASE_OPERATION_MAX_NAME_LENGTH,
  filterCount: DATABASE_FIND_MAX_FILTERS,
  filterExpressionLength: 4_096,
  directionLength: 4,
});

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

/**
 * Build a parameterized SELECT statement for a resource list request.
 *
 * User filters are ANDed with policy constraints. `limit` is increased by one
 * by the caller when it needs has-more detection.
 */
export function buildResourceListQueryPlan(
  options: ResourceListQueryPlanOptions
): ResourceListQueryPlan | ResourceQueryError {
  const queryInput = validateResourceListQueryInput(options.query);
  if (queryInput) return queryInput;
  const allowedColumnSet = new Set(options.columns);
  const select = buildSelectClause(
    options.selectColumns,
    options.table,
    allowedColumnSet,
  );
  if ('error' in select) return select;
  const filterColumns = buildClientColumnSet(
    options.filterColumns,
    options.table,
    allowedColumnSet,
    'filter',
  );
  if ('error' in filterColumns) return filterColumns;
  const sortColumns = buildClientColumnSet(
    options.sortColumns,
    options.table,
    allowedColumnSet,
    'sort',
  );
  if ('error' in sortColumns) return sortColumns;
  const filters = buildFilterClauses(
    options.query?.filter,
    options.table,
    filterColumns.columns,
  );
  if ('error' in filters) return filters;

  const policyFilters = buildConstraintClauses(
    options.constraints ?? [],
    options.table,
    allowedColumnSet
  );
  if ('error' in policyFilters) return policyFilters;

  const order = buildOrderClause(
    options.query?.order,
    options.query?.dir,
    options.table,
    sortColumns.columns
  );
  if ('error' in order) return order;

  const page = parsePagination(
    options.query?.limit,
    options.query?.offset,
    options.defaultLimit ?? DEFAULT_RESOURCE_LIMIT,
    options.maxLimit ?? MAX_RESOURCE_LIMIT
  );
  if ('error' in page) return page;

  const clauses = [...filters.clauses, ...policyFilters.clauses];
  const whereClause = clauses.length > 0
    ? ` WHERE ${clauses.map((clause) => clause.sql).join(' AND ')}`
    : '';
  const params = clauses.flatMap((clause) => clause.params);

  return {
    sql: `SELECT ${select.selectClause} FROM ${quoteResourceIdentifier(options.table)}${whereClause}${order.orderClause} LIMIT ? OFFSET ?`,
    params,
    limit: page.limit,
    offset: page.offset,
  };
}

/**
 * Build the same validated list semantics for an actor-backed tenant file.
 *
 * Unlike the SQL plan, this returns no SQL or bind parameters. Server-owned
 * realm/policy constraints become exact structured predicates, while
 * caller-authored filters retain SQLite's historical comparison semantics.
 * The actor request includes one lookahead row so pagination stays identical
 * to the default-database implementation.
 */
export function buildResourceListFindPlan(
  options: ResourceListQueryPlanOptions,
): ResourceListFindPlan | ResourceQueryError {
  const queryInput = validateResourceListQueryInput(options.query);
  if (queryInput) return queryInput;
  const allowedColumnSet = new Set(options.columns);
  const select = validateFindSelect(
    options.selectColumns,
    options.table,
    allowedColumnSet,
  );
  if ('error' in select) return select;
  const filterColumns = buildClientColumnSet(
    options.filterColumns,
    options.table,
    allowedColumnSet,
    'filter',
  );
  if ('error' in filterColumns) return filterColumns;
  const sortColumns = buildClientColumnSet(
    options.sortColumns,
    options.table,
    allowedColumnSet,
    'sort',
  );
  if ('error' in sortColumns) return sortColumns;

  const filters = buildFindFilters(
    options.query?.filter,
    options.table,
    filterColumns.columns,
  );
  if ('error' in filters) return filters;
  const constraints = buildFindConstraints(
    options.constraints ?? [],
    options.table,
    allowedColumnSet,
  );
  if ('error' in constraints) return constraints;
  const order = buildFindOrder(
    options.query?.order,
    options.query?.dir,
    options.table,
    sortColumns.columns,
  );
  if ('error' in order) return order;
  const page = parsePagination(
    options.query?.limit,
    options.query?.offset,
    options.defaultLimit ?? DEFAULT_RESOURCE_LIMIT,
    options.maxLimit ?? MAX_RESOURCE_LIMIT,
  );
  if ('error' in page) return page;
  if (page.limit + 1 > DATABASE_FIND_MAX_ROWS) {
    return {
      status: 400,
      error: `Limit must not exceed ${DATABASE_FIND_MAX_ROWS - 1} for an isolated database query`,
    };
  }

  const combinedFilters = [...filters.filters, ...constraints.filters];
  return {
    input: {
      ...(select.select === undefined ? {} : { select: select.select }),
      ...(combinedFilters.length === 0 ? {} : { filters: combinedFilters }),
      ...(order.order === undefined ? {} : { order: [order.order] }),
      limit: page.limit + 1,
      offset: page.offset,
    },
    limit: page.limit,
    offset: page.offset,
  };
}

function validateFindSelect(
  columns: readonly string[] | undefined,
  table: string,
  allowedColumnSet: Set<string>,
): { select?: readonly string[] } | ResourceQueryError {
  if (columns === undefined) return {};
  for (const field of columns) {
    const column = validatePolicyColumn(field, table, allowedColumnSet);
    if ('error' in column) return column;
  }
  return { select: [...columns] };
}

function buildFindFilters(
  filterParams: string | string[] | undefined,
  table: string,
  allowedColumnSet: Set<string>,
): { filters: DatabaseFindFilter[] } | ResourceQueryError {
  const filters: DatabaseFindFilter[] = [];
  if (!filterParams) return { filters };

  for (const expression of Array.isArray(filterParams) ? filterParams : [filterParams]) {
    const parsed = parseFilterExpression(expression);
    if ('error' in parsed) return parsed;
    const column = validateUserColumn(
      parsed.field,
      table,
      allowedColumnSet,
      'filter field',
    );
    if ('error' in column) return column;

    if (parsed.operator === 'in') {
      const values = parseInValues(parsed.value);
      if ('error' in values) return values;
      filters.push({
        type: 'field',
        field: parsed.field,
        operator: 'in',
        value: values.values,
      });
    } else {
      filters.push({
        type: 'field',
        field: parsed.field,
        operator: parsed.operator,
        value: parsed.value,
      });
    }
  }
  return { filters };
}

function buildFindConstraints(
  constraints: readonly ResourceDataConstraint[],
  table: string,
  allowedColumnSet: Set<string>,
): { filters: DatabaseFindFilter[] } | ResourceQueryError {
  const filters: DatabaseFindFilter[] = [];
  for (const constraint of constraints) {
    const filter = buildFindConstraint(constraint, table, allowedColumnSet);
    if ('error' in filter) return filter;
    filters.push(filter.filter);
  }
  return { filters };
}

function buildFindConstraint(
  constraint: ResourceDataConstraint,
  table: string,
  allowedColumnSet: Set<string>,
): { filter: DatabaseFindFilter } | ResourceQueryError {
  if (constraint.type === 'field') {
    const column = validatePolicyColumn(constraint.field, table, allowedColumnSet);
    if ('error' in column) return column;
    return {
      filter: {
        type: 'field',
        field: constraint.field,
        operator: 'eq',
        value: constraint.value,
        match: 'exact',
      },
    };
  }
  if (constraint.constraints.length === 0) {
    return { status: 500, error: 'Resource policy returned an empty constraint group' };
  }
  const filters: DatabaseFindFilter[] = [];
  for (const child of constraint.constraints) {
    const filter = buildFindConstraint(child, table, allowedColumnSet);
    if ('error' in filter) return filter;
    filters.push(filter.filter);
  }
  return {
    filter: {
      type: constraint.type,
      filters,
    },
  };
}

function buildFindOrder(
  orderParam: string | undefined,
  dirParam: string | undefined,
  table: string,
  allowedColumnSet: Set<string>,
): { order?: { field: string; direction: 'asc' | 'desc' } } | ResourceQueryError {
  if (!orderParam) return {};
  const column = validateUserColumn(
    orderParam,
    table,
    allowedColumnSet,
    'order column',
  );
  if ('error' in column) return column;
  const direction = (dirParam ?? 'desc').toLowerCase();
  if (direction !== 'asc' && direction !== 'desc') {
    return { status: 400, error: 'Sort direction must be "asc" or "desc"' };
  }
  return { order: { field: orderParam, direction } };
}

function parseInValues(
  value: string,
): { values: string[] } | ResourceQueryError {
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
  return { values };
}

function buildClientColumnSet(
  columns: readonly string[] | undefined,
  table: string,
  allowedColumnSet: Set<string>,
  capability: 'filter' | 'sort',
): { columns: Set<string> } | ResourceQueryError {
  if (columns === undefined) return { columns: allowedColumnSet };
  for (const field of columns) {
    if (isDatabaseTableName(field) && allowedColumnSet.has(field)) continue;
    return {
      status: 500,
      error: `Resource ${capability} field '${field}' is not a column on table '${table}'`,
    };
  }
  return { columns: new Set(columns) };
}

function buildSelectClause(
  columns: readonly string[] | undefined,
  table: string,
  allowedColumnSet: Set<string>,
): { selectClause: string } | ResourceQueryError {
  if (columns === undefined) return { selectClause: '*' };
  if (columns.length === 0) return { selectClause: '1 AS "__zero_empty"' };

  const selected: string[] = [];
  for (const field of columns) {
    const column = validatePolicyColumn(field, table, allowedColumnSet);
    if ('error' in column) return column;
    selected.push(column.identifier);
  }
  return { selectClause: selected.join(', ') };
}

/** Quote a previously validated SQLite identifier. */
export function quoteResourceIdentifier(identifier: string): string {
  return `"${identifier}"`;
}

function buildFilterClauses(
  filterParams: string | string[] | undefined,
  table: string,
  allowedColumnSet: Set<string>
): { clauses: FilterClause[] } | ResourceQueryError {
  const clauses: FilterClause[] = [];
  if (!filterParams) return { clauses };

  const filterList = Array.isArray(filterParams) ? filterParams : [filterParams];

  for (const expression of filterList) {
    const parsed = parseFilterExpression(expression);
    if ('error' in parsed) return parsed;

    const column = validateUserColumn(parsed.field, table, allowedColumnSet, 'filter field');
    if ('error' in column) return column;

    const clause = buildOperatorClause(column.identifier, parsed.operator, parsed.value);
    if ('error' in clause) return clause;
    clauses.push(clause);
  }

  return { clauses };
}

function parseFilterExpression(
  expression: string
): { field: string; operator: FilterOperator; value: string } | ResourceQueryError {
  const colonIdx = expression.indexOf(':');
  if (colonIdx === -1) {
    return { status: 400, error: 'Invalid filter format' };
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
): FilterClause | ResourceQueryError {
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
      const parsed = parseInValues(value);
      if ('error' in parsed) return parsed;
      return {
        sql: `${column} IN (${parsed.values.map(() => '?').join(', ')})`,
        params: parsed.values,
      };
    }
  }
}

function buildConstraintClauses(
  constraints: readonly ResourceDataConstraint[],
  table: string,
  allowedColumnSet: Set<string>
): { clauses: FilterClause[] } | ResourceQueryError {
  const clauses: FilterClause[] = [];

  for (const constraint of constraints) {
    const clause = buildConstraintClause(constraint, table, allowedColumnSet);
    if ('error' in clause) return clause;
    clauses.push(clause);
  }

  return { clauses };
}

function buildConstraintClause(
  constraint: ResourceDataConstraint,
  table: string,
  allowedColumnSet: Set<string>
): FilterClause | ResourceQueryError {
  if (constraint.type === 'field') {
    const column = validatePolicyColumn(constraint.field, table, allowedColumnSet);
    if ('error' in column) return column;
    return buildExactConstraintValueClause(column.identifier, constraint.value);
  }

  if (constraint.constraints.length === 0) {
    return { status: 500, error: 'Resource policy returned an empty constraint group' };
  }

  const childClauses: FilterClause[] = [];
  for (const child of constraint.constraints) {
    const clause = buildConstraintClause(child, table, allowedColumnSet);
    if ('error' in clause) return clause;
    childClauses.push(clause);
  }

  const joiner = constraint.type === 'anyOf' ? ' OR ' : ' AND ';
  return {
    sql: `(${childClauses.map((clause) => clause.sql).join(joiner)})`,
    params: childClauses.flatMap((clause) => clause.params),
  };
}

/**
 * Compile a server-owned equality constraint without allowing SQLite column
 * affinity or a declared collation (for example `COLLATE NOCASE`) to widen
 * the match. The duplicated binding first proves the storage class and then
 * compares the value with BINARY semantics.
 *
 * Sync's in-memory constraint matcher intentionally treats booleans as their
 * canonical SQLite/JSON representations. Preserve that contract with an OR
 * of exact alternatives instead of falling back to coercive SQL equality.
 */
function buildExactConstraintValueClause(
  column: string,
  value: ResourcePolicyScalar,
): FilterClause {
  const values: QueryParam[] = typeof value === 'boolean'
    ? [value ? 1 : 0, value ? '1' : '0', String(value)]
    : [toQueryParam(value)];
  const alternatives = values.map(() =>
    `(typeof(${column}) = typeof(?) AND ${column} COLLATE BINARY IS ?)`);

  return {
    sql: alternatives.length === 1
      ? alternatives[0]!
      : `(${alternatives.join(' OR ')})`,
    params: values.flatMap((candidate) => [candidate, candidate]),
  };
}

function buildOrderClause(
  orderParam: string | undefined,
  dirParam: string | undefined,
  table: string,
  allowedColumnSet: Set<string>
): { orderClause: string } | ResourceQueryError {
  if (!orderParam) return { orderClause: '' };

  const column = validateUserColumn(orderParam, table, allowedColumnSet, 'order column');
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
): { limit: number; offset: number } | ResourceQueryError {
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

function parseInteger(value: number, label: string, min: number): { value: number } | ResourceQueryError {
  if (!Number.isInteger(value) || value < min) {
    const description = min === 0 ? 'a non-negative integer' : 'a positive integer';
    return { status: 400, error: `${label} must be ${description}` };
  }
  return { value };
}

function validateUserColumn(
  column: string,
  table: string,
  allowedColumnSet: Set<string>,
  label: string
): { identifier: string } | ResourceQueryError {
  if (!isDatabaseTableName(column)) {
    return { status: 400, error: `Invalid ${label} name` };
  }
  if (!allowedColumnSet.has(column)) {
    return { status: 400, error: `Unknown column '${column}' for table '${table}'` };
  }
  return { identifier: quoteResourceIdentifier(column) };
}

function validatePolicyColumn(
  column: string,
  table: string,
  allowedColumnSet: Set<string>
): { identifier: string } | ResourceQueryError {
  if (!isDatabaseTableName(column) || !allowedColumnSet.has(column)) {
    return {
      status: 500,
      error: `Resource policy constraint references unknown column '${column}' for table '${table}'`,
    };
  }
  return { identifier: quoteResourceIdentifier(column) };
}

function validateResourceListQueryInput(
  query: ResourceListQueryInput | undefined,
): ResourceQueryError | null {
  if (!query) return null;

  const filters = query.filter === undefined
    ? []
    : Array.isArray(query.filter) ? query.filter : [query.filter];
  if (filters.length > RESOURCE_QUERY_LIMITS.filterCount) {
    return {
      status: 400,
      error: `At most ${RESOURCE_QUERY_LIMITS.filterCount} filters are allowed`,
    };
  }
  if (filters.some((expression) => (
    expression.length > RESOURCE_QUERY_LIMITS.filterExpressionLength
  ))) {
    return {
      status: 400,
      error: `Filter expressions must not exceed ${RESOURCE_QUERY_LIMITS.filterExpressionLength} characters`,
    };
  }
  if (query.order !== undefined
    && query.order.length > RESOURCE_QUERY_LIMITS.identifierLength) {
    return { status: 400, error: 'Invalid order column name' };
  }
  if (query.dir !== undefined
    && query.dir.length > RESOURCE_QUERY_LIMITS.directionLength) {
    return { status: 400, error: 'Sort direction must be "asc" or "desc"' };
  }
  return null;
}

function toQueryParam(value: ResourcePolicyScalar): QueryParam {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
