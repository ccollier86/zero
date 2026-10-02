/** JSON and abort helpers shared by graph activity execution. */

import { WorkflowError } from './workflow-error';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';

export async function raceWorkflowActivityWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw workflowAbortReason(signal);
  let remove: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = () => reject(workflowAbortReason(signal));
    signal.addEventListener('abort', listener, { once: true });
    remove = () => signal.removeEventListener('abort', listener);
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    remove();
  }
}

export function workflowAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Workflow execution aborted');
}

export function parseWorkflowPersistedJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError('Persisted workflow JSON must be text');
  return JSON.parse(value);
}

export function serializeWorkflowActivityOutput(value: unknown): string | null {
  return serializeWorkflowRuntimeJson(value, {
    code: 'WORKFLOW_ACTIVITY_OUTPUT_INVALID',
    label: 'Workflow activity output',
    invalidStatus: 500,
    limitStatus: 500,
  });
}

export function serializeWorkflowActivityInput(value: unknown): string | null {
  return serializeWorkflowRuntimeJson(value, {
    code: 'WORKFLOW_ACTIVITY_INPUT_INVALID',
    label: 'Workflow activity input',
  });
}
