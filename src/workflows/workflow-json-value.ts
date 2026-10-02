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
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Validate and detach a value before it crosses a durable JSON boundary. */
export function normalizeWorkflowJson(
  value: unknown,
  code: WorkflowErrorCode = 'WORKFLOW_STATE_INVALID',
  status = defaultNormalizationStatus(code),
): WorkflowJsonValue {
  return normalize(value, new Set<object>(), 0, code, status);
}

/** Serialize validated JSON with stable object-key ordering. */
export function serializeWorkflowJson(
  value: unknown,
  code: WorkflowErrorCode = 'WORKFLOW_STATE_INVALID',
  status = defaultNormalizationStatus(code),
): string {
  return JSON.stringify(sortJson(normalizeWorkflowJson(value, code, status)));
}

/** Parse persisted JSON and apply the same strict data-only validation. */
export function parseWorkflowJson(
  text: string,
  code: WorkflowErrorCode = 'WORKFLOW_STATE_INVALID',
): WorkflowJsonValue {
  return parseJson(text, code, 500, 'Persisted workflow JSON is malformed');
}

/** Parse caller-controlled JSON while preserving a safe client-error boundary. */
export function parseWorkflowRequestJson(
  text: string,
  code: WorkflowErrorCode = 'WORKFLOW_REQUEST_PARSE_FAILED',
): WorkflowJsonValue {
  return parseJson(text, code, 400, 'Workflow request JSON is malformed');
}

function parseJson(
  text: string,
  code: WorkflowErrorCode,
  status: number,
  malformedMessage: string,
): WorkflowJsonValue {
  try {
    return normalize(JSON.parse(text), new Set<object>(), 0, code, status);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw workflowJsonError(malformedMessage, code, status);
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
  status: number,
): WorkflowJsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw workflowJsonError(`Workflow JSON exceeds ${MAX_JSON_DEPTH} levels`, code, status);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw workflowJsonError('Workflow JSON numbers must be finite', code, status);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw workflowJsonError('Workflow state accepts JSON values only', code, status);
  }
  if (ancestors.has(value)) {
    throw workflowJsonError('Workflow JSON must not contain cycles', code, status);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: WorkflowJsonValue[] = [];
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol'
        || (key !== 'length' && !isArrayIndexKey(key, value.length)))) {
        throw workflowJsonError(
          'Workflow JSON arrays cannot contain named or symbol members',
          code,
          status,
        );
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw workflowJsonError('Workflow JSON arrays must not be sparse', code, status);
        }
        result.push(normalize(descriptor.value, ancestors, depth + 1, code, status));
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw workflowJsonError('Workflow JSON objects must be plain objects', code, status);
    }
    const result: Record<string, WorkflowJsonValue> = Object.create(null);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') {
        throw workflowJsonError('Workflow JSON contains an unsafe object member', code, status);
      }
      const descriptor = descriptors[key];
      if (BLOCKED_KEYS.has(key) || !descriptor?.enumerable || !('value' in descriptor)) {
        throw workflowJsonError('Workflow JSON contains an unsafe object member', code, status);
      }
      result[key] = normalize(descriptor.value, ancestors, depth + 1, code, status);
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

function workflowJsonError(
  message: string,
  code: WorkflowErrorCode,
  status: number,
): WorkflowError {
  return new WorkflowError(message, code, status);
}

function defaultNormalizationStatus(code: WorkflowErrorCode): number {
  return code === 'WORKFLOW_STATE_INVALID' ? 500 : 400;
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}
