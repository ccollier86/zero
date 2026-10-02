/** Context-aware validation for references embedded in workflow graph expressions. */

import type {
  WorkflowExpression,
  WorkflowReferenceExpression,
} from './workflow-expression';
import { isWorkflowExpression } from './workflow-expression';
import type { WorkflowGraphIR, WorkflowIREdge, WorkflowIRNode } from './workflow-ir';
import { workflowGraphInvalid as invalid } from './workflow-ir-validation-primitives';

interface ExpressionUse {
  expression: WorkflowExpression;
  consumer: string;
  itemScopes: boolean;
  onlyItemScopes?: boolean;
}

/**
 * Reject references that are syntactically valid but impossible at the point
 * where the runtime evaluates them. In particular, named outputs must
 * dominate the consumer, so inactive choice branches can never leak `undefined`
 * into a definition that appeared valid at publication time.
 */
export function validateWorkflowGraphExpressionContexts(
  graph: WorkflowGraphIR,
  allowItemScopes = false,
): void {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = incomingEdges(graph.nodes, graph.edges);
  const dominators = computeDominators(graph, incoming);

  for (const use of expressionUses(graph, allowItemScopes)) {
    for (const reference of collectReferences(use.expression)) {
      if (use.onlyItemScopes && reference.scope !== 'item' && reference.scope !== 'itemIndex') {
        invalid(`Workflow each itemKey may reference only item or itemIndex`);
      }
      if ((reference.scope === 'item' || reference.scope === 'itemIndex') && !use.itemScopes) {
        invalid(`Workflow expression at "${use.consumer}" cannot reference ${reference.scope}`);
      }
      if (reference.scope !== 'output') continue;
      const target = reference.node!;
      if (!byId.has(target)) {
        invalid(`Workflow expression at "${use.consumer}" references unknown output "${target}"`);
      }
      if (target === use.consumer || !dominators.get(use.consumer)?.has(target)) {
        invalid(
          `Workflow output "${target}" is not guaranteed before "${use.consumer}"`,
        );
      }
    }
  }
}

function expressionUses(graph: WorkflowGraphIR, allowItemScopes: boolean): ExpressionUse[] {
  const uses: ExpressionUse[] = [];
  for (const node of graph.nodes) {
    if (node.kind === 'activity' && node.input) {
      uses.push({ expression: node.input, consumer: node.id, itemScopes: allowItemScopes });
    } else if (node.kind === 'each') {
      uses.push({ expression: node.source, consumer: node.id, itemScopes: false });
      if (node.itemKey) {
        uses.push({
          expression: node.itemKey,
          consumer: node.id,
          itemScopes: true,
          onlyItemScopes: true,
        });
      }
    } else if (node.kind === 'wait' && node.interaction) {
      if (isWorkflowExpression(node.interaction.request)) {
        uses.push({ expression: node.interaction.request, consumer: node.id, itemScopes: false });
      }
      for (const invocation of node.interaction.delivery ?? []) {
        if (invocation.input) {
          uses.push({ expression: invocation.input, consumer: node.id, itemScopes: true });
        }
      }
    }
  }
  for (const edge of graph.edges) {
    if (edge.condition) {
      uses.push({ expression: edge.condition, consumer: edge.from, itemScopes: allowItemScopes });
    }
  }
  return uses;
}

function collectReferences(expression: WorkflowExpression): WorkflowReferenceExpression[] {
  if (expression.type === 'ref') return [expression];
  if (expression.type === 'literal') return [];
  if (expression.type === 'compare') {
    return [...collectReferences(expression.left), ...collectReferences(expression.right)];
  }
  if (expression.type === 'logical') return expression.values.flatMap(collectReferences);
  if (expression.type === 'includes') {
    return [
      ...collectReferences(expression.collection),
      ...collectReferences(expression.value),
    ];
  }
  return collectReferences(expression.value);
}

function incomingEdges(
  nodes: readonly WorkflowIRNode[],
  edges: readonly WorkflowIREdge[],
): Map<string, WorkflowIREdge[]> {
  const incoming = new Map(nodes.map((node) => [node.id, [] as WorkflowIREdge[]]));
  for (const edge of edges) incoming.get(edge.to)!.push(edge);
  return incoming;
}

function computeDominators(
  graph: WorkflowGraphIR,
  incoming: ReadonlyMap<string, readonly WorkflowIREdge[]>,
): Map<string, Set<string>> {
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]));
  for (const edge of graph.edges) outgoing.get(edge.from)!.push(edge.to);
  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const target of outgoing.get(current) ?? []) {
      const remaining = indegree.get(target)! - 1;
      indegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }

  const result = new Map<string, Set<string>>();
  for (const id of order) {
    const predecessors = (incoming.get(id) ?? []).map((edge) => result.get(edge.from)!);
    const common = predecessors.length === 0
      ? new Set<string>()
      : intersect(predecessors);
    common.add(id);
    result.set(id, common);
  }
  return result;
}

function intersect(values: readonly Set<string>[]): Set<string> {
  const result = new Set(values[0]);
  for (const candidate of result) {
    if (values.slice(1).some((value) => !value.has(candidate))) result.delete(candidate);
  }
  return result;
}
