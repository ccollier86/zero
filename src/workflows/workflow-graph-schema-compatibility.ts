/**
 * workflow-graph-schema-compatibility.ts
 *
 * Verifies that runtime workflow DDL is operating on the fully upgraded schema.
 * It does not create or repair tables because destructive rebuilds belong to
 * managed migrations.
 */

import { MAX_WORKFLOW_DEFINITION_NAME_LENGTH } from './workflow-definition-identifiers';
import { WorkflowError } from './workflow-error';
import type { WorkflowSchemaDatabase } from './workflow-graph-schema-database';

/** Refuse a partially upgraded runtime schema that additive startup DDL cannot repair. */
export function assertWorkflowGraphSchemaCompatible(db: WorkflowSchemaDatabase): void {
  const indexes = db.prepare('PRAGMA index_list(workflow_definitions)').all() as Array<{
    name: string;
    unique: number;
  }>;
  let hasScopedName = false;
  for (const index of indexes) {
    if (index.unique !== 1) continue;
    const columnRows = db.prepare(
      `PRAGMA index_info(${quotePragmaIdentifier(index.name)})`,
    ).all() as Array<{ name: string }>;
    const columns = columnRows.map((column) => column.name);
    if (columns.length === 1 && columns[0] === 'name') incompatibleSchema();
    if (columns.join('\0') === 'scope_type\0scope_id\0name') hasScopedName = true;
  }
  if (!hasScopedName) incompatibleSchema();

  const invalidCatalog = db.prepare(`SELECT 1 AS invalid
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
    LIMIT 1`).get() as { invalid?: number } | null;
  if (invalidCatalog) incompatibleSchema();

  const invalidVersionOwner = db.prepare(`SELECT 1 AS invalid
    FROM workflow_definition_versions AS version
    LEFT JOIN workflow_definitions AS definition
      ON definition.definition_id = version.definition_id
    WHERE definition.definition_id IS NULL OR version.source <> definition.source
    LIMIT 1`).get() as { invalid?: number } | null;
  if (invalidVersionOwner) incompatibleSchema();

  const invalidVersionRetirement = db.prepare(`SELECT 1 AS invalid
    FROM workflow_definition_versions
    WHERE (status = 'published' AND (retired_by IS NOT NULL OR retired_at IS NOT NULL))
      OR (status = 'retired' AND retired_at IS NULL)
    LIMIT 1`).get() as { invalid?: number } | null;
  if (invalidVersionRetirement) incompatibleSchema();

  const invalidDraftOwner = db.prepare(`SELECT 1 AS invalid
    FROM _workflow_definition_drafts AS draft
    LEFT JOIN workflow_definitions AS definition
      ON definition.definition_id = draft.definition_id
    WHERE definition.definition_id IS NULL OR draft.source <> definition.source
    LIMIT 1`).get() as { invalid?: number } | null;
  if (invalidDraftOwner) incompatibleSchema();

  const invalidDraftBase = db.prepare(`SELECT 1 AS invalid
    FROM _workflow_definition_drafts AS draft
    LEFT JOIN workflow_definition_versions AS version
      ON version.version_id = draft.base_version_id
    WHERE draft.base_version_id IS NOT NULL
      AND (version.version_id IS NULL
        OR version.definition_id <> draft.definition_id
        OR version.source <> draft.source)
    LIMIT 1`).get() as { invalid?: number } | null;
  if (invalidDraftBase) incompatibleSchema();

  const invalidActiveVersion = db.prepare(`SELECT 1 AS invalid
    FROM workflow_definitions AS definition
    WHERE definition.active_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM workflow_definition_versions AS version
      WHERE version.version_id = definition.active_version_id
        AND version.definition_id = definition.definition_id
        AND version.source = definition.source
        AND version.status = 'published'
    ) LIMIT 1`).get() as { invalid?: number } | null;
  if (invalidActiveVersion) incompatibleSchema();

  const tables = db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND (name LIKE 'workflow_%' OR name LIKE '_workflow_%')`).all() as Array<{
      name: string;
    }>;
  for (const table of tables) {
    const foreignKeys = db.prepare(
      `PRAGMA foreign_key_list(${quotePragmaIdentifier(table.name)})`,
    ).all() as Array<{ on_update: string; on_delete: string }>;
    if (foreignKeys.some((key) => key.on_update !== 'NO ACTION'
      || key.on_delete !== 'NO ACTION')) incompatibleSchema();
  }
}

function quotePragmaIdentifier(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function incompatibleSchema(): never {
  throw new WorkflowError(
    '[workflows] Workflow database schema is incompatible; apply migration 031 before startup.',
    'WORKFLOW_CONFIG_INVALID',
    500,
  );
}
