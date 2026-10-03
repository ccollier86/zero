import { describe, expect, test } from 'bun:test';

import {
  createDatabaseReadQuerySession,
  withDatabaseReadQuerySession,
} from '../databases/database-read-query-capability';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import {
  defineDatabaseRealm,
  runDatabaseRealmCommand,
  runDatabaseRealmQuery,
} from '../databases/database-realm';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import type {
  DataStudioColumn,
  DataStudioRow,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioTable,
  DataStudioTableSummary,
} from './data-studio-contracts';
import {
  DATA_STUDIO_COMMAND_NAMES,
  DATA_STUDIO_MAX_SCHEMA_VERSIONS,
  DATA_STUDIO_QUERY_NAMES,
  type DataStudioOperationFailure,
  type DataStudioOperationResult,
  type DataStudioRowDeleteResult,
  type DataStudioRowPage,
} from './data-studio-operation-contracts';
import { DATA_STUDIO_REALM_COMMANDS } from './data-studio-realm-commands';
import { DATA_STUDIO_REALM_QUERIES } from './data-studio-realm-queries';
import {
  DATA_STUDIO_CELLS_TABLE_NAME,
  DATA_STUDIO_COLUMN_STATS_TABLE_NAME,
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
  DATA_STUDIO_TENANT_TABLES,
} from './data-studio-tenant-schema';

const ACTOR_ONE = Object.freeze({ userId: 'user_one', membershipId: 'member_one' });
const ACTOR_TWO = Object.freeze({ userId: 'user_two', membershipId: 'member_two' });
const MISMATCHED_ACTOR = Object.freeze({
  userId: ACTOR_ONE.userId,
  membershipId: ACTOR_TWO.membershipId,
});

const TITLE_COLUMN: DataStudioColumn = Object.freeze({
  columnId: 'col_title',
  key: 'title',
  label: 'Title',
  type: 'text',
  required: true,
});

const BASE_SCHEMA: DataStudioSchema = schema(TITLE_COLUMN);

const TEST_REALM = defineDatabaseRealm({
  name: 'data-studio-integration-test',
  version: '1',
  tables: DATA_STUDIO_TENANT_TABLES,
  queries: DATA_STUDIO_REALM_QUERIES,
  commands: DATA_STUDIO_REALM_COMMANDS,
});

describe('Data Studio realm commands', () => {
  test('creates a table with immutable history and reserved column ids', () => {
    using harness = createHarness();

    const table = harness.createTable({
      tableId: 'table_projects',
      key: 'projects',
      name: 'Projects',
      description: 'Delivery projects',
      schema: schema(
        TITLE_COLUMN,
        column('col_budget', 'budget', 'Budget', 'number'),
      ),
    });

    expect(table).toMatchObject({
      tableId: 'table_projects',
      key: 'projects',
      name: 'Projects',
      description: 'Delivery projects',
      status: 'active',
      schemaRevision: 1,
      revision: 1,
      rowCount: 0,
    });
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME)).toHaveLength(1);
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME)[0]).toMatchObject({
      table_id: table.tableId,
      schema_revision: 1,
      created_by_user_id: ACTOR_ONE.userId,
      created_by_membership_id: ACTOR_ONE.membershipId,
    });
    expect(harness.rows(DATA_STUDIO_COLUMN_STATS_TABLE_NAME)).toEqual([
      expect.objectContaining({
        table_id: table.tableId,
        column_id: 'col_title',
        value_count: 0,
        non_null_count: 0,
      }),
      expect.objectContaining({
        table_id: table.tableId,
        column_id: 'col_budget',
        value_count: 0,
        non_null_count: 0,
      }),
    ]);

    expect(expectSuccess<DataStudioTable>(harness.query(
      DATA_STUDIO_QUERY_NAMES.getTable,
      { key: 'projects' },
    ))).toEqual(table);
    const { schema: _schema, ...summary } = table;
    expect(expectSuccess<readonly DataStudioTableSummary[]>(harness.query(
      DATA_STUDIO_QUERY_NAMES.listTables,
      { status: 'active' },
    ))).toEqual([summary]);
  });

  test('rejects duplicate table keys without leaving metadata, history, or stats', () => {
    using harness = createHarness();
    harness.createTable({
      tableId: 'table_first',
      key: 'projects',
      name: 'First',
      schema: BASE_SCHEMA,
    });

    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.createTable, {
      ...ACTOR_ONE,
      tableId: 'table_second',
      key: 'PROJECTS',
      name: 'Second',
      description: null,
      schema: BASE_SCHEMA,
    }), 'DATA_STUDIO_TABLE_KEY_CONFLICT');

    expect(harness.db.get(DATA_STUDIO_TABLES_TABLE_NAME, 'table_second')).toBeNull();
    expect(harness.rows(DATA_STUDIO_TABLES_TABLE_NAME)).toHaveLength(1);
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME)).toHaveLength(1);
    expect(harness.rows(DATA_STUDIO_COLUMN_STATS_TABLE_NAME)).toHaveLength(1);
  });

  test('creates, replaces, and deletes rows atomically with cells, counts, and stats', () => {
    using harness = createHarness();
    const table = harness.createTable({
      tableId: 'table_work',
      key: 'work',
      name: 'Work',
      schema: schema(
        TITLE_COLUMN,
        column('col_score', 'score', 'Score', 'number'),
        column('col_note', 'note', 'Note', 'text'),
      ),
    });

    const created = harness.createRow(table.tableId, 'row_one', {
      title: 'Initial',
      score: 10,
    });
    expect(created).toMatchObject({
      rowId: 'row_one',
      tableId: table.tableId,
      revision: 1,
      schemaRevision: 1,
      values: { col_title: 'Initial', col_score: 10 },
    });
    expect(harness.table(table.tableId).row_count).toBe(1);
    expect(harness.cells(table.tableId, 'row_one')).toEqual([
      expect.objectContaining({ column_id: 'col_score', number_value: 10 }),
      expect.objectContaining({ column_id: 'col_title', text_value: 'Initial' }),
    ]);
    expect(harness.stat(table.tableId, 'col_title')).toMatchObject({
      value_count: 1,
      non_null_count: 1,
    });
    expect(harness.stat(table.tableId, 'col_score')).toMatchObject({
      value_count: 1,
      non_null_count: 1,
    });
    expect(harness.stat(table.tableId, 'col_note')).toMatchObject({
      value_count: 0,
      non_null_count: 0,
    });

    const replaced = expectSuccess<DataStudioRow>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.replaceRow,
      {
        ...ACTOR_TWO,
        tableId: table.tableId,
        rowId: created.rowId,
        expectedRevision: created.revision,
        values: { title: 'Updated', note: null },
      },
    ));
    expect(replaced).toMatchObject({
      revision: 2,
      values: { col_title: 'Updated', col_note: null },
    });
    expect(harness.cells(table.tableId, created.rowId)).toEqual([
      expect.objectContaining({
        column_id: 'col_note',
        value_type: 'null',
        updated_by_user_id: ACTOR_TWO.userId,
      }),
      expect.objectContaining({
        column_id: 'col_title',
        text_value: 'Updated',
        updated_by_user_id: ACTOR_TWO.userId,
      }),
    ]);
    expect(harness.stat(table.tableId, 'col_score')).toMatchObject({
      value_count: 0,
      non_null_count: 0,
    });
    expect(harness.stat(table.tableId, 'col_note')).toMatchObject({
      value_count: 1,
      non_null_count: 0,
    });

    expectSuccess<DataStudioRowDeleteResult>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.deleteRow,
      {
        ...ACTOR_TWO,
        tableId: table.tableId,
        rowId: created.rowId,
        expectedRevision: replaced.revision,
      },
    ));
    expect(harness.rows(DATA_STUDIO_ROWS_TABLE_NAME)).toHaveLength(0);
    expect(harness.rows(DATA_STUDIO_CELLS_TABLE_NAME)).toHaveLength(0);
    expect(harness.table(table.tableId).row_count).toBe(0);
    expect(harness.stat(table.tableId, 'col_title')).toMatchObject({
      value_count: 0,
      non_null_count: 0,
    });
    expect(harness.stat(table.tableId, 'col_note')).toMatchObject({
      value_count: 0,
      non_null_count: 0,
    });
  });

  test('scopes row identities to their logical table and rejects duplicates only locally', () => {
    using harness = createHarness();
    const first = harness.createTable({
      tableId: 'table_first',
      key: 'first',
      name: 'First',
      schema: BASE_SCHEMA,
    });
    const second = harness.createTable({
      tableId: 'table_second',
      key: 'second',
      name: 'Second',
      schema: BASE_SCHEMA,
    });

    harness.createRow(first.tableId, 'shared_row', { title: 'One' });
    harness.createRow(second.tableId, 'shared_row', { title: 'Two' });

    const stored = harness.rows(DATA_STUDIO_ROWS_TABLE_NAME);
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((row) => row.record_id)).size).toBe(2);
    expect(harness.table(first.tableId).row_count).toBe(1);
    expect(harness.table(second.tableId).row_count).toBe(1);

    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.createRow, {
      ...ACTOR_ONE,
      tableId: first.tableId,
      rowId: 'shared_row',
      values: { title: 'Duplicate' },
    }), 'DATA_STUDIO_IDEMPOTENCY_CONFLICT');
    expect(harness.rows(DATA_STUDIO_ROWS_TABLE_NAME)).toHaveLength(2);
    expect(harness.table(first.tableId).row_count).toBe(1);
  });

  test('rejects mismatched Guardian actor pairs before any command mutation', () => {
    using harness = createHarness();

    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.createTable, {
      ...MISMATCHED_ACTOR,
      tableId: 'table_rejected',
      key: 'rejected',
      name: 'Rejected',
      description: null,
      schema: BASE_SCHEMA,
    }), 'DATA_STUDIO_AUTHORITY_REQUIRED');
    expect(harness.rows(DATA_STUDIO_TABLES_TABLE_NAME)).toHaveLength(0);
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME)).toHaveLength(0);
    expect(harness.rows(DATA_STUDIO_COLUMN_STATS_TABLE_NAME)).toHaveLength(0);

    const table = harness.createTable({
      tableId: 'table_valid',
      key: 'valid',
      name: 'Valid',
      schema: BASE_SCHEMA,
    });
    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.createRow, {
      ...MISMATCHED_ACTOR,
      tableId: table.tableId,
      rowId: 'row_rejected',
      values: { title: 'Rejected' },
    }), 'DATA_STUDIO_AUTHORITY_REQUIRED');
    expect(harness.rows(DATA_STUDIO_ROWS_TABLE_NAME)).toHaveLength(0);
    expect(harness.rows(DATA_STUDIO_CELLS_TABLE_NAME)).toHaveLength(0);
    expect(harness.table(table.tableId).row_count).toBe(0);
    expect(harness.stat(table.tableId, 'col_title')).toMatchObject({
      value_count: 0,
      non_null_count: 0,
    });
  });

  test('returns revision conflicts without partially changing rows, cells, stats, or history', () => {
    using harness = createHarness();
    const table = harness.createTable({
      tableId: 'table_conflicts',
      key: 'conflicts',
      name: 'Conflicts',
      schema: schema(TITLE_COLUMN, column('col_score', 'score', 'Score', 'number')),
    });
    const row = harness.createRow(table.tableId, 'row_one', {
      title: 'Original',
      score: 10,
    });
    const rowsBefore = harness.rows(DATA_STUDIO_ROWS_TABLE_NAME);
    const cellsBefore = harness.rows(DATA_STUDIO_CELLS_TABLE_NAME);
    const statsBefore = harness.rows(DATA_STUDIO_COLUMN_STATS_TABLE_NAME);

    const rowFailure = expectFailure(harness.command(
      DATA_STUDIO_COMMAND_NAMES.replaceRow,
      {
        ...ACTOR_TWO,
        tableId: table.tableId,
        rowId: row.rowId,
        expectedRevision: row.revision + 1,
        values: { title: 'Must not persist' },
      },
    ), 'DATA_STUDIO_REVISION_CONFLICT');
    expect(rowFailure.currentRevision).toBe(row.revision);
    expect(harness.rows(DATA_STUDIO_ROWS_TABLE_NAME)).toEqual(rowsBefore);
    expect(harness.rows(DATA_STUDIO_CELLS_TABLE_NAME)).toEqual(cellsBefore);
    expect(harness.rows(DATA_STUDIO_COLUMN_STATS_TABLE_NAME)).toEqual(statsBefore);

    const historyBefore = harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME);
    const tableBefore = harness.table(table.tableId);
    const tableFailure = expectFailure(harness.command(
      DATA_STUDIO_COMMAND_NAMES.updateTable,
      {
        ...ACTOR_TWO,
        tableId: table.tableId,
        expectedRevision: table.revision + 1,
        schema: schema(TITLE_COLUMN),
      },
    ), 'DATA_STUDIO_REVISION_CONFLICT');
    expect(tableFailure.currentRevision).toBe(table.revision);
    expect(harness.table(table.tableId)).toEqual(tableBefore);
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME)).toEqual(historyBefore);
  });

  test('denies row and schema mutations while archived and can be explicitly reactivated', () => {
    using harness = createHarness();
    const table = harness.createTable({
      tableId: 'table_archive',
      key: 'archive',
      name: 'Archive',
      schema: BASE_SCHEMA,
    });
    const row = harness.createRow(table.tableId, 'row_one', { title: 'Existing' });
    const archived = expectSuccess<DataStudioTable>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.setTableStatus,
      {
        ...ACTOR_ONE,
        tableId: table.tableId,
        expectedRevision: table.revision,
        status: 'archived',
      },
    ));

    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.createRow, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      rowId: 'row_two',
      values: { title: 'No' },
    }), 'DATA_STUDIO_TABLE_ARCHIVED');
    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.replaceRow, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      rowId: row.rowId,
      expectedRevision: row.revision,
      values: { title: 'No' },
    }), 'DATA_STUDIO_TABLE_ARCHIVED');
    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.deleteRow, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      rowId: row.rowId,
      expectedRevision: row.revision,
    }), 'DATA_STUDIO_TABLE_ARCHIVED');
    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.updateTable, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      expectedRevision: archived.revision,
      schema: schema(TITLE_COLUMN, column('col_note', 'note', 'Note', 'text')),
    }), 'DATA_STUDIO_TABLE_ARCHIVED');
    expect(harness.table(table.tableId)).toMatchObject({
      status: 'archived',
      row_count: 1,
      schema_revision: 1,
      revision: archived.revision,
    });
    expect(harness.rows(DATA_STUDIO_ROWS_TABLE_NAME)).toHaveLength(1);
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME)).toHaveLength(1);

    const active = expectSuccess<DataStudioTable>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.setTableStatus,
      {
        ...ACTOR_TWO,
        tableId: table.tableId,
        expectedRevision: archived.revision,
        status: 'active',
      },
    ));
    expect(active.status).toBe('active');
    expect(active.revision).toBe(archived.revision + 1);
    expect(harness.createRow(table.tableId, 'row_two', { title: 'Allowed' })).toBeTruthy();
  });
});

describe('Data Studio schema evolution', () => {
  test('enforces presence-aware required, removal, and type transition rules', () => {
    using harness = createHarness();
    const optionalNote = column('col_note', 'note', 'Note', 'text');
    let table = harness.createTable({
      tableId: 'table_schema',
      key: 'schema_rules',
      name: 'Schema rules',
      schema: schema(TITLE_COLUMN, optionalNote),
    });
    harness.createRow(table.tableId, 'row_absent', { title: 'Absent' });
    harness.createRow(table.tableId, 'row_null', { title: 'Null', note: null });
    harness.createRow(table.tableId, 'row_value', { title: 'Value', note: 'present' });

    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.updateTable, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      expectedRevision: table.revision,
      schema: schema(TITLE_COLUMN, { ...optionalNote, required: true }),
    }), 'DATA_STUDIO_SCHEMA_INVALID');
    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.updateTable, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      expectedRevision: table.revision,
      schema: schema(TITLE_COLUMN),
    }), 'DATA_STUDIO_SCHEMA_INVALID');
    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.updateTable, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      expectedRevision: table.revision,
      schema: schema(TITLE_COLUMN, { ...optionalNote, type: 'number' }),
    }), 'DATA_STUDIO_SCHEMA_INVALID');
    expect(harness.table(table.tableId)).toMatchObject({
      revision: table.revision,
      schema_revision: table.schemaRevision,
    });
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME)).toHaveLength(1);

    const addRequired = schema(
      TITLE_COLUMN,
      optionalNote,
      {
        ...column('col_required', 'required_value', 'Required value', 'text'),
        required: true,
        defaultValue: 'default does not rewrite old rows',
      },
    );
    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.updateTable, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      expectedRevision: table.revision,
      schema: addRequired,
    }), 'DATA_STUDIO_SCHEMA_INVALID');

    const complete = harness.createTable({
      tableId: 'table_complete',
      key: 'complete',
      name: 'Complete',
      schema: schema(TITLE_COLUMN, optionalNote),
    });
    harness.createRow(complete.tableId, 'row_one', { title: 'One', note: 'yes' });
    harness.createRow(complete.tableId, 'row_two', { title: 'Two', note: 'yes' });
    const required = expectSuccess<DataStudioTable>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.updateTable,
      {
        ...ACTOR_ONE,
        tableId: complete.tableId,
        expectedRevision: complete.revision,
        schema: schema(TITLE_COLUMN, { ...optionalNote, required: true }),
      },
    ));
    expect(required.schema.columns[1]?.required).toBe(true);
  });

  test('keeps defaults write-time only for pre-schema rows and typed queries', () => {
    using harness = createHarness();
    let table = harness.createTable({
      tableId: 'table_defaults',
      key: 'defaults',
      name: 'Defaults',
      schema: BASE_SCHEMA,
    });
    const oldRow = harness.createRow(table.tableId, 'row_old', { title: 'Old' });

    table = expectSuccess<DataStudioTable>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.updateTable,
      {
        ...ACTOR_ONE,
        tableId: table.tableId,
        expectedRevision: table.revision,
        schema: schema(
          TITLE_COLUMN,
          {
            ...column('col_priority', 'priority', 'Priority', 'number'),
            defaultValue: 5,
          },
          {
            ...column('col_tier', 'tier', 'Tier', 'text'),
            defaultValue: 'standard',
          },
        ),
      },
    ));
    const newRow = harness.createRow(table.tableId, 'row_new', { title: 'New' });

    expect(expectSuccess<DataStudioRow>(harness.query(
      DATA_STUDIO_QUERY_NAMES.getRow,
      { tableId: table.tableId, rowId: oldRow.rowId },
    )).values).toEqual({ col_title: 'Old' });
    expect(newRow.values).toEqual({
      col_priority: 5,
      col_tier: 'standard',
      col_title: 'New',
    });
    expect(harness.cells(table.tableId, oldRow.rowId).map((row) => row.column_id))
      .toEqual(['col_title']);
    expect(harness.stat(table.tableId, 'col_priority')).toMatchObject({
      value_count: 1,
      non_null_count: 1,
    });

    const filtered = expectSuccess<DataStudioRowPage>(harness.query(
      DATA_STUDIO_QUERY_NAMES.listRows,
      {
        tableId: table.tableId,
        limit: 25,
        offset: 0,
        filters: [{ columnKey: 'priority', operator: 'eq', value: 5 }],
      },
    ));
    expect(filtered.rows.map((row) => row.rowId)).toEqual([newRow.rowId]);
    const searched = expectSuccess<DataStudioRowPage>(harness.query(
      DATA_STUDIO_QUERY_NAMES.listRows,
      {
        tableId: table.tableId,
        limit: 25,
        offset: 0,
        search: 'standard',
      },
    ));
    expect(searched.rows.map((row) => row.rowId)).toEqual([newRow.rowId]);
  });

  test('permanently reserves removed column ids and accepts removal only when unused', () => {
    using harness = createHarness();
    const temporary = column('col_temporary', 'temporary', 'Temporary', 'text');
    let table = harness.createTable({
      tableId: 'table_reservations',
      key: 'reservations',
      name: 'Reservations',
      schema: schema(TITLE_COLUMN, temporary),
    });
    harness.createRow(table.tableId, 'row_one', { title: 'No temporary cell' });

    table = expectSuccess<DataStudioTable>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.updateTable,
      {
        ...ACTOR_ONE,
        tableId: table.tableId,
        expectedRevision: table.revision,
        schema: BASE_SCHEMA,
      },
    ));
    expect(table.schema.columns.map((entry) => entry.columnId)).toEqual(['col_title']);
    expect(harness.stat(table.tableId, temporary.columnId)).toMatchObject({
      value_count: 0,
      non_null_count: 0,
    });

    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.updateTable, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      expectedRevision: table.revision,
      schema: schema(
        TITLE_COLUMN,
        column(temporary.columnId, 'replacement', 'Replacement', 'number'),
      ),
    }), 'DATA_STUDIO_SCHEMA_INVALID');
    expect(harness.table(table.tableId)).toMatchObject({
      revision: table.revision,
      schema_revision: table.schemaRevision,
    });

    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.updateTable, {
      ...ACTOR_ONE,
      tableId: table.tableId,
      expectedRevision: table.revision,
      schema: schema(
        TITLE_COLUMN,
        column(temporary.columnId.toUpperCase(), 'case_variant', 'Case variant', 'text'),
      ),
    }), 'DATA_STUDIO_SCHEMA_INVALID');
    expect(harness.table(table.tableId)).toMatchObject({
      revision: table.revision,
      schema_revision: table.schemaRevision,
    });
  });

  test('caps immutable schema history and pages it newest-first', () => {
    using harness = createHarness();
    let table = harness.createTable({
      tableId: 'table_history',
      key: 'history',
      name: 'History 1',
      schema: BASE_SCHEMA,
    });

    for (let revision = 2; revision <= DATA_STUDIO_MAX_SCHEMA_VERSIONS; revision += 1) {
      table = expectSuccess<DataStudioTable>(harness.command(
        DATA_STUDIO_COMMAND_NAMES.updateTable,
        {
          ...ACTOR_TWO,
          tableId: table.tableId,
          expectedRevision: table.revision,
          schema: schema({ ...TITLE_COLUMN, label: `Title ${revision}` }),
        },
      ));
    }
    expect(table.schemaRevision).toBe(DATA_STUDIO_MAX_SCHEMA_VERSIONS);
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME))
      .toHaveLength(DATA_STUDIO_MAX_SCHEMA_VERSIONS);

    const firstPage = expectSuccess<readonly DataStudioSchemaVersion[]>(harness.query(
      DATA_STUDIO_QUERY_NAMES.listSchemaVersions,
      { tableId: table.tableId, limit: 10 },
    ));
    expect(firstPage.map((version) => version.schemaRevision)).toEqual(
      Array.from({ length: 10 }, (_, index) => DATA_STUDIO_MAX_SCHEMA_VERSIONS - index),
    );
    const nextPage = expectSuccess<readonly DataStudioSchemaVersion[]>(harness.query(
      DATA_STUDIO_QUERY_NAMES.listSchemaVersions,
      {
        tableId: table.tableId,
        limit: 3,
        beforeRevision: firstPage.at(-1)!.schemaRevision,
      },
    ));
    expect(nextPage.map((version) => version.schemaRevision)).toEqual([246, 245, 244]);

    expectFailure(harness.command(DATA_STUDIO_COMMAND_NAMES.updateTable, {
      ...ACTOR_TWO,
      tableId: table.tableId,
      expectedRevision: table.revision,
      schema: schema({ ...TITLE_COLUMN, label: 'One too many' }),
    }), 'DATA_STUDIO_LIMIT_EXCEEDED');
    expect(harness.table(table.tableId)).toMatchObject({
      revision: table.revision,
      schema_revision: DATA_STUDIO_MAX_SCHEMA_VERSIONS,
    });
    expect(harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME))
      .toHaveLength(DATA_STUDIO_MAX_SCHEMA_VERSIONS);
  });
});

describe('Data Studio realm queries', () => {
  test('lists, searches, filters, sorts, and paginates logical rows deterministically', () => {
    using harness = createHarness();
    const table = harness.createTable({
      tableId: 'table_query',
      key: 'query',
      name: 'Query',
      schema: schema(
        TITLE_COLUMN,
        column('col_score', 'score', 'Score', 'number'),
        column('col_active', 'active', 'Active', 'boolean'),
        column('col_date', 'date', 'Date', 'date'),
      ),
    });
    harness.createRow(table.tableId, 'row_alpha', {
      title: 'Alpha 100%_literal', score: 30, active: true, date: '2026-10-03',
    });
    harness.createRow(table.tableId, 'row_beta', {
      title: 'Beta needle', score: 10, active: false, date: '2026-10-01',
    });
    harness.createRow(table.tableId, 'row_gamma', {
      title: 'Gamma needle', score: 20, active: true, date: '2026-10-02',
    });

    const searched = harness.listRows(table.tableId, { search: 'needle' });
    expect(searched.total).toBe(2);
    expect(new Set(searched.rows.map((row) => row.rowId)))
      .toEqual(new Set(['row_beta', 'row_gamma']));
    const escapedSearch = harness.listRows(table.tableId, { search: '100%_' });
    expect(escapedSearch.rows.map((row) => row.rowId)).toEqual(['row_alpha']);

    const filtered = harness.listRows(table.tableId, {
      filters: [
        { columnKey: 'score', operator: 'gte', value: 20 },
        { columnKey: 'active', operator: 'eq', value: true },
      ],
      sortColumnId: 'col_score',
      sortDirection: 'desc',
    });
    expect(filtered.rows.map((row) => row.rowId)).toEqual(['row_alpha', 'row_gamma']);

    const dateFiltered = harness.listRows(table.tableId, {
      filters: [{ columnKey: 'date', operator: 'gt', value: '2026-10-01' }],
      sortColumnId: 'col_date',
      sortDirection: 'asc',
    });
    expect(dateFiltered.rows.map((row) => row.rowId)).toEqual([
      'row_gamma', 'row_alpha',
    ]);

    const firstPage = harness.listRows(table.tableId, {
      limit: 2,
      sortColumnId: 'col_score',
      sortDirection: 'asc',
    });
    expect(firstPage).toMatchObject({ total: 3, limit: 2, offset: 0, nextOffset: 2 });
    expect(firstPage.rows.map((row) => row.rowId)).toEqual(['row_beta', 'row_gamma']);
    const secondPage = harness.listRows(table.tableId, {
      limit: 2,
      offset: firstPage.nextOffset!,
      sortColumnId: 'col_score',
      sortDirection: 'asc',
    });
    expect(secondPage).toMatchObject({ total: 3, limit: 2, offset: 2, nextOffset: null });
    expect(secondPage.rows.map((row) => row.rowId)).toEqual(['row_alpha']);
  });

  test('treats SQL-looking search and filter values as bound data', () => {
    using harness = createHarness();
    const table = harness.createTable({
      tableId: 'table_bound',
      key: 'bound',
      name: 'Bound',
      schema: BASE_SCHEMA,
    });
    harness.createRow(table.tableId, 'row_safe', { title: 'Safe' });
    harness.createRow(table.tableId, 'row_literal', {
      title: "x' OR 1=1 --",
    });

    const exactLiteral = harness.listRows(table.tableId, {
      filters: [{
        columnKey: 'title',
        operator: 'eq',
        value: "x' OR 1=1 --",
      }],
    });
    expect(exactLiteral.rows.map((row) => row.rowId)).toEqual(['row_literal']);
    const hostileSearch = harness.listRows(table.tableId, {
      search: "%' OR 1=1 --",
    });
    expect(hostileSearch.total).toBe(0);
    expect(harness.rows(DATA_STUDIO_ROWS_TABLE_NAME)).toHaveLength(2);
    expect(harness.rows(DATA_STUDIO_TABLES_TABLE_NAME)).toHaveLength(1);
  });

  test('keeps absent cells distinct from stored null in typed filters', () => {
    using harness = createHarness();
    const table = harness.createTable({
      tableId: 'table_null_filters',
      key: 'null_filters',
      name: 'Null filters',
      schema: schema(
        TITLE_COLUMN,
        column('col_note', 'note', 'Note', 'text'),
      ),
    });
    harness.createRow(table.tableId, 'row_absent', { title: 'Absent' });
    harness.createRow(table.tableId, 'row_null', { title: 'Null', note: null });
    harness.createRow(table.tableId, 'row_value', { title: 'Value', note: 'present' });

    const storedNull = harness.listRows(table.tableId, {
      filters: [{ columnKey: 'note', operator: 'eq', value: null }],
    });
    expect(storedNull.rows.map((row) => row.rowId)).toEqual(['row_null']);

    const storedNonNull = harness.listRows(table.tableId, {
      filters: [{ columnKey: 'note', operator: 'ne', value: null }],
    });
    expect(storedNonNull.rows.map((row) => row.rowId)).toEqual(['row_value']);
  });

  test('uses nextOffset when the byte budget truncates a nominal page', () => {
    using harness = createHarness();
    const largeColumns = Array.from({ length: 4 }, (_, index) =>
      column(`col_blob_${index}`, `blob_${index}`, `Blob ${index}`, 'text'));
    const table = harness.createTable({
      tableId: 'table_large',
      key: 'large',
      name: 'Large',
      schema: schema(TITLE_COLUMN, ...largeColumns),
    });
    const fragment = 'x'.repeat(60 * 1024);
    for (let index = 0; index < 4; index += 1) {
      harness.createRow(table.tableId, `row_${index}`, {
        title: `Row ${index}`,
        ...Object.fromEntries(largeColumns.map((entry) => [entry.key, fragment])),
      });
    }

    const first = harness.listRows(table.tableId, {
      limit: 25,
      sortColumnId: 'col_title',
      sortDirection: 'asc',
    });
    expect(first.total).toBe(4);
    expect(first.rows.length).toBeGreaterThan(0);
    expect(first.rows.length).toBeLessThan(4);
    expect(first.nextOffset).toBe(first.rows.length);
    const second = harness.listRows(table.tableId, {
      limit: 25,
      offset: first.nextOffset!,
      sortColumnId: 'col_title',
      sortDirection: 'asc',
    });
    expect([...first.rows, ...second.rows].map((row) => row.rowId)).toEqual([
      'row_0', 'row_1', 'row_2', 'row_3',
    ]);
    expect(second.nextOffset).toBeNull();
  });
});

describe('Data Studio actor attribution', () => {
  test('preserves creators while recording the latest valid updater and schema author', () => {
    using harness = createHarness();
    let table = harness.createTable({
      tableId: 'table_attribution',
      key: 'attribution',
      name: 'Attribution',
      schema: BASE_SCHEMA,
    });
    table = expectSuccess<DataStudioTable>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.updateTable,
      {
        ...ACTOR_TWO,
        tableId: table.tableId,
        expectedRevision: table.revision,
        schema: schema(TITLE_COLUMN, column('col_note', 'note', 'Note', 'text')),
      },
    ));
    const tableRow = harness.db.get(DATA_STUDIO_TABLES_TABLE_NAME, table.tableId)!;
    expect(tableRow).toMatchObject({
      created_by_user_id: ACTOR_ONE.userId,
      created_by_membership_id: ACTOR_ONE.membershipId,
      updated_by_user_id: ACTOR_TWO.userId,
      updated_by_membership_id: ACTOR_TWO.membershipId,
    });
    const history = harness.rows(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME)
      .sort((left, right) => Number(left.schema_revision) - Number(right.schema_revision));
    expect(history).toEqual([
      expect.objectContaining({
        schema_revision: 1,
        created_by_user_id: ACTOR_ONE.userId,
        created_by_membership_id: ACTOR_ONE.membershipId,
      }),
      expect.objectContaining({
        schema_revision: 2,
        created_by_user_id: ACTOR_TWO.userId,
        created_by_membership_id: ACTOR_TWO.membershipId,
      }),
    ]);

    const created = harness.createRow(table.tableId, 'row_one', {
      title: 'Created', note: 'one',
    });
    expectSuccess<DataStudioRow>(harness.command(
      DATA_STUDIO_COMMAND_NAMES.replaceRow,
      {
        ...ACTOR_TWO,
        tableId: table.tableId,
        rowId: created.rowId,
        expectedRevision: created.revision,
        values: { title: 'Updated', note: 'two' },
      },
    ));
    const row = harness.rows(DATA_STUDIO_ROWS_TABLE_NAME)[0]!;
    expect(row).toMatchObject({
      created_by_user_id: ACTOR_ONE.userId,
      created_by_membership_id: ACTOR_ONE.membershipId,
      updated_by_user_id: ACTOR_TWO.userId,
      updated_by_membership_id: ACTOR_TWO.membershipId,
    });
    for (const cell of harness.cells(table.tableId, created.rowId)) {
      expect(cell).toMatchObject({
        updated_by_user_id: ACTOR_TWO.userId,
        updated_by_membership_id: ACTOR_TWO.membershipId,
      });
    }
  });
});

interface TableCreateFixture {
  readonly tableId: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly schema: DataStudioSchema;
}

interface ListRowsFixture {
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
  readonly filters?: readonly {
    readonly columnKey: string;
    readonly operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
    readonly value: string | number | boolean | null;
  }[];
  readonly sortColumnId?: string;
  readonly sortDirection?: 'asc' | 'desc';
}

class DataStudioRealmHarness implements Disposable {
  readonly db: ReactiveDB;

  constructor() {
    this.db = createReactiveDB({ mode: 'memory', ringBufferDepth: 10_000 });
    this.db.defineTable('users', { user_id: 'text primary key' });
    this.db.defineTable('tenant_memberships', {
      membership_id: 'text primary key',
      tenant_id: 'text not null',
      user_id: 'text references users(user_id) on delete restrict not null',
    });
    for (const [name, tableSchema] of Object.entries(DATA_STUDIO_TENANT_TABLES)) {
      this.db.defineTable(name, tableSchema);
    }
    this.db.createStrict('users', { user_id: ACTOR_ONE.userId });
    this.db.createStrict('users', { user_id: ACTOR_TWO.userId });
    this.db.createStrict('tenant_memberships', {
      membership_id: ACTOR_ONE.membershipId,
      tenant_id: 'organization_one',
      user_id: ACTOR_ONE.userId,
    });
    this.db.createStrict('tenant_memberships', {
      membership_id: ACTOR_TWO.membershipId,
      tenant_id: 'organization_one',
      user_id: ACTOR_TWO.userId,
    });
  }

  [Symbol.dispose](): void {
    this.db.dispose();
  }

  command<T>(name: string, input: unknown): DataStudioOperationResult<T> {
    return runDatabaseRealmCommand(
      TEST_REALM,
      this.db,
      name,
      input as DatabaseSerializableValue,
    ) as unknown as DataStudioOperationResult<T>;
  }

  query<T>(name: string, input: unknown): DataStudioOperationResult<T> {
    return withDatabaseReadQuerySession(
      createDatabaseReadQuerySession(this.db.getRawDatabase()),
      (context) => runDatabaseRealmQuery(
        TEST_REALM,
        context,
        name,
        input as DatabaseSerializableValue,
      ),
    ) as unknown as DataStudioOperationResult<T>;
  }

  createTable(input: TableCreateFixture): DataStudioTable {
    return expectSuccess<DataStudioTable>(this.command(
      DATA_STUDIO_COMMAND_NAMES.createTable,
      {
        ...ACTOR_ONE,
        ...input,
        description: input.description ?? null,
      },
    ));
  }

  createRow(
    tableId: string,
    rowId: string,
    values: Readonly<Record<string, unknown>>,
  ): DataStudioRow {
    return expectSuccess<DataStudioRow>(this.command(
      DATA_STUDIO_COMMAND_NAMES.createRow,
      { ...ACTOR_ONE, tableId, rowId, values },
    ));
  }

  listRows(tableId: string, input: ListRowsFixture = {}): DataStudioRowPage {
    return expectSuccess<DataStudioRowPage>(this.query(
      DATA_STUDIO_QUERY_NAMES.listRows,
      {
        tableId,
        limit: input.limit ?? 25,
        offset: input.offset ?? 0,
        ...(input.search === undefined ? {} : { search: input.search }),
        ...(input.filters === undefined ? {} : { filters: input.filters }),
        ...(input.sortColumnId === undefined
          ? {}
          : { sortColumnId: input.sortColumnId }),
        ...(input.sortDirection === undefined
          ? {}
          : { sortDirection: input.sortDirection }),
      },
    ));
  }

  table(tableId: string): Row {
    const row = this.db.get(DATA_STUDIO_TABLES_TABLE_NAME, tableId);
    if (!row) throw new Error(`Missing fixture table ${tableId}`);
    return row;
  }

  rows(table: string): Row[] {
    return this.db.query(table);
  }

  stat(tableId: string, columnId: string): Row {
    const row = this.db.queryByIdentity(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, {
      table_id: tableId,
      column_id: columnId,
    });
    if (!row) throw new Error(`Missing fixture stat ${tableId}/${columnId}`);
    return row;
  }

  cells(tableId: string, rowId: string): Row[] {
    const row = this.db.queryByIdentity(DATA_STUDIO_ROWS_TABLE_NAME, {
      table_id: tableId,
      row_id: rowId,
    });
    if (!row) return [];
    return this.db.query(DATA_STUDIO_CELLS_TABLE_NAME)
      .filter((cell) => cell.row_record_id === row.record_id)
      .sort((left, right) => String(left.column_id).localeCompare(String(right.column_id)));
  }
}

function createHarness(): DataStudioRealmHarness {
  return new DataStudioRealmHarness();
}

function expectSuccess<T>(result: DataStudioOperationResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.code}`);
  }
  return result.value;
}

function expectFailure<T>(
  result: DataStudioOperationResult<T>,
  code: DataStudioOperationFailure['code'],
): DataStudioOperationFailure {
  expect(result).toMatchObject({ ok: false, code });
  if (result.ok) throw new Error('Expected Data Studio failure');
  return result;
}

function schema(...columns: readonly DataStudioColumn[]): DataStudioSchema {
  return Object.freeze({
    version: 1,
    columns: Object.freeze(columns.map((entry) => Object.freeze({ ...entry }))),
  });
}

function column(
  columnId: string,
  key: string,
  label: string,
  type: DataStudioColumn['type'],
): DataStudioColumn {
  return Object.freeze({ columnId, key, label, type, required: false });
}
