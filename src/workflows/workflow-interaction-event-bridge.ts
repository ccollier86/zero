/** Securely routes named workflow events through the interaction boundary. */

import { OBS_CODES } from '../observability/codes';
import { WorkflowError } from './workflow-error';
import { AuthError } from '../auth/types';
import {
  WorkflowAuthorityChangedError,
  type WorkflowExecutionAuthorityGate,
} from './workflow-execution-authority-gate';
import type { WorkflowInteractionService } from './workflow-interaction-service';
import type { WorkflowInteractionRecord } from './workflow-interaction-store';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

const MAX_EVENTS_PER_ADVANCE = 1_024;

export class WorkflowInteractionEventBridge {
  constructor(
    private readonly runtime: WorkflowRuntimeStore,
    private readonly interactions: WorkflowInteractionService,
    private readonly authority: Pick<
      WorkflowExecutionAuthorityGate,
      'assertActorCurrent' | 'assertSystemCurrent'
    >,
    private readonly now: () => Date = () => new Date(),
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  async consume(input: {
    instanceId: string;
    nodeId: string;
    stepId: string;
    eventName: string;
    interaction: WorkflowInteractionRecord;
  }): Promise<WorkflowInteractionRecord> {
    let current = input.interaction;
    this.reconcileFinalizedEvent(input);
    for (let index = 0; index < MAX_EVENTS_PER_ADVANCE; index += 1) {
      if (current.status !== 'open' || !this.runtime.isInstanceRunning(input.instanceId)) break;
      const event = this.runtime.claimedEvent(input.stepId)
        ?? this.runtime.claimEvent(
          input.instanceId,
          input.stepId,
          input.eventName,
          this.now().toISOString(),
        );
      if (!event) break;
      if (event.authorityInvalid || event.authorityKind === 'legacy-untrusted') {
        this.consumeRejected(input, event.eventId, 'forbidden');
        current = this.interactions.get(input.interaction.interactionId)!;
        continue;
      }
      const actor = event.actor;
      if (!actor) {
        this.consumeRejected(input, event.eventId, 'unauthenticated');
        current = this.interactions.get(input.interaction.interactionId)!;
        continue;
      }
      try {
        const eventAuthority = event.authority;
        const assertCurrentResponder = eventAuthority?.kind === 'actor'
          ? () => this.authority.assertActorCurrent(eventAuthority)
          : eventAuthority?.kind === 'system'
            ? () => this.authority.assertSystemCurrent(
                eventAuthority,
                input.interaction.tenantId,
              )
            : undefined;
        assertCurrentResponder?.();
        const result = await this.interactions.submitEvent({
          interactionId: input.interaction.interactionId,
          eventId: event.eventId,
          actor,
          payload: event.payload,
          assertCurrentResponder,
          onDecisionCommit: () => this.consumeOrThrow(input.stepId, event.eventId),
          onDecisionAbort: () => this.consumeOrThrow(input.stepId, event.eventId),
        });
        current = result.interaction;
      } catch (error) {
        if (!isForbiddenOrRevoked(error)) throw error;
        this.consumeRejected(input, event.eventId, 'forbidden');
        current = this.interactions.get(input.interaction.interactionId)!;
      }
    }
    return current;
  }

  private consumeRejected(
    input: { instanceId: string; nodeId: string; stepId: string; interaction: WorkflowInteractionRecord },
    eventId: string,
    reason: 'unauthenticated' | 'forbidden',
  ): void {
    this.interactions.releaseEventSubmission(
      input.interaction.interactionId,
      eventId,
      () => this.consumeOrThrow(input.stepId, eventId),
    );
    this.observability.emitNow(OBS_CODES.WORKFLOW_INTERACTION_SUBMISSION_REJECTED, {
      metadata: {
        interactionId: input.interaction.interactionId,
        instanceId: input.instanceId,
        nodeId: input.nodeId,
        channel: 'event',
        reason,
      },
    });
  }

  private reconcileFinalizedEvent(input: {
    interaction: WorkflowInteractionRecord;
    stepId: string;
  }): void {
    const event = this.runtime.claimedEvent(input.stepId);
    if (!event) return;
    const response = this.interactions.getSubmission(
      input.interaction.interactionId,
      `event:${event.eventId}`,
    );
    if (response?.origin === 'event'
      && response.eventId === event.eventId
      && response.status !== 'processing') {
      this.consumeOrThrow(input.stepId, event.eventId);
    }
  }

  private consumeOrThrow(stepId: string, eventId: string): void {
    if (this.runtime.consumeClaimedEvent(stepId, eventId)) return;
    throw new WorkflowError(
      'Workflow interaction event could not be consumed atomically',
      'WORKFLOW_STATE_INVALID',
      500,
    );
  }
}

function isForbiddenOrRevoked(error: unknown): boolean {
  return (error instanceof WorkflowError
      && error.code === 'WORKFLOW_INTERACTION_FORBIDDEN')
    || error instanceof WorkflowAuthorityChangedError
    || (error instanceof AuthError && error.code === 'AUTH_STATE_CHANGED');
}
