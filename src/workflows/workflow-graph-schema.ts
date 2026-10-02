/**
 * workflow-graph-schema.ts
 *
 * Orchestrates additive SQLite schema installation for versioned workflow
 * graphs. Focused modules own table DDL, integrity triggers, and compatibility
 * checks; this facade preserves their startup order and public API.
 */

import { assertWorkflowGraphSchemaCompatible } from './workflow-graph-schema-compatibility';
import type { WorkflowSchemaDatabase } from './workflow-graph-schema-database';
import { createWorkflowGraphIntegrityTriggers } from './workflow-graph-schema-integrity';
import {
  createCompatiblePublicTables,
  createGraphRuntimeTables,
  createMemoryAndInteractionTables,
  createVersionTables,
  createWorkflowGraphIndexes,
} from './workflow-graph-schema-tables';

export type { WorkflowSchemaDatabase } from './workflow-graph-schema-database';
export { assertWorkflowGraphSchemaCompatible } from './workflow-graph-schema-compatibility';

const ADDITIVE_COLUMNS = {
  workflow_definitions: {
    active_version_id: 'TEXT',
    source: "TEXT NOT NULL DEFAULT 'code'",
    scope_type: "TEXT NOT NULL DEFAULT 'application'",
    scope_id: "TEXT NOT NULL DEFAULT ''",
    status: "TEXT NOT NULL DEFAULT 'active'",
    access_policy_json: 'TEXT',
    created_by: 'TEXT',
    updated_by: 'TEXT',
  },
  workflow_instances: {
    tenant_id: 'TEXT',
    definition_version_id: 'TEXT',
    definition_version: 'INTEGER',
    graph_json: 'TEXT',
    graph_fingerprint: 'TEXT',
  },
  workflow_steps: {
    tenant_id: 'TEXT',
    node_id: 'TEXT',
    node_kind: 'TEXT',
    node_path: 'TEXT',
    parent_step_id: 'TEXT',
    branch_key: 'TEXT',
    item_key: 'TEXT',
    item_index: 'INTEGER',
    activation_key: 'TEXT',
    updated_at: 'TEXT',
  },
  _workflow_interaction_responses: {
    accepted_value_json: 'TEXT',
    origin: "TEXT NOT NULL DEFAULT 'external'",
    event_id: 'TEXT',
  },
  workflow_events: {
    tenant_id: 'TEXT',
  },
  workflow_interactions: {
    tenant_id: 'TEXT',
  },
  _workflow_interaction_details: {
    request_json: 'TEXT',
    response_count: 'INTEGER NOT NULL DEFAULT 0',
    response_bytes: 'INTEGER NOT NULL DEFAULT 0',
  },
} as const;

/**
 * Create graph-runtime tables and repair additive columns on legacy schemas.
 *
 * Safe to call repeatedly from both the managed migration and standalone
 * workflow plugin startup. Existing workflow data is never dropped; newly
 * introduced derived counters are backfilled exactly once with their columns.
 */
export function ensureWorkflowGraphSchema(db: WorkflowSchemaDatabase): void {
  createCompatiblePublicTables(db);
  createVersionTables(db);
  createGraphRuntimeTables(db);
  createMemoryAndInteractionTables(db);
  let interactionCountersAdded = false;
  let interactionTenantAdded = false;
  for (const [table, columns] of Object.entries(ADDITIVE_COLUMNS)) {
    for (const [column, definition] of Object.entries(columns)) {
      const added = ensureColumn(db, table, column, definition);
      if (table === '_workflow_interaction_details'
        && (column === 'response_count' || column === 'response_bytes')) {
        interactionCountersAdded ||= added;
      }
      if (table === 'workflow_interactions' && column === 'tenant_id') {
        interactionTenantAdded ||= added;
      }
    }
  }
  if (interactionCountersAdded) backfillInteractionResponseUsage(db);
  if (interactionTenantAdded) backfillInteractionTenants(db);
  createWorkflowGraphIndexes(db);
  createWorkflowGraphIntegrityTriggers(db);
  assertWorkflowGraphSchemaCompatible(db);
}

/** Populate a newly added public tenant key from its immutable parent exactly once. */
function backfillInteractionTenants(db: WorkflowSchemaDatabase): void {
  db.exec(`UPDATE workflow_interactions SET tenant_id = (
    SELECT instance.tenant_id FROM workflow_instances AS instance
    WHERE instance.instance_id = workflow_interactions.instance_id
  )`);
}

/** Initialize newly introduced counters once; ordinary startup must never repair corruption. */
function backfillInteractionResponseUsage(db: WorkflowSchemaDatabase): void {
  db.exec(`UPDATE _workflow_interaction_details SET
    response_count = (SELECT COUNT(*) FROM _workflow_interaction_responses AS response
      WHERE response.interaction_id = _workflow_interaction_details.interaction_id),
    response_bytes = COALESCE((SELECT SUM(
      length(CAST(response.payload_json AS BLOB))
        + length(CAST(COALESCE(response.accepted_value_json, '') AS BLOB))
    ) FROM _workflow_interaction_responses AS response
      WHERE response.interaction_id = _workflow_interaction_details.interaction_id), 0)`);
}

function ensureColumn(
  db: WorkflowSchemaDatabase,
  table: string,
  column: string,
  definition: string,
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}
