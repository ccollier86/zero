/**
 * Stable interaction-persistence facade.
 *
 * Public wait lifecycle and private definitions are owned by the lifecycle
 * store; response reservations and first-valid-wins decisions are owned by the
 * response store. Keeping this facade stable avoids leaking that persistence
 * split into services, controllers, and application code.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowInteractionLifecycleStore } from './workflow-interaction-lifecycle-store';
import { WorkflowInteractionResponseStore } from './workflow-interaction-response-store';
import { WorkflowRuntimeValueBudget } from './workflow-runtime-budget';
import type { WorkflowJsonValue } from './workflow-json-value';
import type { WorkflowRuntimeFence } from './workflow-runtime-fence';
import type {
  BeginWorkflowInteractionSubmissionInput,
  OpenWorkflowInteractionInput,
  WorkflowInteractionDecision,
  WorkflowInteractionDecisionResult,
  WorkflowInteractionPrivateDefinition,
  WorkflowInteractionRecord,
  WorkflowInteractionResponseRecord,
} from './workflow-interaction-records';

export {
  MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES,
  MAX_WORKFLOW_INTERACTION_SUBMISSIONS,
} from './workflow-interaction-response-store';

export type {
  BeginWorkflowInteractionSubmissionInput,
  OpenWorkflowInteractionInput,
  WorkflowInteractionDecision,
  WorkflowInteractionDecisionResult,
  WorkflowInteractionPrivateDefinition,
  WorkflowInteractionRecord,
  WorkflowInteractionResponseRecord,
  WorkflowInteractionResponseStatus,
  WorkflowInteractionStatus,
} from './workflow-interaction-records';

/** Durable interaction persistence with atomic first-valid-wins decisions. */
export class WorkflowInteractionStore {
  private readonly lifecycle: WorkflowInteractionLifecycleStore;
  private readonly responses: WorkflowInteractionResponseStore;

  constructor(db: ReactiveDB, runtimeFence: WorkflowRuntimeFence | null = null) {
    const runtimeBudget = new WorkflowRuntimeValueBudget(db);
    this.lifecycle = new WorkflowInteractionLifecycleStore(db, runtimeBudget, runtimeFence);
    this.responses = new WorkflowInteractionResponseStore(
      db,
      this.lifecycle,
      runtimeBudget,
      runtimeFence,
    );
  }

  /** Create a cryptographically random wait and persist it before delivery. */
  open(input: OpenWorkflowInteractionInput): WorkflowInteractionRecord {
    return this.lifecycle.open(input);
  }

  /** Read projection-safe interaction progress. */
  get(interactionId: string): WorkflowInteractionRecord | null {
    return this.lifecycle.get(interactionId);
  }

  /** Recover the newest durable wait owned by one graph step. */
  getByStep(instanceId: string, stepId: string): WorkflowInteractionRecord | null {
    return this.lifecycle.getByStep(instanceId, stepId);
  }

  /** List projection-safe interactions for one workflow run in opening order. */
  listByInstance(instanceId: string): WorkflowInteractionRecord[] {
    return this.lifecycle.listByInstance(instanceId);
  }

  /** Shift open deadlines after a paused workflow resumes. */
  shiftOpenExpiries(instanceId: string, milliseconds: number, now: string): void {
    this.lifecycle.shiftOpenExpiries(instanceId, milliseconds, now);
  }

  /** Read the private policy and validation definition for server execution. */
  getPrivateDefinition(interactionId: string): WorkflowInteractionPrivateDefinition {
    return this.lifecycle.getPrivateDefinition(interactionId);
  }

  /** Reserve an idempotency key before running validators. */
  beginSubmission(input: BeginWorkflowInteractionSubmissionInput): WorkflowInteractionResponseRecord {
    return this.responses.beginSubmission(input);
  }

  /** Atomically apply a validation result; at most one valid response wins. */
  decideSubmission(
    interactionId: string,
    submissionId: string,
    decision: WorkflowInteractionDecision,
    now: string,
    requireRunningInstance = false,
    beforeDecision?: (interaction: WorkflowInteractionRecord) => boolean,
    afterDecision?: (result: WorkflowInteractionDecisionResult) => void,
    afterAbort?: () => void,
  ): WorkflowInteractionDecisionResult | null {
    return this.responses.decideSubmission(
      interactionId,
      submissionId,
      decision,
      now,
      requireRunningInstance,
      beforeDecision,
      afterDecision,
      afterAbort,
    );
  }

  /** Mark one due open interaction expired. */
  expire(interactionId: string, now: string): WorkflowInteractionRecord {
    return this.lifecycle.expire(interactionId, now);
  }

  /** Expire every due interaction and return the changed public rows. */
  expireDue(now: string): WorkflowInteractionRecord[] {
    return this.lifecycle.expireDue(now);
  }

  /** Cancel every still-open wait when its workflow reaches a terminal state. */
  cancelForInstance(instanceId: string, now: string): WorkflowInteractionRecord[] {
    return this.lifecycle.cancelForInstance(instanceId, now);
  }

  /** Retrieve an accepted value only through the private response table. */
  getAcceptedValue(interactionId: string): WorkflowJsonValue | null {
    return this.responses.getAcceptedValue(interactionId);
  }

  /** Correlate an accepted response with its trusted event command, if any. */
  getAcceptedEventId(interactionId: string): string | null {
    return this.responses.getAcceptedEventId(interactionId);
  }

  /** Read one private submission for idempotent service replay. */
  findResponse(
    interactionId: string,
    submissionId: string,
  ): WorkflowInteractionResponseRecord | null {
    return this.responses.findResponse(interactionId, submissionId);
  }

  /** Remove an interrupted, undecided reservation so a direct caller may retry. */
  releaseProcessingSubmission(
    interactionId: string,
    submissionId: string,
    now: string,
    afterRelease?: () => void,
    expectedEventId?: string,
  ): boolean {
    return this.responses.releaseProcessingSubmission(
      interactionId,
      submissionId,
      now,
      afterRelease,
      expectedEventId,
    );
  }

  /** Fail closed when graph response work is attempted outside a running run. */
  assertInteractionInstanceRunning(interactionId: string): void {
    const interaction = this.lifecycle.require(interactionId);
    this.lifecycle.assertInstanceRunning(interaction.instanceId);
  }
}
