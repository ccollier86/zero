/** Permanent MAC-sealed actor starts and bounded receipt accounting. Self-contained immutable DDL. */
import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '044', description: 'Torrent actor-preserving idempotent start receipts', safety: 'safe', backupRequired: false,
  up(db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS _workflow_actor_start_usage (
      scope_kind TEXT NOT NULL CHECK(scope_kind IN ('application','tenant')),
      scope_id TEXT NOT NULL,
      principal TEXT NOT NULL,
      receipt_count INTEGER NOT NULL CHECK(typeof(receipt_count) = 'integer' AND receipt_count BETWEEN 0 AND 100000),
      PRIMARY KEY(scope_kind, scope_id, principal)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS _workflow_actor_start_receipts (
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('application','tenant')),
      scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 256), tenant_id TEXT,
      principal TEXT NOT NULL CHECK (length(principal) BETWEEN 1 AND 120),
      idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128
        AND substr(idempotency_key,1,1) GLOB '[A-Za-z0-9]' AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'),
      command_version INTEGER NOT NULL DEFAULT 1 CHECK (command_version = 1),
      request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64 AND request_fingerprint NOT GLOB '*[^a-f0-9]*'),
      command_fingerprint TEXT NOT NULL CHECK (length(command_fingerprint) = 64 AND command_fingerprint NOT GLOB '*[^a-f0-9]*'),
      instance_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, definition_version INTEGER, created_at TEXT NOT NULL,
      authority_json TEXT NOT NULL, authority_mac TEXT NOT NULL,
      PRIMARY KEY (scope_kind, scope_id, principal, idempotency_key),
      FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id),
      CHECK ((scope_kind = 'application' AND scope_id = 'application' AND tenant_id IS NULL)
        OR (scope_kind = 'tenant' AND tenant_id IS NOT NULL AND scope_id = tenant_id))
    )`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_actor_start_receipt_parent_insert BEFORE INSERT ON _workflow_actor_start_receipts
      WHEN NOT EXISTS (SELECT 1 FROM workflow_instances AS instance
        INNER JOIN _workflow_execution_authorities AS authority ON authority.instance_id = instance.instance_id
        WHERE instance.instance_id = NEW.instance_id AND instance.tenant_id IS NEW.tenant_id
          AND instance.name = NEW.name AND instance.created_at = NEW.created_at
          AND instance.definition_version IS NEW.definition_version AND authority.authority_kind = 'actor'
          AND instance.started_by = authority.actor_user_id AND authority.tenant_id IS NEW.tenant_id)
      BEGIN SELECT RAISE(ABORT, 'workflow actor start receipt parent is invalid'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_actor_start_receipt_immutable BEFORE UPDATE ON _workflow_actor_start_receipts
      BEGIN SELECT RAISE(ABORT, 'workflow actor start receipt is immutable'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_actor_start_receipt_delete_forbidden BEFORE DELETE ON _workflow_actor_start_receipts
      BEGIN SELECT RAISE(ABORT, 'workflow actor start receipt is immutable'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_actor_start_receipt_parent_delete BEFORE DELETE ON workflow_instances
      WHEN EXISTS (SELECT 1 FROM _workflow_actor_start_receipts WHERE instance_id = OLD.instance_id)
      BEGIN SELECT RAISE(ABORT, 'workflow actor start receipt parent is immutable'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_actor_start_usage_insert AFTER INSERT ON _workflow_actor_start_receipts
      BEGIN INSERT INTO _workflow_actor_start_usage(scope_kind, scope_id, principal, receipt_count)
        VALUES(NEW.scope_kind, NEW.scope_id, NEW.principal, 1)
        ON CONFLICT(scope_kind, scope_id, principal) DO UPDATE SET receipt_count = receipt_count + 1; END`);
  },
  down(db: Database) {
    if ((db.query('SELECT COUNT(*) AS n FROM _workflow_actor_start_receipts').get() as { n: number }).n) {
      throw new Error('Cannot discard permanent actor start receipts');
    }
    for (const trigger of ['usage_insert', 'receipt_parent_delete', 'receipt_delete_forbidden', 'receipt_immutable', 'receipt_parent_insert']) {
      db.exec(`DROP TRIGGER IF EXISTS trg_workflow_actor_start_${trigger}`);
    }
    db.exec('DROP TABLE _workflow_actor_start_receipts'); db.exec('DROP TABLE _workflow_actor_start_usage');
  },
};
