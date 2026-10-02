/** Lossless private persistence codec for pinned workflow activity references. */

import type { WorkflowActivityReference } from './workflow-ir';
import { WorkflowError } from './workflow-error';

export function encodeWorkflowActivityReference(reference: WorkflowActivityReference): string {
  return JSON.stringify([reference.name, reference.version ?? null]);
}

export function decodeWorkflowActivityReference(value: string): WorkflowActivityReference {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.length === 2
      && typeof parsed[0] === 'string' && parsed[0]
      && (parsed[1] === null || typeof parsed[1] === 'string')) {
      return parsed[1] === null
        ? { name: parsed[0] }
        : { name: parsed[0], version: parsed[1] };
    }
  } catch {
    // Pre-release rows used `name@version`; retain a read path for local data.
    const index = value.lastIndexOf('@');
    if (index > 0) return { name: value.slice(0, index), version: value.slice(index + 1) };
    if (value) return { name: value };
  }
  throw new WorkflowError(
    'Workflow interaction validator reference is invalid',
    'WORKFLOW_CONFIG_INVALID',
    500,
  );
}
