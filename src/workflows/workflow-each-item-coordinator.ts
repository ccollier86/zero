/**
 * workflow-each-item-coordinator.ts
 *
 * Owns durable each-item/child identity, claiming, and crash reconciliation.
 * It batches snapshot reads so fan-out size does not multiply database work.
 */

import type {
  WorkflowEachItemRecord,
  WorkflowGraphStore,
} from './workflow-graph-store';
import type { WorkflowActivityNode } from './workflow-ir';
import type { WorkflowStepRecord } from './types';

export interface WorkflowEachExecutionSnapshot {
  items: WorkflowEachItemRecord[];
  children: ReadonlyMap<string, WorkflowStepRecord>;
}

export interface WorkflowEachReconciledPair {
  item: WorkflowEachItemRecord;
  child: WorkflowStepRecord;
}

export class WorkflowEachItemCoordinator {
  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly now: () => Date,
  ) {}

  /** Load and reconcile a complete fan-out with one item and one step scan. */
  snapshot(
    instanceId: string,
    nodeId: string,
    parentStepId: string,
    body: WorkflowActivityNode,
  ): WorkflowEachExecutionSnapshot {
    return this.store.transaction(() => {
      const items = this.store.listEachItems(instanceId, nodeId);
      const children = this.matchChildren(instanceId, parentStepId, items, body);
      if (this.store.getInstance(instanceId)?.status !== 'running') {
        return { items, children };
      }
      const reconciled = items.map((item) => this.reconcileRow(
        item,
        children.get(item.item_id)!,
      ));
      return { items: reconciled, children };
    });
  }

  /** Atomically reserve one pending item before its child activity starts. */
  claim(
    instanceId: string,
    item: WorkflowEachItemRecord,
    child: WorkflowStepRecord,
  ): boolean {
    return this.store.transaction(() => {
      const instance = this.store.getInstance(instanceId);
      const currentItem = this.store.getEachItem(item.item_id);
      const currentChild = this.store.getStep(child.step_id);
      if (!instance || instance.status !== 'running'
        || !currentItem || currentItem.status !== 'pending'
        || !currentChild || currentChild.status !== 'pending') return false;
      const now = this.now().toISOString();
      this.store.updateEachItem(item.item_id, {
        status: 'running',
        started_at: currentItem.started_at ?? now,
        updated_at: now,
      });
      return true;
    });
  }

  /** Reconcile one completed/failed attempt without rescanning its fan-out. */
  reconcileOne(
    instanceId: string,
    itemId: string,
    childStepId: string,
    body: WorkflowActivityNode,
  ): WorkflowEachReconciledPair | null {
    return this.store.transaction(() => {
      const instance = this.store.getInstance(instanceId);
      const item = this.store.getEachItem(itemId);
      const child = this.store.getStep(childStepId);
      if (!instance || instance.status !== 'running' || !item || !child) return null;
      this.assertChild(item.parent_step_id, item, child, body);
      return { item: this.reconcileRow(item, child), child };
    });
  }

  private matchChildren(
    instanceId: string,
    parentStepId: string,
    items: readonly WorkflowEachItemRecord[],
    body: WorkflowActivityNode,
  ): Map<string, WorkflowStepRecord> {
    const children = this.store.listSteps(instanceId)
      .filter((step) => step.parent_step_id === parentStepId);
    if (children.length !== items.length) {
      throw new TypeError('Workflow each child step count is invalid');
    }
    const byKey = new Map<string, WorkflowStepRecord>();
    for (const child of children) {
      if (!child.item_key || byKey.has(child.item_key)) {
        throw new TypeError('Workflow each child step identity is duplicated');
      }
      byKey.set(child.item_key, child);
    }
    const result = new Map<string, WorkflowStepRecord>();
    for (const item of items) {
      const child = byKey.get(item.item_key);
      if (!child) throw new TypeError('Workflow each child step identity is invalid');
      this.assertChild(parentStepId, item, child, body);
      result.set(item.item_id, child);
    }
    return result;
  }

  private assertChild(
    parentStepId: string | null,
    item: WorkflowEachItemRecord,
    child: WorkflowStepRecord,
    body: WorkflowActivityNode,
  ): void {
    if (!parentStepId
      || child.parent_step_id !== parentStepId
      || child.node_id !== body.id
      || child.node_kind !== 'activity'
      || child.node_path !== `${item.node_id}/${body.id}`
      || child.activation_key !== item.item_key
      || child.item_key !== item.item_key
      || child.item_index !== item.item_index) {
      throw new TypeError('Workflow each child step does not match its pinned definition');
    }
  }

  private reconcileRow(
    item: WorkflowEachItemRecord,
    child: WorkflowStepRecord,
  ): WorkflowEachItemRecord {
    const terminalFailure = child.status === 'failed' && child.retry_at === null;
    const retryWaiting = child.status === 'failed' && child.retry_at !== null;
    const status = child.status === 'completed' ? 'completed'
      : terminalFailure ? 'failed'
        : child.status === 'skipped' ? 'skipped'
          : retryWaiting || child.status === 'pending' ? 'pending'
            : child.status === 'running' ? 'running' : item.status;
    const completedAt = status === 'completed' || status === 'failed' || status === 'skipped'
      ? child.completed_at ?? item.completed_at ?? this.now().toISOString()
      : null;
    const attempts = child.status === 'completed' ? child.retries + 1 : child.retries;
    const startedAt = child.started_at ?? item.started_at;
    if (item.status === status
      && item.output_json === child.output
      && item.error === child.error
      && item.attempts === attempts
      && item.started_at === startedAt
      && item.completed_at === completedAt) return item;
    const updatedAt = this.now().toISOString();
    this.store.updateEachItem(item.item_id, {
      status,
      output_json: child.output,
      error: child.error,
      attempts,
      started_at: startedAt,
      completed_at: completedAt,
      updated_at: updatedAt,
    });
    return {
      ...item,
      status,
      output_json: child.output,
      error: child.error,
      attempts,
      started_at: startedAt,
      completed_at: completedAt,
      updated_at: updatedAt,
    };
  }
}
