/** Primitive shape checks shared by workflow graph validation. */

import { isWorkflowExpression, validateWorkflowExpression } from './workflow-expression';
import {
  WORKFLOW_GRAPH_LIMITS,
  type WorkflowActivityReference,
} from './workflow-ir';
import { WorkflowError } from './workflow-error';

interface WorkflowJsonBudget {
  members: number;
  characters: number;
}

export function validateWorkflowInteraction(value: unknown): void {
  if (!isWorkflowRecord(value)) workflowGraphInvalid('Workflow interaction must be an object');
  assertWorkflowKnownKeys(value, ['delivery', 'validator', 'maxRejections', 'request'], 'Workflow interaction');
  if (value.delivery !== undefined) {
    if (!Array.isArray(value.delivery)
      || value.delivery.length > WORKFLOW_GRAPH_LIMITS.maxActivityDeliveries) {
      workflowGraphInvalid(
        `Workflow interaction delivery is limited to ${WORKFLOW_GRAPH_LIMITS.maxActivityDeliveries} activities`,
      );
    }
    for (const invocation of value.delivery) {
      if (!isWorkflowRecord(invocation)) {
        workflowGraphInvalid('Workflow interaction delivery must be an activity invocation');
      }
      assertWorkflowKnownKeys(invocation, ['activity', 'input'], 'Workflow interaction delivery');
      validateWorkflowActivityReference(invocation.activity);
      if (invocation.input !== undefined) validateWorkflowExpression(invocation.input);
    }
  }
  if (value.validator !== undefined) validateWorkflowActivityReference(value.validator);
  if (value.maxRejections !== undefined
    && (!Number.isInteger(value.maxRejections)
      || Number(value.maxRejections) < 1
      || Number(value.maxRejections) > WORKFLOW_GRAPH_LIMITS.maxInteractionRejections)) {
    workflowGraphInvalid(
      `Workflow interaction maxRejections must be from 1 to ${WORKFLOW_GRAPH_LIMITS.maxInteractionRejections}`,
    );
  }
  if (value.request !== undefined) {
    if (isWorkflowExpression(value.request)) validateWorkflowExpression(value.request);
    else assertWorkflowJsonSafe(value.request, new Set());
  }
}

export function validateWorkflowActivityReference(
  value: unknown,
): asserts value is WorkflowActivityReference {
  if (!isWorkflowRecord(value)) workflowGraphInvalid('Workflow activity reference must be an object');
  assertWorkflowKnownKeys(value, ['name', 'version'], 'Workflow activity reference');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name !== value.name.trim()) {
    workflowGraphInvalid('Workflow activity name must be non-empty and trimmed');
  }
  if (value.name.length > WORKFLOW_GRAPH_LIMITS.maxActivityNameLength) {
    workflowGraphInvalid('Workflow activity name is too long');
  }
  if (value.version !== undefined
    && (typeof value.version !== 'string'
      || !value.version.trim()
      || value.version !== value.version.trim()
      || value.version.length > WORKFLOW_GRAPH_LIMITS.maxActivityVersionLength)) {
    workflowGraphInvalid('Workflow activity version must be non-empty and trimmed');
  }
}

export function validateWorkflowExecutionPolicy(value: Record<string, unknown>): void {
  if (value.retries !== undefined
    && (!Number.isInteger(value.retries)
      || Number(value.retries) < 1
      || Number(value.retries) > 1_000)) {
    workflowGraphInvalid('Workflow activity retries must be an integer from 1 to 1000');
  }
  if (value.backoffMs !== undefined
    && (typeof value.backoffMs !== 'number'
      || !Number.isFinite(value.backoffMs)
      || value.backoffMs < 0)) {
    workflowGraphInvalid('Workflow activity backoffMs must be a finite non-negative number');
  }
  validateWorkflowPositiveDuration(value.timeoutMs, 'activity timeoutMs');
}

export function validateWorkflowPositiveDuration(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0
    || !Number.isFinite(new Date(Date.now() + value).getTime())) {
    workflowGraphInvalid(`Workflow ${label} must be a finite positive duration`);
  }
}

export function assertWorkflowId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string'
    || !value
    || value.length > WORKFLOW_GRAPH_LIMITS.maxIdLength
    || !/^[A-Za-z0-9@][A-Za-z0-9@/._:-]*$/.test(value)) {
    workflowGraphInvalid(`Workflow ${label} id is invalid`);
  }
}

export function assertWorkflowEvent(value: unknown): asserts value is string {
  if (typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || value.length > WORKFLOW_GRAPH_LIMITS.maxEventLength) {
    workflowGraphInvalid('Workflow event name is invalid');
  }
}

export function assertWorkflowJsonSafe(
  value: unknown,
  seen: Set<object>,
  depth = 0,
  budget: WorkflowJsonBudget = { members: 0, characters: 0 },
): void {
  budget.members += 1;
  if (budget.members > WORKFLOW_GRAPH_LIMITS.maxJsonMembers) {
    workflowGraphInvalid(`JSON values cannot exceed ${WORKFLOW_GRAPH_LIMITS.maxJsonMembers} members`);
  }
  if (depth > WORKFLOW_GRAPH_LIMITS.maxJsonDepth) {
    workflowGraphInvalid(`JSON values cannot exceed ${WORKFLOW_GRAPH_LIMITS.maxJsonDepth} levels`);
  }
  if (typeof value === 'string') {
    if (value.length > WORKFLOW_GRAPH_LIMITS.maxJsonStringLength) {
      workflowGraphInvalid('JSON strings are too long');
    }
    addJsonCharacters(value.length, budget);
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) workflowGraphInvalid('JSON values must contain finite numbers');
    return;
  }
  if (typeof value !== 'object') {
    workflowGraphInvalid('JSON values cannot contain undefined, functions, symbols, or bigint');
  }
  if (seen.has(value)) workflowGraphInvalid('JSON values cannot contain cycles');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    workflowGraphInvalid('JSON values must use plain objects and arrays');
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
    workflowGraphInvalid('JSON values cannot contain symbol properties');
  }
  seen.add(value);
  if (Array.isArray(value)) validateJsonArray(value, seen, depth, budget);
  else validateJsonObject(value, seen, depth, budget);
  seen.delete(value);
}

function validateJsonArray(
  value: unknown[],
  seen: Set<object>,
  depth: number,
  budget: WorkflowJsonBudget,
): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      workflowGraphInvalid('JSON arrays cannot be sparse');
    }
    assertWorkflowJsonSafe(value[index], seen, depth + 1, budget);
  }
  if (Object.keys(value).some((key) => !/^\d+$/.test(key))) {
    workflowGraphInvalid('JSON arrays cannot contain named properties');
  }
}

function validateJsonObject(
  value: object,
  seen: Set<object>,
  depth: number,
  budget: WorkflowJsonBudget,
): void {
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)
      || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      workflowGraphInvalid('JSON objects cannot contain hidden, accessor, or unsafe properties');
    }
    addJsonCharacters(key.length, budget);
    assertWorkflowJsonSafe(descriptor.value, seen, depth + 1, budget);
  }
}

function addJsonCharacters(count: number, budget: WorkflowJsonBudget): void {
  budget.characters += count;
  if (budget.characters > WORKFLOW_GRAPH_LIMITS.maxJsonCharacters) {
    workflowGraphInvalid('JSON values contain too much string data');
  }
}

export function assertWorkflowKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !accepted.has(key));
  if (unknown) workflowGraphInvalid(`${label} property "${unknown}" is not supported`);
}

export function isWorkflowRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function workflowGraphInvalid(message: string): never {
  throw new WorkflowError(message, 'WORKFLOW_GRAPH_INVALID', 422);
}
