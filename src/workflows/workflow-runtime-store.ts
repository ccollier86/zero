/**
 * workflow-runtime-store.ts
 *
 * Stable persistence facade for private workflow coordination state. Focused
 * stores own event delivery, physical attempt leases, and pause timestamps;
 * this facade preserves the existing runtime API and schema initialization.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowAttemptLeaseStore } from './workflow-attempt-lease-store';
import {
  WorkflowEventDeliveryStore,
  type ClaimedWorkflowEvent,
} from './workflow-event-delivery-store';
import {
  WorkflowExecutionAuthorityStore,
  type WorkflowPersistedExecutionAuthority,
} from './workflow-execution-authority';
import {
  workflowExecutionAuthorityStoreUsesDatabase,
} from './workflow-execution-authority-store';
import { WorkflowError } from './workflow-error';
import { WorkflowPauseStore } from './workflow-pause-store';
import { ensureWorkflowRuntimeSchema } from './workflow-runtime-schema';
import {
  createUnmanagedWorkflowRuntimeFence,
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

export {
  MAX_WORKFLOW_EVENT_NAME_LENGTH,
  MAX_WORKFLOW_EVENT_QUEUE_BYTES,
  MAX_WORKFLOW_EVENT_QUEUE_SIZE,
  MAX_WORKFLOW_EVENT_TOTAL_BYTES,
  MAX_WORKFLOW_EVENT_TOTAL_COUNT,
} from './workflow-event-capacity-store';
export { workflowSystemEventActorId } from './workflow-event-delivery-store';
export type { ClaimedWorkflowEvent } from './workflow-event-delivery-store';

const runtimeDatabases = new WeakMap<WorkflowRuntimeStore, ReactiveDB>();

/** Route private runtime persistence to its focused, transaction-safe stores. */
export class WorkflowRuntimeStore {
  private readonly events: WorkflowEventDeliveryStore;
  private readonly attempts: WorkflowAttemptLeaseStore;
  private readonly pauses: WorkflowPauseStore;
  private readonly runtimeFence: WorkflowRuntimeFence;

  constructor(
    private readonly db: ReactiveDB,
    authorityStore: WorkflowExecutionAuthorityStore = new WorkflowExecutionAuthorityStore(db),
    now: () => Date = () => new Date(),
    runtimeFence: WorkflowRuntimeFence | null = null,
  ) {
    if (!workflowExecutionAuthorityStoreUsesDatabase(authorityStore, db)) {
      throw workflowCollaboratorDatabaseError('authority store');
    }
    runtimeDatabases.set(this, db);
    // Runtime `now` controls workflow timestamps and may intentionally be a
    // simulated/future business clock. Lease expiry always uses wall time.
    this.runtimeFence = runtimeFence ?? createUnmanagedWorkflowRuntimeFence(db);
    this.defineTables();
    this.events = new WorkflowEventDeliveryStore(db, authorityStore, now, this.runtimeFence);
    this.attempts = new WorkflowAttemptLeaseStore(db, this.runtimeFence);
    this.pauses = new WorkflowPauseStore(db, this.runtimeFence);
  }

  /**
   * Create a fresh runtime view for one durable owner generation.
   *
   * A historical caller-supplied runtime is accepted only as a same-database
   * compatibility template. Reusing or rebinding it would let a stale service
   * inherit a successor's fence, so every WorkflowService owns new stores
   * closed over its exact immutable generation instead.
   */
  static createOwnerFenced(
    db: ReactiveDB,
    authorityStore: WorkflowExecutionAuthorityStore,
    now: () => Date,
    runtimeFence: WorkflowRuntimeFence,
    template?: WorkflowRuntimeStore,
  ): WorkflowRuntimeStore {
    if (template && runtimeDatabases.get(template) !== db) {
      throw new WorkflowError(
        'Injected workflow runtime must use the WorkflowService database',
        'WORKFLOW_CONFIG_INVALID',
        500,
      );
    }
    return new WorkflowRuntimeStore(db, authorityStore, now, runtimeFence);
  }

  /** Ensure internal tables exist for both migrated and pre-migration apps. */
  defineTables(): void {
    workflowRuntimeTransaction(
      this.db,
      this.runtimeFence,
      () => ensureWorkflowRuntimeSchema(this.db),
    );
  }

  recordDeliverableEvent(
    eventId: string,
    instanceId: string,
    eventName: string,
    createdAt: string,
    tenantId: string | null,
    payloadJson: string | null,
    sentBy: string | null,
    actorJson: string | null = null,
    payloadBytes = 0,
    actorBytes = 0,
    eventAuthority: WorkflowPersistedExecutionAuthority | null = null,
  ): void {
    this.events.recordDeliverableEvent(
      eventId,
      instanceId,
      eventName,
      createdAt,
      tenantId,
      payloadJson,
      sentBy,
      actorJson,
      payloadBytes,
      actorBytes,
      eventAuthority,
    );
  }

  claimEvent(
    instanceId: string,
    stepId: string,
    eventName: string,
    claimedAt: string,
  ): ClaimedWorkflowEvent | null {
    return this.events.claimEvent(instanceId, stepId, eventName, claimedAt);
  }

  claimedEvent(stepId: string): ClaimedWorkflowEvent | null {
    return this.events.claimedEvent(stepId);
  }

  isEventClaimed(eventId: string): boolean {
    return this.events.isEventClaimed(eventId);
  }

  consumeClaimedEvent(stepId: string, eventId: string): boolean {
    return this.events.consumeClaimedEvent(stepId, eventId);
  }

  getEventSender(eventId: string): string | null {
    return this.events.getEventSender(eventId);
  }

  isInstanceRunning(instanceId: string): boolean {
    return this.events.isInstanceRunning(instanceId);
  }

  eventDeliverySignature(instanceId: string): string {
    return this.events.signature(instanceId);
  }

  discardInstanceQueue(instanceId: string, terminalAt: string): void {
    this.events.discardInstanceQueue(instanceId, terminalAt);
  }

  validateEventUsage(instanceId: string): void {
    this.events.validateUsage(instanceId);
  }

  validateGraphEventState(instanceId: string): void {
    this.events.validateGraphState(instanceId);
  }

  validateLegacyEventState(instanceId: string): void {
    this.events.validateLegacyState(instanceId);
  }

  beginAttempt(
    stepId: string,
    instanceId: string,
    attemptId: string,
    startedAt: string,
  ): void {
    this.attempts.begin(stepId, instanceId, attemptId, startedAt);
  }

  isCurrentAttempt(stepId: string, attemptId: string): boolean {
    return this.attempts.isCurrent(stepId, attemptId);
  }

  finishAttempt(stepId: string, attemptId?: string): boolean {
    return this.attempts.finish(stepId, attemptId);
  }

  finishInstanceAttempts(instanceId: string): void {
    this.attempts.finishInstance(instanceId);
  }

  clearAllAttempts(): void {
    this.attempts.clear();
  }

  markPaused(instanceId: string, pausedAt: string): void {
    this.pauses.mark(instanceId, pausedAt);
  }

  takePausedAt(instanceId: string): string | null {
    return this.pauses.take(instanceId);
  }

  clearPause(instanceId: string): void {
    this.pauses.clear(instanceId);
  }
}

/** @internal Non-spoofable database identity for executor composition. */
export function workflowRuntimeStoreUsesDatabase(
  runtime: WorkflowRuntimeStore,
  db: ReactiveDB,
): boolean {
  return runtimeDatabases.get(runtime) === db;
}

function workflowCollaboratorDatabaseError(collaborator: string): WorkflowError {
  return new WorkflowError(
    `Workflow ${collaborator} must use the composed runtime database`,
    'WORKFLOW_CONFIG_INVALID',
    500,
  );
}
