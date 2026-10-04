/**
 * workflow-graph-schema-integrity.ts
 *
 * Owns SQLite triggers that protect immutable workflow topology, definition
 * history, tenant lineage, and trusted interaction-response provenance.
 */

import { MAX_WORKFLOW_DEFINITION_NAME_LENGTH } from './workflow-definition-identifiers';
import type { WorkflowSchemaDatabase } from './workflow-graph-schema-database';

/** Install idempotent integrity triggers after all workflow tables and columns exist. */
export function createWorkflowGraphIntegrityTriggers(db: WorkflowSchemaDatabase): void {
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_values_valid_insert
    BEFORE INSERT ON workflow_definitions
    WHEN NOT (
      typeof(NEW.version) = 'integer' AND NEW.version >= 0
      AND NEW.name = trim(NEW.name) AND length(NEW.name) BETWEEN 1 AND ${MAX_WORKFLOW_DEFINITION_NAME_LENGTH}
      AND NEW.source IN ('code','database')
      AND NEW.scope_type IN ('application','tenant')
      AND (
        (NEW.scope_type = 'application' AND NEW.scope_id = '')
        OR (NEW.scope_type = 'tenant' AND NEW.scope_id = trim(NEW.scope_id)
          AND length(NEW.scope_id) BETWEEN 1 AND 256)
      )
      AND NEW.status IN ('active','retired')
    )
    BEGIN SELECT RAISE(ABORT, 'workflow definition values are invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_values_valid_update
    BEFORE UPDATE OF name, version, status ON workflow_definitions
    WHEN NOT (
      typeof(NEW.version) = 'integer' AND NEW.version >= 0
      AND NEW.name = trim(NEW.name) AND length(NEW.name) BETWEEN 1 AND ${MAX_WORKFLOW_DEFINITION_NAME_LENGTH}
      AND NEW.status IN ('active','retired')
    )
    BEGIN SELECT RAISE(ABORT, 'workflow definition values are invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_code_scope_valid
    BEFORE INSERT ON workflow_definitions
    WHEN NEW.source = 'code'
      AND (NEW.scope_type <> 'application' OR NEW.scope_id <> '')
    BEGIN SELECT RAISE(ABORT, 'code workflow definitions require application scope'); END`);
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
        AND version.source = NEW.source
        AND version.status = 'published'
    )
    BEGIN SELECT RAISE(ABORT, 'workflow active version is invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_active_version_valid_insert
    BEFORE INSERT ON workflow_definitions
    WHEN NEW.active_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM workflow_definition_versions AS version
      WHERE version.version_id = NEW.active_version_id
        AND version.definition_id = NEW.definition_id
        AND version.source = NEW.source
        AND version.status = 'published'
    )
    BEGIN SELECT RAISE(ABORT, 'workflow active version is invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_version_source_valid
    BEFORE INSERT ON workflow_definition_versions
    WHEN NOT EXISTS (
      SELECT 1 FROM workflow_definitions AS definition
      WHERE definition.definition_id = NEW.definition_id
        AND definition.source = NEW.source
    )
    BEGIN SELECT RAISE(ABORT, 'workflow version source must match its definition'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_version_retirement_valid_insert
    BEFORE INSERT ON workflow_definition_versions
    WHEN NOT (
      (NEW.status = 'published' AND NEW.retired_by IS NULL AND NEW.retired_at IS NULL)
      OR (NEW.status = 'retired' AND NEW.retired_at IS NOT NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'workflow version retirement state is invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_version_retirement_transition
    BEFORE UPDATE OF status, retired_by, retired_at ON workflow_definition_versions
    WHEN NOT (
      (OLD.status IS NEW.status
        AND OLD.retired_by IS NEW.retired_by
        AND OLD.retired_at IS NEW.retired_at)
      OR (OLD.status = 'published'
        AND OLD.retired_by IS NULL
        AND OLD.retired_at IS NULL
        AND NEW.status = 'retired'
        AND NEW.retired_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM workflow_definitions AS definition
          WHERE definition.active_version_id = NEW.version_id
        ))
    )
    BEGIN SELECT RAISE(ABORT, 'workflow version retirement transition is invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_draft_source_valid_insert
    BEFORE INSERT ON _workflow_definition_drafts
    WHEN NOT EXISTS (
      SELECT 1 FROM workflow_definitions AS definition
      WHERE definition.definition_id = NEW.definition_id
        AND definition.source = NEW.source
    )
    BEGIN SELECT RAISE(ABORT, 'workflow draft source must match its definition'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_draft_source_valid_update
    BEFORE UPDATE OF definition_id, source ON _workflow_definition_drafts
    WHEN NOT EXISTS (
      SELECT 1 FROM workflow_definitions AS definition
      WHERE definition.definition_id = NEW.definition_id
        AND definition.source = NEW.source
    )
    BEGIN SELECT RAISE(ABORT, 'workflow draft source must match its definition'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_draft_base_valid_insert
    BEFORE INSERT ON _workflow_definition_drafts
    WHEN NEW.base_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM workflow_definition_versions AS version
      WHERE version.version_id = NEW.base_version_id
        AND version.definition_id = NEW.definition_id
        AND version.source = NEW.source
    )
    BEGIN SELECT RAISE(ABORT, 'workflow draft base version is invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_draft_base_valid_update
    BEFORE UPDATE OF base_version_id, definition_id, source ON _workflow_definition_drafts
    WHEN NEW.base_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM workflow_definition_versions AS version
      WHERE version.version_id = NEW.base_version_id
        AND version.definition_id = NEW.definition_id
        AND version.source = NEW.source
    )
    BEGIN SELECT RAISE(ABORT, 'workflow draft base version is invalid'); END`);
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
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_instance_tenant_immutable
    BEFORE UPDATE OF tenant_id ON workflow_instances
    WHEN OLD.tenant_id IS NOT NEW.tenant_id
    BEGIN SELECT RAISE(ABORT, 'workflow instance tenant is immutable'); END`);
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
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_memory_policy_immutable
    BEFORE UPDATE ON _workflow_memory_policies
    BEGIN SELECT RAISE(ABORT, 'workflow memory policy is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_interaction_identity_immutable
    BEFORE UPDATE OF tenant_id, instance_id, node_id, step_id, opened_at, created_at
    ON workflow_interactions
    WHEN OLD.tenant_id IS NOT NEW.tenant_id
      OR OLD.instance_id IS NOT NEW.instance_id
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
  db.exec('DROP TRIGGER IF EXISTS trg_workflow_interaction_response_immutable');
  db.exec(`CREATE TRIGGER trg_workflow_interaction_response_immutable
    BEFORE UPDATE OF response_id, interaction_id, submission_id, actor_id, channel,
      origin, event_id, payload_hash, payload_json, created_at ON _workflow_interaction_responses
    WHEN OLD.response_id IS NOT NEW.response_id
      OR OLD.interaction_id IS NOT NEW.interaction_id
      OR OLD.submission_id IS NOT NEW.submission_id
      OR OLD.actor_id IS NOT NEW.actor_id
      OR OLD.channel IS NOT NEW.channel
      OR OLD.origin IS NOT NEW.origin
      OR OLD.event_id IS NOT NEW.event_id
      OR OLD.payload_hash IS NOT NEW.payload_hash
      OR OLD.payload_json IS NOT NEW.payload_json
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN SELECT RAISE(ABORT, 'workflow interaction response is immutable'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_interaction_response_origin_insert
    BEFORE INSERT ON _workflow_interaction_responses
    WHEN NOT (
      (NEW.origin = 'external' AND NEW.event_id IS NULL
        AND COALESCE(NEW.channel, '') != 'event'
        AND NEW.submission_id NOT LIKE 'event:%')
      OR (NEW.origin = 'event' AND NEW.event_id IS NOT NULL
        AND NEW.channel = 'event'
        AND NEW.submission_id = ('event:' || NEW.event_id)
        AND EXISTS (
          SELECT 1 FROM workflow_events AS event
          INNER JOIN workflow_interactions AS interaction
            ON interaction.interaction_id = NEW.interaction_id
          WHERE event.event_id = NEW.event_id
            AND event.instance_id = interaction.instance_id
        ))
    )
    BEGIN SELECT RAISE(ABORT, 'workflow interaction response origin is invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_event_response_parent_delete
    BEFORE DELETE ON workflow_events
    WHEN EXISTS (
      SELECT 1 FROM _workflow_interaction_responses AS response
      WHERE response.origin = 'event' AND response.event_id = OLD.event_id
    )
    BEGIN SELECT RAISE(ABORT, 'workflow interaction event response parent is immutable'); END`);
  for (const [table, id] of [
    ['_workflow_graph_edges', 'edge_id'],
    ['_workflow_decisions', 'decision_id'],
    ['_workflow_each_items', 'item_id'],
    ['_workflow_memory_policies', 'instance_id'],
    ['_workflow_memory', 'memory_id'],
    ['workflow_interactions', 'interaction_id'],
  ] as const) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${table.replace(/^_/, '')}_parent_immutable
      BEFORE UPDATE OF instance_id ON ${table}
      WHEN OLD.instance_id IS NOT NEW.instance_id
      BEGIN SELECT RAISE(ABORT, '${id} workflow parent is immutable'); END`);
  }
  for (const [table, label] of [
    ['workflow_steps', 'step'],
    ['workflow_events', 'event'],
    ['workflow_interactions', 'interaction'],
  ] as const) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${table}_tenant_matches_parent_insert
      BEFORE INSERT ON ${table}
      WHEN NOT EXISTS (
        SELECT 1 FROM workflow_instances
        WHERE instance_id = NEW.instance_id AND tenant_id IS NEW.tenant_id
      )
      BEGIN SELECT RAISE(ABORT, 'workflow ${label} tenant must match its parent'); END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${table}_tenant_matches_parent_update
      BEFORE UPDATE OF tenant_id, instance_id ON ${table}
      WHEN NOT EXISTS (
        SELECT 1 FROM workflow_instances
        WHERE instance_id = NEW.instance_id AND tenant_id IS NEW.tenant_id
      )
      BEGIN SELECT RAISE(ABORT, 'workflow ${label} tenant must match its parent'); END`);
  }
  for (const [table, label] of [
    ['workflow_steps', 'step'],
    ['workflow_events', 'event'],
  ] as const) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${table}_tenant_immutable
      BEFORE UPDATE OF tenant_id ON ${table}
      WHEN OLD.tenant_id IS NOT NEW.tenant_id
      BEGIN SELECT RAISE(ABORT, 'workflow ${label} tenant is immutable'); END`);
  }
}
