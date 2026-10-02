/** Observability events for terminal graph activity attempts. */

import { OBS_CODES } from '../observability/codes';
import type { WorkflowObservability } from './workflow-observability';

export function emitWorkflowGraphActivityFailure(input: {
  instanceId: string;
  stepId: string;
  nodeId: string;
  itemIndex?: number;
  result: 'failed' | 'timed-out';
  cause: unknown;
}, observability: WorkflowObservability): void {
  if (input.result === 'timed-out') observability.emitAfterCommit(OBS_CODES.WORKFLOW_STEP_TIMED_OUT, {
    metadata: { instanceId: input.instanceId, stepId: input.stepId, nodeId: input.nodeId },
  });
  observability.emitAfterCommit(input.itemIndex === undefined
    ? OBS_CODES.WORKFLOW_INSTANCE_FAILED
    : OBS_CODES.WORKFLOW_EACH_ITEM_FAILED, {
    error: input.cause,
    metadata: {
      instanceId: input.instanceId,
      stepId: input.stepId,
      nodeId: input.nodeId,
      ...(input.itemIndex === undefined ? {} : { itemIndex: input.itemIndex }),
      reason: input.result === 'timed-out' ? 'timeout' : 'activity',
    },
  });
}
