/** Public and canonical contracts for idempotent privileged event delivery. */

import type { ServiceDataScope } from '../auth/service-data-scope';
import type { WorkflowSystemExecutionOptions } from './workflow-execution-authority';
import { WorkflowError } from './workflow-error';
import {
  MAX_WORKFLOW_RUNTIME_JSON_BYTES,
} from './workflow-runtime-json';
import { serializeWorkflowJson, workflowJsonBytes } from './workflow-json-value';

export const MAX_WORKFLOW_SYSTEM_EVENT_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Trusted system authority plus one permanent logical-delivery identity. */
export interface WorkflowSystemEventDeliveryOptions
  extends WorkflowSystemExecutionOptions {
  /** Stable across retries; scoped by exact system principal and data scope. */
  idempotencyKey: string;
}

/** Exact durable acknowledgement returned for both first delivery and replay. */
export interface WorkflowSystemEventDeliveryResult {
  readonly eventId: string;
  readonly instanceId: string;
  readonly eventName: string;
  readonly createdAt: string;
}

/** @internal Commit-time authority fence supplied by trusted service adapters. */
export interface WorkflowSystemEventDeliveryMutation {
  readonly assertCurrentAuthority?: () => void;
}

/** Private receipt namespace, deliberately excluding the command itself. */
export interface WorkflowSystemEventReceiptIdentity {
  readonly scopeKind: ServiceDataScope['scopeKind'];
  readonly scopeId: string;
  readonly tenantId: string | null;
  readonly principal: string;
  readonly idempotencyKey: string;
}

/** Canonical command retained as a digest by the receipt ledger. */
export interface WorkflowSystemEventReceiptCommand {
  readonly version: 1;
  readonly fingerprint: string;
  readonly targetKind: 'instance';
  readonly targetId: string;
  readonly instanceId: string;
  readonly eventName: string;
}

export function requireWorkflowSystemEventIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string'
    || value.length > MAX_WORKFLOW_SYSTEM_EVENT_IDEMPOTENCY_KEY_LENGTH
    || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new WorkflowError(
      `Workflow system event idempotency key must match ${IDEMPOTENCY_KEY_PATTERN}`,
      'WORKFLOW_EVENT_IDEMPOTENCY_INVALID',
      422,
    );
  }
  return value;
}

/** Serialize system-delivery payloads with stable object-key ordering. */
export function serializeWorkflowSystemEventPayload(payload: unknown): string | null {
  if (payload === undefined) return null;
  const serialized = serializeWorkflowJson(payload, 'WORKFLOW_EVENT_INVALID', 422);
  if (workflowJsonBytes(serialized) > MAX_WORKFLOW_RUNTIME_JSON_BYTES) {
    throw new WorkflowError(
      'Workflow event payload exceeds its byte limit',
      'WORKFLOW_EVENT_INVALID',
      413,
    );
  }
  return serialized;
}

export function createWorkflowSystemEventCommand(input: {
  readonly instanceId: string;
  readonly eventName: string;
  readonly payloadJson: string | null;
  readonly principal: string;
  readonly reason: string;
  readonly scopeKind: ServiceDataScope['scopeKind'];
  readonly scopeId: string;
  readonly tenantId: string | null;
}): WorkflowSystemEventReceiptCommand {
  const canonical = JSON.stringify([
    1,
    'instance',
    input.instanceId,
    input.eventName,
    input.payloadJson,
    input.principal,
    input.reason,
    input.scopeKind,
    input.scopeId,
    input.tenantId,
  ]);
  return Object.freeze({
    version: 1,
    fingerprint: new Bun.CryptoHasher('sha256').update(canonical).digest('hex'),
    targetKind: 'instance',
    targetId: input.instanceId,
    instanceId: input.instanceId,
    eventName: input.eventName,
  });
}

export function workflowSystemEventIdempotencyConflict(): WorkflowError {
  return new WorkflowError(
    'Workflow system event idempotency key was already used for another command',
    'WORKFLOW_EVENT_IDEMPOTENCY_CONFLICT',
    409,
  );
}
