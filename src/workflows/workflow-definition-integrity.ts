/** Generic SQLite constraints for Torrent definition and draft history. */

import type { WorkflowSchemaDatabase } from './workflow-graph-schema';

export function createWorkflowDefinitionIntegrityTriggers(
  db: WorkflowSchemaDatabase,
): void {
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_values_valid_insert
    BEFORE INSERT ON workflow_definitions
    WHEN NOT (
      typeof(NEW.version) = 'integer' AND NEW.version >= 0
      AND NEW.name = trim(NEW.name) AND length(NEW.name) BETWEEN 1 AND 200
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
      AND NEW.name = trim(NEW.name) AND length(NEW.name) BETWEEN 1 AND 200
      AND NEW.status IN ('active','retired')
    )
    BEGIN SELECT RAISE(ABORT, 'workflow definition values are invalid'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_code_scope_valid
    BEFORE INSERT ON workflow_definitions
    WHEN NEW.source = 'code'
      AND (NEW.scope_type <> 'application' OR NEW.scope_id <> '')
    BEGIN SELECT RAISE(ABORT, 'code workflow definitions require application scope'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_workflow_definition_active_version_source_valid
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
}
