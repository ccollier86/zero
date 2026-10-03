/** Transactional realm commands for logical table metadata and schemas. */

import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { serializeDataStudioSchema } from './data-studio-codec';
import type { DataStudioSchema } from './data-studio-contracts';
import {
  assertDataStudioActor,
  dataStudioMutationTimestamp,
} from './data-studio-actor';
import {
  getDataStudioColumnStats,
  reserveDataStudioColumnId,
} from './data-studio-column-stats';
import { DataStudioError } from './data-studio-error';
import {
  readDataStudioTableCreateInput,
  readDataStudioTableStatusInput,
  readDataStudioTableUpdateInput,
} from './data-studio-input';
import {
  DATA_STUDIO_MAX_TABLES,
  DATA_STUDIO_MAX_SCHEMA_VERSIONS,
  type DataStudioTableResult,
} from './data-studio-operation-contracts';
import {
  dataStudioExpectedFailure,
  dataStudioRevisionConflict,
  dataStudioSuccess,
} from './data-studio-operation-result';
import { dataStudioTableFromRow } from './data-studio-records';
import {
  DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
} from './data-studio-tenant-schema';

export function createDataStudioTableCommand(
  { db }: DatabaseWriteCommandContext,
  value: DatabaseSerializableValue,
): DataStudioTableResult {
  try {
    const input = readDataStudioTableCreateInput(value);
    assertDataStudioActor(db, input);
    const now = dataStudioMutationTimestamp();
    const tables = db.query(DATA_STUDIO_TABLES_TABLE_NAME);
    if (tables.length >= DATA_STUDIO_MAX_TABLES) {
      throw new DataStudioError(
        'DATA_STUDIO_LIMIT_EXCEEDED',
        'Data Studio table limit was reached.',
      );
    }
    if (tables.some((row) => row.key === input.key)) {
      throw new DataStudioError(
        'DATA_STUDIO_TABLE_KEY_CONFLICT',
        'Data Studio table key is already in use.',
      );
    }
    if (db.get(DATA_STUDIO_TABLES_TABLE_NAME, input.tableId)) {
      throw new DataStudioError(
        'DATA_STUDIO_TABLE_KEY_CONFLICT',
        'Data Studio table identity already exists.',
      );
    }
    const schemaJson = serializeDataStudioSchema(input.schema);
    db.createStrict(DATA_STUDIO_TABLES_TABLE_NAME, {
      table_id: input.tableId,
      key: input.key,
      name: input.name,
      description: input.description,
      status: 'active',
      schema_json: schemaJson,
      schema_revision: 1,
      revision: 1,
      row_count: 0,
      created_by_user_id: input.userId,
      created_by_membership_id: input.membershipId,
      updated_by_user_id: input.userId,
      updated_by_membership_id: input.membershipId,
      created_at: now,
      updated_at: now,
      archived_at: null,
    });
    appendSchemaVersion(db, {
      tableId: input.tableId,
      schemaRevision: 1,
      schemaJson,
      userId: input.userId,
      membershipId: input.membershipId,
      now,
    });
    for (const column of input.schema.columns) {
      reserveDataStudioColumnId(db, input.tableId, column.columnId, now);
    }
    const stored = db.get(DATA_STUDIO_TABLES_TABLE_NAME, input.tableId);
    if (!stored) throw corrupt();
    return dataStudioSuccess(dataStudioTableFromRow(stored));
  } catch (error) {
    const failure = dataStudioExpectedFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export function updateDataStudioTableCommand(
  { db }: DatabaseWriteCommandContext,
  value: DatabaseSerializableValue,
): DataStudioTableResult {
  try {
    const input = readDataStudioTableUpdateInput(value);
    assertDataStudioActor(db, input);
    const currentRow = db.get(DATA_STUDIO_TABLES_TABLE_NAME, input.tableId);
    if (!currentRow) throw tableNotFound();
    const current = dataStudioTableFromRow(currentRow);
    const now = dataStudioMutationTimestamp(current.updatedAt);
    if (current.revision !== input.expectedRevision) {
      throw dataStudioRevisionConflict(current.revision);
    }

    const nextName = input.name ?? current.name;
    const nextDescription = input.description === undefined
      ? current.description
      : input.description;
    const nextSchema = input.schema ?? current.schema;
    const currentSchemaJson = serializeDataStudioSchema(current.schema);
    const nextSchemaJson = serializeDataStudioSchema(nextSchema);
    const schemaChanged = nextSchemaJson !== currentSchemaJson;
    if (schemaChanged && current.status === 'archived') {
      throw new DataStudioError(
        'DATA_STUDIO_TABLE_ARCHIVED',
        'Archived Data Studio tables cannot change schema.',
      );
    }
    if (schemaChanged) {
      if (current.schemaRevision >= DATA_STUDIO_MAX_SCHEMA_VERSIONS) {
        throw new DataStudioError(
          'DATA_STUDIO_LIMIT_EXCEEDED',
          'Data Studio schema history limit was reached.',
        );
      }
      assertSchemaTransition(db, current.tableId, current.rowCount, current.schema, nextSchema);
    }
    const metadataChanged = nextName !== current.name
      || nextDescription !== current.description;
    if (!schemaChanged && !metadataChanged) return dataStudioSuccess(current);

    const schemaRevision = current.schemaRevision + Number(schemaChanged);
    if (schemaChanged) {
      // History is append-only and is written before the current pointer moves.
      appendSchemaVersion(db, {
        tableId: current.tableId,
        schemaRevision,
        schemaJson: nextSchemaJson,
        userId: input.userId,
        membershipId: input.membershipId,
        now,
      });
      for (const column of nextSchema.columns) {
        reserveDataStudioColumnId(db, current.tableId, column.columnId, now);
      }
    }
    const changed = db.updateIfCurrent(
      DATA_STUDIO_TABLES_TABLE_NAME,
      current.tableId,
      {
        name: nextName,
        description: nextDescription,
        schema_json: nextSchemaJson,
        schema_revision: schemaRevision,
        revision: current.revision + 1,
        updated_by_user_id: input.userId,
        updated_by_membership_id: input.membershipId,
        updated_at: now,
      },
      currentRow,
    );
    // A schema history row may already have been appended in this transaction;
    // an impossible writer-lane CAS miss must roll the transaction back.
    if (!changed) throw corrupt();
    const stored = db.get(DATA_STUDIO_TABLES_TABLE_NAME, current.tableId);
    if (!stored) throw corrupt();
    return dataStudioSuccess(dataStudioTableFromRow(stored));
  } catch (error) {
    const failure = dataStudioExpectedFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export function setDataStudioTableStatusCommand(
  { db }: DatabaseWriteCommandContext,
  value: DatabaseSerializableValue,
): DataStudioTableResult {
  try {
    const input = readDataStudioTableStatusInput(value);
    assertDataStudioActor(db, input);
    const currentRow = db.get(DATA_STUDIO_TABLES_TABLE_NAME, input.tableId);
    if (!currentRow) throw tableNotFound();
    const current = dataStudioTableFromRow(currentRow);
    const now = dataStudioMutationTimestamp(current.updatedAt);
    if (current.revision !== input.expectedRevision) {
      throw dataStudioRevisionConflict(current.revision);
    }
    if (current.status === input.status) return dataStudioSuccess(current);
    const changed = db.updateIfCurrent(
      DATA_STUDIO_TABLES_TABLE_NAME,
      current.tableId,
      {
        status: input.status,
        archived_at: input.status === 'archived' ? now : null,
        revision: current.revision + 1,
        updated_by_user_id: input.userId,
        updated_by_membership_id: input.membershipId,
        updated_at: now,
      },
      currentRow,
    );
    if (!changed) throw dataStudioRevisionConflict(current.revision);
    const stored = db.get(DATA_STUDIO_TABLES_TABLE_NAME, current.tableId);
    if (!stored) throw corrupt();
    return dataStudioSuccess(dataStudioTableFromRow(stored));
  } catch (error) {
    const failure = dataStudioExpectedFailure(error);
    if (failure) return failure;
    throw error;
  }
}

function assertSchemaTransition(
  db: DatabaseWriteCommandContext['db'],
  tableId: string,
  rowCount: number,
  current: DataStudioSchema,
  next: DataStudioSchema,
): void {
  const currentById = new Map(current.columns.map((column) => [column.columnId, column]));
  const nextById = new Map(next.columns.map((column) => [column.columnId, column]));
  for (const column of current.columns) {
    const replacement = nextById.get(column.columnId);
    const stats = getDataStudioColumnStats(db, tableId, column.columnId);
    if ((!replacement || replacement.type !== column.type) && stats.valueCount > 0) {
      throw incompatibleSchema();
    }
    if (replacement
      && !column.required
      && replacement.required
      && stats.nonNullCount !== rowCount) {
      throw incompatibleSchema();
    }
  }
  for (const column of next.columns) {
    if (currentById.has(column.columnId)) continue;
    if (getDataStudioColumnStats(db, tableId, column.columnId).exists) {
      throw incompatibleSchema();
    }
    if (column.required && rowCount > 0) {
      throw incompatibleSchema();
    }
  }
}

function appendSchemaVersion(
  db: DatabaseWriteCommandContext['db'],
  input: {
    tableId: string;
    schemaRevision: number;
    schemaJson: string;
    userId: string;
    membershipId: string;
    now: number;
  },
): void {
  const identity = {
    table_id: input.tableId,
    schema_revision: input.schemaRevision,
  };
  db.createStrict(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME, {
    schema_version_id: db.identityKey(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME, identity),
    ...identity,
    schema_json: input.schemaJson,
    created_by_user_id: input.userId,
    created_by_membership_id: input.membershipId,
    created_at: input.now,
  });
}

function incompatibleSchema(): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_SCHEMA_INVALID',
    'Data Studio schema change is incompatible with existing rows.',
  );
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
    'Data Studio table state is inconsistent.',
  );
}
