/** Add permanent idempotency receipts for privileged Torrent event delivery. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '036',
  description: 'Torrent idempotent system event delivery receipts',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // Keep the numbered definition self-contained and immutable. Runtime
    // schema helpers may evolve after this migration has been released.
    db.exec(`CREATE TABLE IF NOT EXISTS _workflow_system_event_receipts (
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('application','tenant')),
      scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 256),
      tenant_id TEXT,
      principal TEXT NOT NULL CHECK (length(principal) BETWEEN 1 AND 120),
      idempotency_key TEXT NOT NULL
        CHECK (length(idempotency_key) BETWEEN 1 AND 128
          AND substr(idempotency_key, 1, 1) GLOB '[A-Za-z0-9]'
          AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'),
      command_version INTEGER NOT NULL DEFAULT 1
        CHECK (command_version = 1),
      command_fingerprint TEXT NOT NULL
        CHECK (length(command_fingerprint) = 64
          AND command_fingerprint NOT GLOB '*[^a-f0-9]*'),
      target_kind TEXT NOT NULL DEFAULT 'instance'
        CHECK (target_kind = 'instance'),
      target_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      instance_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (scope_kind, scope_id, principal, idempotency_key),
      FOREIGN KEY (event_id) REFERENCES workflow_events(event_id),
      CHECK (target_id = instance_id),
      CHECK (
        (scope_kind = 'application' AND scope_id = 'application' AND tenant_id IS NULL)
        OR (scope_kind = 'tenant' AND tenant_id IS NOT NULL AND scope_id = tenant_id)
      )
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_system_event_receipts_instance
      ON _workflow_system_event_receipts(instance_id, created_at, event_id)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_system_event_receipt_parent_insert
      BEFORE INSERT ON _workflow_system_event_receipts
      WHEN NOT EXISTS (
        SELECT 1
        FROM workflow_events AS event
        INNER JOIN _workflow_event_delivery AS delivery
          ON delivery.event_id = event.event_id
          AND delivery.instance_id = event.instance_id
          AND delivery.event_name = event.event_name
        INNER JOIN _workflow_event_authorities AS authority
          ON authority.event_id = event.event_id
        WHERE event.event_id = NEW.event_id
          AND event.instance_id = NEW.instance_id
          AND event.event_name = NEW.event_name
          AND event.tenant_id IS NEW.tenant_id
          AND delivery.authority_kind = 'system'
      )
      BEGIN
        SELECT RAISE(ABORT, 'workflow system event receipt parent is invalid');
      END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_system_event_receipt_immutable
      BEFORE UPDATE ON _workflow_system_event_receipts
      BEGIN SELECT RAISE(ABORT, 'workflow system event receipt is immutable'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_system_event_receipt_delete_forbidden
      BEFORE DELETE ON _workflow_system_event_receipts
      BEGIN SELECT RAISE(ABORT, 'workflow system event receipt is immutable'); END`);
  },

  down(db: Database) {
    db.exec('DROP TRIGGER IF EXISTS trg_workflow_system_event_receipt_delete_forbidden');
    db.exec('DROP TRIGGER IF EXISTS trg_workflow_system_event_receipt_immutable');
    db.exec('DROP TRIGGER IF EXISTS trg_workflow_system_event_receipt_parent_insert');
    db.exec('DROP INDEX IF EXISTS idx_workflow_system_event_receipts_instance');
    db.exec('DROP TABLE IF EXISTS _workflow_system_event_receipts');
  },
};
