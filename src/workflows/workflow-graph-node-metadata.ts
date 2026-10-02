/** Derive stable, public-safe graph presentation metadata from structured control flow. */

import type { WorkflowGraphIR } from './workflow-ir';

export interface WorkflowGraphNodeMetadata {
  branchKey: string | null;
}

interface BranchFrame {
  join: string;
  key: string;
}

/**
 * Associate every node inside a choice/parallel lane with its innermost named
 * branch. Joins pop their matching lane, so downstream nodes are not mislabeled.
 */
export function deriveWorkflowGraphNodeMetadata(
  graph: WorkflowGraphIR,
): ReadonlyMap<string, WorkflowGraphNodeMetadata> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from) ?? [];
    outgoing.set(edge.from, [...list, edge]);
  }

  const result = new Map<string, WorkflowGraphNodeMetadata>();
  const signatures = new Map<string, string>();
  const queue: Array<{ nodeId: string; frames: readonly BranchFrame[] }> = [
    { nodeId: graph.entry, frames: [] },
  ];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodes.get(current.nodeId);
    if (!node) continue;
    const frames = popMatchingJoins(current.nodeId, current.frames);
    const signature = JSON.stringify(frames);
    const previous = signatures.get(node.id);
    if (previous !== undefined) {
      if (previous !== signature) {
        throw new TypeError(`Workflow node "${node.id}" has ambiguous branch ancestry`);
      }
      continue;
    }
    signatures.set(node.id, signature);
    result.set(node.id, { branchKey: frames.at(-1)?.key ?? null });

    for (const edge of outgoing.get(node.id) ?? []) {
      const nextFrames = (node.kind === 'choice' || node.kind === 'parallel')
        ? [...frames, { join: node.join, key: requireBranch(edge.branch, node.id) }]
        : frames;
      queue.push({ nodeId: edge.to, frames: nextFrames });
    }
  }
  return result;
}

function popMatchingJoins(
  nodeId: string,
  frames: readonly BranchFrame[],
): readonly BranchFrame[] {
  let end = frames.length;
  while (end > 0 && frames[end - 1]!.join === nodeId) end -= 1;
  return end === frames.length ? frames : frames.slice(0, end);
}

function requireBranch(branch: string | undefined, nodeId: string): string {
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new TypeError(`Workflow control node "${nodeId}" has an unnamed branch`);
  }
  return branch;
}
