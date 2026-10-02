/** Integrity-check and decode one immutable workflow definition version. */

import { fingerprintStoredWorkflowDefinition } from './workflow-definition-canonical';
import type {
  ResolvedWorkflowDefinitionVersion,
  WorkflowDefinitionCatalogRecord,
  WorkflowDefinitionVersionRecord,
} from './workflow-definition-version-types';
import { WorkflowDefinitionVersionStoreError } from './workflow-definition-version-types';

/** Resolve persisted content only after its complete canonical fingerprint matches. */
export function resolveWorkflowDefinitionVersionRecord(
  catalog: WorkflowDefinitionCatalogRecord,
  version: WorkflowDefinitionVersionRecord,
): ResolvedWorkflowDefinitionVersion {
  try {
    const canonical = fingerprintStoredWorkflowDefinition({
      graphJson: version.graph_json,
      graphFormat: version.graph_format,
      schemaVersion: Number(version.schema_version),
      inputSchemaJson: version.input_schema_json,
      accessPolicyJson: version.access_policy_json,
    });
    if (canonical.fingerprint !== version.fingerprint) throw new TypeError('fingerprint mismatch');
    return {
      catalog,
      version,
      graph: JSON.parse(canonical.graphJson),
      inputSchema: canonical.inputSchemaJson === null
        ? null
        : JSON.parse(canonical.inputSchemaJson),
      accessPolicy: canonical.accessPolicyJson === null
        ? null
        : JSON.parse(canonical.accessPolicyJson),
    };
  } catch {
    throw new WorkflowDefinitionVersionStoreError(
      'Workflow definition version history failed integrity validation',
      'WORKFLOW_DEFINITION_HISTORY_INVALID',
      500,
    );
  }
}
