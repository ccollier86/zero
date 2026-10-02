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
    let current = input.interaction;
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
        });
        // The accepted event is consumed atomically with wait completion.
        // Rejected/superseded submissions cannot settle the wait and are
        // consumed here so the next queued event may be evaluated.
        if (result.outcome !== 'accepted') {
          this.runtime.consumeClaimedEvent(input.stepId, event.eventId);
        }
        current = result.interaction;
      } catch (error) {
        if (!(error instanceof WorkflowError)
          || error.code !== 'WORKFLOW_INTERACTION_FORBIDDEN') throw error;
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
    this.runtime.consumeClaimedEvent(input.stepId, eventId);
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
}
