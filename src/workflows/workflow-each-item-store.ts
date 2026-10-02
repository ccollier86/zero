/** Durable fan-out item persistence and runtime-value accounting. */

import type { ReactiveDB } from '../sync/reactive-db';
import type { WorkflowEachItemRecord } from './workflow-graph-records';
import { WorkflowRuntimeValueBudget } from './workflow-runtime-budget';

/** Owns private `each` item rows without exposing them through Sync. */
export class WorkflowEachItemStore {
  private readonly budget: WorkflowRuntimeValueBudget;

  constructor(private readonly db: ReactiveDB) {
    this.budget = new WorkflowRuntimeValueBudget(db);
  }

  list(instanceId: string, nodeId: string): WorkflowEachItemRecord[] {
    return this.db.prepare(`
      SELECT * FROM _workflow_each_items
      WHERE instance_id = ? AND node_id = ?
      ORDER BY item_index ASC, rowid ASC
    `).all(instanceId, nodeId) as WorkflowEachItemRecord[];
  }

  get(itemId: string): WorkflowEachItemRecord | null {
    return (this.db.prepare(`
      SELECT * FROM _workflow_each_items WHERE item_id = ? LIMIT 1
    `).get(itemId) as WorkflowEachItemRecord | null) ?? null;
  }

  listByInstance(instanceId: string): WorkflowEachItemRecord[] {
    return this.db.prepare(`
      SELECT * FROM _workflow_each_items
      WHERE instance_id = ? ORDER BY node_id ASC, item_index ASC, rowid ASC
    `).all(instanceId) as WorkflowEachItemRecord[];
  }

  insert(row: WorkflowEachItemRecord): void {
    this.db.transaction(() => {
      this.budget.assertNewEachItem(row as unknown as Record<string, unknown>);
      this.db.prepare(`
        INSERT INTO _workflow_each_items (
          item_id, instance_id, parent_step_id, node_id, activation_key,
          item_key, item_index, status, input_json, output_json, error,
          attempts, max_attempts, created_at, updated_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.item_id,
        row.instance_id,
        row.parent_step_id,
        row.node_id,
        row.activation_key,
        row.item_key,
        row.item_index,
        row.status,
        row.input_json,
        row.output_json,
        row.error,
        row.attempts,
        row.max_attempts,
        row.created_at,
        row.updated_at,
        row.started_at,
        row.completed_at,
      );
    });
  }

  update(itemId: string, changes: Record<string, unknown>): void {
    this.db.transaction(() => {
      this.budget.assertEachItemChange(itemId, changes);
      updateInternalRow(this.db, '_workflow_each_items', 'item_id', itemId, changes);
    });
  }
}

function updateInternalRow(
  db: ReactiveDB,
  table: string,
  keyColumn: string,
  key: string,
  changes: Record<string, unknown>,
): void {
  const entries = Object.entries(changes);
  if (entries.length === 0) return;
  const columns = entries.map(([column]) => {
    if (!/^[a-z_][a-z0-9_]*$/u.test(column)) throw new TypeError('Invalid column name');
    return `${column} = ?`;
  });
  db.prepare(`UPDATE ${table} SET ${columns.join(', ')} WHERE ${keyColumn} = ?`)
    .run(...entries.map(([, value]) => value as never), key);
}
