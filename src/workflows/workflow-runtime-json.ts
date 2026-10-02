/** Shared JSON serialization and byte limits for durable workflow runtime values. */

import { WorkflowError, type WorkflowErrorCode } from './workflow-error';

export const MAX_WORKFLOW_RUNTIME_JSON_BYTES = 1024 * 1024;

export interface WorkflowRuntimeJsonOptions {
  code: WorkflowErrorCode;
  label: string;
  invalidStatus?: number;
  limitStatus?: number;
}

/** Serialize one runtime value and reject it before persistence when over budget. */
export function serializeWorkflowRuntimeJson(
  value: unknown,
  options: WorkflowRuntimeJsonOptions,
): string | null {
  if (value === undefined) return null;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalid(options);
  }
  if (serialized === undefined) throw invalid(options);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKFLOW_RUNTIME_JSON_BYTES) {
    throw new WorkflowError(
      `${options.label} exceeds its byte limit`,
      options.code,
      options.limitStatus ?? 413,
    );
  }
  return serialized;
}

function invalid(options: WorkflowRuntimeJsonOptions): WorkflowError {
  return new WorkflowError(
    `${options.label} is not JSON-serializable`,
    options.code,
    options.invalidStatus ?? 422,
  );
}
