/** Data-preserving rebuilds for workflow tables shipped with cascading FKs in 030. */

import type { Database } from 'bun:sqlite';

const MAX_WORKFLOW_DEFINITION_NAME_LENGTH = 200;

const REBUILT_TABLES = [
  'workflow_definitions',
  'workflow_definition_versions',
  '_workflow_definition_drafts',
  '_workflow_graph_edges',
  '_workflow_decisions',
  '_workflow_each_items',
  '_workflow_memory',
  'workflow_interactions',
  '_workflow_interaction_details',
  '_workflow_interaction_responses',
] as const;

const INTEGRITY_TABLES = [...REBUILT_TABLES, '_workflow_event_authorities'] as const;

/** Rebuild the released 030 tables without unobservable cascade actions. */
export function rebuildWorkflowGraphTables(db: Database): void {
  assertUpgradePrerequisites(db);
  assertReleasedCatalogCanUpgrade(db);
  createBackups(db);
  dropReleasedTables(db);
  createCurrentTables(db);
  restoreBackups(db);
  assertRowCountsPreserved(db);
  dropBackups(db);
}

/**
 * Refuse catalog corruption before any table is rebuilt. Migration 030 did not
 * encode all of the ownership/value invariants that the runtime already
 * required, so silently copying malformed rows would leave a database that
 * cannot safely start. The surrounding migration transaction keeps this a
 * zero-write failure.
 */
function assertReleasedCatalogCanUpgrade(db: Database): void {
  const invalidDefinition = db.query(`SELECT definition_id
    FROM workflow_definitions
    WHERE typeof(version) <> 'integer' OR version < 0
      OR name <> trim(name) OR length(name) < 1
      OR length(name) > ${MAX_WORKFLOW_DEFINITION_NAME_LENGTH}
      OR source NOT IN ('code','database')
      OR scope_type NOT IN ('application','tenant')
      OR NOT (
        (scope_type = 'application' AND scope_id = '')
        OR (scope_type = 'tenant' AND scope_id = trim(scope_id)
          AND length(scope_id) BETWEEN 1 AND 256)
      )
      OR (source = 'code' AND scope_type <> 'application')
      OR status NOT IN ('active','retired')
    LIMIT 1`).get() as { definition_id: string } | null;
  if (invalidDefinition) {
    throw new Error(
      `[migration 031] Workflow definition ${invalidDefinition.definition_id} has invalid catalog values.`,
    );
  }

  const invalidVersion = db.query(`SELECT version.version_id
    FROM workflow_definition_versions AS version
    LEFT JOIN workflow_definitions AS definition
      ON definition.definition_id = version.definition_id
    WHERE definition.definition_id IS NULL OR version.source <> definition.source
    LIMIT 1`).get() as { version_id: string } | null;
  if (invalidVersion) {
    throw new Error(
      `[migration 031] Workflow version ${invalidVersion.version_id} does not match its definition source.`,
    );
  }

  const invalidVersionRetirement = db.query(`SELECT version_id
    FROM workflow_definition_versions
    WHERE (status = 'published' AND (retired_by IS NOT NULL OR retired_at IS NOT NULL))
      OR (status = 'retired' AND retired_at IS NULL)
    LIMIT 1`).get() as { version_id: string } | null;
  if (invalidVersionRetirement) {
    throw new Error(
      `[migration 031] Workflow version ${invalidVersionRetirement.version_id} has invalid retirement state.`,
    );
  }

  const invalidDraft = db.query(`SELECT draft.draft_id
    FROM _workflow_definition_drafts AS draft
    LEFT JOIN workflow_definitions AS definition
      ON definition.definition_id = draft.definition_id
    WHERE definition.definition_id IS NULL OR draft.source <> definition.source
    LIMIT 1`).get() as { draft_id: string } | null;
  if (invalidDraft) {
    throw new Error(
      `[migration 031] Workflow draft ${invalidDraft.draft_id} does not match its definition source.`,
    );
  }

  const invalidDraftBase = db.query(`SELECT draft.draft_id
    FROM _workflow_definition_drafts AS draft
    WHERE draft.base_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM workflow_definition_versions AS version
      WHERE version.version_id = draft.base_version_id
        AND version.definition_id = draft.definition_id
        AND version.source = draft.source
    ) LIMIT 1`).get() as { draft_id: string } | null;
  if (invalidDraftBase) {
    throw new Error(
      `[migration 031] Workflow draft ${invalidDraftBase.draft_id} has an invalid base version.`,
    );
  }

  const invalidActiveVersion = db.query(`SELECT definition.definition_id
    FROM workflow_definitions AS definition
    WHERE definition.active_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM workflow_definition_versions AS version
      WHERE version.version_id = definition.active_version_id
        AND version.definition_id = definition.definition_id
        AND version.source = definition.source
        AND version.status = 'published'
    ) LIMIT 1`).get() as { definition_id: string } | null;
  if (invalidActiveVersion) {
    throw new Error(
      `[migration 031] Workflow definition ${invalidActiveVersion.definition_id} has an invalid active version.`,
    );
  }
}

export function assertWorkflowGraphForeignKeys(db: Database): void {
  for (const table of INTEGRITY_TABLES) {
    const foreignKeys = db.query(`PRAGMA foreign_key_list(${table})`).all() as Array<{
      on_delete: string;
    }>;
    if (foreignKeys.some((foreignKey) => foreignKey.on_delete === 'CASCADE')) {
      throw new Error(`[migration 031] ${table} still contains an ON DELETE CASCADE action.`);
    }
    const violations = db.query(`PRAGMA foreign_key_check(${table})`).all();
    if (violations.length > 0) {
      throw new Error(`[migration 031] ${table} contains foreign-key violations.`);
    }
  }
}

function assertUpgradePrerequisites(db: Database): void {
  for (const table of REBUILT_TABLES) {
    if (!tableExists(db, table)) {
      throw new Error(`[migration 031] Required migration-030 table ${table} is missing.`);
    }
  }
  for (const table of ['workflow_instances', 'workflow_steps', 'workflow_events']) {
    if (!hasColumn(db, table, 'tenant_id')) {
      throw new Error(
        `[migration 031] ${table}.tenant_id from migration 008 is required before upgrade.`,
      );
    }
  }
}

function createBackups(db: Database): void {
  for (const table of REBUILT_TABLES) {
    db.exec(`DROP TABLE IF EXISTS temp.${backupName(table)}`);
  }
  db.exec(`CREATE TEMP TABLE ${backupName('_workflow_definition_drafts')}
    AS SELECT * FROM _workflow_definition_drafts`);
  db.exec(`CREATE TEMP TABLE ${backupName('workflow_definitions')}
    AS SELECT * FROM workflow_definitions`);
  db.exec(`CREATE TEMP TABLE ${backupName('workflow_definition_versions')}
    AS SELECT * FROM workflow_definition_versions`);
  db.exec(`CREATE TEMP TABLE ${backupName('_workflow_graph_edges')}
    AS SELECT * FROM _workflow_graph_edges`);
  db.exec(`CREATE TEMP TABLE ${backupName('_workflow_decisions')}
    AS SELECT * FROM _workflow_decisions`);
  db.exec(`CREATE TEMP TABLE ${backupName('_workflow_each_items')}
    AS SELECT * FROM _workflow_each_items`);
  db.exec(`CREATE TEMP TABLE ${backupName('_workflow_memory')}
    AS SELECT * FROM _workflow_memory`);
  db.exec(`CREATE TEMP TABLE ${backupName('workflow_interactions')} AS
    SELECT interaction.interaction_id, instance.tenant_id,
      interaction.instance_id, interaction.node_id, interaction.step_id,
      interaction.safe_label, interaction.status, interaction.opened_at,
      interaction.expires_at, interaction.accepted_at, interaction.accepted_by,
      interaction.rejection_count, interaction.max_rejections,
      interaction.created_at, interaction.updated_at
    FROM workflow_interactions AS interaction
    LEFT JOIN workflow_instances AS instance
      ON instance.instance_id = interaction.instance_id`);
  db.exec(`CREATE TEMP TABLE ${backupName('_workflow_interaction_details')}
    AS SELECT * FROM _workflow_interaction_details`);
  db.exec(`CREATE TEMP TABLE ${backupName('_workflow_interaction_responses')}
    AS SELECT * FROM _workflow_interaction_responses`);
}

function dropReleasedTables(db: Database): void {
  // Dependents are removed before their parents so SQLite never invokes the
  // released cascade actions or rejects a referenced parent drop.
  db.exec('DROP TABLE _workflow_interaction_responses');
  db.exec('DROP TABLE _workflow_interaction_details');
  db.exec('DROP TABLE workflow_interactions');
  db.exec('DROP TABLE _workflow_decisions');
  db.exec('DROP TABLE _workflow_graph_edges');
  db.exec('DROP TABLE _workflow_definition_drafts');
  db.exec('DROP TABLE workflow_definition_versions');
  db.exec('DROP TABLE workflow_definitions');
  db.exec('DROP TABLE _workflow_each_items');
  db.exec('DROP TABLE _workflow_memory');
}

function createCurrentTables(db: Database): void {
  createDefinitionTables(db);
  createGraphTables(db);
  createEachItems(db);
  createMemory(db);
  createInteractions(db);
}

function createDefinitionTables(db: Database): void {
  db.exec(`CREATE TABLE workflow_definitions (
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
  db.exec(`CREATE TABLE workflow_definition_versions (
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
  db.exec(`CREATE TABLE _workflow_definition_drafts (
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

function createGraphTables(db: Database): void {
  db.exec(`CREATE TABLE _workflow_graph_edges (
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
  db.exec(`CREATE TABLE _workflow_decisions (
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
}

function createEachItems(db: Database): void {
  db.exec(`CREATE TABLE _workflow_each_items (
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

function createMemory(db: Database): void {
  db.exec(`CREATE TABLE _workflow_memory (
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
}

function createInteractions(db: Database): void {
  db.exec(`CREATE TABLE workflow_interactions (
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
  db.exec(`CREATE TABLE _workflow_interaction_details (
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
  db.exec(`CREATE TABLE _workflow_interaction_responses (
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

function restoreBackups(db: Database): void {
  db.exec(`INSERT INTO workflow_definitions
    SELECT * FROM temp.${backupName('workflow_definitions')}`);
  db.exec(`INSERT INTO workflow_definition_versions
    SELECT * FROM temp.${backupName('workflow_definition_versions')}`);
  db.exec(`INSERT INTO _workflow_definition_drafts
    SELECT * FROM temp.${backupName('_workflow_definition_drafts')}`);
  db.exec(`INSERT INTO _workflow_graph_edges
    SELECT * FROM temp.${backupName('_workflow_graph_edges')}`);
  db.exec(`INSERT INTO _workflow_decisions
    SELECT * FROM temp.${backupName('_workflow_decisions')}`);
  db.exec(`INSERT INTO _workflow_each_items
    SELECT * FROM temp.${backupName('_workflow_each_items')}`);
  db.exec(`INSERT INTO _workflow_memory
    SELECT * FROM temp.${backupName('_workflow_memory')}`);
  db.exec(`INSERT INTO workflow_interactions
    SELECT * FROM temp.${backupName('workflow_interactions')}`);
  db.exec(`INSERT INTO _workflow_interaction_details
    SELECT * FROM temp.${backupName('_workflow_interaction_details')}`);
  const responseBackup = backupName('_workflow_interaction_responses');
  const hasTrustedOrigin = hasTempColumn(db, responseBackup, 'origin');
  const hasEventId = hasTempColumn(db, responseBackup, 'event_id');
  if (hasTrustedOrigin !== hasEventId) {
    throw new Error('[migration 031] Workflow interaction origin columns are incomplete.');
  }
  const responseOriginProjection = hasTrustedOrigin
    ? 'origin, event_id'
    // Released rows predate the trusted discriminator. Never infer internal
    // authority from caller-controlled legacy channel or submission strings.
    : "'external', NULL";
  db.exec(`INSERT INTO _workflow_interaction_responses (
      response_id, interaction_id, submission_id, actor_id, channel,
      payload_hash, payload_json, accepted_value_json, status, rejection_code,
      public_message, created_at, decided_at, origin, event_id
    )
    SELECT response_id, interaction_id, submission_id, actor_id, channel,
      payload_hash, payload_json, accepted_value_json, status, rejection_code,
      public_message, created_at, decided_at, ${responseOriginProjection}
    FROM temp.${responseBackup}`);
}

function assertRowCountsPreserved(db: Database): void {
  for (const table of REBUILT_TABLES) {
    const restored = rowCount(db, table);
    const original = rowCount(db, `temp.${backupName(table)}`);
    if (restored !== original) {
      throw new Error(
        `[migration 031] ${table} row count changed from ${original} to ${restored}.`,
      );
    }
  }
}

function dropBackups(db: Database): void {
  for (const table of [...REBUILT_TABLES].reverse()) {
    db.exec(`DROP TABLE temp.${backupName(table)}`);
  }
}

function rowCount(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function backupName(table: string): string {
  return `_zero031_backup_${table.replace(/^_/, '')}`;
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function hasColumn(db: Database, table: string, column: string): boolean {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}

function hasTempColumn(db: Database, table: string, column: string): boolean {
  return (db.query(`PRAGMA temp.table_info(${table})`).all() as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}
