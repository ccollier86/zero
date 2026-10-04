/** Atomic idempotent delivery for trusted system-authored Torrent events. */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import {
  createSystemAuthority,
} from './workflow-execution-authority';
import { serializeWorkflowEventActor } from './workflow-event-actor';
import type { WorkflowEventCoordinatorHooks } from './workflow-event-coordinator';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowError, workflowNotFound } from './workflow-error';
import type { WorkflowObservability } from './workflow-observability';
import type { WorkflowRepository } from './workflow-repository';
import {
  MAX_WORKFLOW_EVENT_NAME_LENGTH,
  type WorkflowRuntimeStore,
  workflowSystemEventActorId,
} from './workflow-runtime-store';
import type { WorkflowScopeBoundary } from './workflow-scope-boundary';
import {
  createWorkflowSystemEventCommand,
  requireWorkflowSystemEventIdempotencyKey,
  serializeWorkflowSystemEventPayload,
  type WorkflowSystemEventDeliveryOptions,
  type WorkflowSystemEventDeliveryResult,
  type WorkflowSystemEventDeliveryMutation,
  type WorkflowSystemEventReceiptIdentity,
} from './workflow-system-event-delivery-contract';
import { WorkflowSystemEventReceiptStore } from './workflow-system-event-receipt-store';

const textEncoder = new TextEncoder();

/** Owns the trusted retry boundary without changing legacy event APIs. */
export class WorkflowSystemEventDeliveryCoordinator {
  private readonly receipts: WorkflowSystemEventReceiptStore;

  constructor(
    db: ReactiveDB,
    private readonly repository: WorkflowRepository,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly clock: WorkflowClock,
    private readonly scopes: WorkflowScopeBoundary,
    private readonly hooks: WorkflowEventCoordinatorHooks,
    private readonly observability: WorkflowObservability,
  ) {
    this.receipts = new WorkflowSystemEventReceiptStore(db);
  }

  /**
   * Commit an event and permanent receipt once, then re-kick its run on every
   * successful replay. The durable acknowledgement is byte-for-byte stable.
   */
  async deliver(
    instanceId: string,
    eventName: string,
    payload: unknown,
    options: WorkflowSystemEventDeliveryOptions,
    mutation: WorkflowSystemEventDeliveryMutation = {},
  ): Promise<WorkflowSystemEventDeliveryResult> {
    this.hooks.beginOperation();
    const idempotencyKey = requireWorkflowSystemEventIdempotencyKey(
      options?.idempotencyKey,
    );
    const scope = this.scopes.requireScope(options.scope);
    const scopedInstance = this.scopes.requireInstance(instanceId, scope);
    requireEventName(eventName);
    const payloadJson = serializeWorkflowSystemEventPayload(payload);
    const authority = createSystemAuthority({
      principal: options.principal,
      reason: options.reason,
      scope,
    });
    const principal = authority.identity.principal;
    const actorId = workflowSystemEventActorId(principal);
    const actorJson = serializeWorkflowEventActor({
      actorId,
      tenantId: authority.identity.tenantId,
      roles: [],
      claims: { system: true, principal },
    });
    if (actorJson === null) {
      throw new WorkflowError(
        'Workflow system event actor could not be serialized',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    const identity: WorkflowSystemEventReceiptIdentity = Object.freeze({
      scopeKind: scope.scopeKind,
      scopeId: scope.scopeId,
      tenantId: scope.tenantId,
      principal,
      idempotencyKey,
    });
    const command = createWorkflowSystemEventCommand({
      instanceId,
      eventName,
      payloadJson,
      principal,
      reason: authority.identity.reason,
      scopeKind: scope.scopeKind,
      scopeId: scope.scopeId,
      tenantId: scope.tenantId,
    });
    let result: WorkflowSystemEventDeliveryResult | null = null;
    let shouldAdvance = false;

    try {
      this.repository.transaction(() => {
        // The final authority check joins the same writer transaction as the
        // event, sealed authority envelope, and idempotency receipt. A caller
        // cannot revoke a source after preflight and still win the commit race.
        mutation.assertCurrentAuthority?.();
        const instance = this.repository.getInstance(instanceId);
        if (!instance || instance.tenant_id !== scopedInstance.tenant_id) {
          throw workflowNotFound();
        }
        const receipt = this.receipts.lookup(identity, command);
        if (receipt.state === 'replay') {
          result = receipt.result;
          shouldAdvance = instance.status === 'running';
          this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_SYSTEM_EVENT_REPLAYED, {
            metadata: eventMetadata(instanceId, eventName, principal, scope.scopeKind),
          });
          return;
        }
        if (instance.status !== 'running' && instance.status !== 'paused') {
          throw new WorkflowError(
            `Cannot send an event to a ${instance.status} workflow`,
            'WORKFLOW_STATE_INVALID',
            409,
          );
        }
        const candidate: WorkflowSystemEventDeliveryResult = Object.freeze({
          eventId: crypto.randomUUID(),
          instanceId,
          eventName,
          createdAt: this.clock.now().toISOString(),
        });
        result = candidate;
        shouldAdvance = instance.status === 'running';
        this.repository.insertEvent({
          event_id: candidate.eventId,
          tenant_id: instance.tenant_id,
          instance_id: instanceId,
          event_name: eventName,
          payload: payloadJson,
          sent_by: actorId,
          created_at: candidate.createdAt,
        });
        this.runtime.recordDeliverableEvent(
          candidate.eventId,
          instanceId,
          eventName,
          candidate.createdAt,
          instance.tenant_id,
          payloadJson,
          actorId,
          actorJson,
          payloadJson === null ? 0 : textEncoder.encode(payloadJson).byteLength,
          textEncoder.encode(actorJson).byteLength,
          authority,
        );
        this.receipts.insert(identity, command, candidate);
        this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_SYSTEM_EVENT_DELIVERED, {
          metadata: eventMetadata(instanceId, eventName, principal, scope.scopeKind),
        });
      });
    } catch (error) {
      if (error instanceof WorkflowError
        && error.code === 'WORKFLOW_EVENT_IDEMPOTENCY_CONFLICT') {
        this.observability.emitNow(OBS_CODES.WORKFLOW_SYSTEM_EVENT_CONFLICT, {
          metadata: eventMetadata(instanceId, eventName, principal, scope.scopeKind),
        });
        throw error;
      }
      if (error instanceof WorkflowError) throw error;
      this.observability.emitNow(OBS_CODES.WORKFLOW_SYSTEM_EVENT_DELIVERY_FAILED, {
        error,
        metadata: eventMetadata(instanceId, eventName, principal, scope.scopeKind),
      });
      throw new WorkflowError(
        'Workflow system event delivery failed',
        'WORKFLOW_INTERNAL_ERROR',
        500,
      );
    }

    if (result === null) {
      throw new WorkflowError(
        'Workflow system event delivery produced no acknowledgement',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    if (shouldAdvance) await this.hooks.advance(instanceId);
    // Replays intentionally return the original receipt rather than decorating
    // it. Callers can retry without branching on transport history.
    return result;
  }
}

function requireEventName(eventName: string): void {
  if (typeof eventName !== 'string' || !eventName.trim()) {
    throw new WorkflowError('Event name is required', 'WORKFLOW_EVENT_INVALID', 422);
  }
  if (eventName !== eventName.trim()) {
    throw new WorkflowError(
      'Event name must not include surrounding whitespace',
      'WORKFLOW_EVENT_INVALID',
      422,
    );
  }
  if (eventName.length > MAX_WORKFLOW_EVENT_NAME_LENGTH) {
    throw new WorkflowError(
      `Event name must be at most ${MAX_WORKFLOW_EVENT_NAME_LENGTH} characters`,
      'WORKFLOW_EVENT_INVALID',
      422,
    );
  }
}

function eventMetadata(
  instanceId: string,
  eventName: string,
  principal: string,
  scopeKind: 'application' | 'tenant',
): Record<string, unknown> {
  return { instanceId, eventName, principal, scopeKind };
}
