/** Stable workflow-domain errors shared by the service and HTTP plugin. */

export type WorkflowErrorCode =
  | 'WORKFLOW_NOT_READY'
  | 'WORKFLOW_DRAINING'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_DEFINITION_NOT_FOUND'
  | 'WORKFLOW_DEFINITION_INVALID'
  | 'WORKFLOW_HANDLER_NOT_REGISTERED'
  | 'WORKFLOW_STATE_INVALID'
  | 'WORKFLOW_INPUT_INVALID'
  | 'WORKFLOW_EVENT_INVALID'
  | 'WORKFLOW_REQUEST_INVALID'
  | 'WORKFLOW_REQUEST_PARSE_FAILED'
  | 'WORKFLOW_CONFIG_INVALID'
  | 'WORKFLOW_STARTUP_FAILED'
  | 'WORKFLOW_INTERNAL_ERROR';

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly code: WorkflowErrorCode,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export function workflowNotFound(): WorkflowError {
  return new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404);
}

/** Bound hostile thrown values before they enter durable state or telemetry. */
export function formatWorkflowError(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return String(message).slice(0, 2_000);
  } catch {
    return 'Workflow handler failed with an unprintable error';
  }
}
