/**
 * Durable lifecycle and private-definition persistence for workflow waits.
 * Response reservations and decisions live in workflow-interaction-response-store.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import { parseWorkflowJson, workflowJsonBytes } from './workflow-json-value';
import {
  deserializeWorkflowInteraction,
  normalizeOpenWorkflowInteractionInput,
  workflowInteractionInvalid,
  workflowInteractionNotFound,
  type OpenWorkflowInteractionInput,
  type WorkflowInteractionDetailRow,
  type WorkflowInteractionPrivateDefinition,
  type WorkflowInteractionPublicRow,
  type WorkflowInteractionRecord,
} from './workflow-interaction-records';
import { WorkflowRuntimeValueBudget } from './workflow-runtime-budget';
import {
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

/** Owns public wait lifecycle rows and their private definition snapshots. */
export class WorkflowInteractionLifecycleStore {
  constructor(
    private readonly db: ReactiveDB,
    private readonly runtimeBudget: WorkflowRuntimeValueBudget,
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {}

  open(input: OpenWorkflowInteractionInput): WorkflowInteractionRecord {
    const normalized = normalizeOpenWorkflowInteractionInput(input);
    return this.transaction(() => {
      const existing = this.getByStep(normalized.instanceId, normalized.stepId);
      if (existing) return existing;
      const instance = this.db.prepare(`
        SELECT tenant_id FROM workflow_instances WHERE instance_id = ? LIMIT 1
      `).get(normalized.instanceId) as { tenant_id: string | null } | null;
      if (!instance) throw new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404);
      this.runtimeBudget.reserveInteractionBytes(
        normalized.instanceId,
        workflowJsonBytes(normalized.responderPolicyJson)
          + workflowJsonBytes(normalized.responseSchemaJson)
          + workflowJsonBytes(normalized.requestJson),
      );
      const interactionId = `wait_${crypto.randomUUID()}`;
      this.db.insert('workflow_interactions', {
        interaction_id: interactionId,
        tenant_id: instance.tenant_id,
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

  get(interactionId: string): WorkflowInteractionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM workflow_interactions WHERE interaction_id = ? LIMIT 1
    `).get(interactionId) as WorkflowInteractionPublicRow | null;
    return row ? deserializeWorkflowInteraction(row) : null;
  }

  getByStep(instanceId: string, stepId: string): WorkflowInteractionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM workflow_interactions
      WHERE instance_id = ? AND step_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(instanceId, stepId) as WorkflowInteractionPublicRow | null;
    return row ? deserializeWorkflowInteraction(row) : null;
  }

  listByInstance(instanceId: string): WorkflowInteractionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM workflow_interactions
      WHERE instance_id = ?
      ORDER BY opened_at ASC, rowid ASC
    `).all(instanceId) as WorkflowInteractionPublicRow[];
    return rows.map(deserializeWorkflowInteraction);
  }

  shiftOpenExpiries(instanceId: string, milliseconds: number, now: string): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw workflowInteractionInvalid('Interaction pause duration is invalid', 500);
    }
    if (milliseconds === 0) return;
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
  }

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

  require(interactionId: string): WorkflowInteractionRecord {
    const interaction = this.get(interactionId);
    if (!interaction) throw workflowInteractionNotFound();
    return interaction;
  }

  expireIfDue(interaction: WorkflowInteractionRecord, now: string): void {
    if (interaction.status === 'open' && interaction.expiresAt && interaction.expiresAt <= now
      && !this.isInstancePaused(interaction.instanceId)) {
      this.db.update('workflow_interactions', interaction.interactionId, {
        status: 'expired', updated_at: now,
      });
    }
  }

  assertInstanceRunning(instanceId: string): void {
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

  private isInstancePaused(instanceId: string): boolean {
    const row = this.db.prepare(`
      SELECT status FROM workflow_instances WHERE instance_id = ? LIMIT 1
    `).get(instanceId) as { status: string } | null;
    return row?.status === 'paused';
  }

  transaction<T>(operation: () => T): T {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, operation);
  }
}
