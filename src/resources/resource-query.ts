/**
 * resource-query.ts
 *
 * Builds safe SQL read plans for generated resource list routes. This file
 * owns query-string and policy-constraint translation only; it does not
 * evaluate policies, mutate ReactiveDB, or mount HTTP routes.
 */

import type { ResourceDataConstraint, ResourcePolicyScalar } from './resource-policy-types';

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
  columns: readonly string[];
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

interface FilterClause {
  sql: string;
  params: QueryParam[];
}

const DEFAULT_RESOURCE_LIMIT = 100;
const MAX_RESOURCE_LIMIT = 1000;
const MAX_IN_VALUES = 50;
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
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
  const allowedColumnSet = new Set(options.columns);
  const filters = buildFilterClauses(options.query?.filter, options.table, allowedColumnSet);
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
    allowedColumnSet
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
    sql: `SELECT * FROM ${quoteResourceIdentifier(options.table)}${whereClause}${order.orderClause} LIMIT ? OFFSET ?`,
    params,
    limit: page.limit,
    offset: page.offset,
  };
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

    return {
      sql: `${column.identifier} = ?`,
      params: [toQueryParam(constraint.value)],
    };
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
  if (!SAFE_IDENTIFIER.test(column)) {
    return { status: 400, error: `Invalid ${label} name: ${column}` };
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
  if (!SAFE_IDENTIFIER.test(column) || !allowedColumnSet.has(column)) {
    return {
      status: 500,
      error: `Resource policy constraint references unknown column '${column}' for table '${table}'`,
    };
  }
  return { identifier: quoteResourceIdentifier(column) };
}

function toQueryParam(value: ResourcePolicyScalar): QueryParam {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
