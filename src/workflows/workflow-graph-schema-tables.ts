/**
 * workflow-graph-schema-tables.ts
 *
 * Owns idempotent SQLite table and index creation for the versioned workflow
 * graph runtime. It does not repair legacy columns or enforce upgrade policy.
 */

import { MAX_WORKFLOW_DEFINITION_NAME_LENGTH } from './workflow-definition-identifiers';
import type { WorkflowSchemaDatabase } from './workflow-graph-schema-database';

/** Create the public workflow projection tables when they do not exist. */
export function createCompatiblePublicTables(db: WorkflowSchemaDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_definitions (
    definition_id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (
      name = trim(name) AND length(name) BETWEEN 1 AND ${MAX_WORKFLOW_DEFINITION_NAME_LENGTH}
    ),
    version INTEGER NOT NULL DEFAULT 1
      CHECK (typeof(version) = 'integer' AND version >= 0),
    steps_json TEXT NOT NULL,
    input_schema TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    active_version_id TEXT,
    source TEXT NOT NULL DEFAULT 'code' CHECK (source IN ('code','database')),
    scope_type TEXT NOT NULL DEFAULT 'application'
      CHECK (scope_type IN ('application','tenant')),
    scope_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
    access_policy_json TEXT,
    created_by TEXT,
    updated_by TEXT,
    CHECK (
      (scope_type = 'application' AND scope_id = '')
      OR (scope_type = 'tenant' AND scope_id = trim(scope_id)
        AND length(scope_id) BETWEEN 1 AND 256)
    ),
    CHECK (source <> 'code' OR scope_type = 'application')
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_instances (
    instance_id TEXT PRIMARY KEY, tenant_id TEXT, definition_id TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', current_step INTEGER NOT NULL DEFAULT 0,
    input TEXT, output TEXT, error TEXT, started_by TEXT, steps_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
    definition_version_id TEXT, definition_version INTEGER, graph_json TEXT,
    graph_fingerprint TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_steps (
    step_id TEXT PRIMARY KEY, tenant_id TEXT, instance_id TEXT NOT NULL, step_index INTEGER NOT NULL,
    step_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', input TEXT,
    output TEXT, error TEXT, retries INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3, retry_at TEXT, wait_event TEXT,
    timeout_at TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL,
    node_id TEXT, node_kind TEXT, node_path TEXT, parent_step_id TEXT,
    branch_key TEXT, item_key TEXT, item_index INTEGER, activation_key TEXT,
    updated_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_events (
    event_id TEXT PRIMARY KEY, tenant_id TEXT, instance_id TEXT NOT NULL, event_name TEXT NOT NULL,
    payload TEXT, sent_by TEXT, created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_interactions (
    interaction_id TEXT PRIMARY KEY,
    tenant_id TEXT,
    instance_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    step_id TEXT,
    safe_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open','accepted','expired','cancelled','rejection_limit')),
    opened_at TEXT NOT NULL,
    expires_at TEXT,
    accepted_at TEXT,
    accepted_by TEXT,
    rejection_count INTEGER NOT NULL DEFAULT 0 CHECK (rejection_count >= 0),
    max_rejections INTEGER NOT NULL DEFAULT 3 CHECK (max_rejections >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id)
  )`);
}

/** Create immutable definition-version and private draft tables. */
export function createVersionTables(db: WorkflowSchemaDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_definition_versions (
    version_id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    source TEXT NOT NULL CHECK (source IN ('code','database')),
    graph_format TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 0),
    graph_json TEXT NOT NULL,
    input_schema_json TEXT,
    access_policy_json TEXT,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published'
      CHECK (status IN ('published','retired')),
    created_by TEXT,
    created_at TEXT NOT NULL,
    retired_by TEXT,
    retired_at TEXT,
    CHECK (
      (status = 'published' AND retired_by IS NULL AND retired_at IS NULL)
      OR (status = 'retired' AND retired_at IS NOT NULL)
    ),
    FOREIGN KEY (definition_id) REFERENCES workflow_definitions(definition_id),
    UNIQUE (definition_id, version_number),
    UNIQUE (definition_id, fingerprint)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_definition_drafts (
    draft_id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL,
    base_version_id TEXT,
    source TEXT NOT NULL CHECK (source IN ('code','database')),
    graph_format TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 0),
    graph_json TEXT NOT NULL,
    input_schema_json TEXT,
    access_policy_json TEXT,
    fingerprint TEXT NOT NULL,
    editor_metadata_json TEXT,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (definition_id) REFERENCES workflow_definitions(definition_id),
    FOREIGN KEY (base_version_id) REFERENCES workflow_definition_versions(version_id)
  )`);
}

/** Create private topology, decision, and fan-out runtime tables. */
export function createGraphRuntimeTables(db: WorkflowSchemaDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_graph_edges (
    edge_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    from_node_id TEXT,
    to_node_id TEXT NOT NULL,
    edge_kind TEXT NOT NULL,
    branch_key TEXT,
    condition_json TEXT,
    ordinal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_decisions (
    decision_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    activation_key TEXT NOT NULL DEFAULT '',
    selected_edge_id TEXT,
    selected_branch TEXT,
    decision_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id),
    FOREIGN KEY (selected_edge_id) REFERENCES _workflow_graph_edges(edge_id),
    UNIQUE (instance_id, node_id, activation_key)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_each_items (
    item_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    parent_step_id TEXT,
    node_id TEXT NOT NULL,
    activation_key TEXT NOT NULL DEFAULT '',
    item_key TEXT NOT NULL,
    item_index INTEGER NOT NULL CHECK (item_index >= 0),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','running','completed','failed','skipped','cancelled')),
    input_json TEXT NOT NULL,
    output_json TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id),
    FOREIGN KEY (parent_step_id) REFERENCES workflow_steps(step_id),
    UNIQUE (instance_id, node_id, activation_key, item_key)
  )`);
}

/** Create private scratch-memory and interaction-detail tables. */
export function createMemoryAndInteractionTables(db: WorkflowSchemaDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_memory_policies (
    instance_id TEXT PRIMARY KEY,
    max_key_bytes INTEGER NOT NULL CHECK (max_key_bytes BETWEEN 1 AND 1024),
    max_value_bytes INTEGER NOT NULL CHECK (max_value_bytes BETWEEN 1 AND 1048576),
    max_entries INTEGER NOT NULL CHECK (max_entries BETWEEN 1 AND 4096),
    max_total_bytes INTEGER NOT NULL CHECK (max_total_bytes BETWEEN 1 AND 16777216),
    CHECK (max_value_bytes <= max_total_bytes),
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_memory (
    memory_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('instance','each-item')),
    scope_id TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    updated_by_step_id TEXT,
    updated_by_attempt_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id),
    UNIQUE (instance_id, scope_kind, scope_id, key)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_interaction_details (
    interaction_id TEXT PRIMARY KEY,
    responder_policy_json TEXT,
    response_schema_json TEXT NOT NULL,
    request_json TEXT,
    validator_activity_id TEXT,
    accepted_response_id TEXT,
    response_count INTEGER NOT NULL DEFAULT 0,
    response_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (interaction_id) REFERENCES workflow_interactions(interaction_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS _workflow_interaction_responses (
    response_id TEXT PRIMARY KEY,
    interaction_id TEXT NOT NULL,
    submission_id TEXT NOT NULL,
    actor_id TEXT,
    channel TEXT,
    payload_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    accepted_value_json TEXT,
    status TEXT NOT NULL DEFAULT 'processing'
      CHECK (status IN ('processing','rejected','accepted','superseded')),
    rejection_code TEXT,
    public_message TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    origin TEXT NOT NULL DEFAULT 'external'
      CHECK (origin IN ('external','event')),
    event_id TEXT,
    FOREIGN KEY (interaction_id) REFERENCES workflow_interactions(interaction_id),
    FOREIGN KEY (event_id) REFERENCES workflow_events(event_id),
    CHECK ((origin = 'external' AND event_id IS NULL)
      OR (origin = 'event' AND event_id IS NOT NULL)),
    UNIQUE (interaction_id, submission_id)
  )`);
}

/** Install idempotent lookup and identity indexes after additive columns exist. */
export function createWorkflowGraphIndexes(db: WorkflowSchemaDatabase): void {
  const statements = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_definitions_scope_name ON workflow_definitions(scope_type, scope_id, name)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_definition_versions_definition ON workflow_definition_versions(definition_id, version_number DESC)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_definition_versions_status ON workflow_definition_versions(definition_id, status, version_number DESC)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_definition_drafts_definition ON _workflow_definition_drafts(definition_id, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_instances_definition_version ON workflow_instances(definition_version_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant ON workflow_instances(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_steps_tenant_instance ON workflow_steps(tenant_id, instance_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_events_tenant_instance ON workflow_events(tenant_id, instance_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_interactions_tenant_instance ON workflow_interactions(tenant_id, instance_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_steps_node ON workflow_steps(instance_id, node_id, activation_key)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_graph_edges_from ON _workflow_graph_edges(instance_id, from_node_id, ordinal)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_each_items_status ON _workflow_each_items(instance_id, node_id, activation_key, status, item_index)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_memory_policy_instance ON _workflow_memory_policies(instance_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_memory_scope ON _workflow_memory(instance_id, scope_kind, scope_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_interactions_instance_status ON workflow_interactions(instance_id, status, opened_at)',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_interactions_identity
      ON workflow_interactions(instance_id, step_id)`,
    'CREATE INDEX IF NOT EXISTS idx_workflow_interactions_expiry ON workflow_interactions(status, expires_at) WHERE expires_at IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_workflow_interaction_responses_interaction ON _workflow_interaction_responses(interaction_id, created_at)',
  ];
  for (const statement of statements) db.exec(statement);
}
