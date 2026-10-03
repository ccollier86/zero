/** Transactional realm commands for logical row and cell mutations. */

import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import type { Row } from '../sync/types';
import {
  normalizeDataStudioValueForColumn,
  parseDataStudioSchema,
  serializeDataStudioRowValues,
} from './data-studio-codec';
import type {
  DataStudioRowValues,
  DataStudioSchema,
} from './data-studio-contracts';
import {
  assertDataStudioActor,
  dataStudioMutationTimestamp,
} from './data-studio-actor';
import { updateDataStudioColumnStats } from './data-studio-column-stats';
import { DataStudioError } from './data-studio-error';
import {
  peekDataStudioTableId,
  readDataStudioRowCreateInput,
  readDataStudioRowDeleteInput,
  readDataStudioRowReplaceInput,
} from './data-studio-input';
import {
  DATA_STUDIO_MAX_ROWS_PER_TABLE,
  type DataStudioRowDeleteOperationResult,
  type DataStudioRowResult,
} from './data-studio-operation-contracts';
import {
  dataStudioExpectedFailure,
  dataStudioRevisionConflict,
  dataStudioSuccess,
} from './data-studio-operation-result';
import {
  dataStudioCellRows,
  dataStudioRowFromRow,
  dataStudioTableFromRow,
  storedString,
} from './data-studio-records';
import {
  DATA_STUDIO_CELLS_TABLE_NAME,
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
} from './data-studio-tenant-schema';

export function createDataStudioRowCommand(
  { db }: DatabaseWriteCommandContext,
  value: DatabaseSerializableValue,
): DataStudioRowResult {
  try {
    const tableRow = requireTableRow(db, peekDataStudioTableId(value));
    const table = dataStudioTableFromRow(tableRow);
    requireActive(table.status);
    const input = readDataStudioRowCreateInput(value, table.schema);
    assertDataStudioActor(db, input);
    const now = dataStudioMutationTimestamp();
    if (table.rowCount >= DATA_STUDIO_MAX_ROWS_PER_TABLE) {
      throw new DataStudioError(
        'DATA_STUDIO_LIMIT_EXCEEDED',
        'Data Studio row limit was reached.',
      );
    }
    const identity = { table_id: table.tableId, row_id: input.rowId };
    if (db.queryByIdentity(DATA_STUDIO_ROWS_TABLE_NAME, identity)) {
      throw new DataStudioError(
        'DATA_STUDIO_IDEMPOTENCY_CONFLICT',
        'Data Studio row identity already exists.',
      );
    }
    const valuesJson = serializeDataStudioRowValues(table.schema, input.values);
    const recordId = db.identityKey(DATA_STUDIO_ROWS_TABLE_NAME, identity);
    const cellRows = dataStudioCellRows({
      rowRecordId: recordId,
      schema: table.schema,
      values: input.values,
      userId: input.userId,
      membershipId: input.membershipId,
      now,
    });
    db.createStrict(DATA_STUDIO_ROWS_TABLE_NAME, {
      record_id: recordId,
      ...identity,
      schema_revision: table.schemaRevision,
      values_json: valuesJson,
      revision: 1,
      created_by_user_id: input.userId,
      created_by_membership_id: input.membershipId,
      updated_by_user_id: input.userId,
      updated_by_membership_id: input.membershipId,
      created_at: now,
      updated_at: now,
    });
    createCellRows(db, cellRows);
    updateDataStudioColumnStats(db, {
      tableId: table.tableId,
      previous: Object.freeze({}),
      next: input.values,
      now,
    });
    updateTableRowCount(db, tableRow, table.rowCount + 1);
    const stored = db.get(DATA_STUDIO_ROWS_TABLE_NAME, recordId);
    if (!stored) throw corrupt();
    return dataStudioSuccess(dataStudioRowFromRow(stored, table.schema));
  } catch (error) {
    const failure = dataStudioExpectedFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export function replaceDataStudioRowCommand(
  { db }: DatabaseWriteCommandContext,
  value: DatabaseSerializableValue,
): DataStudioRowResult {
  try {
    const tableRow = requireTableRow(db, peekDataStudioTableId(value));
    const table = dataStudioTableFromRow(tableRow);
    requireActive(table.status);
    const input = readDataStudioRowReplaceInput(value, table.schema);
    assertDataStudioActor(db, input);
    const identity = { table_id: table.tableId, row_id: input.rowId };
    const currentRow = db.queryByIdentity(DATA_STUDIO_ROWS_TABLE_NAME, identity);
    if (!currentRow) throw rowNotFound();
    const current = dataStudioRowFromRow(currentRow, table.schema);
    const now = dataStudioMutationTimestamp(current.updatedAt);
    if (current.revision !== input.expectedRevision) {
      throw dataStudioRevisionConflict(current.revision);
    }
    const previous = parseStoredRawValues(currentRow, table.schema);
    const valuesJson = serializeDataStudioRowValues(table.schema, input.values);
    const cellRows = dataStudioCellRows({
      rowRecordId: storedString(currentRow, 'record_id'),
      schema: table.schema,
      values: input.values,
      userId: input.userId,
      membershipId: input.membershipId,
      now,
    });
    const changed = db.updateIfCurrent(
      DATA_STUDIO_ROWS_TABLE_NAME,
      storedString(currentRow, 'record_id'),
      {
        schema_revision: table.schemaRevision,
        values_json: valuesJson,
        revision: current.revision + 1,
        updated_by_user_id: input.userId,
        updated_by_membership_id: input.membershipId,
        updated_at: now,
      },
      currentRow,
    );
    if (!changed) throw dataStudioRevisionConflict(current.revision);
    replaceCellRows(db, storedString(currentRow, 'record_id'), previous, cellRows);
    updateDataStudioColumnStats(db, {
      tableId: table.tableId,
      previous,
      next: input.values,
      now,
    });
    const stored = db.queryByIdentity(DATA_STUDIO_ROWS_TABLE_NAME, identity);
    if (!stored) throw corrupt();
    return dataStudioSuccess(dataStudioRowFromRow(stored, table.schema));
  } catch (error) {
    const failure = dataStudioExpectedFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export function deleteDataStudioRowCommand(
  { db }: DatabaseWriteCommandContext,
  value: DatabaseSerializableValue,
): DataStudioRowDeleteOperationResult {
  try {
    const tableRow = requireTableRow(db, peekDataStudioTableId(value));
    const table = dataStudioTableFromRow(tableRow);
    requireActive(table.status);
    const input = readDataStudioRowDeleteInput(value);
    assertDataStudioActor(db, input);
    const identity = { table_id: table.tableId, row_id: input.rowId };
    const currentRow = db.queryByIdentity(DATA_STUDIO_ROWS_TABLE_NAME, identity);
    if (!currentRow) throw rowNotFound();
    const current = dataStudioRowFromRow(currentRow, table.schema);
    const now = dataStudioMutationTimestamp(current.updatedAt);
    if (current.revision !== input.expectedRevision) {
      throw dataStudioRevisionConflict(current.revision);
    }
    const previous = parseStoredRawValues(currentRow, table.schema);
    deleteCellRows(db, storedString(currentRow, 'record_id'), previous);
    updateDataStudioColumnStats(db, {
      tableId: table.tableId,
      previous,
      next: Object.freeze({}),
      now,
    });
    const removed = db.deleteIfCurrent(
      DATA_STUDIO_ROWS_TABLE_NAME,
      storedString(currentRow, 'record_id'),
      currentRow,
    );
    // Cell/stat changes already occurred inside this transaction; a writer-lane
    // invariant failure must escape so the outer transaction rolls everything back.
    if (!removed) throw corrupt();
    if (table.rowCount < 1) throw corrupt();
    updateTableRowCount(db, tableRow, table.rowCount - 1);
    return dataStudioSuccess(Object.freeze({ deleted: true, rowId: input.rowId }));
  } catch (error) {
    const failure = dataStudioExpectedFailure(error);
    if (failure) return failure;
    throw error;
  }
}

function replaceCellRows(
  db: DatabaseWriteCommandContext['db'],
  rowRecordId: string,
  previous: DataStudioRowValues,
  nextRows: readonly Row[],
): void {
  deleteCellRows(db, rowRecordId, previous);
  createCellRows(db, nextRows);
}

function deleteCellRows(
  db: DatabaseWriteCommandContext['db'],
  rowRecordId: string,
  previous: DataStudioRowValues,
): void {
  for (const columnId of Object.keys(previous)) {
    db.deleteByIdentity(DATA_STUDIO_CELLS_TABLE_NAME, {
      row_record_id: rowRecordId,
      column_id: columnId,
    });
  }
}

function createCellRows(
  db: DatabaseWriteCommandContext['db'],
  rows: readonly Row[],
): void {
  for (const row of rows) {
    const identity = {
      row_record_id: storedString(row, 'row_record_id'),
      column_id: storedString(row, 'column_id'),
    };
    db.createStrict(DATA_STUDIO_CELLS_TABLE_NAME, {
      cell_id: db.identityKey(DATA_STUDIO_CELLS_TABLE_NAME, identity),
      ...row,
    });
  }
}

function parseStoredRawValues(
  row: Row,
  schema: DataStudioSchema,
): DataStudioRowValues {
  let decoded: unknown;
  try {
    decoded = JSON.parse(storedString(row, 'values_json'));
  } catch (cause) {
    throw new DataStudioError(
      'DATA_STUDIO_INTERNAL_ERROR',
      'Stored Data Studio row values are malformed.',
      { cause },
    );
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw corrupt();
  const source = decoded as Record<string, unknown>;
  const columns = new Map(schema.columns.map((column) => [column.columnId, column]));
  const result: Record<string, ReturnType<typeof normalizeDataStudioValueForColumn>> =
    Object.create(null);
  for (const [columnId, candidate] of Object.entries(source)) {
    const column = columns.get(columnId);
    if (!column) throw corrupt();
    result[columnId] = normalizeDataStudioValueForColumn(column, candidate);
  }
  return Object.freeze(result);
}

function updateTableRowCount(
  db: DatabaseWriteCommandContext['db'],
  tableRow: Row,
  rowCount: number,
): void {
  const updated = db.updateIfCurrent(
    DATA_STUDIO_TABLES_TABLE_NAME,
    storedString(tableRow, 'table_id'),
    { row_count: rowCount },
    tableRow,
  );
  if (!updated) throw corrupt();
}

function requireTableRow(
  db: DatabaseWriteCommandContext['db'],
  tableId: string,
): Row {
  const row = db.get(DATA_STUDIO_TABLES_TABLE_NAME, tableId);
  if (!row) {
    throw new DataStudioError(
      'DATA_STUDIO_TABLE_NOT_FOUND',
      'Data Studio table was not found.',
    );
  }
  return row;
}

function requireActive(status: 'active' | 'archived'): void {
  if (status === 'archived') {
    throw new DataStudioError(
      'DATA_STUDIO_TABLE_ARCHIVED',
      'Data Studio table is archived.',
    );
  }
}

function rowNotFound(): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_ROW_NOT_FOUND',
    'Data Studio row was not found.',
  );
}

function corrupt(): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_INTERNAL_ERROR',
    'Data Studio row state is inconsistent.',
  );
}
