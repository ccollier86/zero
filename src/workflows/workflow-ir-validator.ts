/**
 * workflow-ir-validator.ts
 *
 * Validates untrusted workflow graph structure before registration or
 * persistence. It owns graph topology and boundedness rules, not activity
 * authorization, database writes, or runtime transitions.
 */

import { validateWorkflowExpression } from './workflow-expression';
import {
  WORKFLOW_COMPILER_ID_PREFIX,
  WORKFLOW_GRAPH_LIMITS,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowGraphIR,
  type WorkflowIREdge,
  type WorkflowIRNode,
} from './workflow-ir';
import { WorkflowError } from './workflow-error';
import { validateWorkflowGraphExpressionContexts } from './workflow-ir-expression-validator';
import {
  assertWorkflowEvent as assertEvent,
  assertWorkflowId as assertId,
  assertWorkflowJsonSafe as assertJsonSafe,
  assertWorkflowKnownKeys as assertKeys,
  isWorkflowRecord as isRecord,
  validateWorkflowActivityReference as validateActivityReference,
  validateWorkflowExecutionPolicy as validateExecutionPolicy,
  validateWorkflowInteraction as validateInteraction,
  validateWorkflowPositiveDuration as validatePositiveDuration,
  workflowGraphInvalid as invalid,
} from './workflow-ir-validation-primitives';

export interface WorkflowGraphValidationOptions {
  /** Only the trusted legacy compiler may carry source-string conditions. */
  allowLegacyCompatibility?: boolean;
}

interface ValidationBudget {
  nodes: number;
  edges: number;
}

/** Validate shape, limits, reachability, acyclicity, branching, and nested each graphs. */
export function validateWorkflowGraphIR(
  graph: unknown,
  options: WorkflowGraphValidationOptions = {},
): asserts graph is WorkflowGraphIR {
  assertJsonSafe(graph, new Set());
  const bytes = new TextEncoder().encode(JSON.stringify(graph)).byteLength;
  if (bytes > WORKFLOW_GRAPH_LIMITS.maxDefinitionBytes) {
    invalid(`Workflow graph exceeds ${WORKFLOW_GRAPH_LIMITS.maxDefinitionBytes} bytes`);
  }
  validateGraph(graph, options, 0, { nodes: 0, edges: 0 }, false);
}

/** Assert a value can cross the durable JSON boundary without lossy coercion. */
export function assertWorkflowJsonValue(value: unknown, label = 'Value'): void {
  try {
    assertJsonSafe(value, new Set());
  } catch (error) {
    if (error instanceof WorkflowError) {
      invalid(`${label} is not JSON-safe: ${error.message}`);
    }
    throw error;
  }
}

function validateGraph(
  value: unknown,
  options: WorkflowGraphValidationOptions,
  depth: number,
  budget: ValidationBudget,
  allowItemScopes: boolean,
): void {
  if (depth > WORKFLOW_GRAPH_LIMITS.maxDepth) invalid('Workflow graph nesting is too deep');
  if (!isRecord(value)) invalid('Workflow graph must be an object');
  assertKeys(value, ['schemaVersion', 'entry', 'nodes', 'edges'], 'Workflow graph');
  if (value.schemaVersion !== WORKFLOW_GRAPH_SCHEMA_VERSION) {
    invalid(`Unsupported workflow graph schema version "${String(value.schemaVersion)}"`);
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    invalid('Workflow graph must define at least one node');
  }
  if (!Array.isArray(value.edges)) invalid('Workflow graph edges must be an array');
  budget.nodes += value.nodes.length;
  budget.edges += value.edges.length;
  if (budget.nodes > WORKFLOW_GRAPH_LIMITS.maxNodes) invalid('Workflow graph has too many nodes');
  if (budget.edges > WORKFLOW_GRAPH_LIMITS.maxEdges) invalid('Workflow graph has too many edges');

  const nodes = value.nodes as unknown[];
  const edges = value.edges as unknown[];
  const byId = new Map<string, WorkflowIRNode>();
  for (const candidate of nodes) {
    validateNode(candidate, options, depth, budget);
    const node = candidate as WorkflowIRNode;
    if (byId.has(node.id)) invalid(`Workflow graph contains duplicate node id "${node.id}"`);
    byId.set(node.id, node);
  }
  if (typeof value.entry !== 'string' || !byId.has(value.entry)) {
    invalid('Workflow graph entry must reference an existing node');
  }

  const edgeIds = new Set<string>();
  const outgoing = new Map<string, WorkflowIREdge[]>();
  const incoming = new Map<string, WorkflowIREdge[]>();
  for (const candidate of edges) {
    validateEdge(candidate, byId);
    const edge = candidate as WorkflowIREdge;
    if (edgeIds.has(edge.id)) invalid(`Workflow graph contains duplicate edge id "${edge.id}"`);
    edgeIds.add(edge.id);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }

  validateTopology(value.entry as string, byId, outgoing);
  validateWorkflowGraphExpressionContexts(value as unknown as WorkflowGraphIR, allowItemScopes);
  for (const node of byId.values()) {
    validateControlNode(node, byId, outgoing, incoming);
  }
}

function validateNode(
  value: unknown,
  options: WorkflowGraphValidationOptions,
  depth: number,
  budget: ValidationBudget,
): void {
  if (!isRecord(value)) invalid('Workflow graph node must be an object');
  assertId(value.id, 'node');
  if (value.label !== undefined
    && (typeof value.label !== 'string'
      || !value.label.trim()
      || value.label !== value.label.trim()
      || value.label.length > WORKFLOW_GRAPH_LIMITS.maxLabelLength)) {
    invalid(`Workflow node "${String(value.id)}" label must be a non-empty string`);
  }
  if (String(value.id).startsWith(WORKFLOW_COMPILER_ID_PREFIX) && value.kind !== 'join') {
    invalid(`Workflow node id prefix "${WORKFLOW_COMPILER_ID_PREFIX}" is reserved for joins`);
  }
  switch (value.kind) {
    case 'activity':
      assertKeys(value, [
        'id', 'kind', 'label', 'activity', 'input', 'retries', 'backoffMs', 'timeoutMs',
        'legacyCondition', 'legacyWaitFor',
      ], `Workflow activity "${value.id}"`);
      validateActivityReference(value.activity);
      if (value.input !== undefined) validateWorkflowExpression(value.input);
      validateExecutionPolicy(value);
      if (value.legacyCondition !== undefined || value.legacyWaitFor !== undefined) {
        if (!options.allowLegacyCompatibility) {
          invalid('Legacy condition and wait fields are forbidden in graph definitions');
        }
        if (value.legacyCondition !== undefined
          && (typeof value.legacyCondition !== 'string' || !value.legacyCondition.trim())) {
          invalid('Legacy workflow condition must be a non-empty string');
        }
        if (value.legacyWaitFor !== undefined) assertEvent(value.legacyWaitFor);
      }
      return;
    case 'wait':
      assertKeys(value, ['id', 'kind', 'label', 'event', 'timeoutMs', 'inputSchema', 'interaction'], `Workflow wait "${value.id}"`);
      assertEvent(value.event);
      validatePositiveDuration(value.timeoutMs, 'wait timeoutMs');
      if (value.inputSchema !== undefined) assertWorkflowJsonValue(value.inputSchema, 'Wait input schema');
      if (value.interaction !== undefined) validateInteraction(value.interaction);
      return;
    case 'choice':
      assertKeys(value, ['id', 'kind', 'label', 'join'], `Workflow choice "${value.id}"`);
      assertId(value.join, 'choice join');
      return;
    case 'parallel':
      assertKeys(value, ['id', 'kind', 'label', 'join'], `Workflow parallel "${value.id}"`);
      assertId(value.join, 'parallel join');
      return;
    case 'join':
      assertKeys(value, ['id', 'kind', 'label', 'parent', 'strategy'], `Workflow join "${value.id}"`);
      assertId(value.parent, 'join parent');
      if (value.strategy !== 'all') invalid('Workflow joins currently require strategy "all"');
      assertGeneratedJoinId(String(value.id), String(value.parent));
      return;
    case 'each':
      assertKeys(value, [
        'id', 'kind', 'label', 'source', 'itemSchema', 'itemKey', 'concurrency', 'onInvalid', 'onError', 'visibility', 'body',
      ], `Workflow each "${value.id}"`);
      validateWorkflowExpression(value.source);
      if (value.itemSchema !== undefined) assertWorkflowJsonValue(value.itemSchema, 'Each item schema');
      if (value.itemKey !== undefined) validateWorkflowExpression(value.itemKey);
      if (!Number.isInteger(value.concurrency)
        || Number(value.concurrency) < 1
        || Number(value.concurrency) > WORKFLOW_GRAPH_LIMITS.maxEachConcurrency) {
        invalid(`Workflow each concurrency must be from 1 to ${WORKFLOW_GRAPH_LIMITS.maxEachConcurrency}`);
      }
      if (value.onInvalid !== 'fail' && value.onInvalid !== 'skip') {
        invalid('Workflow each onInvalid policy is invalid');
      }
      if (value.onError !== 'fail' && value.onError !== 'collect') {
        invalid('Workflow each onError policy is invalid');
      }
      if (value.visibility !== undefined
        && value.visibility !== 'public'
        && value.visibility !== 'private') {
        invalid('Workflow each visibility is invalid');
      }
      validateGraph(value.body, options, depth + 1, budget, true);
      if (!isRecord(value.body)
        || !Array.isArray(value.body.nodes)
        || value.body.nodes.length !== 1
        || !isRecord(value.body.nodes[0])
        || value.body.nodes[0].kind !== 'activity'
        || !Array.isArray(value.body.edges)
        || value.body.edges.length !== 0) {
        invalid('Workflow each body must contain exactly one activity node in this runtime version');
      }
      return;
    default:
      invalid(`Workflow node "${String(value.id)}" has an invalid kind`);
  }
}

function validateEdge(value: unknown, nodes: ReadonlyMap<string, WorkflowIRNode>): void {
  if (!isRecord(value)) invalid('Workflow graph edge must be an object');
  assertKeys(value, ['id', 'from', 'to', 'branch', 'order', 'condition', 'default'], 'Workflow edge');
  assertId(value.id, 'edge');
  if (String(value.id).startsWith(WORKFLOW_COMPILER_ID_PREFIX)) {
    invalid(`Workflow edge ids cannot use the compiler-reserved prefix`);
  }
  if (typeof value.from !== 'string' || !nodes.has(value.from)) {
    invalid(`Workflow edge "${String(value.id)}" has an unknown source`);
  }
  if (typeof value.to !== 'string' || !nodes.has(value.to)) {
    invalid(`Workflow edge "${String(value.id)}" has an unknown target`);
  }
  if (value.from === value.to) invalid(`Workflow edge "${String(value.id)}" cannot target itself`);
  if (value.branch !== undefined
    && (typeof value.branch !== 'string'
      || !value.branch.trim()
      || value.branch !== value.branch.trim()
      || value.branch.length > WORKFLOW_GRAPH_LIMITS.maxIdLength)) {
    invalid(`Workflow edge "${String(value.id)}" has an invalid branch name`);
  }
  if (value.condition !== undefined) validateWorkflowExpression(value.condition);
  if (value.order !== undefined && (!Number.isInteger(value.order) || Number(value.order) < 0)) {
    invalid(`Workflow edge "${String(value.id)}" has an invalid order`);
  }
  if (value.default !== undefined && value.default !== true) {
    invalid(`Workflow edge "${String(value.id)}" default must be true when present`);
  }
  const source = nodes.get(value.from)!;
  if (source.kind !== 'choice'
    && (value.condition !== undefined || value.default !== undefined || value.order !== undefined)) {
    invalid('Conditions and default markers are legal only on choice edges');
  }
  if (source.kind !== 'parallel' && source.kind !== 'choice' && value.branch !== undefined) {
    invalid('Branch labels are legal only on choice and parallel edges');
  }
}

function validateControlNode(
  node: WorkflowIRNode,
  nodes: ReadonlyMap<string, WorkflowIRNode>,
  outgoing: ReadonlyMap<string, readonly WorkflowIREdge[]>,
  incoming: ReadonlyMap<string, readonly WorkflowIREdge[]>,
): void {
  const edges = outgoing.get(node.id) ?? [];
  const inbound = incoming.get(node.id) ?? [];
  if (node.kind !== 'choice' && node.kind !== 'parallel' && edges.length > 1) {
    invalid(`Workflow node "${node.id}" may have only one outgoing edge; use parallel for fan-out`);
  }
  if (node.kind !== 'join' && inbound.length > 1) {
    invalid(`Workflow node "${node.id}" may have only one incoming edge; use a generated join`);
  }
  if (node.kind === 'choice') {
    if (edges.length < 2) invalid(`Workflow choice "${node.id}" requires at least two branches`);
    const branchNames = edges.map((edge) => edge.branch);
    if (branchNames.some((name) => !name) || new Set(branchNames).size !== branchNames.length) {
      invalid(`Workflow choice "${node.id}" requires unique named branches`);
    }
    const defaults = edges.filter((edge) => edge.default === true);
    if (defaults.length !== 1) invalid(`Workflow choice "${node.id}" requires exactly one otherwise branch`);
    if (edges.some((edge) => edge.default !== true && edge.condition === undefined)) {
      invalid(`Workflow choice "${node.id}" has a branch without a condition`);
    }
    const orders = edges.map((edge) => edge.order).sort((left, right) => Number(left) - Number(right));
    if (orders.some((order, index) => order !== index)) {
      invalid(`Workflow choice "${node.id}" requires contiguous branch order values`);
    }
    if (defaults[0]?.order !== edges.length - 1) {
      invalid(`Workflow choice "${node.id}" otherwise branch must be last`);
    }
    if (defaults[0]?.condition !== undefined) invalid('Workflow otherwise edge cannot have a condition');
    assertJoin(node, nodes, outgoing, incoming);
  } else if (node.kind === 'parallel') {
    if (edges.length < 2 || edges.length > WORKFLOW_GRAPH_LIMITS.maxParallelBranches) {
      invalid(`Workflow parallel "${node.id}" requires 2-${WORKFLOW_GRAPH_LIMITS.maxParallelBranches} branches`);
    }
    const names = edges.map((edge) => edge.branch);
    if (names.some((name) => !name) || new Set(names).size !== names.length) {
      invalid(`Workflow parallel "${node.id}" requires unique named branches`);
    }
    assertJoin(node, nodes, outgoing, incoming);
  } else if (node.kind === 'join') {
    const parent = nodes.get(node.parent);
    if (!parent || (parent.kind !== 'choice' && parent.kind !== 'parallel') || parent.join !== node.id) {
      invalid(`Workflow join "${node.id}" does not match its parent`);
    }
    if (inbound.length === 0) invalid(`Workflow join "${node.id}" is unreachable`);
  }
}

function assertJoin(
  node: Extract<WorkflowIRNode, { kind: 'choice' | 'parallel' }>,
  nodes: ReadonlyMap<string, WorkflowIRNode>,
  outgoing: ReadonlyMap<string, readonly WorkflowIREdge[]>,
  incoming: ReadonlyMap<string, readonly WorkflowIREdge[]>,
): void {
  const join = nodes.get(node.join);
  if (!join || join.kind !== 'join' || join.parent !== node.id) {
    invalid(`Workflow ${node.kind} "${node.id}" has no matching join`);
  }
  const owned = new Set<string>();
  for (const edge of outgoing.get(node.id) ?? []) {
    if (!isReachable(edge.to, node.join, outgoing, new Set())) {
      invalid(`Workflow ${node.kind} branch "${edge.branch ?? edge.id}" does not reach its join`);
    }
    collectBeforeJoin(edge.to, node.join, outgoing, owned);
  }
  for (const edge of incoming.get(node.join) ?? []) {
    if (edge.from !== node.id && !owned.has(edge.from)) {
      invalid(`Workflow join "${node.join}" captures a node outside "${node.id}"`);
    }
  }
}

function collectBeforeJoin(
  from: string,
  join: string,
  outgoing: ReadonlyMap<string, readonly WorkflowIREdge[]>,
  collected: Set<string>,
): void {
  if (from === join || collected.has(from)) return;
  collected.add(from);
  for (const edge of outgoing.get(from) ?? []) {
    collectBeforeJoin(edge.to, join, outgoing, collected);
  }
}

function validateTopology(
  entry: string,
  nodes: ReadonlyMap<string, WorkflowIRNode>,
  outgoing: ReadonlyMap<string, readonly WorkflowIREdge[]>,
): void {
  const visited = new Set<string>();
  const active = new Set<string>();
  const walk = (id: string): void => {
    if (active.has(id)) invalid('Workflow graph contains a cycle');
    if (visited.has(id)) return;
    active.add(id);
    for (const edge of outgoing.get(id) ?? []) walk(edge.to);
    active.delete(id);
    visited.add(id);
  };
  walk(entry);
  const unreachable = [...nodes.keys()].find((id) => !visited.has(id));
  if (unreachable) invalid(`Workflow node "${unreachable}" is unreachable from the graph entry`);
}

function isReachable(
  from: string,
  target: string,
  outgoing: ReadonlyMap<string, readonly WorkflowIREdge[]>,
  seen: Set<string>,
): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (outgoing.get(from) ?? []).some((edge) => isReachable(edge.to, target, outgoing, seen));
}

function assertGeneratedJoinId(id: string, parent: string): void {
  if (id !== `${WORKFLOW_COMPILER_ID_PREFIX}${parent}/join`) {
    invalid(`Workflow join "${id}" must use the deterministic compiler id for "${parent}"`);
  }
}
