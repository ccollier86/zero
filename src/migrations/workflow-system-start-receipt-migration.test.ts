/** Upgrade parity and private immutable schema checks for system-start receipts. */
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrations } from './index';
import { Migrator } from './migrator';
import { ensureWorkflowSystemStartReceiptSchema } from '../workflows/workflow-system-start-receipt-schema';

describe('Torrent system-start receipt migration 038', () => {
  test('upgrades 037 with exactly the same immutable receipt schema as runtime startup', () => {
    const db = new Database(':memory:');
    const prior = new Migrator({ database: db, dbPath: ':memory:', migrations: migrations.filter(entry => entry.version <= '037'), createBackups: false, log: () => {} });
    try {
      prior.run(); prior.dispose();
      const current = new Migrator({ database: db, dbPath: ':memory:', migrations: migrations.filter(entry => entry.version <= '038'), createBackups: false, log: () => {} });
      try {
        expect(current.run()).toEqual(['038']);
        const migrated = schema(db);
        expect(migrated).toHaveLength(4);
        db.exec('DROP TRIGGER trg_workflow_system_start_receipt_immutable');
        db.exec('DROP TRIGGER trg_workflow_system_start_receipt_delete_forbidden');
        db.exec('DROP TRIGGER trg_workflow_system_start_receipt_parent_insert');
        db.exec('DROP TRIGGER trg_workflow_system_start_receipt_parent_delete');
        db.exec('DROP TABLE _workflow_system_start_receipts');
        ensureWorkflowSystemStartReceiptSchema(db);
        expect(schema(db)).toEqual(migrated);
        expect(() => db.query(`INSERT INTO _workflow_system_start_receipts (
          scope_kind, scope_id, tenant_id, principal, idempotency_key, request_fingerprint,
          command_fingerprint, instance_id, name, created_at, authority_json, authority_mac
        ) VALUES ('application','application',NULL,'test','effect:missing',?,?,
          'missing','missing',?,'{}','invalid')`).run('0'.repeat(64), '0'.repeat(64), new Date().toISOString())).toThrow('receipt parent is invalid');
      } finally { current.dispose(); }
    } finally { db.close(); }
  });
});

function schema(db: Database): Array<{ name: string; sql: string }> {
  return (db.query(`SELECT name, sql FROM sqlite_master WHERE tbl_name = '_workflow_system_start_receipts'
    AND sql IS NOT NULL ORDER BY name`).all() as Array<{ name: string; sql: string }>)
    .map(row => ({ name: row.name, sql: row.sql.replace(/\s+/gu, ' ').trim() }));
}
