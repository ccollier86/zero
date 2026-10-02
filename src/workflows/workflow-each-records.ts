/** Pure graph-each row construction and JSON helpers. */

import { WorkflowError } from './workflow-error';
import type { WorkflowActivityNode, WorkflowEachNode } from './workflow-ir';
import type { WorkflowStepRecord } from './types';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';

export function requireEachBodyActivity(node: WorkflowEachNode): WorkflowActivityNode {
  const body = node.body.nodes[0];
  if (node.body.nodes.length !== 1 || node.body.edges.length !== 0 || body?.kind !== 'activity') {
    throw new WorkflowError('Workflow each body must contain one activity', 'WORKFLOW_GRAPH_INVALID', 500);
  }
  return body;
}

export function createEachChildStepRow(
  instanceId: string,
  parent: WorkflowStepRecord,
  body: WorkflowActivityNode,
  stepId: string,
  itemKey: string,
  itemIndex: number,
  status: string,
  now: string,
): Record<string, unknown> {
  return {
    step_id: stepId, instance_id: instanceId, step_index: parent.step_index,
    step_name: body.label ?? body.id, status, input: null, output: null,
    error: status === 'skipped' ? 'Item did not match the configured schema' : null,
    retries: 0, max_retries: Math.max(1, body.retries ?? 3), retry_at: null,
    wait_event: null, timeout_at: null, started_at: null,
    completed_at: status === 'skipped' ? now : null, created_at: now,
    node_id: body.id, node_kind: body.kind, node_path: `${parent.node_id}/${body.id}`,
    parent_step_id: parent.step_id, branch_key: null, item_key: itemKey,
    item_index: itemIndex, activation_key: itemKey, updated_at: now,
  };
}

export function firstDuplicateWorkflowEachKey(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

export function parseWorkflowEachJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError('Persisted workflow JSON must be text');
  return JSON.parse(value);
}

export function serializeWorkflowEachJson(value: unknown): string | null {
  return serializeWorkflowRuntimeJson(value, {
    code: 'WORKFLOW_OUTPUT_INVALID', label: 'Workflow fan-out value',
    invalidStatus: 500, limitStatus: 500,
  });
}
