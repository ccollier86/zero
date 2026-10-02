/** O(1) transactional accounting for durable workflow runtime values. */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';

export const MAX_WORKFLOW_INSTANCE_RUNTIME_BYTES = 32 * 1024 * 1024;

type RuntimeRow = Record<string, unknown>;

/**
 * Bounds amplification across instance, step, and fan-out snapshots. The
 * usage row is updated in the caller's write transaction, so quota and data
 * commit or roll back together without rescanning an expanding fan-out.
 */
export class WorkflowRuntimeValueBudget {
  constructor(private readonly db: ReactiveDB) {}

  assertNewInstance(row: RuntimeRow): void {
    const instanceId = requireId(row.instance_id);
    const bytes = valueBytes(row, ['input', 'output']);
    const existing = this.db.prepare(`SELECT started_by, input, output FROM workflow_instances
      WHERE instance_id = ? LIMIT 1`).get(instanceId) as RuntimeRow | null;
    if (existing) {
      if (existing.started_by !== (row.started_by ?? null)) return;
      this.reserve(instanceId, bytes - valueBytes(existing, ['input', 'output']));
      return;
    }
    this.assertLimit(bytes);
    this.db.prepare(`INSERT INTO _workflow_runtime_usage (instance_id, runtime_bytes)
      VALUES (?, ?)`).run(instanceId, bytes);
  }

  assertNewStep(row: RuntimeRow): void {
    const stepId = requireId(row.step_id);
    const instanceId = requireId(row.instance_id);
    const existing = this.db.prepare(`SELECT instance_id, input, output FROM workflow_steps
      WHERE step_id = ? LIMIT 1`).get(stepId) as RuntimeRow | null;
    if (existing) {
      // Let ReactiveDB's immutable-parent boundary report reassignment. Any
      // accounting update would roll back, but skipping it preserves that error.
      if (existing.instance_id !== instanceId) return;
      this.reserve(
        instanceId,
        valueBytes(row, ['input', 'output']) - valueBytes(existing, ['input', 'output']),
      );
      return;
    }
    this.reserve(instanceId, valueBytes(row, ['input', 'output']));
  }

  assertNewEachItem(row: RuntimeRow): void {
    this.reserve(
      requireId(row.instance_id),
      valueBytes(row, ['input_json', 'output_json']),
    );
  }

  assertInstanceChange(instanceId: string, changes: RuntimeRow): void {
    this.assertChange('workflow_instances', 'instance_id', instanceId, changes, ['input', 'output']);
  }

  assertStepChange(stepId: string, changes: RuntimeRow): void {
    this.assertChange('workflow_steps', 'step_id', stepId, changes, ['input', 'output']);
  }

  assertEachItemChange(itemId: string, changes: RuntimeRow): void {
    this.assertChange('_workflow_each_items', 'item_id', itemId, changes, [
      'input_json', 'output_json',
    ]);
  }

  reserveMemoryChange(instanceId: string, before: string | null, after: string | null): void {
    this.reserve(instanceId, textBytes(after) - textBytes(before));
  }

  reserveInteractionBytes(instanceId: string, delta: number): void {
    this.reserve(instanceId, delta);
  }

  /** Recovery-only integrity scan; never used on the execution hot path. */
  validateInstance(instanceId: string): void {
    const actual = this.calculate(instanceId);
    const accounted = this.accounted(instanceId);
    if (accounted === null || accounted !== actual) {
      throw new WorkflowError(
        'Workflow durable runtime value accounting is inconsistent',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
    this.assertLimit(actual);
  }

  private assertChange(
    table: string,
    keyColumn: string,
    key: string,
    changes: RuntimeRow,
    columns: readonly string[],
  ): void {
    if (!columns.some((column) => Object.hasOwn(changes, column))) return;
    const row = this.db.prepare(`SELECT instance_id, ${columns.join(', ')} FROM ${table}
      WHERE ${keyColumn} = ? LIMIT 1`).get(key) as RuntimeRow | null;
    if (!row) throw invalidBudgetState();
    const delta = valueBytes({ ...row, ...changes }, columns) - valueBytes(row, columns);
    this.reserve(requireId(row.instance_id), delta);
  }

  private reserve(instanceId: string, delta: number): void {
    const current = this.accounted(instanceId);
    if (current === null) throw invalidBudgetState();
    if (delta === 0) return;
    const next = current + delta;
    if (next < 0) throw invalidBudgetState();
    this.assertLimit(next);
    const updated = this.db.prepare(`UPDATE _workflow_runtime_usage
      SET runtime_bytes = ? WHERE instance_id = ? AND runtime_bytes = ?`)
      .run(next, instanceId, current);
    if (updated.changes !== 1) throw invalidBudgetState();
  }

  private accounted(instanceId: string): number | null {
    const row = this.db.prepare(`SELECT runtime_bytes FROM _workflow_runtime_usage
      WHERE instance_id = ? LIMIT 1`).get(instanceId) as { runtime_bytes: number } | null;
    return row ? Number(row.runtime_bytes) : null;
  }

  private calculate(instanceId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM (
      SELECT length(CAST(COALESCE(input, '') AS BLOB))
        + length(CAST(COALESCE(output, '') AS BLOB)) AS bytes
      FROM workflow_instances WHERE instance_id = ?
      UNION ALL
      SELECT length(CAST(COALESCE(input, '') AS BLOB))
        + length(CAST(COALESCE(output, '') AS BLOB)) AS bytes
      FROM workflow_steps WHERE instance_id = ?
      UNION ALL
      SELECT length(CAST(COALESCE(input_json, '') AS BLOB))
        + length(CAST(COALESCE(output_json, '') AS BLOB)) AS bytes
      FROM _workflow_each_items WHERE instance_id = ?
      UNION ALL
      SELECT length(CAST(COALESCE(value_json, '') AS BLOB)) AS bytes
      FROM _workflow_memory WHERE instance_id = ?
      UNION ALL
      SELECT length(CAST(response.payload_json AS BLOB))
        + length(CAST(COALESCE(response.accepted_value_json, '') AS BLOB)) AS bytes
      FROM _workflow_interaction_responses AS response
      INNER JOIN workflow_interactions AS interaction
        ON interaction.interaction_id = response.interaction_id
      WHERE interaction.instance_id = ?
      UNION ALL
      SELECT length(CAST(COALESCE(detail.responder_policy_json, '') AS BLOB))
        + length(CAST(detail.response_schema_json AS BLOB))
        + length(CAST(COALESCE(detail.request_json, '') AS BLOB)) AS bytes
      FROM _workflow_interaction_details AS detail
      INNER JOIN workflow_interactions AS interaction
        ON interaction.interaction_id = detail.interaction_id
      WHERE interaction.instance_id = ?
    )`).get(
      instanceId, instanceId, instanceId, instanceId, instanceId, instanceId,
    ) as { bytes: number };
    return Number(row.bytes);
  }

  private assertLimit(bytes: number): void {
    if (bytes <= MAX_WORKFLOW_INSTANCE_RUNTIME_BYTES) return;
    throw new WorkflowError(
      'Workflow durable runtime value capacity was reached for this instance',
      'WORKFLOW_RUNTIME_LIMIT_EXCEEDED',
      500,
    );
  }
}

function valueBytes(row: RuntimeRow, columns: readonly string[]): number {
  return columns.reduce((total, column) => {
    const value = row[column];
    return total + (typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0);
  }, 0);
}

function textBytes(value: string | null): number {
  return value === null ? 0 : Buffer.byteLength(value, 'utf8');
}

function requireId(value: unknown): string {
  if (typeof value === 'string' && value) return value;
  throw invalidBudgetState();
}

function invalidBudgetState(): WorkflowError {
  return new WorkflowError(
    'Workflow durable runtime value accounting could not resolve its owner',
    'WORKFLOW_STATE_INVALID',
    500,
  );
}
