/**
 * workflow-interaction-store.ts
 *
 * Owns durable, channel-neutral workflow waits and their private submissions.
 * The public interaction row contains projection-safe progress only; policy,
 * schemas, payloads, and accepted values remain in underscore-prefixed tables.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
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
import {
  INTERACTION_INVALID,
  MAX_INTERACTION_PAYLOAD_BYTES,
  assertWorkflowInteractionOpen,
  deserializeWorkflowInteraction,
  deserializeWorkflowInteractionResponse,
  normalizeOpenWorkflowInteractionInput,
  normalizeWorkflowInteractionPublicMessage,
  normalizeWorkflowInteractionRejectionCode,
  validateWorkflowInteractionSubmission,
  workflowInteractionInvalid,
  workflowInteractionNotFound,
  workflowInteractionSubmissionConflict,
  type BeginWorkflowInteractionSubmissionInput,
  type OpenWorkflowInteractionInput,
  type WorkflowInteractionDecision,
  type WorkflowInteractionDecisionResult,
  type WorkflowInteractionDetailRow,
  type WorkflowInteractionPrivateDefinition,
  type WorkflowInteractionPublicRow,
  type WorkflowInteractionRecord,
  type WorkflowInteractionResponseRecord,
  type WorkflowInteractionResponseRow,
  type WorkflowInteractionResponseStatus,
} from './workflow-interaction-records';

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

export const MAX_WORKFLOW_INTERACTION_SUBMISSIONS = 1_024;
export const MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Durable interaction persistence with atomic first-valid-wins decisions. */
export class WorkflowInteractionStore {
  private readonly runtimeBudget: WorkflowRuntimeValueBudget;

  constructor(
    private readonly db: ReactiveDB,
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {
    this.runtimeBudget = new WorkflowRuntimeValueBudget(db);
  }

  /** Create a cryptographically random wait and persist it before delivery. */
  open(input: OpenWorkflowInteractionInput): WorkflowInteractionRecord {
    const normalized = normalizeOpenWorkflowInteractionInput(input);
    return this.transaction(() => {
      const existing = this.getByStep(normalized.instanceId, normalized.stepId);
      if (existing) return existing;
      this.runtimeBudget.reserveInteractionBytes(
        normalized.instanceId,
        workflowJsonBytes(normalized.responderPolicyJson)
          + workflowJsonBytes(normalized.responseSchemaJson)
          + workflowJsonBytes(normalized.requestJson),
      );
      const interactionId = `wait_${crypto.randomUUID()}`;
      this.db.insert('workflow_interactions', {
        interaction_id: interactionId,
        instance_id: normalized.instanceId,
        node_id: normalized.nodeId,
        step_id: normalized.stepId,
        safe_label: normalized.safeLabel,
        status: 'open',
        opened_at: normalized.openedAt,
        expires_at: normalized.expiresAt,
        accepted_at: null,
        accepted_by: null,
        rejection_count: 0,
        max_rejections: normalized.maxRejections,
        created_at: normalized.openedAt,
        updated_at: normalized.openedAt,
      });
      this.db.prepare(`
        INSERT INTO _workflow_interaction_details (
          interaction_id, responder_policy_json, response_schema_json,
          request_json, validator_activity_id, accepted_response_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        interactionId,
        normalized.responderPolicyJson,
        normalized.responseSchemaJson,
        normalized.requestJson,
        normalized.validatorActivityId,
        normalized.openedAt,
        normalized.openedAt,
      );
      return this.require(interactionId);
    });
  }

  /** Read projection-safe interaction progress. */
  get(interactionId: string): WorkflowInteractionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM workflow_interactions WHERE interaction_id = ? LIMIT 1
    `).get(interactionId) as WorkflowInteractionPublicRow | null;
    return row ? deserializeWorkflowInteraction(row) : null;
  }

  /** Recover the newest durable wait owned by one graph step. */
  getByStep(instanceId: string, stepId: string): WorkflowInteractionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM workflow_interactions
      WHERE instance_id = ? AND step_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(instanceId, stepId) as WorkflowInteractionPublicRow | null;
    return row ? deserializeWorkflowInteraction(row) : null;
  }

  /** List projection-safe interactions for one workflow run in opening order. */
  listByInstance(instanceId: string): WorkflowInteractionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM workflow_interactions
      WHERE instance_id = ?
      ORDER BY opened_at ASC, rowid ASC
    `).all(instanceId) as WorkflowInteractionPublicRow[];
    return rows.map(deserializeWorkflowInteraction);
  }

  /** Shift open deadlines after a paused workflow resumes. */
  shiftOpenExpiries(instanceId: string, milliseconds: number, now: string): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw workflowInteractionInvalid('Interaction pause duration is invalid', 500);
    }
    if (milliseconds === 0) return;
    this.transaction(() => {
      const rows = this.db.prepare(`
        SELECT interaction_id, expires_at FROM workflow_interactions
        WHERE instance_id = ? AND status = 'open' AND expires_at IS NOT NULL
        ORDER BY rowid ASC
      `).all(instanceId) as Array<{ interaction_id: string; expires_at: string }>;
      for (const row of rows) {
        const shifted = new Date(new Date(row.expires_at).getTime() + milliseconds);
        if (!Number.isFinite(shifted.getTime())) {
          throw workflowInteractionInvalid('Interaction expiry cannot be shifted safely', 500);
        }
        this.db.update('workflow_interactions', row.interaction_id, {
          expires_at: shifted.toISOString(),
          updated_at: now,
        });
      }
    });
  }

  /** Read the private policy and validation definition for server execution. */
  getPrivateDefinition(interactionId: string): WorkflowInteractionPrivateDefinition {
    const row = this.db.prepare(`
      SELECT * FROM _workflow_interaction_details WHERE interaction_id = ? LIMIT 1
    `).get(interactionId) as WorkflowInteractionDetailRow | null;
    if (!row) throw workflowInteractionNotFound();
    return {
      responderPolicy: row.responder_policy_json === null
        ? null
        : parseWorkflowJson(row.responder_policy_json),
      responseSchema: parseWorkflowJson(row.response_schema_json),
      request: row.request_json === null ? null : parseWorkflowJson(row.request_json),
      validatorActivityId: row.validator_activity_id,
    };
  }

  /**
   * Reserve an idempotency key before running validators.
   *
   * A prior same-hash response is returned for replay. Reusing a submission ID
   * with a different payload is always rejected.
   */
  beginSubmission(input: BeginWorkflowInteractionSubmissionInput): WorkflowInteractionResponseRecord {
    validateWorkflowInteractionSubmission(input);
    return this.transaction(() => {
      const interaction = this.require(input.interactionId);
      if (input.requireRunningInstance) this.assertInstanceRunning(interaction.instanceId);
      this.expireIfDue(interaction, input.now);
      const existing = this.findResponse(input.interactionId, input.submissionId);
      if (existing) {
        if (existing.payloadHash !== input.payloadHash
          || existing.actorId !== input.actorId) {
          throw workflowInteractionSubmissionConflict();
        }
        return existing;
      }
      const current = this.require(input.interactionId);
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
          response_id, interaction_id, submission_id, actor_id, channel,
          payload_hash, payload_json, accepted_value_json, status, rejection_code, public_message,
          created_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'processing', NULL, NULL, ?, NULL)
      `).run(
        `wresp_${crypto.randomUUID()}`,
        input.interactionId,
        input.submissionId,
        input.actorId,
        input.channel ?? null,
        input.payloadHash,
        input.payloadJson,
        input.now,
      );
      return this.findResponse(input.interactionId, input.submissionId)!;
    });
  }

  /** Atomically apply a validation result; at most one valid response wins. */
  decideSubmission(
    interactionId: string,
    submissionId: string,
    decision: WorkflowInteractionDecision,
    now: string,
    requireRunningInstance = false,
  ): WorkflowInteractionDecisionResult {
    return this.transaction(() => {
      let interaction = this.require(interactionId);
      if (requireRunningInstance) this.assertInstanceRunning(interaction.instanceId);
      const response = this.requireResponse(interactionId, submissionId);
      if (response.status !== 'processing') {
        return { outcome: response.status === 'accepted' ? 'accepted'
          : response.status === 'rejected' ? 'rejected' : 'superseded', interaction, response };
      }
      this.expireIfDue(interaction, now);
      interaction = this.require(interactionId);
      if (interaction.status !== 'open') {
        const superseded = this.finishResponse(response, 'superseded', now, null, null);
        return { outcome: 'superseded', interaction, response: superseded };
      }
      if (!decision.accepted) return this.reject(interaction, response, decision, now);

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
        return { outcome: 'superseded', interaction: this.require(interactionId), response: superseded };
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
      return { outcome: 'accepted', interaction: this.require(interactionId), response: accepted };
    });
  }

  /** Mark one due open interaction expired. */
  expire(interactionId: string, now: string): WorkflowInteractionRecord {
    return this.transaction(() => {
      const interaction = this.require(interactionId);
      if (interaction.status !== 'open') return interaction;
      if (this.isInstancePaused(interaction.instanceId)) return interaction;
      if (!interaction.expiresAt || interaction.expiresAt > now) return interaction;
      this.db.update('workflow_interactions', interactionId, {
        status: 'expired',
        updated_at: now,
      });
      return this.require(interactionId);
    });
  }

  /** Expire every due interaction and return the changed public rows. */
  expireDue(now: string): WorkflowInteractionRecord[] {
    const ids = this.db.prepare(`
      SELECT interaction.interaction_id
      FROM workflow_interactions AS interaction
      INNER JOIN workflow_instances AS instance
        ON instance.instance_id = interaction.instance_id
      WHERE interaction.status = 'open'
        AND instance.status = 'running'
        AND interaction.expires_at IS NOT NULL
        AND interaction.expires_at <= ?
      ORDER BY interaction.expires_at ASC, interaction.rowid ASC
    `).all(now) as Array<{ interaction_id: string }>;
    return ids.map((row) => this.expire(row.interaction_id, now));
  }

  /** Cancel every still-open wait when its workflow reaches a terminal state. */
  cancelForInstance(instanceId: string, now: string): WorkflowInteractionRecord[] {
    return this.transaction(() => {
      const rows = this.db.prepare(`
        SELECT interaction_id FROM workflow_interactions
        WHERE instance_id = ? AND status = 'open'
        ORDER BY created_at ASC, rowid ASC
      `).all(instanceId) as Array<{ interaction_id: string }>;
      for (const row of rows) {
        this.db.update('workflow_interactions', row.interaction_id, {
          status: 'cancelled',
          updated_at: now,
        });
      }
      return rows.map((row) => this.require(row.interaction_id));
    });
  }

  /** Retrieve an accepted value only through the private response table. */
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

  /** Return the exact internal event accepted by this interaction, if any. */
  getAcceptedEventId(interactionId: string): string | null {
    const row = this.db.prepare(`
      SELECT response.channel, response.submission_id
      FROM _workflow_interaction_details AS detail
      INNER JOIN _workflow_interaction_responses AS response
        ON response.response_id = detail.accepted_response_id
      WHERE detail.interaction_id = ? AND response.status = 'accepted'
      LIMIT 1
    `).get(interactionId) as { channel: string | null; submission_id: string } | null;
    if (!row) return null;
    const hasEventChannel = row.channel === 'event';
    const hasEventIdentity = row.submission_id.startsWith('event:');
    if (!hasEventChannel && !hasEventIdentity) return null;
    const eventId = hasEventIdentity ? row.submission_id.slice('event:'.length) : '';
    if (!hasEventChannel || !hasEventIdentity || !eventId || eventId.startsWith('event:')) {
      throw new WorkflowError(
        'Accepted workflow interaction event identity is invalid',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    return eventId;
  }

  /** Read one private submission for idempotent service replay. */
  findResponse(interactionId: string, submissionId: string): WorkflowInteractionResponseRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM _workflow_interaction_responses
      WHERE interaction_id = ? AND submission_id = ? LIMIT 1
    `).get(interactionId, submissionId) as WorkflowInteractionResponseRow | null;
    return row ? deserializeWorkflowInteractionResponse(row) : null;
  }

  /** Remove an interrupted, undecided reservation so a direct caller may retry. */
  releaseProcessingSubmission(
    interactionId: string,
    submissionId: string,
    now: string,
  ): boolean {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT response.payload_json, interaction.instance_id
        FROM _workflow_interaction_responses AS response
        INNER JOIN workflow_interactions AS interaction
          ON interaction.interaction_id = response.interaction_id
        WHERE response.interaction_id = ? AND response.submission_id = ?
          AND response.status = 'processing' LIMIT 1`)
        .get(interactionId, submissionId) as {
          payload_json: string; instance_id: string;
        } | null;
      if (!row) return false;
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
        WHERE interaction_id = ? AND submission_id = ? AND status = 'processing'`)
        .run(interactionId, submissionId);
      if (result.changes !== 1) throw interactionSubmissionLimit();
      return true;
    });
  }

  /** Fail closed when graph response work is attempted outside a running run. */
  assertInteractionInstanceRunning(interactionId: string): void {
    const interaction = this.require(interactionId);
    this.assertInstanceRunning(interaction.instanceId);
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
    return { outcome: 'rejected', interaction: this.require(interaction.interactionId), response: rejected };
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

  private expireIfDue(interaction: WorkflowInteractionRecord, now: string): void {
    if (interaction.status === 'open' && interaction.expiresAt && interaction.expiresAt <= now
      && !this.isInstancePaused(interaction.instanceId)) {
      this.db.update('workflow_interactions', interaction.interactionId, {
        status: 'expired', updated_at: now,
      });
    }
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

  private isInstancePaused(instanceId: string): boolean {
    const row = this.db.prepare(`
      SELECT status FROM workflow_instances WHERE instance_id = ? LIMIT 1
    `).get(instanceId) as { status: string } | null;
    return row?.status === 'paused';
  }

  private assertInstanceRunning(instanceId: string): void {
    const row = this.db.prepare(`
      SELECT status FROM workflow_instances WHERE instance_id = ? LIMIT 1
    `).get(instanceId) as { status: string } | null;
    if (row?.status === 'running') return;
    if (row?.status === 'paused') {
      throw new WorkflowError(
        'Workflow is paused; retry the interaction response after resume',
        'WORKFLOW_DRAINING',
        409,
        true,
      );
    }
    throw new WorkflowError(
      'Workflow interaction cannot be processed after its workflow stopped',
      'WORKFLOW_STATE_INVALID',
      409,
    );
  }

  private transaction<T>(operation: () => T): T {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, operation);
  }

  private require(interactionId: string): WorkflowInteractionRecord {
    const interaction = this.get(interactionId);
    if (!interaction) throw workflowInteractionNotFound();
    return interaction;
  }

  private requireResponse(interactionId: string, submissionId: string): WorkflowInteractionResponseRecord {
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
