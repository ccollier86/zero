/**
 * workflow-interaction-service.ts
 *
 * Coordinates durable human/agent waits without coupling them to HTTP, email,
 * text, or UI delivery. It owns authorization, validation, idempotency, and
 * privacy-safe results; the store owns atomic persistence.
 */

import { createHash } from 'node:crypto';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { WorkflowError } from './workflow-error';
import { WorkflowExecutionTracker } from './workflow-execution-tracker';
import {
  WorkflowInteractionAuthority,
  type WorkflowInteractionActor,
} from './workflow-interaction-authority';
import {
  type OpenWorkflowInteractionInput,
  type WorkflowInteractionRecord,
  type WorkflowInteractionStore,
} from './workflow-interaction-store';
import { INTERACTION_INVALID } from './workflow-interaction-records';
import {
  replayInteractionResult,
} from './workflow-interaction-results';
import {
  serializeWorkflowJson,
  type WorkflowJsonValue,
} from './workflow-json-value';
import { WorkflowInteractionSubmissionProcessor } from './workflow-interaction-submission-processor';
import { resolveWorkflowShutdownGraceMs } from './workflow-shutdown-policy';

export interface WorkflowInteractionValidationResult {
  valid: boolean;
  code?: string;
  publicMessage?: string;
  /** Optional normalized value passed to downstream nodes when accepted. */
  value?: unknown;
}
export interface WorkflowInteractionValidationContext {
  interaction: WorkflowInteractionRecord;
  submissionId: string;
  actor: WorkflowInteractionActor;
  channel: string | null;
  payload: WorkflowJsonValue;
  signal: AbortSignal;
}
export type WorkflowInteractionSchemaValidator = (
  schema: WorkflowJsonValue,
  context: WorkflowInteractionValidationContext,
) => WorkflowInteractionValidationResult | boolean
  | Promise<WorkflowInteractionValidationResult | boolean>;
export type WorkflowInteractionActivityValidator = (
  activityId: string,
  context: WorkflowInteractionValidationContext,
) => WorkflowInteractionValidationResult | boolean
  | Promise<WorkflowInteractionValidationResult | boolean>;
export interface WorkflowInteractionServiceOptions {
  authority?: WorkflowInteractionAuthority;
  validateSchema?: WorkflowInteractionSchemaValidator;
  validateActivity?: WorkflowInteractionActivityValidator;
  clock?: () => Date;
  shutdownGraceMs?: number;
  /** Require graph instances to remain running at every persistence fence. */
  requireRunningInstance?: boolean;
}

export interface SubmitWorkflowInteractionInput {
  interactionId: string;
  submissionId: string;
  actor: WorkflowInteractionActor;
  payload: unknown;
  /** Audit-only transport name such as `web`, `email`, `sms`, or `agent`. */
  channel?: string;
}

/** Privacy-safe response returned to transport adapters. */
export interface WorkflowInteractionSubmissionResult {
  outcome: 'accepted' | 'rejected' | 'superseded';
  interaction: WorkflowInteractionRecord;
  rejectionCode?: string;
  publicMessage?: string;
}

export interface WorkflowInteractionDeliveryResult {
  interaction: WorkflowInteractionRecord;
  delivered: boolean;
}

export type WorkflowInteractionDeliver = (
  interaction: WorkflowInteractionRecord,
) => void | Promise<void>;

interface InflightSubmission {
  payloadHash: string;
  actorId: string;
  promise: Promise<WorkflowInteractionSubmissionResult>;
}

/** Channel-neutral service for opening, answering, and expiring workflow waits. */
export class WorkflowInteractionService {
  private readonly authority: WorkflowInteractionAuthority;
  private readonly clock: () => Date;
  private readonly inflight = new Map<string, InflightSubmission>();
  private readonly tracker: WorkflowExecutionTracker;
  private readonly processor: WorkflowInteractionSubmissionProcessor;
  private disposed = false;

  constructor(
    private readonly store: WorkflowInteractionStore,
    private readonly options: WorkflowInteractionServiceOptions = {},
  ) {
    this.authority = options.authority ?? new WorkflowInteractionAuthority();
    this.clock = options.clock ?? (() => new Date());
    this.tracker = new WorkflowExecutionTracker(
      resolveWorkflowShutdownGraceMs(options.shutdownGraceMs),
    );
    this.processor = new WorkflowInteractionSubmissionProcessor(
      store,
      this.authority,
      options,
      () => this.now(),
      (signal) => this.assertActive(signal),
    );
  }

  /** Persist a wait before any channel-specific activity is allowed to deliver it. */
  open(input: Omit<OpenWorkflowInteractionInput, 'openedAt'> & { openedAt?: string }): WorkflowInteractionRecord {
    const interaction = this.store.open({
      ...input,
      openedAt: input.openedAt ?? this.now(),
    });
    emitPlatformCode(OBS_CODES.WORKFLOW_INTERACTION_OPENED, {
      metadata: {
        interactionId: interaction.interactionId,
        instanceId: interaction.instanceId,
        nodeId: interaction.nodeId,
      },
    });
    return interaction;
  }

  /** Persist first, then invoke any caller-provided delivery function. */
  async openAndDeliver(
    input: Omit<OpenWorkflowInteractionInput, 'openedAt'> & { openedAt?: string },
    deliver: WorkflowInteractionDeliver,
  ): Promise<WorkflowInteractionDeliveryResult> {
    const interaction = this.open(input);
    try {
      await deliver(interaction);
      return { interaction, delivered: true };
    } catch {
      // The durable wait intentionally remains open so another activity or an
      // operator retry can deliver it without losing the response endpoint.
      emitPlatformCode(OBS_CODES.WORKFLOW_INTERACTION_DELIVERY_FAILED, {
        metadata: {
          interactionId: interaction.interactionId,
          instanceId: interaction.instanceId,
          nodeId: interaction.nodeId,
        },
      });
      return { interaction, delivered: false };
    }
  }

  /** Authorize and validate an idempotent response; exactly one valid response wins. */
  async submit(input: SubmitWorkflowInteractionInput): Promise<WorkflowInteractionSubmissionResult> {
    if (input.channel === 'event' || input.submissionId.startsWith('event:')) {
      throw new WorkflowError(
        'The workflow event response namespace is reserved for internal delivery',
        INTERACTION_INVALID,
        422,
      );
    }
    return this.submitAuthorized(input, false);
  }

  /** Submit one runtime-claimed event through the interaction decision pipeline. */
  async submitClaimedEvent(input: {
    interactionId: string;
    eventId: string;
    actor: WorkflowInteractionActor;
    payload: unknown;
  }): Promise<WorkflowInteractionSubmissionResult> {
    if (!input.eventId || input.eventId.startsWith('event:')) {
      throw new WorkflowError(
        'Workflow event identity is invalid',
        INTERACTION_INVALID,
        500,
      );
    }
    return this.submitAuthorized({
      interactionId: input.interactionId,
      submissionId: `event:${input.eventId}`,
      actor: input.actor,
      payload: input.payload,
      channel: 'event',
    }, true);
  }

  private async submitAuthorized(
    input: SubmitWorkflowInteractionInput,
    internalEvent: boolean,
  ): Promise<WorkflowInteractionSubmissionResult> {
    this.assertAvailable();
    const interaction = this.requireInteraction(input.interactionId);
    const definition = this.store.getPrivateDefinition(input.interactionId);
    const payloadJson = serializeWorkflowJson(
      input.payload,
      'WORKFLOW_INTERACTION_INVALID',
    );
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    const inflightKey = `${input.interactionId}\0${input.submissionId}`;
    const durable = this.store.findResponse(input.interactionId, input.submissionId);
    if (durable) {
      if (durable.payloadHash !== payloadHash || durable.actorId !== input.actor.actorId) {
        throw new WorkflowError(
          'Submission ID was already used with different input or identity',
          'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT',
          409,
        );
      }
      const replay = replayInteractionResult(durable, interaction);
      if (replay) return replay;
    }
    const existing = this.inflight.get(inflightKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash || existing.actorId !== input.actor.actorId) {
        throw new WorkflowError(
          'Submission ID was already used with different input or identity',
          'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT',
          409,
        );
      }
      return existing.promise;
    }

    const controller = new AbortController();
    const promise = this.processor.process({
      submission: input,
      interaction,
      responderPolicy: definition.responderPolicy,
      responseSchema: definition.responseSchema,
      validatorActivityId: definition.validatorActivityId,
      payloadJson,
      payloadHash,
      signal: controller.signal,
      internalEvent,
    });
    this.tracker.track(
      interaction.instanceId,
      inflightKey,
      `wsubmit_${crypto.randomUUID()}`,
      controller,
      promise,
    );
    this.inflight.set(inflightKey, { payloadHash, actorId: input.actor.actorId, promise });
    try {
      return await promise;
    } finally {
      if (this.inflight.get(inflightKey)?.promise === promise) this.inflight.delete(inflightKey);
    }
  }

  /** Read safe progress for a delivery or UI adapter. */
  get(interactionId: string): WorkflowInteractionRecord | null {
    return this.store.get(interactionId);
  }

  /** Recover the durable wait for a graph step without opening a duplicate. */
  getByStep(instanceId: string, stepId: string): WorkflowInteractionRecord | null {
    return this.store.getByStep(instanceId, stepId);
  }

  /** List safe interaction progress for one workflow instance. */
  list(instanceId: string): WorkflowInteractionRecord[] {
    return this.store.listByInstance(instanceId);
  }

  /** Preserve remaining interaction time across a workflow pause. */
  shiftOpenExpiries(instanceId: string, milliseconds: number): void {
    this.store.shiftOpenExpiries(instanceId, milliseconds, this.now());
  }

  /** Read every privacy-safe wait projection for one workflow run. */
  listByInstance(instanceId: string): WorkflowInteractionRecord[] {
    return this.store.listByInstance(instanceId);
  }

  /** Server-only downstream access to the accepted, normalized response value. */
  getAcceptedValue(interactionId: string): WorkflowJsonValue | null {
    return this.store.getAcceptedValue(interactionId);
  }

  /** Server-only correlation for atomically settling an accepted event wait. */
  getAcceptedEventId(interactionId: string): string | null {
    return this.store.getAcceptedEventId(interactionId);
  }

  /** Server-only request passed to configured delivery activities. */
  getRequestValue(interactionId: string): WorkflowJsonValue {
    return this.store.getPrivateDefinition(interactionId).request;
  }

  /** Expire one due wait using the service clock. */
  expire(interactionId: string): WorkflowInteractionRecord {
    const before = this.store.get(interactionId);
    const interaction = this.store.expire(interactionId, this.now());
    if (before?.status === 'open' && interaction.status === 'expired') {
      emitInteractionExpired(interaction);
    }
    return interaction;
  }

  /** Expire every due wait, typically from the workflow wake coordinator. */
  expireDue(): WorkflowInteractionRecord[] {
    const expired = this.store.expireDue(this.now());
    for (const interaction of expired) emitInteractionExpired(interaction);
    return expired;
  }

  /** Close all open waits when their workflow is cancelled or otherwise terminal. */
  cancelForInstance(instanceId: string): WorkflowInteractionRecord[] {
    return this.store.cancelForInstance(instanceId, this.now());
  }

  /** Abort authorization/validation work without pretending physical work has stopped. */
  abortInstance(instanceId: string, reason: string | Error): void {
    this.tracker.abortInstance(instanceId, reason);
  }

  isInstanceDraining(instanceId: string): boolean {
    return this.tracker.isInstanceActive(instanceId);
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.tracker.dispose();
  }

  private requireInteraction(interactionId: string): WorkflowInteractionRecord {
    const interaction = this.store.get(interactionId);
    if (!interaction) {
      throw new WorkflowError(
        'Workflow interaction not found',
        'WORKFLOW_INTERACTION_NOT_FOUND',
        404,
      );
    }
    return interaction;
  }

  private now(): string {
    const date = this.clock();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new WorkflowError('Workflow interaction clock returned an invalid date', 'WORKFLOW_CONFIG_INVALID', 500);
    }
    return date.toISOString();
  }

  private assertAvailable(): void {
    if (this.disposed) {
      throw new WorkflowError(
        'Workflow interaction service is not available',
        'WORKFLOW_NOT_READY',
        503,
      );
    }
  }

  private assertActive(signal: AbortSignal): void {
    this.assertAvailable();
    if (!signal.aborted) return;
    if (signal.reason instanceof WorkflowError) throw signal.reason;
    throw new WorkflowError(
      'Workflow interaction processing was interrupted',
      'WORKFLOW_DRAINING',
      409,
      true,
    );
  }
}

function emitInteractionExpired(interaction: WorkflowInteractionRecord): void {
  emitPlatformCode(OBS_CODES.WORKFLOW_INTERACTION_EXPIRED, {
    metadata: {
      interactionId: interaction.interactionId,
      instanceId: interaction.instanceId,
      nodeId: interaction.nodeId,
    },
  });
}
