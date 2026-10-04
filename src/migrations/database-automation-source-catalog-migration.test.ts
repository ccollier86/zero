import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import {
  assertDatabaseAutomationSourceCatalogSchema,
} from '../database-automations/automation-source-catalog-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';

describe('ReactiveDB automation source catalog migration 037', () => {
  test('upgrades a system database through 036 with the sealed recovery catalog', () => {
    const database = new Database(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    const released = new Migrator({
      database,
      dbPath: ':memory:',
      migrations: migrations.filter((entry) => entry.version <= '036'),
      createBackups: false,
      log: () => {},
    });

    try {
      released.run();
      released.dispose();
      const current = new Migrator({
        database,
        dbPath: ':memory:',
        migrations,
        createBackups: false,
        log: () => {},
      });
      try {
        expect(current.run()).toEqual(['037']);
        expect(columnNames(database, '_zero_database_automation_sources_v1'))
          .toEqual([
            'source_ref',
            'source_kind',
            'logical_source_id',
            'scope_kind',
            'scope_id',
            'tenant_id',
            'lifecycle_status',
            'source_revision',
            'insertion_ordinal',
            'registered_at',
            'updated_at',
            'schema_version',
          ]);
        expect(schemaObjectNames(
          database,
          '_zero_database_automation_sources_v1',
        )).toEqual([
          '_zero_database_automation_sources_delete_guard_v1',
          '_zero_database_automation_sources_insert_guard_v1',
          '_zero_database_automation_sources_insert_state_v1',
          '_zero_database_automation_sources_logical_v1',
          '_zero_database_automation_sources_scan_v1',
          '_zero_database_automation_sources_update_guard_v1',
          '_zero_database_automation_sources_update_state_v1',
        ]);
        expect(schemaObjectNames(
          database,
          '_zero_database_automation_source_catalog_state_v1',
        )).toEqual([
          '_zero_database_automation_source_state_delete_guard_v1',
          '_zero_database_automation_source_state_update_guard_v1',
        ]);

        database.prepare(`INSERT INTO _zero_database_automation_sources_v1 (
          source_ref, source_kind, logical_source_id,
          scope_kind, scope_id, tenant_id, lifecycle_status,
          source_revision, insertion_ordinal, registered_at, updated_at,
          schema_version
        ) VALUES (?, 'application', 'application', 'application',
          'application', NULL, 'active', 1, 1, 10, 10, 1)`)
          .run('a'.repeat(64));
        expect(database.query(`
          SELECT total_sources, last_ordinal, catalog_revision
          FROM _zero_database_automation_source_catalog_state_v1
        `).get()).toEqual({
          total_sources: 1,
          last_ordinal: 1,
          catalog_revision: 1,
        });
        expect(() => database.prepare(`
          UPDATE _zero_database_automation_sources_v1
          SET scope_id = 'other'
          WHERE source_ref = ?
        `).run('a'.repeat(64))).toThrow(/identity is immutable/u);
      } finally {
        current.dispose();
      }

      const reactive = createReactiveDB({ database });
      try {
        assertDatabaseAutomationSourceCatalogSchema(reactive);
      } finally {
        reactive.dispose();
      }
    } finally {
      database.close();
    }
  }, 60_000);
});

function columnNames(database: Database, table: string): string[] {
  return (database.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>).map((column) => column.name);
}

function schemaObjectNames(database: Database, table: string): string[] {
  return (database.query(`SELECT name FROM sqlite_master
    WHERE tbl_name = ? AND type IN ('index','trigger') AND sql IS NOT NULL
    ORDER BY name`).all(table) as Array<{ name: string }>).map((row) => row.name);
}
