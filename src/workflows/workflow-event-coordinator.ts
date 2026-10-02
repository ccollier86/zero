/**
 * workflow-event-coordinator.ts
 *
 * Owns validation, authority binding, atomic persistence, and post-commit
 * dispatch for workflow inbox events. It consumes trusted scopes and sealed
 * authorities; it does not resolve HTTP identity or execute workflow steps.
 */

import { AuthError } from '../auth/types';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { WorkflowError, workflowNotFound } from './workflow-error';
import {
  createSystemAuthority,
  type WorkflowActorExecutionAuthority,
  type WorkflowPersistedExecutionAuthority,
  type WorkflowSystemExecutionOptions,
} from './workflow-execution-authority';
import { serializeWorkflowEventActor } from './workflow-event-actor';
import type { WorkflowClock } from './workflow-executor';
import type { WorkflowInteractionActor } from './workflow-interaction-authority';
import type { WorkflowRepository } from './workflow-repository';
import {
  MAX_WORKFLOW_EVENT_NAME_LENGTH,
  type WorkflowRuntimeStore,
  workflowSystemEventActorId,
} from './workflow-runtime-store';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';
import {
  isWorkflowServiceDataScope,
  type WorkflowScopeBoundary,
} from './workflow-scope-boundary';

/** Commit-time authority material accepted by a workflow event mutation. */
export interface WorkflowEventMutationOptions {
  /** Final exact request/lease authority fence, invoked under the writer lock. */
  assertCurrentAuthority?: () => void;
  /** Server-captured authority persisted for delayed event-channel responses. */
  actorAuthority?: WorkflowActorExecutionAuthority;
  /** Only populated by the explicit privileged system-event entry point. */
  systemAuthority?: Extract<WorkflowPersistedExecutionAuthority, { kind: 'system' }>;
}

/** Lifecycle hooks owned by the WorkflowService facade. */
export interface WorkflowEventCoordinatorHooks {
  beginOperation(): void;
  advance(instanceId: string): Promise<void>;
}

/** Atomically append trusted workflow events and dispatch runnable frontiers. */
export class WorkflowEventCoordinator {
  constructor(
    private readonly repository: WorkflowRepository,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly clock: WorkflowClock,
    private readonly scopes: WorkflowScopeBoundary,
    private readonly hooks: WorkflowEventCoordinatorHooks,
  ) {}

  /**
   * Append an event and its private delivery envelope in one transaction.
   * Returns whether a legal frontier claimed the event after commit.
   */
  async sendEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    sentBy?: string,
    scopeOrActor?: ServiceDataScope | WorkflowInteractionActor,
    explicitActor?: WorkflowInteractionActor,
    mutation: WorkflowEventMutationOptions = {},
  ): Promise<boolean> {
    this.hooks.beginOperation();
    const scope = isWorkflowServiceDataScope(scopeOrActor) ? scopeOrActor : undefined;
    const actor = isWorkflowServiceDataScope(scopeOrActor) ? explicitActor : scopeOrActor;
    const boundary = this.scopes.requireScope(scope);
    const scopedInstance = this.scopes.requireInstance(instanceId, boundary);
    if (!eventName.trim()) {
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
    const serializedPayload = serializeWorkflowRuntimeJson(payload, {
      code: 'WORKFLOW_EVENT_INVALID', label: 'Workflow event payload',
    });
    const eventId = crypto.randomUUID();
    const createdAt = this.clock.now().toISOString();
    if (actor && sentBy && actor.actorId !== sentBy) {
      throw new WorkflowError(
        'Workflow event actor does not match its sender',
        'WORKFLOW_EVENT_INVALID',
        422,
      );
    }
    const eventActor = actor ?? (sentBy ? { actorId: sentBy } : null);
    if (mutation.actorAuthority && mutation.systemAuthority) {
      throw new WorkflowError(
        'Workflow events cannot carry multiple authority kinds',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    const eventAuthority = mutation.actorAuthority ?? mutation.systemAuthority ?? null;
    if (eventAuthority && (
      !eventActor
      || eventActor.actorId !== (eventAuthority.kind === 'actor'
        ? eventAuthority.identity.userId
        : workflowSystemEventActorId(eventAuthority.identity.principal))
      || (eventActor.tenantId ?? boundary.tenantId)
        !== eventAuthority.identity.tenantId
      || boundary.tenantId !== eventAuthority.identity.tenantId
    )) {
      throw new AuthError(
        'Workflow event authority does not match the request scope',
        'AUTH_STATE_CHANGED',
        409,
      );
    }
    const canonicalActor: WorkflowInteractionActor | null = eventAuthority
      ? eventAuthority.kind === 'actor'
        ? {
            actorId: eventAuthority.identity.userId,
            tenantId: eventAuthority.identity.tenantId,
            roles: [...eventAuthority.identity.roles],
          }
        : {
            actorId: workflowSystemEventActorId(eventAuthority.identity.principal),
            tenantId: eventAuthority.identity.tenantId,
            roles: [],
            claims: { system: true, principal: eventAuthority.identity.principal },
          }
      : eventActor;
    const actorJson = serializeWorkflowEventActor(canonicalActor);
    const effectiveSender = canonicalActor?.actorId ?? sentBy ?? null;
    let shouldAdvance = false;

    this.repository.transaction(() => {
      mutation.assertCurrentAuthority?.();
      const instance = this.repository.getInstance(instanceId);
      if (!instance || instance.tenant_id !== scopedInstance.tenant_id) {
        throw workflowNotFound();
      }
      if (instance.status !== 'running' && instance.status !== 'paused') {
        throw new WorkflowError(
          `Cannot send an event to a ${instance.status} workflow`,
          'WORKFLOW_STATE_INVALID',
          409,
        );
      }
      shouldAdvance = instance.status === 'running';
      this.repository.insertEvent({
        event_id: eventId,
        tenant_id: instance.tenant_id,
        instance_id: instanceId,
        event_name: eventName,
        payload: serializedPayload,
        sent_by: effectiveSender ?? null,
        created_at: createdAt,
      });
      this.runtime.recordDeliverableEvent(
        eventId,
        instanceId,
        eventName,
        createdAt,
        instance.tenant_id,
        serializedPayload,
        effectiveSender,
        actorJson,
        serializedPayload === null ? 0 : Buffer.byteLength(serializedPayload, 'utf8'),
        actorJson === null ? 0 : Buffer.byteLength(actorJson, 'utf8'),
        eventAuthority,
      );
    });

    if (shouldAdvance) await this.hooks.advance(instanceId);
    return this.runtime.isEventClaimed(eventId);
  }

  /** Send an event with an explicit, MAC-sealed privileged system identity. */
  async sendEventAsSystem(
    instanceId: string,
    eventName: string,
    payload: unknown,
    system: WorkflowSystemExecutionOptions,
  ): Promise<boolean> {
    const scope = this.scopes.requireScope(system.scope);
    const authority = createSystemAuthority({ ...system, scope });
    const actorId = workflowSystemEventActorId(authority.identity.principal);
    return this.sendEvent(
      instanceId,
      eventName,
      payload,
      actorId,
      scope,
      {
        actorId,
        tenantId: authority.identity.tenantId,
        roles: [],
        claims: {
          system: true,
          principal: authority.identity.principal,
        },
      },
      { systemAuthority: authority },
    );
  }
}
