/** Atomic workflow interaction response reservations, decisions, and ledger reads. */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import { WorkflowInteractionLifecycleStore } from './workflow-interaction-lifecycle-store';
import {
  INTERACTION_INVALID,
  MAX_INTERACTION_PAYLOAD_BYTES,
  assertWorkflowInteractionOpen,
  deserializeWorkflowInteractionResponse,
  normalizeWorkflowInteractionPublicMessage,
  normalizeWorkflowInteractionRejectionCode,
  validateWorkflowInteractionSubmission,
  workflowInteractionInvalid,
  workflowInteractionNotFound,
  workflowInteractionSubmissionConflict,
  type BeginWorkflowInteractionSubmissionInput,
  type WorkflowInteractionDecision,
  type WorkflowInteractionDecisionResult,
  type WorkflowInteractionRecord,
  type WorkflowInteractionResponseRecord,
  type WorkflowInteractionResponseRow,
  type WorkflowInteractionResponseStatus,
} from './workflow-interaction-records';
import { WorkflowRuntimeValueBudget } from './workflow-runtime-budget';
import {
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';
import {
  parseWorkflowJson,
  serializeWorkflowJson,
  workflowJsonBytes,
  type WorkflowJsonValue,
} from './workflow-json-value';

export const MAX_WORKFLOW_INTERACTION_SUBMISSIONS = 1_024;
export const MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Owns the private response ledger and atomic first-valid-wins decisions. */
export class WorkflowInteractionResponseStore {
  constructor(
    private readonly db: ReactiveDB,
    private readonly lifecycle: WorkflowInteractionLifecycleStore,
    private readonly runtimeBudget: WorkflowRuntimeValueBudget,
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {}

  beginSubmission(input: BeginWorkflowInteractionSubmissionInput): WorkflowInteractionResponseRecord {
    validateWorkflowInteractionSubmission(input);
    return this.transaction(() => {
      const interaction = this.lifecycle.require(input.interactionId);
      if (input.requireRunningInstance) {
        this.lifecycle.assertInstanceRunning(interaction.instanceId);
      }
      this.lifecycle.expireIfDue(interaction, input.now);
      const existing = this.findResponse(input.interactionId, input.submissionId);
      if (existing) {
        if (existing.payloadHash !== input.payloadHash
          || existing.actorId !== input.actorId
          || existing.origin !== input.origin
          || existing.eventId !== (input.eventId ?? null)) {
          throw workflowInteractionSubmissionConflict();
        }
        return existing;
      }
      const current = this.lifecycle.require(input.interactionId);
      assertWorkflowInteractionOpen(current);
      const usage = this.responseUsage(input.interactionId);
      const payloadBytes = workflowJsonBytes(input.payloadJson);
      if (usage.response_count >= MAX_WORKFLOW_INTERACTION_SUBMISSIONS
        || usage.response_bytes + payloadBytes > MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES) {
        throw interactionSubmissionLimit();
      }
      this.reserveResponseBytes(current.instanceId, payloadBytes);
      const reserved = this.db.prepare(`UPDATE _workflow_interaction_details SET
        response_count = response_count + 1,
        response_bytes = response_bytes + ?,
        updated_at = ?
        WHERE interaction_id = ? AND response_count = ? AND response_bytes = ?`)
        .run(payloadBytes, input.now, input.interactionId,
          usage.response_count, usage.response_bytes);
      if (reserved.changes !== 1) throw interactionSubmissionLimit();
      this.db.prepare(`
        INSERT INTO _workflow_interaction_responses (
          response_id, interaction_id, submission_id, actor_id, channel, origin, event_id,
          payload_hash, payload_json, accepted_value_json, status, rejection_code, public_message,
          created_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'processing', NULL, NULL, ?, NULL)
      `).run(
        `wresp_${crypto.randomUUID()}`,
        input.interactionId,
        input.submissionId,
        input.actorId,
        input.channel ?? null,
        input.origin,
        input.eventId ?? null,
        input.payloadHash,
        input.payloadJson,
        input.now,
      );
      return this.findResponse(input.interactionId, input.submissionId)!;
    });
  }

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
    return this.transaction(() => {
      let interaction = this.lifecycle.require(interactionId);
      if (requireRunningInstance) {
        this.lifecycle.assertInstanceRunning(interaction.instanceId);
      }
      // This callback runs while the transaction owns SQLite's writer lock.
      // A null result lets the authority gate durably fence the run first.
      if (beforeDecision && !beforeDecision(interaction)) {
        this.releaseProcessingSubmission(interactionId, submissionId, now, afterAbort);
        return null;
      }
      const response = this.requireResponse(interactionId, submissionId);
      if (response.status !== 'processing') {
        const outcome: WorkflowInteractionDecisionResult['outcome'] =
          response.status === 'accepted' ? 'accepted'
            : response.status === 'rejected' ? 'rejected' : 'superseded';
        const result: WorkflowInteractionDecisionResult = { outcome, interaction, response };
        afterDecision?.(result);
        return result;
      }
      this.lifecycle.expireIfDue(interaction, now);
      interaction = this.lifecycle.require(interactionId);
      if (interaction.status !== 'open') {
        const superseded = this.finishResponse(response, 'superseded', now, null, null);
        const result = { outcome: 'superseded' as const, interaction, response: superseded };
        afterDecision?.(result);
        return result;
      }
      if (!decision.accepted) {
        const result = this.reject(interaction, response, decision, now);
        afterDecision?.(result);
        return result;
      }

      const valueJson = serializeWorkflowJson(decision.value, INTERACTION_INVALID);
      if (workflowJsonBytes(valueJson) > MAX_INTERACTION_PAYLOAD_BYTES) {
        throw workflowInteractionInvalid('Accepted interaction value exceeds its byte limit', 413);
      }
      const claim = this.db.prepare(`
        UPDATE _workflow_interaction_details
        SET accepted_response_id = ?, updated_at = ?
        WHERE interaction_id = ? AND accepted_response_id IS NULL
      `).run(response.responseId, now, interactionId);
      if (claim.changes !== 1) {
        const superseded = this.finishResponse(response, 'superseded', now, null, null);
        const result = {
          outcome: 'superseded' as const,
          interaction: this.lifecycle.require(interactionId),
          response: superseded,
        };
        afterDecision?.(result);
        return result;
      }
      const acceptedBytes = workflowJsonBytes(valueJson);
      const usage = this.responseUsage(interactionId);
      if (usage.response_bytes + acceptedBytes > MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES) {
        throw interactionSubmissionLimit();
      }
      this.reserveResponseBytes(interaction.instanceId, acceptedBytes);
      const expanded = this.db.prepare(`UPDATE _workflow_interaction_details SET
        response_bytes = response_bytes + ?, updated_at = ?
        WHERE interaction_id = ? AND response_bytes = ?`)
        .run(acceptedBytes, now, interactionId, usage.response_bytes);
      if (expanded.changes !== 1) throw interactionSubmissionLimit();
      this.db.update('workflow_interactions', interactionId, {
        status: 'accepted',
        accepted_at: now,
        accepted_by: response.actorId,
        updated_at: now,
      });
      const accepted = this.finishResponse(response, 'accepted', now, null, null, valueJson);
      const result = {
        outcome: 'accepted' as const,
        interaction: this.lifecycle.require(interactionId),
        response: accepted,
      };
      afterDecision?.(result);
      return result;
    });
  }

  getAcceptedValue(interactionId: string): WorkflowJsonValue | null {
    const row = this.db.prepare(`
      SELECT COALESCE(response.accepted_value_json, response.payload_json) AS accepted_value_json
      FROM _workflow_interaction_details AS detail
      INNER JOIN _workflow_interaction_responses AS response
        ON response.response_id = detail.accepted_response_id
      WHERE detail.interaction_id = ? AND response.status = 'accepted'
      LIMIT 1
    `).get(interactionId) as { accepted_value_json: string } | null;
    return row ? parseWorkflowJson(row.accepted_value_json) : null;
  }

  findResponse(interactionId: string, submissionId: string): WorkflowInteractionResponseRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND submission_id = ? LIMIT 1
    `).get(interactionId, submissionId) as WorkflowInteractionResponseRow | null;
    return row ? deserializeWorkflowInteractionResponse(row) : null;
  }

  releaseProcessingSubmission(
    interactionId: string,
    submissionId: string,
    now: string,
    afterRelease?: () => void,
    expectedEventId?: string,
  ): boolean {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT response.payload_json, interaction.instance_id
        FROM _workflow_interaction_responses AS response
        INNER JOIN workflow_interactions AS interaction
          ON interaction.interaction_id = response.interaction_id
        WHERE response.interaction_id = ? AND response.submission_id = ?
          AND response.status = 'processing'
          AND (? IS NULL OR (response.origin = 'event' AND response.event_id = ?))
        LIMIT 1`)
        .get(interactionId, submissionId, expectedEventId ?? null, expectedEventId ?? null) as {
          payload_json: string; instance_id: string;
        } | null;
      if (!row) {
        afterRelease?.();
        return false;
      }
      const bytes = workflowJsonBytes(row.payload_json);
      const usage = this.responseUsage(interactionId);
      if (usage.response_count < 1 || usage.response_bytes < bytes) {
        throw new WorkflowError(
          'Workflow interaction response accounting is inconsistent',
          'WORKFLOW_STATE_INVALID',
          500,
        );
      }
      this.reserveResponseBytes(row.instance_id, -bytes);
      const adjusted = this.db.prepare(`UPDATE _workflow_interaction_details SET
        response_count = response_count - 1,
        response_bytes = response_bytes - ?,
        updated_at = ?
        WHERE interaction_id = ? AND response_count = ? AND response_bytes = ?`)
        .run(bytes, now, interactionId,
          usage.response_count, usage.response_bytes);
      if (adjusted.changes !== 1) throw interactionSubmissionLimit();
      const result = this.db.prepare(`DELETE FROM _workflow_interaction_responses
        WHERE interaction_id = ? AND submission_id = ? AND status = 'processing'
          AND (? IS NULL OR (origin = 'event' AND event_id = ?))`)
        .run(interactionId, submissionId, expectedEventId ?? null, expectedEventId ?? null);
      if (result.changes !== 1) throw interactionSubmissionLimit();
      afterRelease?.();
      return true;
    });
  }

  private transaction<T>(operation: () => T): T {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, operation);
  }

  private reject(
    interaction: WorkflowInteractionRecord,
    response: WorkflowInteractionResponseRecord,
    decision: Extract<WorkflowInteractionDecision, { accepted: false }>,
    now: string,
  ): WorkflowInteractionDecisionResult {
    const rejectionCount = interaction.rejectionCount + 1;
    const exhausted = rejectionCount >= interaction.maxRejections;
    this.db.update('workflow_interactions', interaction.interactionId, {
      rejection_count: rejectionCount,
      status: exhausted ? 'rejection_limit' : 'open',
      updated_at: now,
    });
    const rejected = this.finishResponse(
      response,
      'rejected',
      now,
      normalizeWorkflowInteractionRejectionCode(decision.code),
      normalizeWorkflowInteractionPublicMessage(decision.publicMessage),
    );
    return {
      outcome: 'rejected',
      interaction: this.lifecycle.require(interaction.interactionId),
      response: rejected,
    };
  }

  private finishResponse(
    response: WorkflowInteractionResponseRecord,
    status: Exclude<WorkflowInteractionResponseStatus, 'processing'>,
    now: string,
    rejectionCode: string | null,
    publicMessage: string | null,
    acceptedValueJson: string | null = null,
  ): WorkflowInteractionResponseRecord {
    this.db.prepare(`
      UPDATE _workflow_interaction_responses
      SET status = ?, accepted_value_json = ?, rejection_code = ?, public_message = ?, decided_at = ?
      WHERE response_id = ? AND status = 'processing'
    `).run(status, acceptedValueJson, rejectionCode, publicMessage, now, response.responseId);
    return this.requireResponse(response.interactionId, response.submissionId);
  }

  private responseUsage(interactionId: string): { response_count: number; response_bytes: number } {
    const row = this.db.prepare(`SELECT response_count, response_bytes
      FROM _workflow_interaction_details WHERE interaction_id = ? LIMIT 1`)
      .get(interactionId) as { response_count: number; response_bytes: number } | null;
    if (!row) throw workflowInteractionNotFound();
    return {
      response_count: Number(row.response_count),
      response_bytes: Number(row.response_bytes),
    };
  }

  private reserveResponseBytes(instanceId: string, delta: number): void {
    try {
      this.runtimeBudget.reserveInteractionBytes(instanceId, delta);
    } catch (error) {
      if (error instanceof WorkflowError
        && error.code === 'WORKFLOW_RUNTIME_LIMIT_EXCEEDED') {
        throw interactionSubmissionLimit();
      }
      throw error;
    }
  }

  private requireResponse(
    interactionId: string,
    submissionId: string,
  ): WorkflowInteractionResponseRecord {
    const response = this.findResponse(interactionId, submissionId);
    if (!response) {
      throw workflowInteractionInvalid('Workflow interaction submission was not reserved', 409);
    }
    return response;
  }
}

function interactionSubmissionLimit(): WorkflowError {
  return new WorkflowError(
    'Workflow interaction submission capacity was reached',
    'WORKFLOW_INTERACTION_SUBMISSION_LIMIT',
    429,
  );
}
