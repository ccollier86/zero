/**
 * Runtime schema registration for durable workflows.
 *
 * Migrations create the durable tables for managed applications. The workflow
 * plugin still registers them with ReactiveDB so workflow writes participate in
 * the normal change stream and standalone plugin composition remains complete.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { ensureWorkflowGraphSchema } from './workflow-graph-schema';
import { ensureWorkflowRuntimeSchema } from './workflow-runtime-schema';

/** Register workflow tables and their lookup indexes with ReactiveDB. */
export function defineWorkflowTables(db: ReactiveDB): void {
  // Raw additive DDL must run first: defineTable prepares statements for every
  // declared column and legacy databases may not have graph columns yet.
  ensureWorkflowGraphSchema(db);
  ensureWorkflowRuntimeSchema(db);

  db.defineTable('workflow_definitions', {
    definition_id: 'text primary key',
    name: 'text unique not null',
    version: 'integer not null default 1',
    steps_json: 'text not null',
    input_schema: 'text',
    created_at: 'text not null',
    updated_at: 'text not null',
    active_version_id: 'text',
    source: "text not null default 'code'",
    scope_type: "text not null default 'application'",
    scope_id: "text not null default ''",
    status: "text not null default 'active'",
    access_policy_json: 'text',
    created_by: 'text',
    updated_by: 'text',
  });

  db.defineTable('workflow_instances', {
    instance_id: 'text primary key',
    definition_id: 'text not null',
    name: 'text not null',
    status: "text not null default 'pending'",
    current_step: 'integer not null default 0',
    input: 'text',
    output: 'text',
    error: 'text',
    started_by: 'text',
    steps_json: 'text',
    created_at: 'text not null',
    updated_at: 'text not null',
    completed_at: 'text',
    definition_version_id: 'text',
    definition_version: 'integer',
    graph_json: 'text',
    graph_fingerprint: 'text',
  });

  db.defineTable('workflow_steps', {
    step_id: 'text primary key',
    instance_id: 'text not null',
    step_index: 'integer not null',
    step_name: 'text not null',
    status: "text not null default 'pending'",
    input: 'text',
    output: 'text',
    error: 'text',
    retries: 'integer not null default 0',
    max_retries: 'integer not null default 3',
    retry_at: 'text',
    wait_event: 'text',
    timeout_at: 'text',
    started_at: 'text',
    completed_at: 'text',
    created_at: 'text not null',
    node_id: 'text',
    node_kind: 'text',
    node_path: 'text',
    parent_step_id: 'text',
    branch_key: 'text',
    item_key: 'text',
    item_index: 'integer',
    activation_key: 'text',
    updated_at: 'text',
  });

  db.defineTable('workflow_events', {
    event_id: 'text primary key',
    instance_id: 'text not null',
    event_name: 'text not null',
    payload: 'text',
    sent_by: 'text',
    created_at: 'text not null',
  });

  // This is the safe, owner-scoped projection used by ReactiveDB clients.
  // Response payloads and validation policy remain in underscore tables.
  db.defineTable('workflow_interactions', {
    interaction_id: 'text primary key',
    instance_id: 'text not null',
    node_id: 'text not null',
    step_id: 'text',
    safe_label: 'text not null',
    status: "text not null default 'open'",
    opened_at: 'text not null',
    expires_at: 'text',
    accepted_at: 'text',
    accepted_by: 'text',
    rejection_count: 'integer not null default 0',
    max_rejections: 'integer not null default 3',
    created_at: 'text not null',
    updated_at: 'text not null',
    _identity: ['instance_id', 'step_id'],
  });

  // Scratch memory participates in the same ReactiveDB transaction as public
  // step completion, while the underscore prefix keeps values off Sync.
  db.defineTable('_workflow_memory', {
    memory_id: 'text primary key',
    instance_id: 'text not null',
    scope_kind: 'text not null',
    scope_id: "text not null default ''",
    key: 'text not null',
    value_json: 'text not null',
    version: 'integer not null',
    updated_by_step_id: 'text',
    updated_by_attempt_id: 'text',
    created_at: 'text not null',
    updated_at: 'text not null',
  });

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_instances_started_by ON workflow_instances(started_by)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_steps_instance ON workflow_steps(instance_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_events_instance ON workflow_events(instance_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances(status)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_instances_created ON workflow_instances(created_at DESC)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_steps_instance_order ON workflow_steps(instance_id, step_index)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_steps_retry_due ON workflow_steps(status, retry_at, instance_id, step_index)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_steps_timeout_due ON workflow_steps(timeout_at) WHERE timeout_at IS NOT NULL'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workflow_events_instance_created ON workflow_events(instance_id, created_at)'
  );
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_workflow_instance_owner_immutable_update
    BEFORE UPDATE OF started_by ON workflow_instances
    WHEN OLD.started_by IS NOT NEW.started_by
    BEGIN
      SELECT RAISE(ABORT, 'workflow instance ownership is immutable');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_workflow_instance_owner_immutable_replace
    BEFORE INSERT ON workflow_instances
    WHEN EXISTS (
      SELECT 1 FROM workflow_instances AS existing
      WHERE existing.instance_id = NEW.instance_id
        AND existing.started_by IS NOT NEW.started_by
    )
    BEGIN
      SELECT RAISE(ABORT, 'workflow instance ownership is immutable');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_workflow_step_parent_immutable_update
    BEFORE UPDATE OF instance_id ON workflow_steps
    WHEN OLD.instance_id IS NOT NEW.instance_id
    BEGIN
      SELECT RAISE(ABORT, 'workflow step parent is immutable');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_workflow_step_parent_immutable_replace
    BEFORE INSERT ON workflow_steps
    WHEN EXISTS (
      SELECT 1 FROM workflow_steps AS existing
      WHERE existing.step_id = NEW.step_id
        AND existing.instance_id IS NOT NEW.instance_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'workflow step parent is immutable');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_workflow_event_parent_immutable_update
    BEFORE UPDATE OF instance_id ON workflow_events
    WHEN OLD.instance_id IS NOT NEW.instance_id
    BEGIN
      SELECT RAISE(ABORT, 'workflow event parent is immutable');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_workflow_event_parent_immutable_replace
    BEFORE INSERT ON workflow_events
    WHEN EXISTS (
      SELECT 1 FROM workflow_events AS existing
      WHERE existing.event_id = NEW.event_id
        AND existing.instance_id IS NOT NEW.instance_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'workflow event parent is immutable');
    END
  `);
}
