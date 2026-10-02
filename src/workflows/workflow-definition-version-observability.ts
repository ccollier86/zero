/** Stable observability projection for immutable workflow-version lifecycle events. */

import { OBS_CODES } from '../observability/codes';
import type { ResolvedWorkflowDefinitionVersion } from './workflow-definition-version-types';
import type { WorkflowObservability } from './workflow-observability';

export function emitWorkflowDefinitionCode(
  code: typeof OBS_CODES.WORKFLOW_DEFINITION_PUBLISHED,
  result: ResolvedWorkflowDefinitionVersion,
  actorId: string | null | undefined,
  observability: WorkflowObservability,
): void {
  observability.emitAfterCommit(code, {
    metadata: {
      definitionId: result.catalog.definition_id,
      name: result.catalog.name,
      versionId: result.version.version_id,
      version: result.version.version_number,
      source: result.version.source,
      actorId: actorId ?? null,
    },
  });
}
