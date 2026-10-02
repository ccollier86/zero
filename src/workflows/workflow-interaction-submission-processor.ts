/** Authorization, validation, and atomic decision pipeline for one response. */

import { OBS_CODES } from '../observability/codes';
import { WorkflowError } from './workflow-error';
import { WorkflowAuthorityChangedError } from './workflow-execution-authority-gate';
import type { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import {
  normalizeInteractionValidationResult,
  replayInteractionResult,
  toPublicInteractionResult,
} from './workflow-interaction-results';
import { parseWorkflowJson, type WorkflowJsonValue } from './workflow-json-value';
import { validatePersistedInteractionSchema } from './workflow-interaction-schema';
import type {
  InternalSubmitWorkflowInteractionInput,
  WorkflowInteractionServiceOptions,
  WorkflowInteractionSubmissionResult,
  WorkflowInteractionValidationContext,
  WorkflowInteractionValidationResult,
} from './workflow-interaction-service';
import type { WorkflowInteractionRecord, WorkflowInteractionStore } from './workflow-interaction-store';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

export class WorkflowInteractionSubmissionProcessor {
  constructor(
    private readonly store: WorkflowInteractionStore,
    private readonly authority: WorkflowInteractionAuthority,
    private readonly options: WorkflowInteractionServiceOptions,
    private readonly now: () => string,
    private readonly assertActive: (signal: AbortSignal) => void,
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  async process(input: {
    submission: InternalSubmitWorkflowInteractionInput;
    interaction: WorkflowInteractionRecord;
    responderPolicy: WorkflowJsonValue;
    responseSchema: WorkflowJsonValue;
    validatorActivityId: string | null;
    payloadJson: string;
    payloadHash: string;
    signal: AbortSignal;
  }): Promise<WorkflowInteractionSubmissionResult> {
    const { submission, interaction, signal } = input;
    this.assertRunning(submission.interactionId);
    let assertCurrentPolicy: () => void;
    try {
      assertCurrentPolicy = await this.authority.assertCanRespond({
        interactionId: interaction.interactionId,
        instanceId: interaction.instanceId,
        nodeId: interaction.nodeId,
        actor: submission.actor,
        responderPolicy: input.responderPolicy,
        signal,
      });
    } catch (error) {
      this.assertActive(signal);
      throw error;
    }
    this.assertActive(signal);
    this.assertRunning(submission.interactionId);
    return this.reserveAndDecide({ ...input, assertCurrentPolicy });
  }

  private async reserveAndDecide(input: {
    submission: InternalSubmitWorkflowInteractionInput;
    interaction: WorkflowInteractionRecord;
    responseSchema: WorkflowJsonValue;
    validatorActivityId: string | null;
    payloadJson: string;
    payloadHash: string;
    signal: AbortSignal;
    assertCurrentPolicy: () => void;
  }): Promise<WorkflowInteractionSubmissionResult> {
    const { submission, signal } = input;
    const response = this.store.beginSubmission({
      interactionId: submission.interactionId,
      submissionId: submission.submissionId,
      actorId: submission.actor.actorId,
      channel: submission.channel,
      origin: submission.origin,
      eventId: submission.eventId,
      payloadHash: input.payloadHash,
      payloadJson: input.payloadJson,
      now: this.now(),
      requireRunningInstance: this.options.requireRunningInstance,
    });
    const replay = replayInteractionResult(response, this.store.get(submission.interactionId));
    if (replay) return replay;
    const payload = parseWorkflowJson(input.payloadJson);
    const context: WorkflowInteractionValidationContext = {
      interaction: input.interaction,
      submissionId: submission.submissionId,
      actor: submission.actor,
      channel: submission.channel ?? null,
      payload,
      signal,
    };
    try {
      const validation = await this.validate(input.responseSchema, input.validatorActivityId, context);
      const decision = validation.valid
        ? { accepted: true as const, value: 'value' in validation ? validation.value : payload }
        : {
            accepted: false as const,
            code: validation.code ?? 'invalid_response',
            publicMessage: validation.publicMessage ?? 'The response was not accepted.',
          };
      let commitError: unknown;
      const decided = this.store.decideSubmission(
        submission.interactionId,
        submission.submissionId,
        decision,
        this.now(),
        this.options.requireRunningInstance,
        (interaction) => {
          if (this.options.beforeDecision && !this.options.beforeDecision(interaction)) {
            return false;
          }
          try {
            input.assertCurrentPolicy();
            submission.assertCurrentResponder?.();
          } catch (error) {
            commitError = error;
            return false;
          }
          return true;
        },
        (result) => submission.onDecisionCommit?.(toPublicInteractionResult(result)),
        submission.onDecisionAbort,
      );
      if (!decided) throw commitError ?? new WorkflowAuthorityChangedError();
      emitDecision(this.observability, decided.outcome, decided.interaction);
      return toPublicInteractionResult(decided);
    } catch (error) {
      if (submission.origin !== 'event') {
        this.store.releaseProcessingSubmission(
          submission.interactionId,
          submission.submissionId,
          this.now(),
        );
      }
      throw error;
    }
  }

  private async validate(
    schema: WorkflowJsonValue,
    validatorActivityId: string | null,
    context: WorkflowInteractionValidationContext,
  ): Promise<WorkflowInteractionValidationResult> {
    let validation = await this.validateSchema(schema, context);
    this.assertActive(context.signal);
    this.assertRunning(context.interaction.interactionId);
    if (!validation.valid || !validatorActivityId) return validation;
    if (!this.options.validateActivity) {
      throw new WorkflowError(
        `Workflow interaction validator activity "${validatorActivityId}" is unavailable`,
        'WORKFLOW_CONFIG_INVALID',
        500,
      );
    }
    validation = normalizeInteractionValidationResult(
      await this.options.validateActivity(validatorActivityId, context),
    );
    this.assertActive(context.signal);
    return validation;
  }

  private async validateSchema(
    schema: WorkflowJsonValue,
    context: WorkflowInteractionValidationContext,
  ): Promise<WorkflowInteractionValidationResult> {
    if (schema === null) return { valid: true };
    if (this.options.validateSchema) {
      return normalizeInteractionValidationResult(await this.options.validateSchema(schema, context));
    }
    try {
      return validatePersistedInteractionSchema(schema, context.payload)
        ? { valid: true }
        : { valid: false, code: 'schema_invalid',
            publicMessage: 'The response did not match the expected format.' };
    } catch {
      throw new WorkflowError(
        'Workflow interaction response schema is invalid',
        'WORKFLOW_CONFIG_INVALID',
        500,
      );
    }
  }

  private assertRunning(interactionId: string): void {
    if (this.options.requireRunningInstance) {
      this.store.assertInteractionInstanceRunning(interactionId);
    }
  }
}

function emitDecision(
  observability: WorkflowObservability,
  outcome: 'accepted' | 'rejected' | 'superseded',
  interaction: WorkflowInteractionRecord,
): void {
  if (outcome === 'superseded') return;
  observability.emitAfterCommit(
    outcome === 'accepted'
      ? OBS_CODES.WORKFLOW_INTERACTION_ACCEPTED
      : OBS_CODES.WORKFLOW_INTERACTION_SUBMISSION_REJECTED,
    { metadata: {
      interactionId: interaction.interactionId,
      instanceId: interaction.instanceId,
      nodeId: interaction.nodeId,
      outcome,
    } },
  );
}
