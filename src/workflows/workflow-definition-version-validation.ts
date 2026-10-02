/** Focused validation and stable errors for workflow-version persistence. */

import type {
  PublishWorkflowDefinitionVersionInput,
  WorkflowDefinitionCatalogRecord,
  WorkflowDefinitionScope,
} from './workflow-definition-version-types';
import { WorkflowDefinitionVersionStoreError } from './workflow-definition-version-types';
import {
  canonicalWorkflowJson,
  canonicalizeWorkflowDefinition,
  MAX_WORKFLOW_DEFINITION_BYTES,
  WorkflowDefinitionCanonicalError,
  type WorkflowDefinitionFingerprintInput,
} from './workflow-definition-canonical';

/** Canonicalize untrusted publish/draft content with a stable 422 boundary. */
export function canonicalizeWorkflowVersionContent(
  input: WorkflowDefinitionFingerprintInput,
): ReturnType<typeof canonicalizeWorkflowDefinition> {
  try {
    return canonicalizeWorkflowDefinition(input);
  } catch (error) {
    if (!(error instanceof WorkflowDefinitionCanonicalError)) throw error;
    throw new WorkflowDefinitionVersionStoreError(
      error.message,
      'WORKFLOW_DEFINITION_GRAPH_INVALID',
      422,
    );
  }
}

/** Canonicalize auxiliary draft data under the same bounded payload contract. */
export function canonicalizeWorkflowVersionValue(value: unknown, label: string): string {
  try {
    const json = canonicalWorkflowJson(value);
    if (Buffer.byteLength(json, 'utf8') > MAX_WORKFLOW_DEFINITION_BYTES) {
      throw new WorkflowDefinitionCanonicalError(
        `${label} exceeds ${MAX_WORKFLOW_DEFINITION_BYTES} bytes`,
      );
    }
    return json;
  } catch (error) {
    if (!(error instanceof WorkflowDefinitionCanonicalError)) throw error;
    throw new WorkflowDefinitionVersionStoreError(
      error.message,
      'WORKFLOW_DEFINITION_GRAPH_INVALID',
      422,
    );
  }
}

export function normalizeWorkflowDefinitionScope(
  scope?: WorkflowDefinitionScope,
): Required<WorkflowDefinitionScope> {
  return {
    type: scope?.type?.trim() || 'application',
    id: scope?.id?.trim() || '',
  };
}

export function requireWorkflowDefinitionName(value: string): string {
  const name = value.trim();
  if (!name) throw workflowVersionConflict('Workflow definition name must not be empty');
  return name;
}

export function assertWorkflowDefinitionSource(
  catalog: WorkflowDefinitionCatalogRecord,
  source: PublishWorkflowDefinitionVersionInput['source'],
): void {
  if (catalog.source !== source) {
    throw new WorkflowDefinitionVersionStoreError(
      'Workflow definition is owned by another authoring source',
      'WORKFLOW_DEFINITION_SOURCE_CONFLICT',
      409,
    );
  }
}

export function assertWorkflowExpectedActiveVersion(
  catalog: WorkflowDefinitionCatalogRecord,
  input: PublishWorkflowDefinitionVersionInput,
): void {
  if (Object.prototype.hasOwnProperty.call(input, 'expectedActiveVersionId')
    && catalog.active_version_id !== (input.expectedActiveVersionId ?? null)) {
    throw workflowVersionConflict('Workflow definition active version changed concurrently');
  }
}

export function workflowVersionNotFound(): WorkflowDefinitionVersionStoreError {
  return new WorkflowDefinitionVersionStoreError(
    'Workflow definition version not found',
    'WORKFLOW_DEFINITION_VERSION_NOT_FOUND',
    404,
  );
}

export function workflowVersionConflict(message: string): WorkflowDefinitionVersionStoreError {
  return new WorkflowDefinitionVersionStoreError(
    message,
    'WORKFLOW_DEFINITION_VERSION_CONFLICT',
    409,
  );
}
