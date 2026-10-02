/**
 * Pure readiness planning for persisted workflow DAGs.
 *
 * The database remains authoritative for node status and branch decisions.
 * This module only derives edge activation, ready nodes, and unreachable nodes
 * from one coherent snapshot; it performs no I/O.
 */

import type { WorkflowGraphIR, WorkflowIREdge, WorkflowIRNode } from './workflow-ir';
import type {
  WorkflowGraphDecisionRecord,
  WorkflowGraphEdgeRecord,
} from './workflow-graph-store';
import type { WorkflowStepRecord } from './types';

export type WorkflowEdgeState = 'pending' | 'active' | 'inactive';

export interface WorkflowGraphPlan {
  ready: readonly WorkflowIRNode[];
  unreachable: readonly WorkflowIRNode[];
  blocked: readonly WorkflowIRNode[];
}

export interface WorkflowGraphSnapshot {
  graph: WorkflowGraphIR;
  steps: readonly WorkflowStepRecord[];
  edges: readonly WorkflowGraphEdgeRecord[];
  decisions: readonly WorkflowGraphDecisionRecord[];
}

const SETTLED = new Set(['completed', 'skipped']);

/** Derive the next legal node set. Results follow canonical graph order. */
export function planWorkflowGraph(snapshot: WorkflowGraphSnapshot): WorkflowGraphPlan {
  const rootSteps = new Map(snapshot.steps
    .filter((step) => step.parent_step_id == null && typeof step.node_id === 'string')
    .map((step) => [step.node_id!, step]));
  const incoming = groupEdges(snapshot.edges, 'to');
  const decisions = new Map(snapshot.decisions.map((decision) => [
    decision.node_id,
    selectedEdgeIds(decision, snapshot.edges),
  ]));
  const ready: WorkflowIRNode[] = [];
  const unreachable: WorkflowIRNode[] = [];
  const blocked: WorkflowIRNode[] = [];

  for (const node of snapshot.graph.nodes) {
    const step = rootSteps.get(node.id);
    if (!step || step.status !== 'pending') continue;
    const nodeIncoming = incoming.get(node.id) ?? [];
    if (node.id === snapshot.graph.entry && nodeIncoming.length === 0) {
      ready.push(node);
      continue;
    }
    const states = nodeIncoming.map((edge) => edgeState(
      edge,
      rootSteps,
      decisions,
    ));
    if (states.some((state) => state === 'pending')) {
      blocked.push(node);
    } else if (states.some((state) => state === 'active')) {
      ready.push(node);
    } else {
      unreachable.push(node);
    }
  }
  return { ready, unreachable, blocked };
}

/** Resolve the deterministic input for one ready node. */
export function resolveWorkflowNodeInput(
  nodeId: string,
  graph: WorkflowGraphIR,
  steps: readonly WorkflowStepRecord[],
  edges: readonly WorkflowGraphEdgeRecord[],
  decisions: readonly WorkflowGraphDecisionRecord[],
  workflowInput: unknown,
): unknown {
  if (nodeId === graph.entry) return workflowInput;
  const rootSteps = new Map(steps
    .filter((step) => step.parent_step_id == null && typeof step.node_id === 'string')
    .map((step) => [step.node_id!, step]));
  const decisionMap = new Map(decisions.map((decision) => [
    decision.node_id,
    selectedEdgeIds(decision, edges),
  ]));
  const active = edges.filter((edge) => edge.to_node_id === nodeId
    && edgeState(edge, rootSteps, decisionMap) === 'active');
  if (active.length === 0) return workflowInput;
  if (active.length === 1) return parseOutput(rootSteps.get(active[0]!.from_node_id!));

  const result: Record<string, unknown> = Object.create(null);
  for (const edge of active) {
    const source = edge.from_node_id ? rootSteps.get(edge.from_node_id) : undefined;
    const key = edge.branch_key || source?.branch_key || edge.from_node_id || edge.edge_id;
    result[key] = parseOutput(rootSteps.get(edge.from_node_id!));
  }
  return result;
}

/** Build the named output map used by serializable selectors. */
export function collectWorkflowNodeOutputs(
  steps: readonly WorkflowStepRecord[],
): Readonly<Record<string, unknown>> {
  const outputs: Record<string, unknown> = Object.create(null);
  for (const step of steps) {
    if (step.parent_step_id != null || typeof step.node_id !== 'string') continue;
    if (!SETTLED.has(step.status)) continue;
    outputs[step.node_id] = parseOutput(step);
  }
  return outputs;
}

export function graphNodeById(graph: WorkflowGraphIR, nodeId: string): WorkflowIRNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new TypeError(`Workflow graph node "${nodeId}" is missing`);
  return node;
}

export function outgoingGraphEdges(
  graph: WorkflowGraphIR,
  nodeId: string,
): readonly WorkflowIREdge[] {
  return graph.edges.filter((edge) => edge.from === nodeId);
}

function edgeState(
  edge: WorkflowGraphEdgeRecord,
  steps: ReadonlyMap<string, WorkflowStepRecord>,
  decisions: ReadonlyMap<string, ReadonlySet<string>>,
): WorkflowEdgeState {
  if (!edge.from_node_id) return 'active';
  const source = steps.get(edge.from_node_id);
  if (!source || !SETTLED.has(source.status)) return 'pending';
  if (source.status === 'skipped') return 'inactive';
  if (source.node_kind === 'choice' || source.node_kind === 'parallel') {
    const selected = decisions.get(edge.from_node_id);
    if (!selected) return 'pending';
    return selected.has(stripInstancePrefix(edge.edge_id)) ? 'active' : 'inactive';
  }
  return 'active';
}

function selectedEdgeIds(
  decision: WorkflowGraphDecisionRecord,
  edges: readonly WorkflowGraphEdgeRecord[],
): ReadonlySet<string> {
  const selected = new Set<string>();
  if (decision.selected_edge_id) selected.add(stripInstancePrefix(decision.selected_edge_id));
  if (decision.decision_json) {
    try {
      const value = JSON.parse(decision.decision_json) as { selectedEdgeIds?: unknown };
      if (Array.isArray(value.selectedEdgeIds)) {
        for (const edgeId of value.selectedEdgeIds) {
          if (typeof edgeId === 'string') selected.add(stripInstancePrefix(edgeId));
        }
      }
    } catch {
      // Persisted-state validation reports malformed decisions. Treating the
      // edge as unsettled here prevents accidental execution before that fail.
    }
  }
  // Historical records may persist only a branch key.
  if (selected.size === 0 && decision.selected_branch) {
    for (const edge of edges) {
      if (edge.instance_id === decision.instance_id
        && edge.from_node_id === decision.node_id
        && edge.branch_key === decision.selected_branch) {
        selected.add(stripInstancePrefix(edge.edge_id));
      }
    }
  }
  return selected;
}

function stripInstancePrefix(edgeId: string): string {
  const separator = edgeId.indexOf(':');
  return separator < 0 ? edgeId : edgeId.slice(separator + 1);
}

function parseOutput(step: WorkflowStepRecord | undefined): unknown {
  if (!step || step.output === null) return null;
  if (typeof step.output !== 'string') throw new TypeError('Workflow node output is not JSON text');
  return JSON.parse(step.output);
}

function groupEdges(
  edges: readonly WorkflowGraphEdgeRecord[],
  direction: 'to',
): Map<string, WorkflowGraphEdgeRecord[]> {
  const groups = new Map<string, WorkflowGraphEdgeRecord[]>();
  for (const edge of edges) {
    const key = direction === 'to' ? edge.to_node_id : edge.from_node_id;
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }
  return groups;
}
