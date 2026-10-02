/** Durable graph edges, decisions, and pinned-snapshot decoding. */

import type { ReactiveDB } from '../sync/reactive-db';
import type {
  WorkflowGraphDecisionRecord,
  WorkflowGraphEdgeRecord,
} from './workflow-graph-records';
import type { WorkflowGraphIR, WorkflowIREdge } from './workflow-ir';
import type { WorkflowInstanceRecord } from './types';

/** Persistence boundary for immutable topology and durable control decisions. */
export class WorkflowGraphTopologyStore {
  constructor(private readonly db: ReactiveDB) {}

  listEdges(instanceId: string): WorkflowGraphEdgeRecord[] {
    return this.db.prepare(`
      SELECT * FROM _workflow_graph_edges WHERE instance_id = ?
      ORDER BY ordinal ASC, rowid ASC
    `).all(instanceId) as WorkflowGraphEdgeRecord[];
  }

  getDecision(
    instanceId: string,
    nodeId: string,
    activationKey = '',
  ): WorkflowGraphDecisionRecord | null {
    return (this.db.prepare(`
      SELECT * FROM _workflow_decisions
      WHERE instance_id = ? AND node_id = ? AND activation_key = ? LIMIT 1
    `).get(instanceId, nodeId, activationKey) as WorkflowGraphDecisionRecord | null) ?? null;
  }

  insertDecision(row: WorkflowGraphDecisionRecord): void {
    this.db.prepare(`
      INSERT INTO _workflow_decisions (
        decision_id, instance_id, node_id, activation_key,
        selected_edge_id, selected_branch, decision_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.decision_id,
      row.instance_id,
      row.node_id,
      row.activation_key,
      row.selected_edge_id,
      row.selected_branch,
      row.decision_json,
      row.created_at,
    );
  }

  listDecisions(instanceId: string): WorkflowGraphDecisionRecord[] {
    return this.db.prepare(`
      SELECT * FROM _workflow_decisions WHERE instance_id = ? ORDER BY rowid ASC
    `).all(instanceId) as WorkflowGraphDecisionRecord[];
  }

  insertEdge(
    instanceId: string,
    edge: WorkflowIREdge,
    ordinal: number,
    now: string,
  ): void {
    this.db.prepare(`
      INSERT INTO _workflow_graph_edges (
        edge_id, instance_id, from_node_id, to_node_id, edge_kind,
        branch_key, condition_json, ordinal, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${instanceId}:${edge.id}`,
      instanceId,
      edge.from,
      edge.to,
      edge.default ? 'default' : edge.condition ? 'conditional' : 'normal',
      edge.branch ?? null,
      edge.condition ? JSON.stringify(edge.condition) : null,
      ordinal,
      now,
    );
  }

  parseGraph(instance: WorkflowInstanceRecord): WorkflowGraphIR {
    if (typeof instance.graph_json !== 'string' || !instance.graph_json) {
      throw new TypeError('Workflow graph snapshot is missing');
    }
    const parsed = JSON.parse(instance.graph_json) as WorkflowGraphIR;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      throw new TypeError('Workflow graph snapshot is invalid');
    }
    return parsed;
  }
}
