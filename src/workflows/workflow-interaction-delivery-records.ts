/** Pinned child-node records for interaction delivery activities. */

import type {
  WorkflowActivityInvocation,
  WorkflowActivityNode,
  WorkflowWaitNode,
} from './workflow-ir';
import type { WorkflowStepRecord } from './types';

export function interactionDeliveryActivityNode(
  parent: WorkflowWaitNode,
  invocation: WorkflowActivityInvocation,
  index: number,
): WorkflowActivityNode {
  return {
    id: `${parent.id}/delivery/${index}`,
    kind: 'activity',
    label: `Deliver ${parent.label ?? parent.id}`,
    activity: invocation.activity,
    input: invocation.input,
    retries: 3,
  };
}

export function createInteractionDeliveryStepRow(
  instanceId: string,
  parent: WorkflowStepRecord,
  index: number,
  now: string,
): Record<string, unknown> {
  return {
    step_id: `wstep_${crypto.randomUUID()}`, instance_id: instanceId,
    step_index: parent.step_index, step_name: `Deliver ${parent.step_name}`,
    status: 'pending', input: null, output: null,
    error: null, retries: 0, max_retries: 3, retry_at: null, wait_event: null,
    timeout_at: null, started_at: null, completed_at: null, created_at: now,
    node_id: `${parent.node_id}/delivery/${index}`, node_kind: 'activity',
    node_path: `${parent.node_path}/delivery/${index}`, parent_step_id: parent.step_id,
    branch_key: null, item_key: null, item_index: null,
    activation_key: `delivery:${index}`, updated_at: now,
  };
}

export function assertInteractionDeliveryStep(
  step: WorkflowStepRecord,
  instanceId: string,
  parent: WorkflowStepRecord,
  invocation: WorkflowActivityInvocation,
  index: number,
): void {
  if (step.instance_id !== instanceId
    || step.parent_step_id !== parent.step_id
    || step.step_index !== parent.step_index
    || step.node_id !== `${parent.node_id}/delivery/${index}`
    || step.node_kind !== 'activity'
    || step.node_path !== `${parent.node_path}/delivery/${index}`
    || step.activation_key !== `delivery:${index}`
    || step.item_key !== null
    || step.item_index !== null
    || step.step_name !== `Deliver ${parent.step_name}`
    || step.max_retries !== 3) {
    throw new TypeError(
      `Workflow interaction delivery "${invocation.activity.name}" does not match its pinned definition`,
    );
  }
}
