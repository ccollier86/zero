/** Private permanent system-start receipt DDL; no workflow execution or request handling. */
import type { ReactiveDB } from '../sync/reactive-db';

/** Install the immutable receipt ledger for standalone and managed Torrent runtimes. */
export function ensureWorkflowSystemStartReceiptSchema(db: Pick<ReactiveDB, 'exec'>): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_system_start_receipts (
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('application','tenant')),
    scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 256),
    tenant_id TEXT,
    principal TEXT NOT NULL CHECK (length(principal) BETWEEN 1 AND 120),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128
      AND substr(idempotency_key,1,1) GLOB '[A-Za-z0-9]' AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'),
    command_version INTEGER NOT NULL DEFAULT 1 CHECK (command_version = 1),
    request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64 AND request_fingerprint NOT GLOB '*[^a-f0-9]*'),
    command_fingerprint TEXT NOT NULL CHECK (length(command_fingerprint) = 64 AND command_fingerprint NOT GLOB '*[^a-f0-9]*'),
    instance_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    definition_version INTEGER,
    created_at TEXT NOT NULL,
    authority_json TEXT NOT NULL,
    authority_mac TEXT NOT NULL,
    PRIMARY KEY (scope_kind, scope_id, principal, idempotency_key),
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id),
    CHECK ((scope_kind = 'application' AND scope_id = 'application' AND tenant_id IS NULL)
      OR (scope_kind = 'tenant' AND tenant_id IS NOT NULL AND scope_id = tenant_id))
  )`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_system_start_receipt_parent_insert
    BEFORE INSERT ON _workflow_system_start_receipts
    WHEN NOT EXISTS (SELECT 1 FROM workflow_instances AS instance
      INNER JOIN _workflow_execution_authorities AS authority ON authority.instance_id = instance.instance_id
      WHERE instance.instance_id = NEW.instance_id AND instance.tenant_id IS NEW.tenant_id
        AND instance.name = NEW.name AND instance.created_at = NEW.created_at
        AND instance.definition_version IS NEW.definition_version AND authority.authority_kind = 'system'
        AND authority.tenant_id IS NEW.tenant_id)
    BEGIN SELECT RAISE(ABORT, 'workflow system start receipt parent is invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_system_start_receipt_immutable
    BEFORE UPDATE ON _workflow_system_start_receipts
    BEGIN SELECT RAISE(ABORT, 'workflow system start receipt is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_system_start_receipt_delete_forbidden
    BEFORE DELETE ON _workflow_system_start_receipts
    BEGIN SELECT RAISE(ABORT, 'workflow system start receipt is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_system_start_receipt_parent_delete
    BEFORE DELETE ON workflow_instances
    WHEN EXISTS (SELECT 1 FROM _workflow_system_start_receipts WHERE instance_id = OLD.instance_id)
    BEGIN SELECT RAISE(ABORT, 'workflow system start receipt parent is immutable'); END`);
}
