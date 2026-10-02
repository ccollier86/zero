/** Durable, bounded fan-out execution for `each` workflow nodes. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { evaluateWorkflowExpression } from './workflow-expression';
import type {
  WorkflowGraphActivityExecutor,
} from './workflow-graph-activity-executor';
import { WorkflowEachItemCoordinator } from './workflow-each-item-coordinator';
import {
  createEachChildStepRow,
  firstDuplicateWorkflowEachKey,
  parseWorkflowEachJson,
  requireEachBodyActivity,
  serializeWorkflowEachJson,
} from './workflow-each-records';
import {
  collectWorkflowNodeOutputs,
  resolveWorkflowNodeInput,
} from './workflow-graph-planner';
import type { WorkflowEachItemRecord, WorkflowGraphStore } from './workflow-graph-store';
import type { WorkflowEachNode, WorkflowGraphIR } from './workflow-ir';
import type { WorkflowMemoryStore } from './workflow-memory-store';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';
import { WorkflowError } from './workflow-error';
import { validateWorkflowSchemaValue } from './workflow-schema-snapshot';

const MAX_EACH_ITEMS = 10_000;

export class WorkflowEachController {
  private readonly items: WorkflowEachItemCoordinator;

  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly executor: WorkflowGraphActivityExecutor,
    private readonly memory: WorkflowMemoryStore,
    private readonly runtime: WorkflowRuntimeStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.items = new WorkflowEachItemCoordinator(store, now);
  }

  async advance(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowEachNode,
  ): Promise<'completed' | 'blocked' | 'failed'> {
    const parent = this.store.getNodeStep(instance.instance_id, node.id);
    if (!parent || (parent.status !== 'pending' && parent.status !== 'waiting')) return 'blocked';
    if (parent.status === 'pending') this.expand(instance, graph, node, parent);
    return this.drive(instance, graph, node, parent.step_id);
  }

  private expand(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowEachNode,
    parent: WorkflowStepRecord,
  ): void {
    const steps = this.store.listRootSteps(instance.instance_id);
    const workflowInput = parseWorkflowEachJson(instance.input);
    const previous = resolveWorkflowNodeInput(
      node.id,
      graph,
      steps,
      this.store.listEdges(instance.instance_id),
      this.store.listDecisions(instance.instance_id),
      workflowInput,
    );
    const context = {
      input: workflowInput,
      previous,
      outputs: collectWorkflowNodeOutputs(steps),
      memory: Object.fromEntries(this.memory.list({
        instanceId: instance.instance_id,
        kind: 'instance',
      }).map((entry) => [entry.key, entry.value])),
    };
    const source = evaluateWorkflowExpression(node.source, context);
    if (!Array.isArray(source)) {
      throw new WorkflowError(
        `Workflow each node "${node.id}" source is not an array`,
        'WORKFLOW_ACTIVITY_INPUT_INVALID',
        422,
      );
    }
    if (source.length > MAX_EACH_ITEMS) {
      emitPlatformCode(OBS_CODES.WORKFLOW_FANOUT_LIMIT_EXCEEDED, {
        metadata: { instanceId: instance.instance_id, nodeId: node.id, itemCount: source.length },
      });
      throw new WorkflowError(
        `Workflow each node exceeds the ${MAX_EACH_ITEMS} item limit`,
        'WORKFLOW_FANOUT_LIMIT_EXCEEDED',
        422,
      );
    }
    const body = this.requireBody(node);
    const prepared = source.map((value, index) => this.prepareItem(node, value, index));
    const duplicate = firstDuplicateWorkflowEachKey(prepared.map((item) => item.key));
    if (duplicate) {
      throw new WorkflowError(
        `Workflow each node produced duplicate item key "${duplicate}"`,
        'WORKFLOW_ACTIVITY_INPUT_INVALID',
        422,
      );
    }
    if (node.onInvalid === 'fail' && prepared.some((item) => !item.valid)) {
      throw new WorkflowError(
        `Workflow each node "${node.id}" received an invalid item`,
        'WORKFLOW_ACTIVITY_INPUT_INVALID',
        422,
      );
    }
    const now = this.now().toISOString();
    this.store.transaction(() => {
      const current = this.store.getNodeStep(instance.instance_id, node.id);
      if (!current || current.status !== 'pending') return;
      prepared.forEach((item) => {
        const childStepId = `wstep_${crypto.randomUUID()}`;
        const itemId = `witem_${crypto.randomUUID()}`;
        const status = item.valid ? 'pending' : 'skipped';
        this.store.insertEachItem({
          item_id: itemId,
          instance_id: instance.instance_id,
          parent_step_id: parent.step_id,
          node_id: node.id,
          activation_key: '',
          item_key: item.key,
          item_index: item.index,
          status,
          input_json: serializeWorkflowEachJson(item.value)!,
          output_json: null,
          error: item.valid ? null : 'Item did not match the configured schema',
          attempts: 0,
          max_attempts: Math.max(1, body.retries ?? 3),
          created_at: now,
          updated_at: now,
          started_at: null,
          completed_at: item.valid ? null : now,
        });
        this.store.insertStep(createEachChildStepRow(
          instance.instance_id,
          parent,
          body,
          childStepId,
          item.key,
          item.index,
          status,
          now,
        ));
      });
      this.store.updateStep(parent.step_id, {
        status: 'waiting',
        input: serializeWorkflowEachJson(source),
        started_at: parent.started_at ?? now,
        updated_at: now,
      });
    });
    emitPlatformCode(OBS_CODES.WORKFLOW_EACH_EXPANDED, {
      metadata: {
        instanceId: instance.instance_id,
        nodeId: node.id,
        itemCount: prepared.length,
        skippedCount: prepared.filter((item) => !item.valid).length,
        concurrency: node.concurrency,
      },
    });
  }

  private async drive(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowEachNode,
    parentStepId: string,
  ): Promise<'completed' | 'blocked' | 'failed'> {
    const body = this.requireBody(node);
    if (this.store.getInstance(instance.instance_id)?.status !== 'running') return 'blocked';
    const snapshot = this.items.snapshot(instance.instance_id, node.id, parentStepId, body);
    const items = [...snapshot.items];
    const itemPositions = new Map(items.map((item, index) => [item.item_id, index]));
    const children = new Map(snapshot.children);
    const existingFailure = items.find((item) => item.status === 'failed');
    if (existingFailure && node.onError === 'fail') {
      this.failParent(instance, parentStepId, existingFailure.error ?? 'Each item failed');
      return 'failed';
    }

    const activeCount = items.filter((item) => item.status === 'running').length;
    const batchSize = Math.max(0, node.concurrency - activeCount);
    const runnable = items.filter((item) => item.status === 'pending'
      && children.get(item.item_id)?.status === 'pending');
    for (let cursor = 0; batchSize > 0 && cursor < runnable.length; cursor += batchSize) {
      const batch = runnable.slice(cursor, cursor + batchSize);
      await Promise.all(batch.map(async (item) => {
        const child = children.get(item.item_id)!;
        if (!this.items.claim(instance.instance_id, item, child)) return;
        await this.executor.execute(
          instance.instance_id,
          child.step_id,
          graph,
          body,
          {
            value: parseWorkflowEachJson(item.input_json),
            index: item.item_index,
            key: item.item_key,
            memoryScope: {
              instanceId: instance.instance_id,
              kind: 'each-item',
              scopeId: item.item_id,
            },
          },
        );
      }));
      if (this.store.getInstance(instance.instance_id)?.status !== 'running') return 'blocked';
      let batchFailure: string | null = null;
      for (const item of batch) {
        const child = children.get(item.item_id)!;
        const reconciled = this.items.reconcileOne(
          instance.instance_id,
          item.item_id,
          child.step_id,
          body,
        );
        if (!reconciled) return 'blocked';
        items[itemPositions.get(item.item_id)!] = reconciled.item;
        children.set(item.item_id, reconciled.child);
        if (reconciled.item.status === 'failed' && node.onError === 'fail') {
          batchFailure ??= reconciled.item.error ?? 'Each item failed';
        }
      }
      if (batchFailure !== null) {
        this.failParent(instance, parentStepId, batchFailure);
        return 'failed';
      }
    }

    if (items.some((item) => item.status === 'pending' || item.status === 'running')) {
      return 'blocked';
    }
    this.completeParent(instance, node, parentStepId, items);
    return 'completed';
  }

  private prepareItem(node: WorkflowEachNode, value: unknown, index: number) {
    const keyValue = node.itemKey
      ? evaluateWorkflowExpression(node.itemKey, { item: value, itemIndex: index })
      : index;
    const key = typeof keyValue === 'string' || typeof keyValue === 'number'
      ? String(keyValue)
      : '';
    if (!key || key.length > 256) {
      throw new WorkflowError(
        'Workflow each item key is invalid',
        'WORKFLOW_ACTIVITY_INPUT_INVALID',
        422,
      );
    }
    let valid = true;
    if (node.itemSchema !== undefined) {
      try {
        valid = validateWorkflowSchemaValue(node.itemSchema, value);
      } catch {
        throw new WorkflowError(
          'Persisted workflow each item schema is invalid',
          'WORKFLOW_STATE_INVALID',
          500,
        );
      }
    }
    return { value, index, key, valid };
  }

  private requireBody(node: WorkflowEachNode) {
    try {
      return requireEachBodyActivity(node);
    } catch {
      throw new WorkflowError(
        'Persisted workflow each body is invalid',
        'WORKFLOW_STATE_INVALID',
        500,
      );
    }
  }

  private completeParent(
    instance: WorkflowInstanceRecord,
    node: WorkflowEachNode,
    parentStepId: string,
    items: readonly WorkflowEachItemRecord[],
  ): void {
    const output = items.map((item) => node.onError === 'collect' || node.onInvalid === 'skip'
      ? item.status === 'completed'
        ? { ok: true, value: parseWorkflowEachJson(item.output_json) }
        : { ok: false, skipped: item.status === 'skipped', error: item.error }
      : parseWorkflowEachJson(item.output_json));
    const now = this.now().toISOString();
    const completed = this.store.transaction(() => {
      const current = this.store.getInstance(instance.instance_id);
      const parent = this.store.getStep(parentStepId);
      if (!current || current.status !== 'running' || !parent || parent.status !== 'waiting') {
        return false;
      }
      this.store.updateStep(parentStepId, {
        status: 'completed', output: serializeWorkflowEachJson(output), error: null,
        completed_at: now, updated_at: now,
      });
      return true;
    });
    if (completed) emitPlatformCode(OBS_CODES.WORKFLOW_EACH_COMPLETED, {
      metadata: { instanceId: instance.instance_id, nodeId: node.id, itemCount: items.length },
    });
  }

  private failParent(instance: WorkflowInstanceRecord, parentStepId: string, error: string): void {
    const now = this.now().toISOString();
    const failed = this.store.transaction(() => {
      const current = this.store.getInstance(instance.instance_id);
      const parent = this.store.getStep(parentStepId);
      if (!current || current.status !== 'running' || !parent || parent.status !== 'waiting') {
        return false;
      }
      this.store.updateStep(parentStepId, {
        status: 'failed', error, completed_at: now, updated_at: now,
      });
      this.store.updateInstance(instance.instance_id, {
        status: 'failed', error, completed_at: now, updated_at: now,
      });
      this.runtime.discardInstanceQueue(instance.instance_id, now);
      return true;
    });
    if (!failed) return;
    this.executor.abortInstance(instance.instance_id, 'Workflow each item failed');
    emitPlatformCode(OBS_CODES.WORKFLOW_EACH_FAILED, {
      metadata: { instanceId: instance.instance_id, stepId: parentStepId },
    });
    emitPlatformCode(OBS_CODES.WORKFLOW_INSTANCE_FAILED, {
      metadata: { instanceId: instance.instance_id, stepId: parentStepId, reason: 'each' },
    });
  }
}
