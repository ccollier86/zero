/** Public, payload-free topology for authorized live workflow visualization. */

import { deriveWorkflowGraphNodeMetadata } from './workflow-graph-node-metadata';
import type { WorkflowGraphIR, WorkflowIREdge, WorkflowIRNode } from './workflow-ir';
import { publicLegacyWorkflowStepLabel } from './workflow-public-record';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';

export interface WorkflowPublicTopologyNode {
  /** Definition-stable node id. Nested each nodes may reuse ids under another path. */
  id: string;
  /** Run-stable path matching the public workflow_steps.node_path projection. */
  path: string;
  kind: string;
  label: string;
  /** Enclosing each-node path, or null for a root graph node. */
  parentPath: string | null;
  /** Innermost public branch label, when the node belongs to a named lane. */
  branchKey: string | null;
}

export interface WorkflowPublicTopologyEdge {
  /** Stable presentation identity; never exposes the private definition edge id. */
  id: string;
  from: string;
  to: string;
  branch: string | null;
  order: number | null;
  default: boolean;
}

export interface WorkflowPublicTopology {
  instanceId: string;
  name: string;
  format: 'graph' | 'legacy';
  schemaVersion: number | null;
  definitionVersion: number | null;
  graphFingerprint: string | null;
  entry: string | null;
  nodes: WorkflowPublicTopologyNode[];
  edges: WorkflowPublicTopologyEdge[];
}

/** Project one already integrity-checked immutable graph without executable details. */
export function toPublicWorkflowGraphTopology(
  instance: WorkflowInstanceRecord,
  graph: WorkflowGraphIR,
): WorkflowPublicTopology {
  const nodes: WorkflowPublicTopologyNode[] = [];
  const edges: WorkflowPublicTopologyEdge[] = [];
  appendGraphTopology(graph, '', null, nodes, edges);
  return {
    instanceId: instance.instance_id,
    name: instance.name,
    format: 'graph',
    schemaVersion: graph.schemaVersion,
    definitionVersion: instance.definition_version ?? null,
    graphFingerprint: instance.graph_fingerprint ?? null,
    entry: graph.entry,
    nodes,
    edges,
  };
}

/** Project a legacy run from public step identity only, never from steps_json. */
export function toPublicWorkflowLegacyTopology(
  instance: WorkflowInstanceRecord,
  steps: readonly WorkflowStepRecord[],
): WorkflowPublicTopology {
  const ordered = [...steps]
    .filter((step) => step.parent_step_id == null)
    .sort((left, right) => left.step_index - right.step_index);
  const nodes = ordered.map((step): WorkflowPublicTopologyNode => ({
    id: step.step_id,
    path: step.step_id,
    kind: 'activity',
    label: publicLegacyWorkflowStepLabel(
      step as unknown as Record<string, unknown>,
      instance.steps_json,
    ),
    parentPath: null,
    branchKey: null,
  }));
  const edges = ordered.slice(1).map((step, index): WorkflowPublicTopologyEdge => ({
    id: `edge.${index}`,
    from: ordered[index]!.step_id,
    to: step.step_id,
    branch: null,
    order: null,
    default: false,
  }));
  return {
    instanceId: instance.instance_id,
    name: instance.name,
    format: 'legacy',
    schemaVersion: null,
    definitionVersion: null,
    graphFingerprint: null,
    entry: nodes[0]?.path ?? null,
    nodes,
    edges,
  };
}

function appendGraphTopology(
  graph: WorkflowGraphIR,
  prefix: string,
  parentPath: string | null,
  nodes: WorkflowPublicTopologyNode[],
  edges: WorkflowPublicTopologyEdge[],
): void {
  const metadata = deriveWorkflowGraphNodeMetadata(graph);
  graph.nodes.forEach((node) => {
    const path = topologyPath(prefix, node.id);
    nodes.push({
      id: node.id,
      path,
      kind: node.kind,
      label: publicNodeLabel(node),
      parentPath,
      branchKey: metadata.get(node.id)?.branchKey ?? null,
    });
    if (node.kind === 'each') {
      appendGraphTopology(node.body, path, path, nodes, edges);
    }
  });
  graph.edges.forEach((edge, index) => {
    edges.push(publicEdge(edge, index, prefix));
  });
}

function publicEdge(
  edge: WorkflowIREdge,
  index: number,
  prefix: string,
): WorkflowPublicTopologyEdge {
  return {
    id: topologyPath(prefix, `edge.${index}`),
    from: topologyPath(prefix, edge.from),
    to: topologyPath(prefix, edge.to),
    branch: edge.branch ?? null,
    order: edge.order ?? null,
    default: edge.default === true,
  };
}

function publicNodeLabel(node: WorkflowIRNode): string {
  return node.label?.trim() || node.id;
}

function topologyPath(prefix: string, id: string): string {
  return prefix ? `${prefix}/${id}` : id;
}
