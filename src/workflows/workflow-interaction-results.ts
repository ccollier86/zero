/** Pure normalization and projection helpers for interaction submissions. */

import { WorkflowError } from './workflow-error';
import type {
  WorkflowInteractionValidationResult,
  WorkflowInteractionSubmissionResult,
} from './workflow-interaction-service';
import type {
  WorkflowInteractionRecord,
  WorkflowInteractionDecisionResult,
  WorkflowInteractionResponseRecord,
} from './workflow-interaction-store';

export function normalizeInteractionValidationResult(
  result: WorkflowInteractionValidationResult | boolean,
): WorkflowInteractionValidationResult {
  if (typeof result === 'boolean') return { valid: result };
  if (!result || typeof result.valid !== 'boolean') {
    throw new WorkflowError(
      'Workflow interaction validator returned an invalid result',
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
  return result;
}

export function replayInteractionResult(
  response: WorkflowInteractionResponseRecord,
  interaction: WorkflowInteractionRecord | null,
): WorkflowInteractionSubmissionResult | null {
  if (response.status === 'processing' || !interaction) return null;
  return {
    outcome: response.status === 'accepted'
      ? 'accepted' : response.status === 'rejected' ? 'rejected' : 'superseded',
    interaction,
    ...(response.rejectionCode ? { rejectionCode: response.rejectionCode } : {}),
    ...(response.publicMessage ? { publicMessage: response.publicMessage } : {}),
  };
}

export function toPublicInteractionResult(
  result: WorkflowInteractionDecisionResult,
): WorkflowInteractionSubmissionResult {
  return {
    outcome: result.outcome,
    interaction: result.interaction,
    ...(result.response.rejectionCode
      ? { rejectionCode: result.response.rejectionCode } : {}),
    ...(result.response.publicMessage
      ? { publicMessage: result.response.publicMessage } : {}),
  };
}
