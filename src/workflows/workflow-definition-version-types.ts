/**
 * workflow-definition-version-types.ts
 *
 * Declares the persistence-facing contracts for immutable workflow versions.
 * Runtime graph execution and HTTP authorization live in separate modules.
 */

export type WorkflowDefinitionAuthoringSource = 'code' | 'database';
export type WorkflowDefinitionVersionStatus = 'published' | 'retired';

export interface WorkflowDefinitionScope {
  type: string;
  id?: string | null;
}

export interface WorkflowDefinitionCatalogRecord {
  definition_id: string;
  name: string;
  version: number;
  steps_json: string;
  input_schema: string | null;
  created_at: string;
  updated_at: string;
  active_version_id: string | null;
  source: WorkflowDefinitionAuthoringSource;
  scope_type: string;
  scope_id: string;
  status: 'active' | 'retired';
  access_policy_json: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface WorkflowDefinitionVersionRecord {
  version_id: string;
  definition_id: string;
  version_number: number;
  source: WorkflowDefinitionAuthoringSource;
  graph_format: string;
  schema_version: number;
  graph_json: string;
  input_schema_json: string | null;
  access_policy_json: string | null;
  fingerprint: string;
  status: WorkflowDefinitionVersionStatus;
  created_by: string | null;
  created_at: string;
  retired_by: string | null;
  retired_at: string | null;
}

export interface ResolvedWorkflowDefinitionVersion {
  catalog: WorkflowDefinitionCatalogRecord;
  version: WorkflowDefinitionVersionRecord;
  graph: unknown;
  inputSchema: unknown | null;
  accessPolicy: unknown | null;
}

export interface PublishWorkflowDefinitionVersionInput {
  name: string;
  graph: unknown;
  source: WorkflowDefinitionAuthoringSource;
  graphFormat: string;
  schemaVersion: number;
  scope?: WorkflowDefinitionScope;
  inputSchema?: unknown;
  accessPolicy?: unknown;
  version?: number;
  activate?: boolean;
  actorId?: string | null;
  expectedActiveVersionId?: string | null;
  expectedFingerprint?: string;
}

export interface PublishWorkflowDefinitionVersionResult
  extends ResolvedWorkflowDefinitionVersion {
  created: boolean;
  activated: boolean;
}

/** Exact mutable-draft snapshot that may become one immutable version. */
export interface PublishWorkflowDefinitionDraftInput {
  draftId: string;
  definitionId: string;
  expectedRevision: number;
  expectedDraftFingerprint: string;
  publication: PublishWorkflowDefinitionVersionInput;
}

export interface ResolveWorkflowDefinitionVersionInput {
  name?: string;
  definitionId?: string;
  scope?: WorkflowDefinitionScope;
  version?: number;
  versionId?: string;
  includeRetired?: boolean;
}

interface SaveWorkflowDefinitionDraftBase {
  definitionId: string;
  baseVersionId?: string | null;
  source: WorkflowDefinitionAuthoringSource;
  graphFormat: string;
  schemaVersion: number;
  graph: unknown;
  inputSchema?: unknown;
  accessPolicy?: unknown;
  editorMetadata?: unknown;
  actorId?: string | null;
}

/** New drafts receive a server id; existing drafts require an exact revision fence. */
export type SaveWorkflowDefinitionDraftInput = SaveWorkflowDefinitionDraftBase & (
  | { draftId?: never; expectedRevision?: never }
  | { draftId: string; expectedRevision: number }
);

export interface WorkflowDefinitionDraftRecord {
  draft_id: string;
  definition_id: string;
  base_version_id: string | null;
  source: WorkflowDefinitionAuthoringSource;
  graph_format: string;
  schema_version: number;
  graph_json: string;
  input_schema_json: string | null;
  access_policy_json: string | null;
  fingerprint: string;
  editor_metadata_json: string | null;
  revision: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedWorkflowDefinitionDraft {
  draft: WorkflowDefinitionDraftRecord;
  graph: unknown;
  inputSchema: unknown | null;
  accessPolicy: unknown | null;
  editorMetadata: unknown | null;
}

export type WorkflowDefinitionVersionStoreErrorCode =
  | 'WORKFLOW_DEFINITION_VERSION_NOT_FOUND'
  | 'WORKFLOW_DEFINITION_VERSION_CONFLICT'
  | 'WORKFLOW_DEFINITION_SOURCE_CONFLICT'
  | 'WORKFLOW_DEFINITION_SCOPE_CONFLICT'
  | 'WORKFLOW_DEFINITION_HISTORY_INVALID'
  | 'WORKFLOW_DEFINITION_GRAPH_INVALID'
  | 'WORKFLOW_DEFINITION_DRAFT_INVALID'
  | 'WORKFLOW_DEFINITION_DRAFT_CONFLICT';

/** Stable persistence error mapped to the public WorkflowError by services. */
export class WorkflowDefinitionVersionStoreError extends Error {
  constructor(
    message: string,
    readonly code: WorkflowDefinitionVersionStoreErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WorkflowDefinitionVersionStoreError';
  }
}
