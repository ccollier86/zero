/** Secure default responder policy for graph workflow interactions. */

import type { WorkflowGraphStore } from './workflow-graph-store';
import { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import type { WorkflowJsonValue } from './workflow-json-value';
import type { WorkflowObservability } from './workflow-observability';

/**
 * Graph waits default to their workflow starter. Applications can replace this
 * authority when they deliberately expose richer Guardian or tenant policy.
 */
export function createWorkflowGraphInteractionAuthority(
  store: WorkflowGraphStore,
  observability?: WorkflowObservability,
): WorkflowInteractionAuthority {
  return new WorkflowInteractionAuthority(({ instanceId, actor, responderPolicy }) => {
    if (!isStarterPolicy(responderPolicy)) return false;
    const instance = store.getInstance(instanceId);
    return Boolean(instance?.started_by && instance.started_by === actor.actorId);
  }, observability);
}

function isStarterPolicy(value: WorkflowJsonValue): boolean {
  return Boolean(value && !Array.isArray(value) && typeof value === 'object'
    && value.type === 'starter');
}
