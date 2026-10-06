/**
 * database-find.ts
 *
 * Shared actor-local compiler for the public structured find operation. The
 * input has already crossed validateDatabaseOperation(), so every identifier
 * belongs to the immutable realm catalog and every value is detached plain
 * data. This module still quotes all identifiers and binds every value.
 */

import type { Statement } from 'bun:sqlite';

import { quoteSqlIdentifier } from '../sync/identity';
import { buildStringArrayOverlapSql } from '../lib/string-array-overlap-sql';
import { DatabaseError } from './database-error';
import type {
  DatabaseFindFieldFilter,
  DatabaseFindArrayOverlapFilter,
  DatabaseFindFilter,
  DatabaseFindOperation,
  DatabaseFindRows,
  DatabaseOperationCatalog,
  DatabaseSerializableScalar,
} from './database-operations';

type DatabaseFindBinding = string | number | null;

interface DatabaseFindConnection {
  prepare(sql: string): Statement;
}

export interface DatabaseFindClause {
  readonly sql: string;
  readonly params: readonly DatabaseFindBinding[];
}

type DatabaseFindPlan = DatabaseFindClause;

/** Execute one validated find against an actor-owned SQLite connection. */
export function runDatabaseFind(
  database: DatabaseFindConnection,
  operation: DatabaseFindOperation,
  catalog: DatabaseOperationCatalog,
): DatabaseFindRows {
  const plan = buildDatabaseFindPlan(operation, catalog);
  const statement = database.prepare(plan.sql);
  try {
    return statement.all(...plan.params) as DatabaseFindRows;
  } finally {
    statement.finalize();
  }
}

/** Build a parameterized plan. Kept internal to the actor implementation. */
function buildDatabaseFindPlan(
  operation: DatabaseFindOperation,
  catalog: DatabaseOperationCatalog,
): DatabaseFindPlan {
  const columns = catalog.columns?.[operation.table];
  const primaryKey = catalog.primaryKeys?.[operation.table];
  if (!columns || columns.length === 0 || !primaryKey
    || !columns.includes(primaryKey)) {
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Database find catalog is incomplete.',
    );
  }

  const selectedFields = operation.select ?? columns;
  const selectSql = selectedFields
    .map((field) => quoteSqlIdentifier(field))
    .join(', ');
  const filters = operation.filters?.map(compileDatabaseFindFilter) ?? [];
  const whereSql = filters.length === 0
    ? ''
    : ` WHERE ${filters.map((filter) => filter.sql).join(' AND ')}`;
  const params = filters.flatMap((filter) => filter.params);

  const submittedOrder = operation.order ?? [];
  const order = submittedOrder.some((entry) => entry.field === primaryKey)
    ? submittedOrder
    : [...submittedOrder, { field: primaryKey, direction: 'asc' as const }];
  const orderSql = order.map((entry) =>
    `${quoteSqlIdentifier(entry.field)} ${entry.direction.toUpperCase()}`)
    .join(', ');

  return Object.freeze({
    sql: `SELECT ${selectSql} FROM main.${quoteSqlIdentifier(operation.table)}`
      + `${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    params: Object.freeze([
      ...params,
      operation.limit,
      operation.offset ?? 0,
    ]),
  });
}

/** @internal Shared, validated predicate compiler for find and keyset list. */
export function compileDatabaseFindFilter(filter: DatabaseFindFilter): DatabaseFindClause {
  if (filter.type !== 'field') {
    const children = filter.filters.map(compileDatabaseFindFilter);
    return {
      sql: `(${children.map((child) => child.sql).join(
        filter.type === 'allOf' ? ' AND ' : ' OR ',
      )})`,
      params: children.flatMap((child) => child.params),
    };
  }
  return compileFieldFilter(filter);
}

function compileFieldFilter(
  filter: DatabaseFindFieldFilter | DatabaseFindArrayOverlapFilter,
): DatabaseFindClause {
  const field = quoteSqlIdentifier(filter.field);
  if (filter.operator === 'arrayOverlaps') {
    const params: DatabaseFindBinding[] = [];
    return { sql: buildStringArrayOverlapSql(field, filter.value, params), params };
  }
  if (filter.match === 'exact') {
    return compileExactFilter(field, filter.operator, filter.value);
  }
  if (filter.operator === 'in') {
    return compileInFilter(
      field,
      filter.value as readonly DatabaseSerializableScalar[],
    );
  }
  const value = filter.value as DatabaseSerializableScalar;
  if (value === null && (filter.operator === 'eq' || filter.operator === 'ne')) {
    return {
      sql: `${field} IS ${filter.operator === 'ne' ? 'NOT ' : ''}NULL`,
      params: [],
    };
  }

  switch (filter.operator) {
    case 'eq':
      return boundClause(`${field} = ?`, value);
    case 'ne':
      return boundClause(`${field} != ?`, value);
    case 'gt':
      return boundClause(`${field} > ?`, value);
    case 'gte':
      return boundClause(`${field} >= ?`, value);
    case 'lt':
      return boundClause(`${field} < ?`, value);
    case 'lte':
      return boundClause(`${field} <= ?`, value);
    case 'like':
      return boundClause(`${field} LIKE ?`, value);
    case 'contains':
      return boundClause(
        `${field} LIKE ? ESCAPE '\\'`,
        `%${escapeLikeValue(value as string)}%`,
      );
  }
}

function compileExactFilter(
  field: string,
  operator: DatabaseFindFieldFilter['operator'],
  rawValue: DatabaseFindFieldFilter['value'],
): DatabaseFindClause {
  const value = rawValue as DatabaseSerializableScalar;
  if (value === null) {
    return {
      sql: `${field} IS ${operator === 'ne' ? 'NOT ' : ''}NULL`,
      params: [],
    };
  }
  const candidates: readonly DatabaseFindBinding[] = typeof value === 'boolean'
    ? [value ? 1 : 0, value ? '1' : '0', String(value)]
    : [toBinding(value)];
  const equality = candidates.map(() =>
    `(typeof(${field}) = typeof(?) AND ${field} COLLATE BINARY IS ?)`)
    .join(' OR ');
  const sql = candidates.length === 1 ? equality : `(${equality})`;
  return {
    sql: operator === 'ne' ? `NOT (${sql})` : sql,
    params: candidates.flatMap((candidate) => [candidate, candidate]),
  };
}

function compileInFilter(
  field: string,
  values: readonly DatabaseSerializableScalar[],
): DatabaseFindClause {
  const includesNull = values.includes(null);
  const nonNull = values
    .filter((value): value is Exclude<DatabaseSerializableScalar, null> => value !== null)
    .map(toBinding);
  const alternatives: string[] = [];
  if (nonNull.length > 0) {
    alternatives.push(`${field} IN (${nonNull.map(() => '?').join(', ')})`);
  }
  if (includesNull) alternatives.push(`${field} IS NULL`);
  return {
    sql: alternatives.length === 1
      ? alternatives[0]!
      : `(${alternatives.join(' OR ')})`,
    params: nonNull,
  };
}

function boundClause(
  sql: string,
  value: DatabaseSerializableScalar,
): DatabaseFindClause {
  return { sql, params: [toBinding(value)] };
}

function toBinding(value: DatabaseSerializableScalar): DatabaseFindBinding {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}
