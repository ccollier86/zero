/** Private SQLite schema owned by workflow execution authority. */

import type { ReactiveDB } from '../sync/reactive-db';

/** Define private execution authority and in-flight lease tables. */
export function defineWorkflowExecutionAuthorityTables(
  db: Pick<ReactiveDB, 'exec'>,
): void {
  // Standalone WorkflowService tests/embedders may not mount AuthRuntime, but
  // use the same canonical private config table shape when they do.
  db.exec(`CREATE TABLE IF NOT EXISTS _auth_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _workflow_execution_authorities (
      instance_id         TEXT PRIMARY KEY,
      authority_kind      TEXT NOT NULL,
      tenant_id           TEXT,
      actor_user_id       TEXT,
      authority_json      TEXT NOT NULL,
      authority_mac       TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'active',
      validation_count    INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL,
      last_validated_at   INTEGER,
      invalidated_at      INTEGER,
      invalidation_reason TEXT,
      CHECK (authority_kind IN ('actor', 'system')),
      CHECK (status IN ('active', 'invalid'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_authority_tenant_actor
    ON _workflow_execution_authorities(tenant_id, actor_user_id)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _workflow_step_executions (
      step_id      TEXT PRIMARY KEY,
      instance_id  TEXT NOT NULL,
      execution_id TEXT NOT NULL UNIQUE,
      created_at   INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_instance
    ON _workflow_step_executions(instance_id)`);
}
