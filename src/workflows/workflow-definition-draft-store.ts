/**
 * workflow-definition-draft-store.ts
 *
 * Persists mutable editor drafts separately from immutable published workflow
 * versions. It owns optimistic draft revisions, not publication or activation.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  fingerprintStoredWorkflowDefinition,
} from './workflow-definition-canonical';
import type {
  ResolvedWorkflowDefinitionDraft,
  SaveWorkflowDefinitionDraftInput,
  WorkflowDefinitionCatalogRecord,
  WorkflowDefinitionDraftRecord,
  WorkflowDefinitionVersionRecord,
} from './workflow-definition-version-types';
import { WorkflowDefinitionVersionStoreError } from './workflow-definition-version-types';
import {
  canonicalizeWorkflowVersionContent,
  canonicalizeWorkflowVersionValue,
} from './workflow-definition-version-validation';

type DraftDatabase = Pick<ReactiveDB, 'prepare' | 'transaction'>;

/** Mutable draft persistence with revision-based lost-update protection. */
export class WorkflowDefinitionDraftStore {
  constructor(
    private readonly db: DraftDatabase,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /** Create or replace a draft when the caller's expected revision is current. */
  save(input: SaveWorkflowDefinitionDraftInput): ResolvedWorkflowDefinitionDraft {
    const content = canonicalizeWorkflowVersionContent(input);
    const metadataJson = input.editorMetadata === undefined || input.editorMetadata === null
      ? null
      : canonicalizeWorkflowVersionValue(input.editorMetadata, 'Workflow draft editor metadata');

    return this.db.transaction(() => {
      const catalog = this.getCatalog(input.definitionId);
      if (catalog.source !== input.source) {
        throw new WorkflowDefinitionVersionStoreError(
          'Workflow definition source ownership does not match the draft source',
          'WORKFLOW_DEFINITION_SOURCE_CONFLICT',
          409,
        );
      }
      if (input.baseVersionId) this.assertBaseVersion(input.definitionId, input.baseVersionId);

      const draftId = input.draftId ?? crypto.randomUUID();
      const existing = this.getRecord(draftId);
      if (existing && existing.definition_id !== input.definitionId) {
        throw draftConflict('Workflow draft belongs to another definition');
      }
      if (input.expectedRevision !== undefined
        && (existing?.revision ?? 0) !== input.expectedRevision) {
        throw draftConflict('Workflow draft was changed by another editor');
      }

      const now = this.clock();
      if (existing) {
        this.db.prepare(`UPDATE _workflow_definition_drafts SET
          base_version_id = ?, graph_format = ?, schema_version = ?, graph_json = ?,
          input_schema_json = ?, access_policy_json = ?, fingerprint = ?,
          editor_metadata_json = ?, revision = ?, updated_by = ?, updated_at = ?
          WHERE draft_id = ?`).run(
          input.baseVersionId ?? null,
          input.graphFormat,
          input.schemaVersion,
          content.graphJson,
          content.inputSchemaJson,
          content.accessPolicyJson,
          content.fingerprint,
          metadataJson,
          existing.revision + 1,
          input.actorId ?? null,
          now,
          draftId,
        );
      } else {
        this.db.prepare(`INSERT INTO _workflow_definition_drafts (
          draft_id, definition_id, base_version_id, source, graph_format,
          schema_version, graph_json, input_schema_json, access_policy_json,
          fingerprint, editor_metadata_json, revision, created_by, updated_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
          .run(
            draftId,
            input.definitionId,
            input.baseVersionId ?? null,
            input.source,
            input.graphFormat,
            input.schemaVersion,
            content.graphJson,
            content.inputSchemaJson,
            content.accessPolicyJson,
            content.fingerprint,
            metadataJson,
            input.actorId ?? null,
            input.actorId ?? null,
            now,
            now,
          );
      }
      return this.require(draftId);
    });
  }

  /** Read and integrity-check one draft. */
  get(draftId: string): ResolvedWorkflowDefinitionDraft | null {
    const record = this.getRecord(draftId);
    return record ? resolveDraft(record) : null;
  }

  /** Read one draft or throw the stable not-found error. */
  require(draftId: string): ResolvedWorkflowDefinitionDraft {
    const draft = this.get(draftId);
    if (!draft) {
      throw new WorkflowDefinitionVersionStoreError(
        'Workflow definition draft not found',
        'WORKFLOW_DEFINITION_VERSION_NOT_FOUND',
        404,
      );
    }
    return draft;
  }

  /** Delete a mutable draft with optional revision fencing. */
  delete(draftId: string, expectedRevision?: number): boolean {
    return this.db.transaction(() => {
      const existing = this.getRecord(draftId);
      if (!existing) return false;
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
        throw draftConflict('Workflow draft was changed by another editor');
      }
      this.db.prepare('DELETE FROM _workflow_definition_drafts WHERE draft_id = ?').run(draftId);
      return true;
    });
  }

  private getCatalog(definitionId: string): WorkflowDefinitionCatalogRecord {
    const row = this.db.prepare('SELECT * FROM workflow_definitions WHERE definition_id = ?')
      .get(definitionId) as WorkflowDefinitionCatalogRecord | null;
    if (!row) {
      throw new WorkflowDefinitionVersionStoreError(
        'Workflow definition not found',
        'WORKFLOW_DEFINITION_VERSION_NOT_FOUND',
        404,
      );
    }
    return row;
  }

  private assertBaseVersion(definitionId: string, versionId: string): void {
    const row = this.db.prepare(`SELECT * FROM workflow_definition_versions
      WHERE version_id = ? AND definition_id = ?`).get(
        versionId,
        definitionId,
      ) as WorkflowDefinitionVersionRecord | null;
    if (!row) throw draftConflict('Workflow draft base version does not exist');
  }

  private getRecord(draftId: string): WorkflowDefinitionDraftRecord | null {
    return (this.db.prepare('SELECT * FROM _workflow_definition_drafts WHERE draft_id = ?')
      .get(draftId) as WorkflowDefinitionDraftRecord | null) ?? null;
  }
}

function resolveDraft(record: WorkflowDefinitionDraftRecord): ResolvedWorkflowDefinitionDraft {
  try {
    const canonical = fingerprintStoredWorkflowDefinition({
      graphJson: record.graph_json,
      graphFormat: record.graph_format,
      schemaVersion: record.schema_version,
      inputSchemaJson: record.input_schema_json,
      accessPolicyJson: record.access_policy_json,
    });
    if (canonical.fingerprint !== record.fingerprint) {
      throw new TypeError('fingerprint mismatch');
    }
    return {
      draft: record,
      graph: JSON.parse(canonical.graphJson),
      inputSchema: canonical.inputSchemaJson === null ? null : JSON.parse(canonical.inputSchemaJson),
      accessPolicy: canonical.accessPolicyJson === null ? null : JSON.parse(canonical.accessPolicyJson),
      editorMetadata: record.editor_metadata_json === null
        ? null
        : JSON.parse(record.editor_metadata_json),
    };
  } catch {
    throw new WorkflowDefinitionVersionStoreError(
      'Workflow definition draft history failed integrity validation',
      'WORKFLOW_DEFINITION_HISTORY_INVALID',
      500,
    );
  }
}

function draftConflict(message: string): WorkflowDefinitionVersionStoreError {
  return new WorkflowDefinitionVersionStoreError(
    message,
    'WORKFLOW_DEFINITION_DRAFT_CONFLICT',
    409,
  );
}
