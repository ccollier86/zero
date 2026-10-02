/** Stable observability projection for immutable workflow-version lifecycle events. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ResolvedWorkflowDefinitionVersion } from './workflow-definition-version-types';

export function emitWorkflowDefinitionCode(
  code: typeof OBS_CODES.WORKFLOW_DEFINITION_PUBLISHED,
  result: ResolvedWorkflowDefinitionVersion,
  actorId: string | null | undefined,
): void {
  emitPlatformCode(code, {
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
