/**
 * data-studio-tenant-schema.test.ts
 *
 * Proves the fixed schemas are Guardian-aware, Fabric-admissible, and backed by
 * working SQLite foreign keys and generated natural-identity indexes.
 */

import { describe, expect, test } from 'bun:test';
import { defineDatabaseRealm } from '../databases/database-realm';
import {
  getGuardianAnchorRequirements,
  getGuardianTableReferences,
  inspectGuardianReferenceSchema,
} from '../schema/guardian-references';
import { createReactiveDB } from '../sync/reactive-db';
import {
  DATA_STUDIO_CELLS_SCHEMA,
  DATA_STUDIO_CELLS_TABLE_NAME,
  DATA_STUDIO_COLUMN_STATS_SCHEMA,
  DATA_STUDIO_COLUMN_STATS_TABLE_NAME,
  DATA_STUDIO_ROWS_SCHEMA,
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_SCHEMA_VERSIONS_SCHEMA,
  DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME,
  DATA_STUDIO_TABLES_SCHEMA,
  DATA_STUDIO_TABLES_TABLE_NAME,
  DATA_STUDIO_TENANT_TABLES,
  serializeDataStudioSchema,
} from './index';

describe('Data Studio tenant schemas', () => {
  test('are immutable, Fabric-admissible, and carry Guardian references', () => {
    expect(Object.keys(DATA_STUDIO_TENANT_TABLES)).toEqual([
      DATA_STUDIO_TABLES_TABLE_NAME,
      DATA_STUDIO_ROWS_TABLE_NAME,
      DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME,
      DATA_STUDIO_CELLS_TABLE_NAME,
      DATA_STUDIO_COLUMN_STATS_TABLE_NAME,
    ]);
    expect(Object.values(DATA_STUDIO_TENANT_TABLES).every(Object.isFrozen)).toBe(true);

    for (const [tableName, schema] of Object.entries(DATA_STUDIO_TENANT_TABLES)) {
      if (tableName === DATA_STUDIO_COLUMN_STATS_TABLE_NAME) {
        expect(getGuardianAnchorRequirements(schema)).toEqual([]);
        expect(getGuardianTableReferences(schema)).toEqual([]);
        expect(inspectGuardianReferenceSchema(schema)).toEqual([]);
        continue;
      }
      expect(getGuardianAnchorRequirements(schema)).toEqual(['user', 'membership']);
      expect(getGuardianTableReferences(schema).length).toBeGreaterThanOrEqual(2);
      expect(inspectGuardianReferenceSchema(schema)).toEqual([]);
    }

    const realm = defineDatabaseRealm({
      name: 'data-studio-test',
      version: '1',
      tables: DATA_STUDIO_TENANT_TABLES,
    });
    expect(realm.guardianAnchorRequirements).toEqual(['user', 'membership']);
    expect(realm.tables[DATA_STUDIO_ROWS_TABLE_NAME]?._identity).toEqual([
      'table_id',
      'row_id',
    ]);
    expect(realm.tables[DATA_STUDIO_CELLS_TABLE_NAME]?._identity).toEqual([
      'row_record_id',
      'column_id',
    ]);
    expect(realm.tables[DATA_STUDIO_COLUMN_STATS_TABLE_NAME]?._identity).toEqual([
      'table_id',
      'column_id',
    ]);
  });

  test('opens with foreign keys and persists a fully linked logical row', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.defineTable('users', { user_id: 'text primary key' });
      db.defineTable('tenant_memberships', {
        membership_id: 'text primary key',
        user_id: 'text references users(user_id) on delete restrict not null',
      });
      db.defineTable(DATA_STUDIO_TABLES_TABLE_NAME, DATA_STUDIO_TABLES_SCHEMA);
      db.defineTable(DATA_STUDIO_ROWS_TABLE_NAME, DATA_STUDIO_ROWS_SCHEMA);
      db.defineTable(
        DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME,
        DATA_STUDIO_SCHEMA_VERSIONS_SCHEMA,
      );
      db.defineTable(DATA_STUDIO_CELLS_TABLE_NAME, DATA_STUDIO_CELLS_SCHEMA);
      db.defineTable(
        DATA_STUDIO_COLUMN_STATS_TABLE_NAME,
        DATA_STUDIO_COLUMN_STATS_SCHEMA,
      );

      expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });
      expect(identityIndexColumns(db, 'idx_data_studio_rows_identity')).toEqual([
        'table_id',
        'row_id',
      ]);
      expect(identityIndexColumns(db, 'idx__data_studio_cells_identity')).toEqual([
        'row_record_id',
        'column_id',
      ]);

      db.insert('users', { user_id: 'usr_1' });
      db.insert('tenant_memberships', {
        membership_id: 'mem_1',
        user_id: 'usr_1',
      });
      const schemaJson = serializeDataStudioSchema({
        version: 1,
        columns: [{
          columnId: 'col_title',
          key: 'title',
          label: 'Title',
          type: 'text',
          required: true,
        }],
      });
      db.insert(DATA_STUDIO_TABLES_TABLE_NAME, {
        table_id: 'tbl_1',
        key: 'projects',
        name: 'Projects',
        description: null,
        status: 'active',
        schema_json: schemaJson,
        schema_revision: 1,
        revision: 1,
        row_count: 1,
        created_by_user_id: 'usr_1',
        created_by_membership_id: 'mem_1',
        updated_by_user_id: 'usr_1',
        updated_by_membership_id: 'mem_1',
        created_at: 1,
        updated_at: 1,
        archived_at: null,
      });
      db.insert(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME, {
        table_id: 'tbl_1',
        schema_revision: 1,
        schema_json: schemaJson,
        created_by_user_id: 'usr_1',
        created_by_membership_id: 'mem_1',
        created_at: 1,
      });
      db.insert(DATA_STUDIO_ROWS_TABLE_NAME, {
        table_id: 'tbl_1',
        row_id: 'row_1',
        schema_revision: 1,
        values_json: '{"col_title":"First"}',
        revision: 1,
        created_by_user_id: 'usr_1',
        created_by_membership_id: 'mem_1',
        updated_by_user_id: 'usr_1',
        updated_by_membership_id: 'mem_1',
        created_at: 1,
        updated_at: 1,
      });
      const storedRow = db.queryByIdentity(DATA_STUDIO_ROWS_TABLE_NAME, {
        table_id: 'tbl_1',
        row_id: 'row_1',
      });
      expect(storedRow).not.toBeNull();
      const rowRecordId = storedRow!.record_id as string;
      db.insert(DATA_STUDIO_CELLS_TABLE_NAME, {
        row_record_id: rowRecordId,
        column_id: 'col_title',
        value_json: '"First"',
        value_type: 'text',
        text_value: 'First',
        number_value: null,
        boolean_value: null,
        updated_by_user_id: 'usr_1',
        updated_by_membership_id: 'mem_1',
        updated_at: 1,
      });
      db.insert(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, {
        table_id: 'tbl_1',
        column_id: 'col_title',
        value_count: 1,
        non_null_count: 1,
        updated_at: 1,
      });

      expect(db.list(DATA_STUDIO_ROWS_TABLE_NAME)).toHaveLength(1);
      expect(db.list(DATA_STUDIO_CELLS_TABLE_NAME)).toHaveLength(1);
      expect(db.list(DATA_STUDIO_COLUMN_STATS_TABLE_NAME)).toHaveLength(1);
      expect(() => db.insert(DATA_STUDIO_CELLS_TABLE_NAME, {
        row_record_id: 'missing',
        column_id: 'col_title',
        value_json: '"Orphan"',
        value_type: 'text',
        text_value: 'Orphan',
        number_value: null,
        boolean_value: null,
        updated_by_user_id: 'usr_1',
        updated_by_membership_id: 'mem_1',
        updated_at: 1,
      })).toThrow();
      expect(() => db.insert(DATA_STUDIO_CELLS_TABLE_NAME, {
        row_record_id: rowRecordId,
        column_id: 'col_invalid',
        value_json: '1',
        value_type: 'number',
        text_value: 'misaligned',
        number_value: 1,
        boolean_value: null,
        updated_by_user_id: 'usr_1',
        updated_by_membership_id: 'mem_1',
        updated_at: 1,
      })).toThrow();
    } finally {
      db.dispose();
    }
  });
});

function identityIndexColumns(
  db: ReturnType<typeof createReactiveDB>,
  index: string,
): string[] {
  return (db.prepare(`PRAGMA index_info("${index}")`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}
