/** Regression coverage for bounded fan-out database work. */

import { describe, expect, test } from 'bun:test';
import { WorkflowEachController } from './workflow-each-controller';
import type {
  WorkflowEachItemRecord,
  WorkflowGraphStore,
} from './workflow-graph-store';
import type { WorkflowGraphActivityExecutor } from './workflow-graph-activity-executor';
import type { WorkflowEachNode, WorkflowGraphIR } from './workflow-ir';
import type { WorkflowMemoryStore } from './workflow-memory-store';
import type { WorkflowRuntimeStore } from './workflow-runtime-store';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';

const ITEM_COUNT = 10_000;
const NOW = '2030-01-01T00:00:00.000Z';

describe('workflow each execution database work', () => {
  test('scans a maximum fan-out once when concurrency is one', async () => {
    const fixture = largeFanoutFixture(ITEM_COUNT);
    const controller = new WorkflowEachController(
      fixture.store as unknown as WorkflowGraphStore,
      fixture.executor as unknown as WorkflowGraphActivityExecutor,
      {} as WorkflowMemoryStore,
      { discardInstanceQueue: () => undefined } as unknown as WorkflowRuntimeStore,
      () => new Date(NOW),
    );

    const result = await (controller as unknown as {
      drive(
        instance: WorkflowInstanceRecord,
        graph: WorkflowGraphIR,
        node: WorkflowEachNode,
        parentStepId: string,
      ): Promise<'completed' | 'blocked' | 'failed'>;
    }).drive(fixture.instance, fixture.graph, fixture.node, fixture.parent.step_id);

    expect(result).toBe('completed');
    expect(fixture.queries.listEachItems).toBe(1);
    expect(fixture.queries.listSteps).toBe(1);
    expect(fixture.executions()).toBe(ITEM_COUNT);
    expect(fixture.parent.status).toBe('completed');
  });

  test('classifies dynamic source and item-key failures as invalid activity input', async () => {
    const source = controllerFixture({
      source: { type: 'literal', value: 'not-an-array' },
    });
    await expect(source.controller.advance(source.instance, source.graph, source.node))
      .rejects.toMatchObject({ code: 'WORKFLOW_ACTIVITY_INPUT_INVALID', status: 422 });

    const duplicate = controllerFixture({
      source: { type: 'literal', value: [{ id: 1 }, { id: 2 }] },
      itemKey: { type: 'literal', value: 'same-key' },
    });
    await expect(duplicate.controller.advance(
      duplicate.instance,
      duplicate.graph,
      duplicate.node,
    )).rejects.toMatchObject({ code: 'WORKFLOW_ACTIVITY_INPUT_INVALID', status: 422 });

    const invalidKey = controllerFixture({
      source: { type: 'literal', value: [{ id: 1 }] },
      itemKey: { type: 'literal', value: '' },
    });
    await expect(invalidKey.controller.advance(
      invalidKey.instance,
      invalidKey.graph,
      invalidKey.node,
    )).rejects.toMatchObject({ code: 'WORKFLOW_ACTIVITY_INPUT_INVALID', status: 422 });
  });

  test('separates invalid runtime items from corrupt persisted each definitions', async () => {
    const invalidItem = controllerFixture({
      source: { type: 'literal', value: ['wrong-type'] },
      itemSchema: { type: 'number' },
      onInvalid: 'fail',
    });
    await expect(invalidItem.controller.advance(
      invalidItem.instance,
      invalidItem.graph,
      invalidItem.node,
    )).rejects.toMatchObject({ code: 'WORKFLOW_ACTIVITY_INPUT_INVALID', status: 422 });

    const corruptSchema = controllerFixture({
      source: { type: 'literal', value: [1] },
      itemSchema: 'not-a-schema' as never,
    });
    await expect(corruptSchema.controller.advance(
      corruptSchema.instance,
      corruptSchema.graph,
      corruptSchema.node,
    )).rejects.toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 500 });

    const corruptBody = controllerFixture({
      source: { type: 'literal', value: [] },
      body: { schemaVersion: 1, entry: 'missing', nodes: [], edges: [] },
    });
    await expect(corruptBody.controller.advance(
      corruptBody.instance,
      corruptBody.graph,
      corruptBody.node,
    )).rejects.toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 500 });
  });
});

function controllerFixture(overrides: Partial<WorkflowEachNode>) {
  const instance: WorkflowInstanceRecord = {
    instance_id: 'fixture-instance', definition_id: 'fixture-definition',
    name: 'fixture', status: 'running', current_step: 0, input: '{}',
    output: null, error: null, started_by: 'owner', steps_json: null,
    created_at: NOW, updated_at: NOW, completed_at: null,
  };
  const parent = stepRecord({
    step_id: 'fixture-parent', instance_id: instance.instance_id,
    node_id: 'fanout', node_kind: 'each', node_path: 'fanout', status: 'pending',
  });
  const body = {
    id: 'work', kind: 'activity' as const, activity: { name: 'noop' }, retries: 1,
  };
  const node: WorkflowEachNode = {
    id: 'fanout', kind: 'each', source: { type: 'literal', value: [] },
    concurrency: 1, onInvalid: 'fail', onError: 'fail',
    body: { schemaVersion: 1, entry: body.id, nodes: [body], edges: [] },
    ...overrides,
  };
  const graph: WorkflowGraphIR = {
    schemaVersion: 1, entry: node.id, nodes: [node], edges: [],
  };
  const store = {
    getNodeStep: () => parent,
    listRootSteps: () => [parent],
    listEdges: () => [],
    listDecisions: () => [],
    transaction: <T>(operation: () => T) => operation(),
  };
  const controller = new WorkflowEachController(
    store as unknown as WorkflowGraphStore,
    {} as WorkflowGraphActivityExecutor,
    { list: () => [] } as unknown as WorkflowMemoryStore,
    { discardInstanceQueue: () => undefined } as unknown as WorkflowRuntimeStore,
    () => new Date(NOW),
  );
  return { controller, instance, node, graph };
}

function largeFanoutFixture(itemCount: number) {
  const instance: WorkflowInstanceRecord = {
    instance_id: 'instance', definition_id: 'definition', name: 'fanout', status: 'running',
    current_step: 0, input: '{}', output: null, error: null, started_by: 'owner',
    steps_json: null, created_at: NOW, updated_at: NOW, completed_at: null,
  };
  const parent = stepRecord({
    step_id: 'parent', node_id: 'fanout', node_kind: 'each', node_path: 'fanout',
    status: 'waiting', started_at: NOW,
  });
  const body = {
    id: 'work', kind: 'activity' as const, activity: { name: 'noop' }, retries: 1,
  };
  const node: WorkflowEachNode = {
    id: 'fanout', kind: 'each', source: { type: 'literal', value: [] },
    concurrency: 1, onInvalid: 'fail', onError: 'fail',
    body: { schemaVersion: 1, entry: body.id, nodes: [body], edges: [] },
  };
  const graph: WorkflowGraphIR = {
    schemaVersion: 1, entry: node.id, nodes: [node], edges: [],
  };
  const items: WorkflowEachItemRecord[] = [];
  const children: WorkflowStepRecord[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const key = String(index);
    items.push({
      item_id: `item-${key}`, instance_id: instance.instance_id,
      parent_step_id: parent.step_id, node_id: node.id, activation_key: '',
      item_key: key, item_index: index, status: 'pending', input_json: 'null',
      output_json: null, error: null, attempts: 0, max_attempts: 1,
      created_at: NOW, updated_at: NOW, started_at: null, completed_at: null,
    });
    children.push(stepRecord({
      step_id: `child-${key}`, step_index: index, node_id: body.id,
      node_kind: 'activity', node_path: `${node.id}/${body.id}`,
      parent_step_id: parent.step_id, activation_key: key, item_key: key,
      item_index: index,
    }));
  }
  const itemById = new Map(items.map((item) => [item.item_id, item]));
  const stepById = new Map([parent, ...children].map((step) => [step.step_id, step]));
  const queries = { listEachItems: 0, listSteps: 0 };
  let executionCount = 0;
  const store = {
    transaction: <T>(operation: () => T) => operation(),
    getInstance: () => instance,
    listEachItems: () => {
      queries.listEachItems += 1;
      return items;
    },
    listSteps: () => {
      queries.listSteps += 1;
      return [parent, ...children];
    },
    getEachItem: (itemId: string) => itemById.get(itemId) ?? null,
    getStep: (stepId: string) => stepById.get(stepId) ?? null,
    updateEachItem: (itemId: string, changes: Record<string, unknown>) => {
      Object.assign(itemById.get(itemId)!, changes);
    },
    updateStep: (stepId: string, changes: Record<string, unknown>) => {
      Object.assign(stepById.get(stepId)!, changes);
    },
  };
  const executor = {
    execute: async (_instanceId: string, stepId: string) => {
      executionCount += 1;
      Object.assign(stepById.get(stepId)!, {
        status: 'completed', output: 'null', started_at: NOW,
        completed_at: NOW, updated_at: NOW,
      });
      return 'completed';
    },
  };
  return {
    instance, parent, node, graph, store, executor, queries,
    executions: () => executionCount,
  };
}

function stepRecord(overrides: Partial<WorkflowStepRecord>): WorkflowStepRecord {
  return {
    step_id: 'step', instance_id: 'instance', step_index: 0, step_name: 'step',
    status: 'pending', input: null, output: null, error: null, retries: 0,
    max_retries: 1, retry_at: null, wait_event: null, timeout_at: null,
    started_at: null, completed_at: null, created_at: NOW, node_id: null,
    node_kind: null, node_path: null, parent_step_id: null, branch_key: null,
    item_key: null, item_index: null, activation_key: '', updated_at: NOW,
    ...overrides,
  };
}
