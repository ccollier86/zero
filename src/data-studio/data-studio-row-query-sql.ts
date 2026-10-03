/** Closed SQL compiler for bounded logical-row filtering and sorting. */

import type {
  DataStudioColumn,
  DataStudioSchema,
} from './data-studio-contracts';
import { DataStudioError } from './data-studio-error';
import type {
  DataStudioRowFilter,
  DataStudioRowListInput,
} from './data-studio-operation-contracts';
import { DATA_STUDIO_CELLS_TABLE_NAME } from './data-studio-tenant-schema';

type QueryParameter = string | number | boolean | null;

export interface DataStudioRowQuerySql {
  readonly whereSql: string;
  readonly parameters: readonly QueryParameter[];
  readonly orderBySql: string;
  readonly orderByParameters: readonly QueryParameter[];
}

export function buildDataStudioRowQuerySql(
  schema: DataStudioSchema,
  input: DataStudioRowListInput,
): DataStudioRowQuerySql {
  const columns = new Map(schema.columns.map((column) => [column.columnId, column]));
  const predicates = ['r.table_id = ?'];
  const parameters: QueryParameter[] = [input.tableId];
  if (input.search) {
    predicates.push(
      `exists (select 1 from ${DATA_STUDIO_CELLS_TABLE_NAME} search_cell `
      + 'where search_cell.row_record_id = r.record_id '
      + "and search_cell.text_value like ? escape '\\')",
    );
    parameters.push(`%${escapeLike(input.search)}%`);
  }
  for (const [index, filter] of (input.filters ?? []).entries()) {
    const column = columns.get(filter.columnId);
    if (!column) throw invalid('Data Studio filter column is unknown.');
    const compiled = compileFilter(column, filter, `filter_cell_${index}`);
    predicates.push(compiled.sql);
    parameters.push(...compiled.parameters);
  }
  const sort = input.sortColumnId
    ? compileSort(
      columns.get(input.sortColumnId),
      input.sortColumnId,
      input.sortDirection ?? 'asc',
    )
    : Object.freeze({
      sql: 'r.created_at desc, r.record_id asc',
      parameters: Object.freeze([] as QueryParameter[]),
    });
  return Object.freeze({
    whereSql: predicates.join(' and '),
    parameters: Object.freeze(parameters),
    orderBySql: sort.sql,
    orderByParameters: sort.parameters,
  });
}

function compileFilter(
  column: DataStudioColumn,
  filter: DataStudioRowFilter,
  alias: string,
): { readonly sql: string; readonly parameters: readonly QueryParameter[] } {
  const prefix = `exists (select 1 from ${DATA_STUDIO_CELLS_TABLE_NAME} ${alias} `
    + `where ${alias}.row_record_id = r.record_id `
    + `and ${alias}.column_id = ? and `;
  if (filter.value === null) {
    if (filter.operator !== 'eq' && filter.operator !== 'ne') {
      throw invalid('Null Data Studio filters support only equality.');
    }
    return Object.freeze({
      sql: `${prefix}${alias}.value_type ${filter.operator === 'eq' ? '=' : '<>'} 'null')`,
      parameters: Object.freeze([filter.columnId]),
    });
  }

  const projection = projectionFor(column, filter.value);
  if (filter.operator === 'contains') {
    if (column.type !== 'text' || typeof filter.value !== 'string') {
      throw invalid('Contains is valid only for text Data Studio columns.');
    }
    return Object.freeze({
      sql: `${prefix}${alias}.${projection.field} like ? escape '\\')`,
      parameters: Object.freeze([
        filter.columnId,
        `%${escapeLike(filter.value)}%`,
      ]),
    });
  }
  if ((column.type === 'boolean' || column.type === 'json')
    && filter.operator !== 'eq'
    && filter.operator !== 'ne') {
    throw invalid('This Data Studio column supports equality filters only.');
  }
  const operator = sqlOperator(filter.operator);
  return Object.freeze({
    sql: `${prefix}${alias}.${projection.field} ${operator} ?)`,
    parameters: Object.freeze([filter.columnId, projection.value]),
  });
}

function compileSort(
  column: DataStudioColumn | undefined,
  columnId: string,
  direction: 'asc' | 'desc',
): { readonly sql: string; readonly parameters: readonly QueryParameter[] } {
  if (!column) throw invalid('Data Studio sort column is unknown.');
  const field = column.type === 'number'
    ? 'number_value'
    : column.type === 'boolean'
      ? 'boolean_value'
      : column.type === 'json'
        ? 'value_json'
        : 'text_value';
  return Object.freeze({
    sql: `(select sort_cell.${field} from ${DATA_STUDIO_CELLS_TABLE_NAME} sort_cell `
    + 'where sort_cell.row_record_id = r.record_id '
    + `and sort_cell.column_id = ?) ${direction}, r.record_id asc`,
    parameters: Object.freeze([columnId]),
  });
}

function projectionFor(
  column: DataStudioColumn,
  value: string | number | boolean,
): { readonly field: string; readonly value: QueryParameter } {
  switch (column.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw typeMismatch();
      return { field: 'number_value', value };
    case 'boolean':
      if (typeof value !== 'boolean') throw typeMismatch();
      return { field: 'boolean_value', value: value ? 1 : 0 };
    case 'text':
    case 'date':
    case 'datetime':
      if (typeof value !== 'string') throw typeMismatch();
      return { field: 'text_value', value };
    case 'json':
      return { field: 'value_json', value: JSON.stringify(value) };
  }
}

function sqlOperator(operator: DataStudioRowFilter['operator']): string {
  switch (operator) {
    case 'eq': return '=';
    case 'ne': return '<>';
    case 'gt': return '>';
    case 'gte': return '>=';
    case 'lt': return '<';
    case 'lte': return '<=';
    case 'contains': throw invalid('Contains requires a text projection.');
  }
}

function escapeLike(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/%/gu, '\\%').replace(/_/gu, '\\_');
}

function typeMismatch(): DataStudioError {
  return invalid('Data Studio filter value does not match its column type.');
}

function invalid(message: string): DataStudioError {
  return new DataStudioError('DATA_STUDIO_VALUE_INVALID', message);
}
