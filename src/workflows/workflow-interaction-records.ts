/**
 * workflow-interaction-records.ts
 *
 * Defines persisted interaction shapes plus validation and row mapping. It
 * owns no database handle, authorization policy, delivery, or execution.
 */

import { WorkflowError, type WorkflowErrorCode } from './workflow-error';
import {
  parseWorkflowJson,
  serializeWorkflowJson,
  workflowJsonBytes,
  type WorkflowJsonValue,
} from './workflow-json-value';
import { MAX_WORKFLOW_RUNTIME_JSON_BYTES } from './workflow-runtime-json';

export const INTERACTION_INVALID = 'WORKFLOW_INTERACTION_INVALID' as WorkflowErrorCode;
export const MAX_INTERACTION_PAYLOAD_BYTES = MAX_WORKFLOW_RUNTIME_JSON_BYTES;
const INTERACTION_NOT_FOUND = 'WORKFLOW_INTERACTION_NOT_FOUND' as WorkflowErrorCode;
const INTERACTION_EXPIRED = 'WORKFLOW_INTERACTION_EXPIRED' as WorkflowErrorCode;
const INTERACTION_CLOSED = 'WORKFLOW_INTERACTION_CLOSED' as WorkflowErrorCode;
const SUBMISSION_CONFLICT = 'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT' as WorkflowErrorCode;
const REJECTION_LIMIT = 'WORKFLOW_INTERACTION_REJECTION_LIMIT' as WorkflowErrorCode;
const MAX_REJECTIONS = 1000;

export type WorkflowInteractionStatus =
  | 'open'
  | 'accepted'
  | 'expired'
  | 'cancelled'
  | 'rejection_limit';

export type WorkflowInteractionResponseStatus =
  | 'processing'
  | 'rejected'
  | 'accepted'
  | 'superseded';

/** Safe durable interaction shape suitable for authorized Sync projection. */
export interface WorkflowInteractionRecord {
  interactionId: string;
  instanceId: string;
  nodeId: string;
  stepId: string;
  safeLabel: string;
  status: WorkflowInteractionStatus;
  openedAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  rejectionCount: number;
  maxRejections: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInteractionPrivateDefinition {
  responderPolicy: WorkflowJsonValue;
  responseSchema: WorkflowJsonValue;
  request: WorkflowJsonValue;
  validatorActivityId: string | null;
}

export interface OpenWorkflowInteractionInput {
  instanceId: string;
  nodeId: string;
  stepId: string;
  safeLabel: string;
  responderPolicy?: unknown;
  responseSchema?: unknown;
  request?: unknown;
  validatorActivityId?: string;
  openedAt: string;
  expiresAt?: string | null;
  maxRejections?: number;
}

export interface BeginWorkflowInteractionSubmissionInput {
  interactionId: string;
  submissionId: string;
  actorId: string;
  channel?: string;
  payloadHash: string;
  payloadJson: string;
  now: string;
  /** Graph responses are legal only while their owning instance is running. */
  requireRunningInstance?: boolean;
}

export interface WorkflowInteractionResponseRecord {
  responseId: string;
  interactionId: string;
  submissionId: string;
  actorId: string;
  channel: string | null;
  payloadHash: string;
  payloadJson: string;
  acceptedValueJson: string | null;
  status: WorkflowInteractionResponseStatus;
  rejectionCode: string | null;
  publicMessage: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export type WorkflowInteractionDecision =
  | { accepted: true; value: unknown }
  | { accepted: false; code: string; publicMessage: string };

export interface WorkflowInteractionDecisionResult {
  outcome: 'accepted' | 'rejected' | 'superseded';
  interaction: WorkflowInteractionRecord;
  response: WorkflowInteractionResponseRecord;
}

export interface WorkflowInteractionPublicRow {
  interaction_id: string;
  instance_id: string;
  node_id: string;
  step_id: string;
  safe_label: string;
  status: WorkflowInteractionStatus;
  opened_at: string;
  expires_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  rejection_count: number;
  max_rejections: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInteractionDetailRow {
  interaction_id: string;
  responder_policy_json: string | null;
  response_schema_json: string;
  request_json: string | null;
  validator_activity_id: string | null;
  accepted_response_id: string | null;
}

export interface WorkflowInteractionResponseRow {
  response_id: string;
  interaction_id: string;
  submission_id: string;
  actor_id: string;
  channel: string | null;
  payload_hash: string;
  payload_json: string;
  accepted_value_json: string | null;
  status: WorkflowInteractionResponseStatus;
  rejection_code: string | null;
  public_message: string | null;
  created_at: string;
  decided_at: string | null;
}

export type NormalizedOpenWorkflowInteractionInput = Omit<
  OpenWorkflowInteractionInput,
  'expiresAt' | 'maxRejections' | 'validatorActivityId'
> & {
  expiresAt: string | null;
  maxRejections: number;
  responderPolicyJson: string;
  responseSchemaJson: string;
  requestJson: string;
  validatorActivityId: string | null;
};

export function normalizeOpenWorkflowInteractionInput(
  input: OpenWorkflowInteractionInput,
): NormalizedOpenWorkflowInteractionInput {
  for (const [label, value, max] of [
    ['instanceId', input.instanceId, 512], ['nodeId', input.nodeId, 512],
    ['stepId', input.stepId, 512], ['safeLabel', input.safeLabel, 240],
  ] as const) requireString(value, label, max);
  requireIso(input.openedAt, 'openedAt');
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    requireIso(input.expiresAt, 'expiresAt');
    if (input.expiresAt <= input.openedAt) {
      throw workflowInteractionInvalid('Interaction expiry must follow opening', 400);
    }
  }
  if (input.validatorActivityId !== undefined) {
    requireString(input.validatorActivityId, 'validatorActivityId', 512);
  }
  const maxRejections = input.maxRejections ?? 10;
  if (!Number.isSafeInteger(maxRejections) || maxRejections < 1 || maxRejections > MAX_REJECTIONS) {
    throw workflowInteractionInvalid(
      `Interaction maxRejections must be between 1 and ${MAX_REJECTIONS}`,
      400,
    );
  }
  return {
    ...input,
    expiresAt: input.expiresAt ?? null,
    maxRejections,
    responderPolicyJson: serializeBoundedInteractionJson(
      input.responderPolicy ?? null,
      'Interaction responder policy',
    ),
    responseSchemaJson: serializeBoundedInteractionJson(
      input.responseSchema ?? null,
      'Interaction response schema',
    ),
    requestJson: serializeBoundedInteractionJson(
      input.request ?? null,
      'Interaction request',
    ),
    validatorActivityId: input.validatorActivityId ?? null,
  };
}

function serializeBoundedInteractionJson(value: unknown, label: string): string {
  const serialized = serializeWorkflowJson(value, INTERACTION_INVALID);
  if (workflowJsonBytes(serialized) > MAX_INTERACTION_PAYLOAD_BYTES) {
    throw workflowInteractionInvalid(`${label} exceeds its byte limit`, 413);
  }
  return serialized;
}

export function validateWorkflowInteractionSubmission(
  input: BeginWorkflowInteractionSubmissionInput,
): void {
  requireString(input.interactionId, 'interactionId', 512);
  requireString(input.submissionId, 'submissionId', 512);
  requireString(input.actorId, 'actorId', 512);
  requireString(input.payloadHash, 'payloadHash', 128);
  requireIso(input.now, 'now');
  if (input.channel !== undefined) requireString(input.channel, 'channel', 64);
  if (workflowJsonBytes(input.payloadJson) > MAX_INTERACTION_PAYLOAD_BYTES) {
    throw workflowInteractionInvalid('Interaction payload exceeds its byte limit', 413);
  }
  parseWorkflowJson(input.payloadJson, INTERACTION_INVALID);
}

export function assertWorkflowInteractionOpen(interaction: WorkflowInteractionRecord): void {
  if (interaction.status === 'expired') {
    throw new WorkflowError('Workflow interaction has expired', INTERACTION_EXPIRED, 410);
  }
  if (interaction.status === 'rejection_limit') {
    throw new WorkflowError('Workflow interaction rejection limit was reached', REJECTION_LIMIT, 409);
  }
  if (interaction.status !== 'open') {
    throw new WorkflowError('Workflow interaction is already closed', INTERACTION_CLOSED, 409);
  }
}

export function deserializeWorkflowInteraction(
  row: WorkflowInteractionPublicRow,
): WorkflowInteractionRecord {
  return {
    interactionId: row.interaction_id, instanceId: row.instance_id,
    nodeId: row.node_id, stepId: row.step_id, safeLabel: row.safe_label,
    status: row.status, openedAt: row.opened_at, expiresAt: row.expires_at,
    acceptedAt: row.accepted_at, acceptedBy: row.accepted_by,
    rejectionCount: Number(row.rejection_count), maxRejections: Number(row.max_rejections),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function deserializeWorkflowInteractionResponse(
  row: WorkflowInteractionResponseRow,
): WorkflowInteractionResponseRecord {
  return {
    responseId: row.response_id, interactionId: row.interaction_id,
    submissionId: row.submission_id, actorId: row.actor_id, channel: row.channel,
    payloadHash: row.payload_hash, payloadJson: row.payload_json,
    acceptedValueJson: row.accepted_value_json, status: row.status,
    rejectionCode: row.rejection_code, publicMessage: row.public_message,
    createdAt: row.created_at, decidedAt: row.decided_at,
  };
}

export function workflowInteractionNotFound(): WorkflowError {
  return new WorkflowError('Workflow interaction not found', INTERACTION_NOT_FOUND, 404);
}

export function workflowInteractionSubmissionConflict(): WorkflowError {
  return new WorkflowError(
    'Submission ID was already used with different input',
    SUBMISSION_CONFLICT,
    409,
  );
}

export function workflowInteractionInvalid(message: string, status: number): WorkflowError {
  return new WorkflowError(message, INTERACTION_INVALID, status);
}

export function normalizeWorkflowInteractionRejectionCode(value: string): string {
  return /^[a-z][a-z0-9_.-]{0,63}$/i.test(value) ? value : 'invalid_response';
}

export function normalizeWorkflowInteractionPublicMessage(value: string): string {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 280) : '';
  return normalized || 'The response was not accepted.';
}

function requireString(value: string, label: string, max: number): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw workflowInteractionInvalid(`Interaction ${label} is invalid`, 400);
  }
}

function requireIso(value: string, label: string): void {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString() !== value) {
    throw workflowInteractionInvalid(`Interaction ${label} must be an ISO timestamp`, 400);
  }
}
