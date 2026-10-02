/** Validation for the public workflow start boundary. */

import { WorkflowError } from './workflow-error';

export interface WorkflowStartOptions {
  /** Start one already-published immutable graph version. */
  version?: number;
}

export function validateWorkflowStartOptions(value: unknown): WorkflowStartOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('Workflow start options must be an object');
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => key !== 'version');
  if (unknown) throw invalid(`Workflow start option "${unknown}" is not supported`);
  if (record.version === undefined) return {};
  if (!Number.isSafeInteger(record.version) || Number(record.version) < 1) {
    throw invalid('Workflow start version must be a positive integer');
  }
  return { version: Number(record.version) };
}

function invalid(message: string): WorkflowError {
  return new WorkflowError(message, 'WORKFLOW_REQUEST_INVALID', 422);
}
