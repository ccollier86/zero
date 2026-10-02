/** Durable transitions for choice, parallel, and join graph nodes. */

import { OBS_CODES } from '../observability/codes';
import {
  evaluateWorkflowExpression,
  type WorkflowExpressionContext,
} from './workflow-expression';
import {
  collectWorkflowNodeOutputs,
  resolveWorkflowNodeInput,
} from './workflow-graph-planner';
import type {
  WorkflowGraphDecisionRecord,
  WorkflowGraphStore,
} from './workflow-graph-store';
import type {
  WorkflowChoiceNode,
  WorkflowGraphIR,
  WorkflowJoinNode,
  WorkflowParallelNode,
} from './workflow-ir';
import type { WorkflowMemoryStore } from './workflow-memory-store';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';
import type { WorkflowInstanceRecord } from './types';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';

export type WorkflowStructuralNode =
  | WorkflowChoiceNode
  | WorkflowParallelNode
  | WorkflowJoinNode;

export class WorkflowStructuralNodeController {
  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly memory: WorkflowMemoryStore,
    private readonly now: () => Date = () => new Date(),
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  complete(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowStructuralNode,
  ): void {
    if (node.kind === 'choice') return this.completeChoice(instance, graph, node);
    if (node.kind === 'parallel') return this.completeParallel(instance, graph, node);
    return this.completeJoin(instance, graph, node);
  }

  skip(instanceId: string, nodeId: string): boolean {
    const now = this.now().toISOString();
    return this.store.transaction(() => {
      const instance = this.store.getInstance(instanceId);
      const step = this.store.getNodeStep(instanceId, nodeId);
      if (!instance || instance.status !== 'running' || !step || step.status !== 'pending') {
        return false;
      }
      this.store.updateStep(step.step_id, {
        status: 'skipped',
        error: null,
        retry_at: null,
        timeout_at: null,
        completed_at: now,
        updated_at: now,
      });
      return true;
    });
  }

  private completeChoice(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowChoiceNode,
  ): void {
    const snapshot = this.executionContext(instance, graph, node.id);
    const outgoing = graph.edges
      .filter((edge) => edge.from === node.id)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    const selected = outgoing.find((edge) => edge.condition
      && Boolean(evaluateWorkflowExpression(edge.condition, snapshot)))
      ?? outgoing.find((edge) => edge.default === true);
    if (!selected) throw new TypeError(`Workflow choice "${node.id}" has no matching branch`);
    this.persistDecision(instance, node.id, [selected.id], selected.branch ?? null, {
      selectedEdgeIds: [selected.id],
    }, snapshot.previous);
    this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_CHOICE_SELECTED, {
      metadata: {
        instanceId: instance.instance_id,
        nodeId: node.id,
        branch: selected.branch ?? null,
      },
    });
  }

  private completeParallel(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowParallelNode,
  ): void {
    const snapshot = this.executionContext(instance, graph, node.id);
    const selected = graph.edges.filter((edge) => edge.from === node.id
      && (!edge.condition || Boolean(evaluateWorkflowExpression(edge.condition, snapshot))));
    const selectedIds = selected.map((edge) => edge.id);
    this.persistDecision(instance, node.id, selectedIds, null, {
      selectedEdgeIds: selectedIds,
      selectedBranches: selected.map((edge) => edge.branch).filter(Boolean),
    }, snapshot.previous);
    this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_PARALLEL_STARTED, {
      metadata: {
        instanceId: instance.instance_id,
        nodeId: node.id,
        branchCount: selected.length,
      },
    });
  }

  private completeJoin(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    node: WorkflowJoinNode,
  ): void {
    const steps = this.store.listRootSteps(instance.instance_id);
    const input = resolveWorkflowNodeInput(
      node.id,
      graph,
      steps,
      this.store.listEdges(instance.instance_id),
      this.store.listDecisions(instance.instance_id),
      parseJson(instance.input),
    );
    const now = this.now().toISOString();
    this.store.transaction(() => {
      const current = this.store.getInstance(instance.instance_id);
      const step = this.store.getNodeStep(instance.instance_id, node.id);
      if (!current || current.status !== 'running' || !step || step.status !== 'pending') return;
      this.store.updateStep(step.step_id, {
        status: 'completed',
        input: serializeOutput(input),
        output: serializeOutput(input),
        started_at: now,
        completed_at: now,
        updated_at: now,
      });
    });
    if (graph.nodes.find((candidate) => candidate.id === node.parent)?.kind === 'parallel') {
      this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_PARALLEL_JOINED, {
        metadata: { instanceId: instance.instance_id, nodeId: node.id, parentNodeId: node.parent },
      });
    }
  }

  private executionContext(
    instance: WorkflowInstanceRecord,
    graph: WorkflowGraphIR,
    nodeId: string,
  ): WorkflowExpressionContext & { previous: unknown } {
    const steps = this.store.listRootSteps(instance.instance_id);
    const edges = this.store.listEdges(instance.instance_id);
    const decisions = this.store.listDecisions(instance.instance_id);
    return {
      input: parseJson(instance.input),
      previous: resolveWorkflowNodeInput(
        nodeId,
        graph,
        steps,
        edges,
        decisions,
        parseJson(instance.input),
      ),
      outputs: collectWorkflowNodeOutputs(steps),
      memory: Object.fromEntries(this.memory.list({
        instanceId: instance.instance_id,
        kind: 'instance',
      }).map((entry) => [entry.key, entry.value])),
    };
  }

  private persistDecision(
    instance: WorkflowInstanceRecord,
    nodeId: string,
    selectedEdgeIds: readonly string[],
    selectedBranch: string | null,
    decision: unknown,
    input: unknown,
  ): void {
    const now = this.now().toISOString();
    this.store.transaction(() => {
      const current = this.store.getInstance(instance.instance_id);
      const step = this.store.getNodeStep(instance.instance_id, nodeId);
      if (!current || current.status !== 'running' || !step || step.status !== 'pending') return;
      const existing = this.store.getDecision(instance.instance_id, nodeId);
      if (!existing) {
        const row: WorkflowGraphDecisionRecord = {
          decision_id: `wdecision_${crypto.randomUUID()}`,
          instance_id: instance.instance_id,
          node_id: nodeId,
          activation_key: '',
          selected_edge_id: selectedEdgeIds.length === 1
            ? `${instance.instance_id}:${selectedEdgeIds[0]}`
            : null,
          selected_branch: selectedBranch,
          decision_json: JSON.stringify(decision),
          created_at: now,
        };
        this.store.insertDecision(row);
      }
      this.store.updateStep(step.step_id, {
        status: 'completed',
        input: serializeOutput(input),
        output: serializeOutput(decision),
        started_at: now,
        completed_at: now,
        updated_at: now,
      });
    });
  }
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError('Workflow persisted JSON must be text');
  return JSON.parse(value);
}

function serializeOutput(value: unknown): string | null {
  return serializeWorkflowRuntimeJson(value, {
    code: 'WORKFLOW_OUTPUT_INVALID', label: 'Workflow output',
    invalidStatus: 500, limitStatus: 500,
  });
}
