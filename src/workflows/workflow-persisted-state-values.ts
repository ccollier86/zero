/**
 * workflow-persisted-state-values.ts
 *
 * Provides strict scalar, timestamp, and bounded-JSON checks for private
 * workflow recovery validators. It performs no persistence or transitions.
 */

import {
  parseWorkflowJson,
  serializeWorkflowJson,
  workflowJsonBytes,
  type WorkflowJsonValue,
} from './workflow-json-value';
import { MAX_WORKFLOW_RUNTIME_JSON_BYTES } from './workflow-runtime-json';

/** Parse one bounded, data-only JSON snapshot or fail closed. */
export function parsePersistedWorkflowJson(
  value: unknown,
  label: string,
): WorkflowJsonValue {
  if (typeof value !== 'string') persistedStateInvalid(`${label} is not JSON text`);
  if (workflowJsonBytes(value) > MAX_WORKFLOW_RUNTIME_JSON_BYTES) {
    persistedStateInvalid(`${label} exceeds its byte limit`);
  }
  try {
    return parseWorkflowJson(value);
  } catch {
    return persistedStateInvalid(`${label} is not valid workflow JSON`);
  }
}

/** Return stable JSON for equality checks without trusting stored key order. */
export function canonicalPersistedWorkflowJson(
  value: unknown,
  label: string,
): string {
  return serializeWorkflowJson(parsePersistedWorkflowJson(value, label));
}

/** Validate a nullable private JSON field under the shared runtime cap. */
export function assertOptionalPersistedWorkflowJson(
  value: unknown,
  label: string,
): void {
  if (value !== null) parsePersistedWorkflowJson(value, label);
}

/** Validate a canonical ISO timestamp and return its epoch milliseconds. */
export function persistedWorkflowTimestamp(
  value: unknown,
  label: string,
  nullable = false,
): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') persistedStateInvalid(`${label} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    persistedStateInvalid(`${label} is invalid`);
  }
  return milliseconds;
}

/** Validate a persisted identifier or bounded display/error string. */
export function assertPersistedWorkflowString(
  value: unknown,
  label: string,
  maximumLength: number,
  options: { nullable?: boolean; allowEmpty?: boolean } = {},
): asserts value is string | null {
  if (value === null && options.nullable) return;
  if (typeof value !== 'string'
    || (!options.allowEmpty && !value)
    || value.length > maximumLength
    || value.includes('\0')) {
    persistedStateInvalid(`${label} is invalid`);
  }
}

/** Raise the shared fail-closed error consumed by graph recovery/runtime. */
export function persistedStateInvalid(message: string): never {
  throw new TypeError(`Workflow graph persisted state is invalid: ${message}`);
}
