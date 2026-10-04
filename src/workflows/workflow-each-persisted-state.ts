/**
 * workflow-each-persisted-state.ts
 *
 * Validates the private fan-out envelope against an immutable graph and its
 * public child steps. It performs no database I/O or runtime transitions.
 */

import { evaluateWorkflowExpression } from './workflow-expression';
import type { WorkflowEachItemRecord } from './workflow-graph-store';
import type { WorkflowEachNode, WorkflowGraphIR } from './workflow-ir';
import { MAX_WORKFLOW_RUNTIME_JSON_BYTES } from './workflow-runtime-json';
import { validateWorkflowSchemaValue } from './workflow-schema-snapshot';
import { parseWorkflowJson, workflowJsonBytes } from './workflow-json-value';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';

const ITEM_STATUSES = new Set([
  'pending', 'running', 'completed', 'failed', 'skipped',
]);

export function validateWorkflowEachPersistedState(input: {
  instance: WorkflowInstanceRecord;
  graph: WorkflowGraphIR;
  steps: readonly WorkflowStepRecord[];
  items: readonly WorkflowEachItemRecord[];
}): void {
  const rootByNode = new Map(input.steps
    .filter((step) => step.parent_step_id === null && typeof step.node_id === 'string')
    .map((step) => [step.node_id!, step]));
  const itemsByNode = groupBy(input.items, (item) => item.node_id);
  const childrenByParent = groupBy(
    input.steps.filter((step) => step.parent_step_id !== null),
    (step) => step.parent_step_id!,
  );
  const accountedItems = new Set<string>();

  for (const node of input.graph.nodes) {
    if (node.kind !== 'each') continue;
    const parent = rootByNode.get(node.id);
    if (!parent) invalid(`each node "${node.id}" has no root step`);
    const children = childrenByParent.get(parent.step_id) ?? [];
    const items = itemsByNode.get(node.id) ?? [];
    for (const item of items) accountedItems.add(item.item_id);
    validateEachExpansion(input.instance, node, parent, children, items);
  }

  if (accountedItems.size !== input.items.length) {
    invalid('each items contain an unknown graph node');
  }
}

function validateEachExpansion(
  instance: WorkflowInstanceRecord,
  node: WorkflowEachNode,
  parent: WorkflowStepRecord,
  children: readonly WorkflowStepRecord[],
  items: readonly WorkflowEachItemRecord[],
): void {
  if (parent.status === 'pending' || parent.status === 'skipped') {
    if (children.length !== 0 || items.length !== 0 || parent.input !== null) {
      invalid(`each node "${node.id}" has state before expansion`);
    }
    return;
  }
  if (parent.status !== 'waiting' && parent.status !== 'completed') {
    invalid(`each node "${node.id}" has an invalid expanded status`);
  }

  if (node.visibility === 'private' && parent.input !== null) {
    invalid(`private each node "${node.id}" exposed its source`);
  }
  const source = node.visibility === 'private'
    ? [...items]
      .sort((left, right) => left.item_index - right.item_index)
      .map((item, index) => parseJson(
        item.input_json,
        `each node "${node.id}" item ${index} input`,
      ))
    : parseJson(parent.input, `each node "${node.id}" source`);
  if (!Array.isArray(source)) invalid(`each node "${node.id}" source is not an array`);
  if (items.length !== source.length || children.length !== source.length) {
    invalid(`each node "${node.id}" item count does not match its source`);
  }

  const itemKeys = new Set<string>();
  const itemIndexes = new Set<number>();
  const childKeys = new Set<string>();
  const itemsByIdentity = new Map<string, WorkflowEachItemRecord>();
  const childrenByIdentity = new Map<string, WorkflowStepRecord>();
  for (const item of items) {
    const itemIndex = Number(item.item_index);
    if (!Number.isSafeInteger(itemIndex) || itemIndex < 0
      || itemKeys.has(item.item_key) || itemIndexes.has(itemIndex)) {
      invalid(`each node "${node.id}" contains duplicate item identity`);
    }
    itemKeys.add(item.item_key);
    itemIndexes.add(itemIndex);
    itemsByIdentity.set(identity(itemIndex, item.item_key), item);
  }
  for (const child of children) {
    const childIndex = Number(child.item_index);
    if (!child.item_key || !Number.isSafeInteger(childIndex) || childIndex < 0
      || childKeys.has(child.item_key)
      || childrenByIdentity.has(identity(childIndex, child.item_key))) {
      invalid(`each node "${node.id}" contains duplicate child identity`);
    }
    childKeys.add(child.item_key);
    childrenByIdentity.set(identity(childIndex, child.item_key), child);
  }

  source.forEach((value, index) => {
    const key = expectedItemKey(node, value, index);
    const pairIdentity = identity(index, key);
    const item = itemsByIdentity.get(pairIdentity);
    const child = childrenByIdentity.get(pairIdentity);
    if (!item || !child) {
      invalid(`each node "${node.id}" item ${index} has no exact item/child pair`);
    }
    validateEachItem(instance, node, parent, item, child, value, index, key);
  });
  if (parent.status === 'completed') {
    validateCompletedExpansion(node, parent, source, itemsByIdentity);
  }
}

function identity(index: number, key: string): string {
  return `${index}\0${key}`;
}

function groupBy<T>(
  values: readonly T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}

function validateEachItem(
  instance: WorkflowInstanceRecord,
  node: WorkflowEachNode,
  parent: WorkflowStepRecord,
  item: WorkflowEachItemRecord,
  child: WorkflowStepRecord,
  value: unknown,
  index: number,
  key: string,
): void {
  const body = node.body.nodes[0];
  if (!body || body.kind !== 'activity') invalid(`each node "${node.id}" body is invalid`);
  const maxAttempts = Math.max(1, body.retries ?? 3);
  if (item.instance_id !== instance.instance_id
    || item.parent_step_id !== parent.step_id
    || item.node_id !== node.id
    || item.activation_key !== ''
    || item.item_key !== key
    || item.item_index !== index
    || item.max_attempts !== maxAttempts
    || child.instance_id !== instance.instance_id
    || child.parent_step_id !== parent.step_id
    || child.activation_key !== key
    || child.item_key !== key
    || child.item_index !== index
    || child.step_index !== parent.step_index
    || child.step_name !== (body.label ?? body.id)
    || child.branch_key !== null
    || child.wait_event !== null
    || child.created_at !== item.created_at) {
    invalid(`each node "${node.id}" item ${index} identity is invalid`);
  }
  if (!ITEM_STATUSES.has(String(item.status))) {
    invalid(`each node "${node.id}" item ${index} status is invalid`);
  }
  if (!Number.isInteger(item.attempts) || item.attempts < 0
    || item.attempts > item.max_attempts) {
    invalid(`each node "${node.id}" item ${index} attempts are invalid`);
  }

  const expectedInput = stringifyJson(value, `each node "${node.id}" item ${index}`);
  assertBoundedJson(item.input_json, `each node "${node.id}" item ${index} input`);
  if (item.input_json !== expectedInput) {
    invalid(`each node "${node.id}" item ${index} input does not match its source`);
  }
  assertOptionalBoundedJson(item.output_json, `each node "${node.id}" item ${index} output`);
  assertOptionalBoundedJson(child.input, `each node "${node.id}" child ${index} input`);
  assertOptionalBoundedJson(child.output, `each node "${node.id}" child ${index} output`);
  if (node.visibility === 'private'
    && (child.input !== null || child.output !== null || item.output_json !== null)) {
    invalid(`private each node "${node.id}" exposed an item value`);
  }
  assertItemTimestamps(item, node.id, index);
  if (item.error !== null && (typeof item.error !== 'string' || item.error.length > 2_000)) {
    invalid(`each node "${node.id}" item ${index} error is invalid`);
  }

  const valid = itemMatchesSchema(node, value);
  if (!valid && node.onInvalid === 'fail') {
    invalid(`each node "${node.id}" persisted an item rejected by its fail policy`);
  }
  const skipped = !valid && node.onInvalid === 'skip';
  if (skipped) {
    if (item.status !== 'skipped' || child.status !== 'skipped'
      || item.attempts !== 0 || item.output_json !== null
      || item.error !== 'Item did not match the configured schema'
      || child.error !== item.error || item.completed_at !== child.completed_at) {
      invalid(`each node "${node.id}" item ${index} invalid-item state is incoherent`);
    }
    return;
  }
  if (item.status === 'skipped' || child.status === 'skipped') {
    invalid(`each node "${node.id}" item ${index} was skipped despite matching its schema`);
  }

  validateMutableItemState(item, child, node.id, index);
}

function validateMutableItemState(
  item: WorkflowEachItemRecord,
  child: WorkflowStepRecord,
  nodeId: string,
  index: number,
): void {
  if (item.status === 'pending' || item.status === 'running') {
    const attemptsLag = child.retries - item.attempts;
    if (item.output_json !== null || item.completed_at !== null
      || attemptsLag < 0 || attemptsLag > 1
      || (item.status === 'pending' && child.status === 'running')) {
      invalid(`each node "${nodeId}" item ${index} active state is incoherent`);
    }
    if (item.status === 'running' && item.started_at === null) {
      invalid(`each node "${nodeId}" item ${index} running state has no start time`);
    }
    if (child.started_at !== null && (item.started_at === null
      || item.started_at > child.started_at)) {
      invalid(`each node "${nodeId}" item ${index} start lifecycle is incoherent`);
    }
    if (item.error !== null && (typeof item.error !== 'string' || item.error.length > 2_000)) {
      invalid(`each node "${nodeId}" item ${index} active error is invalid`);
    }
    return;
  }
  if (item.status === 'completed') {
    if (child.status !== 'completed' || item.output_json !== child.output
      || item.error !== child.error || item.attempts !== child.retries + 1
      || item.completed_at === null || item.completed_at !== child.completed_at) {
      invalid(`each node "${nodeId}" item ${index} completion is incoherent`);
    }
    return;
  }
  if (item.status === 'failed') {
    if (child.status !== 'failed' || child.retry_at !== null
      || item.output_json !== child.output || item.error !== child.error
      || !item.error || item.attempts !== child.retries
      || item.completed_at === null || item.completed_at !== child.completed_at) {
      invalid(`each node "${nodeId}" item ${index} failure is incoherent`);
    }
  }
}

function validateCompletedExpansion(
  node: WorkflowEachNode,
  parent: WorkflowStepRecord,
  source: readonly unknown[],
  itemsByIdentity: ReadonlyMap<string, WorkflowEachItemRecord>,
): void {
  const items = source.map((value, index) => {
    const key = expectedItemKey(node, value, index);
    const item = itemsByIdentity.get(identity(index, key));
    if (!item || !['completed', 'failed', 'skipped'].includes(item.status)) {
      invalid(`each node "${node.id}" completed with an active item`);
    }
    return item;
  });
  if (node.onError === 'fail' && items.some((item) => item.status === 'failed')) {
    invalid(`each node "${node.id}" completed despite a failed item`);
  }
  const output = items.map((item) => node.onError === 'collect' || node.onInvalid === 'skip'
    ? item.status === 'completed'
      ? { ok: true, value: parseNullableJson(item.output_json, node.id) }
      : { ok: false, skipped: item.status === 'skipped', error: item.error }
    : parseNullableJson(item.output_json, node.id));
  const expected = node.visibility === 'private'
    ? null
    : stringifyJson(output, `each node "${node.id}" completed output`);
  if (parent.output !== expected || parent.completed_at === null) {
    invalid(`each node "${node.id}" completed output is incoherent`);
  }
}

function parseNullableJson(value: string | null, nodeId: string): unknown {
  return value === null ? null : parseJson(value, `each node "${nodeId}" item output`);
}

function expectedItemKey(node: WorkflowEachNode, value: unknown, index: number): string {
  let keyValue: unknown;
  try {
    keyValue = node.itemKey
      ? evaluateWorkflowExpression(node.itemKey, { item: value, itemIndex: index })
      : index;
  } catch {
    return invalid(`each node "${node.id}" item key cannot be evaluated`);
  }
  const key = typeof keyValue === 'string' || typeof keyValue === 'number'
    ? String(keyValue) : '';
  if (!key || key.length > 256) invalid(`each node "${node.id}" item key is invalid`);
  return key;
}

function itemMatchesSchema(node: WorkflowEachNode, value: unknown): boolean {
  if (node.itemSchema === undefined) return true;
  try {
    return validateWorkflowSchemaValue(node.itemSchema, value);
  } catch {
    return invalid(`each node "${node.id}" item schema cannot be evaluated`);
  }
}

function assertItemTimestamps(item: WorkflowEachItemRecord, nodeId: string, index: number): void {
  assertTimestamp(item.created_at, `each node "${nodeId}" item ${index} created_at`, false);
  assertTimestamp(item.updated_at, `each node "${nodeId}" item ${index} updated_at`, false);
  assertTimestamp(item.started_at, `each node "${nodeId}" item ${index} started_at`);
  assertTimestamp(item.completed_at, `each node "${nodeId}" item ${index} completed_at`);
  if (item.updated_at < item.created_at) {
    invalid(`each node "${nodeId}" item ${index} timestamps are out of order`);
  }
  const terminal = item.status === 'completed' || item.status === 'failed'
    || item.status === 'skipped';
  if (terminal !== (item.completed_at !== null)) {
    invalid(`each node "${nodeId}" item ${index} completion timestamp is incoherent`);
  }
}

function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return invalid(`${label} is not JSON text`);
  assertBoundedJson(value, label);
  return JSON.parse(value);
}

function stringifyJson(value: unknown, label: string): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return invalid(`${label} is not JSON-serializable`);
  }
  if (serialized === undefined) invalid(`${label} is not JSON-serializable`);
  if (workflowJsonBytes(serialized) > MAX_WORKFLOW_RUNTIME_JSON_BYTES) {
    invalid(`${label} exceeds its byte limit`);
  }
  return serialized;
}

function assertOptionalBoundedJson(value: unknown, label: string): void {
  if (value === null) return;
  if (typeof value !== 'string') invalid(`${label} is not JSON text`);
  assertBoundedJson(value, label);
}

function assertBoundedJson(value: string, label: string): void {
  if (workflowJsonBytes(value) > MAX_WORKFLOW_RUNTIME_JSON_BYTES) {
    invalid(`${label} exceeds its byte limit`);
  }
  try {
    parseWorkflowJson(value);
  } catch {
    invalid(`${label} is invalid workflow JSON`);
  }
}

function assertTimestamp(value: unknown, label: string, nullable = true): void {
  if (value === null && nullable) return;
  if (typeof value !== 'string') invalid(`${label} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    invalid(`${label} is invalid`);
  }
}

function invalid(message: string): never {
  throw new TypeError(`Workflow graph persisted state is invalid: ${message}`);
}
