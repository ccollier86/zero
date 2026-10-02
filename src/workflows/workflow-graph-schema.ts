/**
 * workflow-graph-schema.ts
 *
 * Owns additive SQLite DDL for versioned workflow graphs and their private
 * coordination state. It does not register ReactiveDB change tracking or
 * execute workflow business logic.
 */

import type { ReactiveDB } from '../sync/reactive-db';

export type WorkflowSchemaDatabase = Pick<ReactiveDB, 'exec' | 'prepare'>;

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
    definition_version_id: 'TEXT',
    definition_version: 'INTEGER',
    graph_json: 'TEXT',
    graph_fingerprint: 'TEXT',
  },
  workflow_steps: {
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
  for (const [table, columns] of Object.entries(ADDITIVE_COLUMNS)) {
    for (const [column, definition] of Object.entries(columns)) {
      const added = ensureColumn(db, table, column, definition);
      if (table === '_workflow_interaction_details'
        && (column === 'response_count' || column === 'response_bytes')) {
        interactionCountersAdded ||= added;
      }
    }
  }
  if (interactionCountersAdded) backfillInteractionResponseUsage(db);
  createIndexes(db);
  createIntegrityTriggers(db);
}

function createCompatiblePublicTables(db: WorkflowSchemaDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_definitions (
    definition_id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    steps_json TEXT NOT NULL,
    input_schema TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    active_version_id TEXT,
    source TEXT NOT NULL DEFAULT 'code',
    scope_type TEXT NOT NULL DEFAULT 'application',
    scope_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    access_policy_json TEXT,
    created_by TEXT,
    updated_by TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_instances (
    instance_id TEXT PRIMARY KEY, definition_id TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', current_step INTEGER NOT NULL DEFAULT 0,
    input TEXT, output TEXT, error TEXT, started_by TEXT, steps_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
    definition_version_id TEXT, definition_version INTEGER, graph_json TEXT,
    graph_fingerprint TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_steps (
    step_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, step_index INTEGER NOT NULL,
    step_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', input TEXT,
    output TEXT, error TEXT, retries INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3, retry_at TEXT, wait_event TEXT,
    timeout_at TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL,
    node_id TEXT, node_kind TEXT, node_path TEXT, parent_step_id TEXT,
    branch_key TEXT, item_key TEXT, item_index INTEGER, activation_key TEXT,
    updated_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_events (
    event_id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, event_name TEXT NOT NULL,
    payload TEXT, sent_by TEXT, created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_interactions (
    interaction_id TEXT PRIMARY KEY,
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
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id) ON DELETE CASCADE
  )`);
}

function createVersionTables(db: WorkflowSchemaDatabase): void {
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
    FOREIGN KEY (definition_id) REFERENCES workflow_definitions(definition_id) ON DELETE CASCADE,
    FOREIGN KEY (base_version_id) REFERENCES workflow_definition_versions(version_id)
  )`);
}

function createGraphRuntimeTables(db: WorkflowSchemaDatabase): void {
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
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id) ON DELETE CASCADE
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
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id) ON DELETE CASCADE,
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
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_step_id) REFERENCES workflow_steps(step_id),
    UNIQUE (instance_id, node_id, activation_key, item_key)
  )`);
}

function createMemoryAndInteractionTables(db: WorkflowSchemaDatabase): void {
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
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(instance_id) ON DELETE CASCADE,
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
    FOREIGN KEY (interaction_id) REFERENCES workflow_interactions(interaction_id) ON DELETE CASCADE
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
    FOREIGN KEY (interaction_id) REFERENCES workflow_interactions(interaction_id) ON DELETE CASCADE,
    UNIQUE (interaction_id, submission_id)
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

function createIndexes(db: WorkflowSchemaDatabase): void {
  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_workflow_definitions_scope_name ON workflow_definitions(scope_type, scope_id, name)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_definition_versions_definition ON workflow_definition_versions(definition_id, version_number DESC)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_definition_versions_status ON workflow_definition_versions(definition_id, status, version_number DESC)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_definition_drafts_definition ON _workflow_definition_drafts(definition_id, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_instances_definition_version ON workflow_instances(definition_version_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_steps_node ON workflow_steps(instance_id, node_id, activation_key)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_graph_edges_from ON _workflow_graph_edges(instance_id, from_node_id, ordinal)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_each_items_status ON _workflow_each_items(instance_id, node_id, activation_key, status, item_index)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_memory_scope ON _workflow_memory(instance_id, scope_kind, scope_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_interactions_instance_status ON workflow_interactions(instance_id, status, opened_at)',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_interactions_identity
      ON workflow_interactions(instance_id, step_id)`,
    'CREATE INDEX IF NOT EXISTS idx_workflow_interactions_expiry ON workflow_interactions(status, expires_at) WHERE expires_at IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_workflow_interaction_responses_interaction ON _workflow_interaction_responses(interaction_id, created_at)',
  ];
  for (const statement of statements) db.exec(statement);
}

function createIntegrityTriggers(db: WorkflowSchemaDatabase): void {
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_scope_immutable
    BEFORE UPDATE OF source, scope_type, scope_id ON workflow_definitions
    WHEN OLD.source IS NOT NEW.source OR OLD.scope_type IS NOT NEW.scope_type
      OR OLD.scope_id IS NOT NEW.scope_id
    BEGIN SELECT RAISE(ABORT, 'workflow definition ownership is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_active_version_valid
    BEFORE UPDATE OF active_version_id ON workflow_definitions
    WHEN NEW.active_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM workflow_definition_versions AS version
      WHERE version.version_id = NEW.active_version_id
        AND version.definition_id = NEW.definition_id
        AND version.status = 'published'
    )
    BEGIN SELECT RAISE(ABORT, 'workflow active version is invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_version_content_immutable
    BEFORE UPDATE OF definition_id, version_number, source, graph_format, schema_version,
      graph_json, input_schema_json, access_policy_json, fingerprint, created_by, created_at
    ON workflow_definition_versions
    BEGIN SELECT RAISE(ABORT, 'workflow definition version content is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_version_delete_forbidden
    BEFORE DELETE ON workflow_definition_versions
    BEGIN SELECT RAISE(ABORT, 'workflow definition versions are append-only'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_instance_graph_immutable
    BEFORE UPDATE OF definition_version_id, definition_version, graph_json, graph_fingerprint
    ON workflow_instances
    WHEN (OLD.definition_version_id IS NOT NULL AND OLD.definition_version_id IS NOT NEW.definition_version_id)
      OR (OLD.definition_version IS NOT NULL AND OLD.definition_version IS NOT NEW.definition_version)
      OR (OLD.graph_json IS NOT NULL AND OLD.graph_json IS NOT NEW.graph_json)
      OR (OLD.graph_fingerprint IS NOT NULL AND OLD.graph_fingerprint IS NOT NEW.graph_fingerprint)
    BEGIN SELECT RAISE(ABORT, 'workflow instance graph pin is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_graph_edge_topology_immutable
    BEFORE UPDATE OF instance_id, from_node_id, to_node_id, edge_kind, branch_key,
      condition_json, ordinal ON _workflow_graph_edges
    WHEN OLD.instance_id IS NOT NEW.instance_id
      OR OLD.from_node_id IS NOT NEW.from_node_id
      OR OLD.to_node_id IS NOT NEW.to_node_id
      OR OLD.edge_kind IS NOT NEW.edge_kind
      OR OLD.branch_key IS NOT NEW.branch_key
      OR OLD.condition_json IS NOT NEW.condition_json
      OR OLD.ordinal IS NOT NEW.ordinal
    BEGIN SELECT RAISE(ABORT, 'workflow graph edge topology is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_each_item_identity_immutable
    BEFORE UPDATE OF instance_id, parent_step_id, node_id, activation_key, item_key,
      item_index, input_json ON _workflow_each_items
    WHEN OLD.instance_id IS NOT NEW.instance_id
      OR OLD.parent_step_id IS NOT NEW.parent_step_id
      OR OLD.node_id IS NOT NEW.node_id
      OR OLD.activation_key IS NOT NEW.activation_key
      OR OLD.item_key IS NOT NEW.item_key
      OR OLD.item_index IS NOT NEW.item_index
      OR OLD.input_json IS NOT NEW.input_json
    BEGIN SELECT RAISE(ABORT, 'workflow each item identity is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_memory_identity_immutable
    BEFORE UPDATE OF instance_id, scope_kind, scope_id, key ON _workflow_memory
    WHEN OLD.instance_id IS NOT NEW.instance_id
      OR OLD.scope_kind IS NOT NEW.scope_kind
      OR OLD.scope_id IS NOT NEW.scope_id
      OR OLD.key IS NOT NEW.key
    BEGIN SELECT RAISE(ABORT, 'workflow memory identity is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_interaction_identity_immutable
    BEFORE UPDATE OF instance_id, node_id, step_id, opened_at, created_at
    ON workflow_interactions
    WHEN OLD.instance_id IS NOT NEW.instance_id
      OR OLD.node_id IS NOT NEW.node_id
      OR OLD.step_id IS NOT NEW.step_id
      OR OLD.opened_at IS NOT NEW.opened_at
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN SELECT RAISE(ABORT, 'workflow interaction identity is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_interaction_definition_immutable
    BEFORE UPDATE OF interaction_id, responder_policy_json, response_schema_json, request_json,
      validator_activity_id, created_at ON _workflow_interaction_details
    WHEN OLD.interaction_id IS NOT NEW.interaction_id
      OR OLD.responder_policy_json IS NOT NEW.responder_policy_json
      OR OLD.response_schema_json IS NOT NEW.response_schema_json
      OR OLD.request_json IS NOT NEW.request_json
      OR OLD.validator_activity_id IS NOT NEW.validator_activity_id
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN SELECT RAISE(ABORT, 'workflow interaction definition is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_interaction_request_immutable
    BEFORE UPDATE OF request_json ON _workflow_interaction_details
    WHEN OLD.request_json IS NOT NEW.request_json
    BEGIN SELECT RAISE(ABORT, 'workflow interaction request is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_interaction_response_immutable
    BEFORE UPDATE OF response_id, interaction_id, submission_id, actor_id, channel,
      payload_hash, payload_json, created_at ON _workflow_interaction_responses
    WHEN OLD.response_id IS NOT NEW.response_id
      OR OLD.interaction_id IS NOT NEW.interaction_id
      OR OLD.submission_id IS NOT NEW.submission_id
      OR OLD.actor_id IS NOT NEW.actor_id
      OR OLD.channel IS NOT NEW.channel
      OR OLD.payload_hash IS NOT NEW.payload_hash
      OR OLD.payload_json IS NOT NEW.payload_json
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN SELECT RAISE(ABORT, 'workflow interaction response is immutable'); END`);
  for (const [table, id] of [
    ['_workflow_graph_edges', 'edge_id'],
    ['_workflow_decisions', 'decision_id'],
    ['_workflow_each_items', 'item_id'],
    ['_workflow_memory', 'memory_id'],
    ['workflow_interactions', 'interaction_id'],
  ] as const) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${table.replace(/^_/, '')}_parent_immutable
      BEFORE UPDATE OF instance_id ON ${table}
      WHEN OLD.instance_id IS NOT NEW.instance_id
      BEGIN SELECT RAISE(ABORT, '${id} workflow parent is immutable'); END`);
  }
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
