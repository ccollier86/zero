import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { migrations } from './index';
import { Migrator } from './migrator';

describe('Torrent system-event receipt migration 036', () => {
  test('upgrades a database through 035 with the private immutable receipt ledger', () => {
    const database = new Database(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    const released = new Migrator({
      database,
      dbPath: ':memory:',
      migrations: migrations.filter((entry) => entry.version <= '035'),
      createBackups: false,
      log: () => {},
    });

    try {
      released.run();
      released.dispose();
      const current = new Migrator({
        database,
        dbPath: ':memory:',
        // Keep this migration proof stable when later system migrations are
        // added; migration 037 has its own upgrade-boundary test.
        migrations: migrations.filter((entry) => entry.version <= '036'),
        createBackups: false,
        log: () => {},
      });
      try {
        expect(current.run()).toEqual(['036']);
        expect(columnNames(database, '_workflow_system_event_receipts')).toEqual([
          'scope_kind',
          'scope_id',
          'tenant_id',
          'principal',
          'idempotency_key',
          'command_version',
          'command_fingerprint',
          'target_kind',
          'target_id',
          'event_id',
          'instance_id',
          'event_name',
          'created_at',
        ]);
        expect(schemaObjectNames(database, '_workflow_system_event_receipts')).toEqual([
          'idx_workflow_system_event_receipts_instance',
          'trg_workflow_system_event_receipt_delete_forbidden',
          'trg_workflow_system_event_receipt_immutable',
          'trg_workflow_system_event_receipt_parent_insert',
        ]);
        expect(() => database.prepare(`INSERT INTO _workflow_system_event_receipts (
          scope_kind, scope_id, tenant_id, principal, idempotency_key,
          command_fingerprint, target_id, event_id, instance_id, event_name, created_at
        ) VALUES ('application', 'application', NULL, 'test', 'delivery:test',
          ?, 'missing', 'missing', 'missing', 'continue', ?)`)
          .run('0'.repeat(64), new Date().toISOString()))
          .toThrow(/receipt parent is invalid/u);
      } finally {
        current.dispose();
      }
    } finally {
      database.close();
    }
  });
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
