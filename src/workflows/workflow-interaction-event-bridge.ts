/** Securely routes named workflow events through the interaction boundary. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { WorkflowError } from './workflow-error';
import type { WorkflowInteractionService } from './workflow-interaction-service';
import type { WorkflowInteractionRecord } from './workflow-interaction-store';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';

const MAX_EVENTS_PER_ADVANCE = 1_024;

export class WorkflowInteractionEventBridge {
  constructor(
    private readonly runtime: WorkflowRuntimeStore,
    private readonly interactions: WorkflowInteractionService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async consume(input: {
    instanceId: string;
    nodeId: string;
    stepId: string;
    eventName: string;
    interaction: WorkflowInteractionRecord;
  }): Promise<WorkflowInteractionRecord> {
    let current = this.reconcileFinalizedEvent(input);
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
      const actor = event.actor ?? (() => {
        const actorId = this.runtime.getEventSender(event.eventId);
        return actorId ? { actorId } : null;
      })();
      if (!actor) {
        this.consumeRejected(input, event.eventId, 'unauthenticated');
        current = this.interactions.get(input.interaction.interactionId)!;
        continue;
      }
      try {
        const result = await this.interactions.submitClaimedEvent({
          interactionId: input.interaction.interactionId,
          eventId: event.eventId,
          actor,
          payload: event.payload,
          onDecisionCommit: (decision) => {
            if (decision.outcome !== 'accepted') {
              this.consumeOrThrow(input.stepId, event.eventId);
            }
          },
        });
        current = result.interaction;
      } catch (error) {
        if (error instanceof WorkflowError
          && error.code === 'WORKFLOW_INTERACTION_FORBIDDEN') {
          this.consumeRejected(input, event.eventId, 'forbidden');
          current = this.interactions.get(input.interaction.interactionId)!;
          continue;
        }
        const refreshed = this.interactions.get(input.interaction.interactionId);
        if (!isInteractionClosure(error) || !refreshed || refreshed.status === 'open') {
          throw error;
        }
        current = this.reconcileFinalizedEvent(input);
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
    emitPlatformCode(OBS_CODES.WORKFLOW_INTERACTION_SUBMISSION_REJECTED, {
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
  }): WorkflowInteractionRecord {
    const current = this.interactions.get(input.interaction.interactionId);
    if (!current) {
      throw new WorkflowError(
        'Workflow interaction event has no durable interaction',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    const event = this.runtime.claimedEvent(input.stepId);
    if (!event) return current;
    const response = this.interactions.getSubmission(
      current.interactionId,
      `event:${event.eventId}`,
    );
    const exactEvent = response?.channel === 'event'
      && response.submissionId === `event:${event.eventId}`;
    if (exactEvent && response.status === 'accepted') return current;
    if (current.status !== 'open') {
      this.interactions.releaseEventSubmission(
        current.interactionId,
        event.eventId,
        () => this.consumeOrThrow(input.stepId, event.eventId),
      );
      return current;
    }
    if (exactEvent && response.status !== 'processing') {
      this.consumeOrThrow(input.stepId, event.eventId);
    }
    return current;
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

function isInteractionClosure(error: unknown): boolean {
  return error instanceof WorkflowError && (
    error.code === 'WORKFLOW_INTERACTION_CLOSED'
    || error.code === 'WORKFLOW_INTERACTION_EXPIRED'
    || error.code === 'WORKFLOW_INTERACTION_REJECTION_LIMIT'
  );
}
