/** Fail-closed validation for durable graph coordination rows. */

import { canonicalWorkflowJson } from './workflow-definition-canonical';
import { deriveWorkflowGraphNodeMetadata } from './workflow-graph-node-metadata';
import { parsePersistedWorkflowJson } from './workflow-persisted-state-values';
import type {
  WorkflowEachItemRecord,
  WorkflowGraphDecisionRecord,
  WorkflowGraphEdgeRecord,
  WorkflowPersistedInteractionRecord,
  WorkflowPersistedInteractionResponseRecord,
} from './workflow-graph-store';
import { validateWorkflowEachPersistedState } from './workflow-each-persisted-state';
import { validateWorkflowInteractionPersistedState } from './workflow-interaction-persisted-state';
import type { WorkflowGraphIR } from './workflow-ir';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';

const GRAPH_INSTANCE_STATUSES = new Set(['running', 'paused']);
const STEP_STATUSES = new Set([
  'pending', 'running', 'completed', 'failed', 'waiting', 'skipped',
]);

export interface WorkflowGraphPersistedSnapshot {
  instance: WorkflowInstanceRecord;
  graph: WorkflowGraphIR;
  steps: readonly WorkflowStepRecord[];
  edges: readonly WorkflowGraphEdgeRecord[];
  decisions: readonly WorkflowGraphDecisionRecord[];
  eachItems: readonly WorkflowEachItemRecord[];
  interactions: readonly WorkflowPersistedInteractionRecord[];
  interactionResponses: readonly WorkflowPersistedInteractionResponseRecord[];
}

/** Validate the runtime rows that can change graph reachability or execution. */
export function validateWorkflowGraphPersistedState(
  snapshot: WorkflowGraphPersistedSnapshot,
): void {
  validateInstance(snapshot.instance, snapshot.graph);
  const roots = snapshot.steps.filter((step) => step.parent_step_id == null);
  if (roots.length !== snapshot.graph.nodes.length) invalid('root node count does not match graph');
  const rootByNode = new Map<string, WorkflowStepRecord>();
  const rootsByNode = new Map<string, WorkflowStepRecord[]>();
  for (const root of roots) {
    if (typeof root.node_id !== 'string') invalid('root step has no node identity');
    const matches = rootsByNode.get(root.node_id) ?? [];
    matches.push(root);
    rootsByNode.set(root.node_id, matches);
  }
  const nodeById = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
  const outgoingByNode = indexOutgoingEdges(snapshot.graph);
  const metadata = deriveWorkflowGraphNodeMetadata(snapshot.graph);
  snapshot.graph.nodes.forEach((node, index) => {
    const matches = rootsByNode.get(node.id) ?? [];
    if (matches.length !== 1) invalid(`node "${node.id}" does not have exactly one root step`);
    const step = matches[0]!;
    validateStep(step, snapshot.instance, true);
    const expectedRetries = node.kind === 'activity'
      ? Math.max(1, node.retries ?? 3)
      : 1;
    const expectedWaitEvent = node.kind === 'wait'
      ? node.event
      : node.kind === 'activity' ? node.legacyWaitFor ?? null : null;
    if (step.node_kind !== node.kind || step.step_index !== index
      || step.node_path !== node.id
      || step.branch_key !== (metadata.get(node.id)?.branchKey ?? null)
      || step.step_name !== (node.label ?? node.id)
      || step.max_retries !== expectedRetries
      || step.wait_event !== expectedWaitEvent) {
      invalid(`node "${node.id}" step metadata does not match graph`);
    }
    if (step.status === 'waiting' && node.kind !== 'wait' && node.kind !== 'each') {
      invalid(`node "${node.id}" cannot be waiting`);
    }
    if (snapshot.instance.status === 'running'
      && step.status === 'failed' && step.retry_at === null) {
      invalid(`node "${node.id}" has a terminal failure on a running instance`);
    }
    rootByNode.set(node.id, step);
  });

  validateEdges(snapshot.graph, snapshot.instance.instance_id, snapshot.edges);
  validateDecisions(
    snapshot.graph,
    snapshot.instance.instance_id,
    snapshot.decisions,
    rootByNode,
    nodeById,
    outgoingByNode,
  );
  validateChildren(
    snapshot.steps,
    rootByNode,
    snapshot.instance,
    nodeById,
  );
  validateWorkflowEachPersistedState({
    instance: snapshot.instance,
    graph: snapshot.graph,
    steps: snapshot.steps,
    items: snapshot.eachItems,
  });
  validateWorkflowInteractionPersistedState({
    instance: snapshot.instance,
    graph: snapshot.graph,
    steps: snapshot.steps,
    interactions: snapshot.interactions,
    responses: snapshot.interactionResponses,
  });
}

function validateInstance(instance: WorkflowInstanceRecord, graph: WorkflowGraphIR): void {
  if (!GRAPH_INSTANCE_STATUSES.has(String(instance.status))) {
    invalid(`instance status "${String(instance.status)}" is invalid for active graph execution`);
  }
  if (!Number.isInteger(instance.current_step)
    || instance.current_step < 0 || instance.current_step > graph.nodes.length) {
    invalid('instance current step is outside the graph');
  }
  assertJsonText(instance.input, 'instance input');
  if (instance.output !== null || instance.error !== null || instance.completed_at !== null) {
    invalid('active instance contains terminal fields');
  }
  assertTimestamp(instance.created_at, 'instance created_at', false);
  assertTimestamp(instance.updated_at, 'instance updated_at', false);
}

function validateStep(
  step: WorkflowStepRecord,
  instance: WorkflowInstanceRecord,
  root: boolean,
): void {
  if (step.instance_id !== instance.instance_id
    || (step.tenant_id ?? null) !== (instance.tenant_id ?? null)) {
    invalid('step belongs to another instance or tenant');
  }
  if (!STEP_STATUSES.has(String(step.status))) invalid(`step status "${step.status}" is invalid`);
  if (!Number.isInteger(step.retries) || step.retries < 0
    || !Number.isInteger(step.max_retries) || step.max_retries < 1
    || step.retries > step.max_retries) invalid('step retry counters are invalid');
  assertJsonText(step.input, 'step input');
  assertJsonText(step.output, 'step output');
  assertTimestamp(step.created_at, 'step created_at', false);
  assertTimestamp(step.updated_at, 'step updated_at', false);
  assertTimestamp(step.started_at, 'step started_at');
  assertTimestamp(step.completed_at, 'step completed_at');
  assertTimestamp(step.retry_at, 'step retry_at');
  assertTimestamp(step.timeout_at, 'step timeout_at');
  if (instance.status === 'paused' && step.status === 'running') {
    invalid('paused instance contains a running step');
  }
  if (step.status !== 'completed' && step.output !== null) invalid('unfinished step has output');
  if (step.status === 'running' && (step.started_at === null || step.completed_at !== null)) {
    invalid('running step lifecycle is invalid');
  }
  if (step.status === 'waiting' && (step.started_at === null || step.completed_at !== null)) {
    invalid('waiting step lifecycle is invalid');
  }
  if ((step.status === 'completed' || step.status === 'skipped')
    && (step.completed_at === null || step.retry_at !== null || step.timeout_at !== null)) {
    invalid('terminal step lifecycle is invalid');
  }
  if (step.retry_at !== null && (step.status !== 'failed'
    || step.retries < 1 || step.retries >= step.max_retries)) {
    invalid('step retry deadline is invalid');
  }
  if (step.status === 'failed' && !step.error) invalid('failed step has no error');
  if (root && (step.parent_step_id !== null || step.activation_key !== '')) {
    invalid('root step identity is invalid');
  }
}

function validateEdges(
  graph: WorkflowGraphIR,
  instanceId: string,
  rows: readonly WorkflowGraphEdgeRecord[],
): void {
  if (rows.length !== graph.edges.length) invalid('persisted edge count does not match graph');
  const rowById = new Map(rows.map((row) => [row.edge_id, row]));
  if (rowById.size !== rows.length) invalid('persisted edges contain duplicate identities');
  graph.edges.forEach((edge, ordinal) => {
    const id = `${instanceId}:${edge.id}`;
    const row = rowById.get(id);
    if (!row
      || row.instance_id !== instanceId
      || row.from_node_id !== edge.from
      || row.to_node_id !== edge.to
      || row.branch_key !== (edge.branch ?? null)
      || row.ordinal !== ordinal
      || row.edge_kind !== (edge.default ? 'default' : edge.condition ? 'conditional' : 'normal')) {
      invalid(`persisted edge "${edge.id}" does not match graph`);
    }
    const expectedCondition = edge.condition === undefined
      ? null : canonicalWorkflowJson(edge.condition);
    const actualCondition = row.condition_json === null
      ? null : canonicalStoredJson(row.condition_json, `edge "${edge.id}" condition`);
    if (actualCondition !== expectedCondition) {
      invalid(`persisted edge "${edge.id}" condition does not match graph`);
    }
  });
}

function validateDecisions(
  graph: WorkflowGraphIR,
  instanceId: string,
  decisions: readonly WorkflowGraphDecisionRecord[],
  steps: ReadonlyMap<string, WorkflowStepRecord>,
  nodes: ReadonlyMap<string, WorkflowGraphIR['nodes'][number]>,
  outgoingByNode: ReadonlyMap<string, readonly WorkflowGraphIR['edges'][number][]>,
): void {
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (decision.instance_id !== instanceId || decision.activation_key !== '') {
      invalid('workflow decision identity is invalid');
    }
    if (seen.has(decision.node_id)) invalid(`node "${decision.node_id}" has duplicate decisions`);
    seen.add(decision.node_id);
    const node = nodes.get(decision.node_id);
    if (!node || (node.kind !== 'choice' && node.kind !== 'parallel')) {
      invalid(`decision references invalid control node "${decision.node_id}"`);
    }
    const selected = parseSelectedEdges(decision);
    const outgoing = outgoingByNode.get(node.id) ?? [];
    if (selected.some((id) => !outgoing.some((edge) => edge.id === id))) {
      invalid(`decision for "${node.id}" selects an unrelated edge`);
    }
    if (node.kind === 'choice' && selected.length !== 1) {
      invalid(`choice "${node.id}" must select exactly one edge`);
    }
    if (node.kind === 'parallel' && decision.selected_branch !== null) {
      invalid(`parallel "${node.id}" has an invalid selected branch`);
    }
    if (node.kind === 'parallel'
      && (selected.length !== outgoing.length
        || outgoing.some((edge) => !selected.includes(edge.id)))) {
      invalid(`parallel "${node.id}" must select every branch`);
    }
    if (node.kind === 'choice'
      && decision.selected_branch !== (outgoing.find((edge) => edge.id === selected[0])?.branch ?? null)) {
      invalid(`choice "${node.id}" branch does not match its selected edge`);
    }
    const expectedPointer = selected.length === 1 ? `${instanceId}:${selected[0]}` : null;
    if (decision.selected_edge_id !== expectedPointer) {
      invalid(`decision edge pointer for "${node.id}" is invalid`);
    }
    const step = steps.get(node.id);
    if (step?.status === 'completed') {
      if (step.output === null
        || canonicalStoredJson(step.output, `node "${node.id}" output`)
          !== canonicalStoredJson(decision.decision_json!, `decision for "${node.id}"`)) {
        invalid(`decision for "${node.id}" does not match its durable node output`);
      }
    }
  }
  for (const node of graph.nodes) {
    if ((node.kind === 'choice' || node.kind === 'parallel')
      && steps.get(node.id)?.status === 'completed' && !seen.has(node.id)) {
      invalid(`completed control node "${node.id}" is missing its decision`);
    }
  }
}

function validateChildren(
  steps: readonly WorkflowStepRecord[],
  roots: ReadonlyMap<string, WorkflowStepRecord>,
  instance: WorkflowInstanceRecord,
  nodes: ReadonlyMap<string, WorkflowGraphIR['nodes'][number]>,
): void {
  const rootByStep = new Map([...roots.values()].map((step) => [step.step_id, step]));
  const children = new Set<string>();
  for (const step of steps) {
    if (step.parent_step_id == null) continue;
    const parent = rootByStep.get(step.parent_step_id);
    if (!parent) invalid('workflow child step has an invalid parent');
    if (!step.activation_key) invalid('workflow child step has no activation key');
    const identity = `${step.parent_step_id}\0${step.activation_key}`;
    if (children.has(identity)) invalid('workflow child steps contain a duplicate activation');
    children.add(identity);
    if (parent.node_kind !== 'each' && parent.node_kind !== 'wait') {
      invalid('workflow child step belongs to an unsupported parent');
    }
    if (step.node_kind !== 'activity') invalid('workflow child step is not an activity');
    validateStep(step, instance, false);
    const parentNode = parent.node_id ? nodes.get(parent.node_id) : undefined;
    if (!parentNode || parentNode.kind !== parent.node_kind) {
      invalid('workflow child parent does not match the pinned graph');
    }
    if (parentNode.kind === 'each') validateEachChild(step, parent, parentNode);
    if (parentNode.kind === 'wait') validateDeliveryChild(step, parent, parentNode);
  }
}

function indexOutgoingEdges(
  graph: WorkflowGraphIR,
): Map<string, WorkflowGraphIR['edges'][number][]> {
  const result = new Map<string, WorkflowGraphIR['edges'][number][]>();
  for (const edge of graph.edges) {
    if (edge.from === null) continue;
    const outgoing = result.get(edge.from) ?? [];
    outgoing.push(edge);
    result.set(edge.from, outgoing);
  }
  return result;
}

function validateEachChild(
  step: WorkflowStepRecord,
  parent: WorkflowStepRecord,
  node: Extract<WorkflowGraphIR['nodes'][number], { kind: 'each' }>,
): void {
  const body = node.body.nodes[0];
  if (node.body.nodes.length !== 1 || node.body.edges.length !== 0 || body?.kind !== 'activity') {
    invalid(`each node "${node.id}" has an invalid pinned body`);
  }
  if (!step.item_key || !Number.isInteger(step.item_index) || Number(step.item_index) < 0
    || step.activation_key !== step.item_key
    || step.node_id !== body.id
    || step.node_path !== `${parent.node_path}/${body.id}`
    || step.step_index !== parent.step_index
    || step.step_name !== (body.label ?? body.id)
    || step.branch_key !== null
    || step.wait_event !== null
    || step.max_retries !== Math.max(1, body.retries ?? 3)) {
    invalid(`each node "${node.id}" has an invalid child step`);
  }
}

function validateDeliveryChild(
  step: WorkflowStepRecord,
  parent: WorkflowStepRecord,
  node: Extract<WorkflowGraphIR['nodes'][number], { kind: 'wait' }>,
): void {
  const match = /^delivery:(\d+)$/u.exec(String(step.activation_key));
  const index = match ? Number(match[1]) : -1;
  const delivery = node.interaction?.delivery?.[index];
  if (!delivery
    || step.item_key !== null
    || step.item_index !== null
    || step.node_id !== `${node.id}/delivery/${index}`
    || step.node_path !== `${parent.node_path}/delivery/${index}`
    || step.step_index !== parent.step_index
    || step.step_name !== `Deliver ${parent.step_name}`
    || step.branch_key !== null
    || step.wait_event !== null
    || step.max_retries !== 3) {
    invalid(`wait node "${node.id}" has an invalid delivery step`);
  }
}

function parseSelectedEdges(decision: WorkflowGraphDecisionRecord): string[] {
  if (!decision.decision_json) invalid(`decision for "${decision.node_id}" has no payload`);
  let parsed: unknown;
  try {
    parsed = parsePersistedWorkflowJson(
      decision.decision_json,
      `decision for "${decision.node_id}"`,
    );
  } catch {
    invalid(`decision for "${decision.node_id}" is not valid bounded JSON`);
  }
  if (!parsed || typeof parsed !== 'object'
    || !Array.isArray((parsed as { selectedEdgeIds?: unknown }).selectedEdgeIds)
    || (parsed as { selectedEdgeIds: unknown[] }).selectedEdgeIds
      .some((value) => typeof value !== 'string')) {
    invalid(`decision for "${decision.node_id}" has an invalid edge set`);
  }
  const selected = (parsed as { selectedEdgeIds: string[] }).selectedEdgeIds;
  if (new Set(selected).size !== selected.length) {
    invalid(`decision for "${decision.node_id}" contains duplicate edges`);
  }
  return selected;
}

function canonicalStoredJson(value: string, label: string): string {
  try {
    return canonicalWorkflowJson(parsePersistedWorkflowJson(value, label));
  } catch {
    return invalid(`${label} is not valid bounded canonical JSON`);
  }
}

function assertJsonText(value: unknown, label: string): void {
  if (value === null) return;
  try {
    parsePersistedWorkflowJson(value, label);
  } catch {
    invalid(`${label} is invalid or exceeds its byte limit`);
  }
}

function assertTimestamp(value: unknown, label: string, nullable = true): void {
  if (value === null && nullable) return;
  if (typeof value !== 'string') invalid(`${label} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    invalid(`${label} is invalid`);
  }
}

function invalid(message: string): never {
  throw new TypeError(`Workflow graph persisted state is invalid: ${message}`);
}
