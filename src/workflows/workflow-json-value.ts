/**
 * workflow-json-value.ts
 *
 * Owns the strict JSON-value boundary shared by private workflow state. It
 * accepts data only, returns detached values, and never performs persistence
 * or workflow transitions.
 */

import { WorkflowError, type WorkflowErrorCode } from './workflow-error';

/** JSON data accepted by durable workflow state. */
export type WorkflowJsonValue =
  | null
  | boolean
  | number
  | string
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue };

const MAX_JSON_DEPTH = 64;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype']);

/** Validate and detach a value before it crosses a durable JSON boundary. */
export function normalizeWorkflowJson(
  value: unknown,
  code: WorkflowErrorCode = 'WORKFLOW_STATE_INVALID',
): WorkflowJsonValue {
  return normalize(value, new Set<object>(), 0, code);
}

/** Serialize validated JSON with stable object-key ordering. */
export function serializeWorkflowJson(
  value: unknown,
  code: WorkflowErrorCode = 'WORKFLOW_STATE_INVALID',
): string {
  return JSON.stringify(sortJson(normalizeWorkflowJson(value, code)));
}

/** Parse persisted JSON and apply the same strict data-only validation. */
export function parseWorkflowJson(
  text: string,
  code: WorkflowErrorCode = 'WORKFLOW_STATE_INVALID',
): WorkflowJsonValue {
  try {
    return normalizeWorkflowJson(JSON.parse(text), code);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw workflowJsonError('Persisted workflow JSON is malformed', code);
  }
}

/** Return a detached clone so callers cannot mutate a store-owned snapshot. */
export function cloneWorkflowJson(value: WorkflowJsonValue): WorkflowJsonValue {
  return normalizeWorkflowJson(value);
}

/** Measure the UTF-8 bytes that will be persisted. */
export function workflowJsonBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function normalize(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  code: WorkflowErrorCode,
): WorkflowJsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw workflowJsonError(`Workflow JSON exceeds ${MAX_JSON_DEPTH} levels`, code);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw workflowJsonError('Workflow JSON numbers must be finite', code);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw workflowJsonError('Workflow state accepts JSON values only', code);
  }
  if (ancestors.has(value)) {
    throw workflowJsonError('Workflow JSON must not contain cycles', code);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: WorkflowJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw workflowJsonError('Workflow JSON arrays must not be sparse', code);
        }
        result.push(normalize(value[index], ancestors, depth + 1, code));
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw workflowJsonError('Workflow JSON objects must be plain objects', code);
    }
    const result: Record<string, WorkflowJsonValue> = Object.create(null);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable) continue;
      if (BLOCKED_KEYS.has(key) || !('value' in descriptor)) {
        throw workflowJsonError('Workflow JSON contains an unsafe object member', code);
      }
      result[key] = normalize(descriptor.value, ancestors, depth + 1, code);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function sortJson(value: WorkflowJsonValue): WorkflowJsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  const sorted: Record<string, WorkflowJsonValue> = Object.create(null);
  for (const key of Object.keys(value).sort()) sorted[key] = sortJson(value[key]!);
  return sorted;
}

function workflowJsonError(message: string, code: WorkflowErrorCode): WorkflowError {
  return new WorkflowError(message, code, 400);
}
