/** Named read-query registry for Data Studio tenant actors. */

import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import type { Row } from '../sync/types';
import { DataStudioError } from './data-studio-error';
import {
  peekDataStudioTableId,
  readDataStudioRowGetInput,
  readDataStudioRowListInput,
  readDataStudioSchemaVersionListInput,
  readDataStudioTableGetInput,
  readDataStudioTableListInput,
} from './data-studio-input';
import {
  DATA_STUDIO_QUERY_NAMES,
  DATA_STUDIO_RESULT_BYTE_BUDGET,
  type DataStudioOperationResult,
  type DataStudioRowPage,
  type DataStudioRowPageResult,
  type DataStudioRowResult,
  type DataStudioSchemaVersionListResult,
  type DataStudioTableListResult,
  type DataStudioTableResult,
} from './data-studio-operation-contracts';
import {
  dataStudioExpectedFailure,
  dataStudioSuccess,
} from './data-studio-operation-result';
import {
  dataStudioRowFromRow,
  dataStudioSchemaVersionFromRow,
  dataStudioTableFromRow,
  dataStudioTableSummaryFromRow,
} from './data-studio-records';
import { buildDataStudioRowQuerySql } from './data-studio-row-query-sql';
import {
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
} from './data-studio-tenant-schema';

export const DATA_STUDIO_REALM_QUERIES = Object.freeze({
  [DATA_STUDIO_QUERY_NAMES.listTables]: listDataStudioTablesQuery,
  [DATA_STUDIO_QUERY_NAMES.getTable]: getDataStudioTableQuery,
  [DATA_STUDIO_QUERY_NAMES.listRows]: listDataStudioRowsQuery,
  [DATA_STUDIO_QUERY_NAMES.getRow]: getDataStudioRowQuery,
  [DATA_STUDIO_QUERY_NAMES.listSchemaVersions]: listDataStudioSchemaVersionsQuery,
});

function listDataStudioTablesQuery(
  { database }: DatabaseReadQueryContext,
  value: DatabaseSerializableValue,
): DataStudioTableListResult {
  return readResult(() => {
    const input = readDataStudioTableListInput(value);
    const rows = input.status === 'all'
      ? database.query<Row>(
        `select * from ${DATA_STUDIO_TABLES_TABLE_NAME} order by name collate nocase, table_id`,
      ).all()
      : database.query<Row>(
        `select * from ${DATA_STUDIO_TABLES_TABLE_NAME} where status = ? `
        + 'order by name collate nocase, table_id',
      ).all(input.status);
    return Object.freeze(rows.map(dataStudioTableSummaryFromRow));
  });
}

function getDataStudioTableQuery(
  { database }: DatabaseReadQueryContext,
  value: DatabaseSerializableValue,
): DataStudioTableResult {
  return readResult(() => {
    const input = readDataStudioTableGetInput(value);
    const row = input.tableId
      ? database.query<Row>(
        `select * from ${DATA_STUDIO_TABLES_TABLE_NAME} where table_id = ?`,
      ).get(input.tableId)
      : database.query<Row>(
        `select * from ${DATA_STUDIO_TABLES_TABLE_NAME} where key = ? collate nocase`,
      ).get(input.key!);
    if (!row) throw tableNotFound();
    return dataStudioTableFromRow(row);
  });
}

function listDataStudioRowsQuery(
  { database }: DatabaseReadQueryContext,
  value: DatabaseSerializableValue,
): DataStudioRowPageResult {
  return readResult(() => {
    const table = requireTable(database, peekDataStudioTableId(value));
    const input = readDataStudioRowListInput(value, table.schema.columns);
    const compiled = buildDataStudioRowQuerySql(table.schema, input);
    const countRow = database.query<{ count: number }>(
      `select count(*) as count from ${DATA_STUDIO_ROWS_TABLE_NAME} r `
      + `where ${compiled.whereSql}`,
    ).get(...(compiled.parameters as any[]));
    const total = countRow?.count;
    if (!Number.isSafeInteger(total) || (total as number) < 0) throw corrupt();
    const parameters = [
      ...compiled.parameters,
      ...compiled.orderByParameters,
      input.limit,
      input.offset,
    ];
    const rows = database.query<Row>(
      `select r.* from ${DATA_STUDIO_ROWS_TABLE_NAME} r `
      + `where ${compiled.whereSql} order by ${compiled.orderBySql} limit ? offset ?`,
    ).all(...(parameters as any[]));
    const projectedRows = rows.map((row) => dataStudioRowFromRow(row, table.schema));
    const boundedRows = fitRowsToResultBudget(projectedRows);
    const nextOffset = input.offset + boundedRows.length < (total as number)
      ? input.offset + boundedRows.length
      : null;
    const page: DataStudioRowPage = Object.freeze({
      rows: Object.freeze(boundedRows),
      total: total as number,
      limit: input.limit,
      offset: input.offset,
      nextOffset,
    });
    return page;
  });
}

function fitRowsToResultBudget<T>(rows: readonly T[]): T[] {
  const selected: T[] = [];
  let bytes = 256;
  for (const row of rows) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
    if (bytes + rowBytes > DATA_STUDIO_RESULT_BYTE_BUDGET) {
      if (selected.length === 0) {
        throw new DataStudioError(
          'DATA_STUDIO_LIMIT_EXCEEDED',
          'Data Studio row cannot fit the result budget.',
        );
      }
      break;
    }
    selected.push(row);
    bytes += rowBytes;
  }
  return selected;
}

function getDataStudioRowQuery(
  { database }: DatabaseReadQueryContext,
  value: DatabaseSerializableValue,
): DataStudioRowResult {
  return readResult(() => {
    const table = requireTable(database, peekDataStudioTableId(value));
    const input = readDataStudioRowGetInput(value);
    const row = database.query<Row>(
      `select * from ${DATA_STUDIO_ROWS_TABLE_NAME} where table_id = ? and row_id = ?`,
    ).get(input.tableId, input.rowId);
    if (!row) {
      throw new DataStudioError(
        'DATA_STUDIO_ROW_NOT_FOUND',
        'Data Studio row was not found.',
      );
    }
    return dataStudioRowFromRow(row, table.schema);
  });
}

function listDataStudioSchemaVersionsQuery(
  { database }: DatabaseReadQueryContext,
  value: DatabaseSerializableValue,
): DataStudioSchemaVersionListResult {
  return readResult(() => {
    const input = readDataStudioSchemaVersionListInput(value);
    requireTable(database, input.tableId);
    const rows = input.beforeRevision === undefined
      ? database.query<Row>(
        `select * from ${DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME} `
        + 'where table_id = ? order by schema_revision desc limit ?',
      ).all(input.tableId, input.limit)
      : database.query<Row>(
        `select * from ${DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME} `
        + 'where table_id = ? and schema_revision < ? '
        + 'order by schema_revision desc limit ?',
      ).all(input.tableId, input.beforeRevision, input.limit);
    return Object.freeze(rows.map(dataStudioSchemaVersionFromRow));
  });
}

function requireTable(
  database: DatabaseReadQueryContext['database'],
  tableId: string,
) {
  const row = database.query<Row>(
    `select * from ${DATA_STUDIO_TABLES_TABLE_NAME} where table_id = ?`,
  ).get(tableId);
  if (!row) throw tableNotFound();
  return dataStudioTableFromRow(row);
}

function readResult<T>(operation: () => T): DataStudioOperationResult<T> {
  try {
    return dataStudioSuccess(operation());
  } catch (error) {
    const failure = dataStudioExpectedFailure(error);
    if (failure) return failure;
    throw error;
  }
}

function tableNotFound(): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_TABLE_NOT_FOUND',
    'Data Studio table was not found.',
  );
}

function corrupt(): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_INTERNAL_ERROR',
    'Data Studio query state is inconsistent.',
  );
}
