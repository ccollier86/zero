/**
 * workflow-graph-store.ts
 *
 * ReactiveDB persistence boundary for graph workflow instances. Executable
 * graph snapshots and coordination rows stay server-only; public node rows use
 * `workflow_steps` so Sync can publish a safe live execution projection.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { deriveWorkflowGraphNodeMetadata } from './workflow-graph-node-metadata';
import { WorkflowEventCapacityStore } from './workflow-event-capacity-store';
import type { WorkflowGraphIR, WorkflowIRNode, WorkflowIREdge } from './workflow-ir';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';
import { WorkflowRuntimeValueBudget } from './workflow-runtime-budget';

export interface CreateGraphInstanceInput {
  instanceId: string;
  definitionId: string;
  definitionVersionId: string;
  definitionVersion: number;
  name: string;
  graph: WorkflowGraphIR;
  graphJson: string;
  graphFingerprint: string;
  inputJson: string | null;
  startedBy: string | null;
  now: string;
}

export interface WorkflowGraphDecisionRecord {
  decision_id: string;
  instance_id: string;
  node_id: string;
  activation_key: string;
  selected_edge_id: string | null;
  selected_branch: string | null;
  decision_json: string | null;
  created_at: string;
}

export interface WorkflowGraphEdgeRecord {
  edge_id: string;
  instance_id: string;
  from_node_id: string | null;
  to_node_id: string;
  edge_kind: string;
  branch_key: string | null;
  condition_json: string | null;
  ordinal: number;
  created_at: string;
}

export interface WorkflowEachItemRecord {
  item_id: string;
  instance_id: string;
  parent_step_id: string | null;
  node_id: string;
  activation_key: string;
  item_key: string;
  item_index: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  input_json: string;
  output_json: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** Raw public/private interaction envelope used only for fail-closed recovery checks. */
export interface WorkflowPersistedInteractionRecord {
  interaction_id: string;
  instance_id: string;
  node_id: string;
  step_id: string | null;
  safe_label: string;
  status: string;
  opened_at: string;
  expires_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  rejection_count: number;
  max_rejections: number;
  created_at: string;
  updated_at: string;
  detail_interaction_id: string | null;
  responder_policy_json: string | null;
  response_schema_json: string | null;
  request_json: string | null;
  validator_activity_id: string | null;
  accepted_response_id: string | null;
  response_count: number | null;
  response_bytes: number | null;
  detail_created_at: string | null;
  detail_updated_at: string | null;
}

/** Raw private response row paired with its owning instance for integrity validation. */
export interface WorkflowPersistedInteractionResponseRecord {
  response_id: string;
  interaction_id: string;
  submission_id: string;
  actor_id: string | null;
  channel: string | null;
  payload_hash: string;
  payload_json: string;
  accepted_value_json: string | null;
  status: string;
  rejection_code: string | null;
  public_message: string | null;
  created_at: string;
  decided_at: string | null;
}

export class WorkflowGraphStore {
  private readonly budget: WorkflowRuntimeValueBudget;
  private readonly eventCapacity: WorkflowEventCapacityStore;

  constructor(private readonly db: ReactiveDB) {
    this.budget = new WorkflowRuntimeValueBudget(db);
    this.eventCapacity = new WorkflowEventCapacityStore(db);
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation);
  }

  createInstance(input: CreateGraphInstanceInput): void {
    this.db.transaction(() => {
      const metadata = deriveWorkflowGraphNodeMetadata(input.graph);
      const instanceRow = {
        instance_id: input.instanceId,
        definition_id: input.definitionId,
        definition_version_id: input.definitionVersionId,
        definition_version: input.definitionVersion,
        name: input.name,
        status: 'running',
        current_step: 0,
        input: input.inputJson,
        output: null,
        error: null,
        started_by: input.startedBy,
        steps_json: null,
        graph_json: input.graphJson,
        graph_fingerprint: input.graphFingerprint,
        created_at: input.now,
        updated_at: input.now,
        completed_at: null,
      };
      this.budget.assertNewInstance(instanceRow);
      this.eventCapacity.initializeInstance(input.instanceId);
      this.db.insert('workflow_instances', instanceRow);

      input.graph.nodes.forEach((node, index) => {
        this.db.insert('workflow_steps', graphNodeRow(
          input.instanceId,
          node,
          index,
          input.now,
          metadata.get(node.id)?.branchKey ?? null,
        ));
      });
      input.graph.edges.forEach((edge, ordinal) => {
        this.insertEdge(input.instanceId, edge, ordinal, input.now);
      });
    });
  }

  getInstance(instanceId: string): WorkflowInstanceRecord | null {
    return (this.db.prepare(
      'SELECT * FROM workflow_instances WHERE instance_id = ? LIMIT 1',
    ).get(instanceId) as WorkflowInstanceRecord | null) ?? null;
  }

  getStep(stepId: string): WorkflowStepRecord | null {
    return (this.db.prepare(
      'SELECT * FROM workflow_steps WHERE step_id = ? LIMIT 1',
    ).get(stepId) as WorkflowStepRecord | null) ?? null;
  }

  getNodeStep(instanceId: string, nodeId: string): WorkflowStepRecord | null {
    return (this.db.prepare(`
      SELECT * FROM workflow_steps
      WHERE instance_id = ? AND node_id = ? AND parent_step_id IS NULL
      ORDER BY rowid ASC LIMIT 1
    `).get(instanceId, nodeId) as WorkflowStepRecord | null) ?? null;
  }

  listSteps(instanceId: string): WorkflowStepRecord[] {
    return this.db.prepare(`
      SELECT * FROM workflow_steps WHERE instance_id = ?
      ORDER BY step_index ASC, item_index ASC, rowid ASC
    `).all(instanceId) as WorkflowStepRecord[];
  }

  listRootSteps(instanceId: string): WorkflowStepRecord[] {
    return this.db.prepare(`
      SELECT * FROM workflow_steps
      WHERE instance_id = ? AND parent_step_id IS NULL
      ORDER BY step_index ASC, rowid ASC
    `).all(instanceId) as WorkflowStepRecord[];
  }

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

  listEachItems(instanceId: string, nodeId: string): WorkflowEachItemRecord[] {
    return this.db.prepare(`
      SELECT * FROM _workflow_each_items
      WHERE instance_id = ? AND node_id = ?
      ORDER BY item_index ASC, rowid ASC
    `).all(instanceId, nodeId) as WorkflowEachItemRecord[];
  }

  getEachItem(itemId: string): WorkflowEachItemRecord | null {
    return (this.db.prepare(`
      SELECT * FROM _workflow_each_items WHERE item_id = ? LIMIT 1
    `).get(itemId) as WorkflowEachItemRecord | null) ?? null;
  }

  listInstanceEachItems(instanceId: string): WorkflowEachItemRecord[] {
    return this.db.prepare(`
      SELECT * FROM _workflow_each_items
      WHERE instance_id = ? ORDER BY node_id ASC, item_index ASC, rowid ASC
    `).all(instanceId) as WorkflowEachItemRecord[];
  }

  listPersistedInteractions(instanceId: string): WorkflowPersistedInteractionRecord[] {
    return this.db.prepare(`
      SELECT interaction.*,
        detail.interaction_id AS detail_interaction_id,
        detail.responder_policy_json,
        detail.response_schema_json,
        detail.request_json,
        detail.validator_activity_id,
        detail.accepted_response_id,
        detail.response_count,
        detail.response_bytes,
        detail.created_at AS detail_created_at,
        detail.updated_at AS detail_updated_at
      FROM workflow_interactions AS interaction
      LEFT JOIN _workflow_interaction_details AS detail
        ON detail.interaction_id = interaction.interaction_id
      WHERE interaction.instance_id = ?
      ORDER BY interaction.opened_at ASC, interaction.rowid ASC
    `).all(instanceId) as WorkflowPersistedInteractionRecord[];
  }

  listPersistedInteractionResponses(
    instanceId: string,
  ): WorkflowPersistedInteractionResponseRecord[] {
    return this.db.prepare(`
      SELECT response.*
      FROM _workflow_interaction_responses AS response
      INNER JOIN workflow_interactions AS interaction
        ON interaction.interaction_id = response.interaction_id
      WHERE interaction.instance_id = ?
      ORDER BY response.created_at ASC, response.rowid ASC
    `).all(instanceId) as WorkflowPersistedInteractionResponseRecord[];
  }

  insertEachItem(row: WorkflowEachItemRecord): void {
    this.db.transaction(() => {
      this.budget.assertNewEachItem(row as unknown as Record<string, unknown>);
      this.db.prepare(`
        INSERT INTO _workflow_each_items (
          item_id, instance_id, parent_step_id, node_id, activation_key,
          item_key, item_index, status, input_json, output_json, error,
          attempts, max_attempts, created_at, updated_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.item_id,
        row.instance_id,
        row.parent_step_id,
        row.node_id,
        row.activation_key,
        row.item_key,
        row.item_index,
        row.status,
        row.input_json,
        row.output_json,
        row.error,
        row.attempts,
        row.max_attempts,
        row.created_at,
        row.updated_at,
        row.started_at,
        row.completed_at,
      );
    });
  }

  updateEachItem(itemId: string, changes: Record<string, unknown>): void {
    this.db.transaction(() => {
      this.budget.assertEachItemChange(itemId, changes);
      updateInternalRow(this.db, '_workflow_each_items', 'item_id', itemId, changes);
    });
  }

  updateInstance(instanceId: string, changes: Record<string, unknown>): void {
    this.db.transaction(() => {
      this.budget.assertInstanceChange(instanceId, changes);
      this.db.update('workflow_instances', instanceId, changes);
    });
  }

  updateStep(stepId: string, changes: Record<string, unknown>): void {
    this.db.transaction(() => {
      this.budget.assertStepChange(stepId, changes);
      this.db.update('workflow_steps', stepId, changes);
    });
  }

  insertStep(row: Record<string, unknown>): void {
    this.db.transaction(() => {
      this.budget.assertNewStep(row);
      this.db.insert('workflow_steps', row);
    });
  }

  /** Recovery-only aggregate byte-accounting integrity check. */
  validateRuntimeBudget(instanceId: string): void {
    this.budget.validateInstance(instanceId);
  }

  listNonterminalInstances(): WorkflowInstanceRecord[] {
    return this.db.prepare(`
      SELECT * FROM workflow_instances
      WHERE graph_json IS NOT NULL
        AND status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY rowid ASC
    `).all() as WorkflowInstanceRecord[];
  }

  listDueInstanceIds(now: string): string[] {
    return (this.db.prepare(`
      SELECT DISTINCT step.instance_id FROM workflow_steps AS step
      INNER JOIN workflow_instances AS instance ON instance.instance_id = step.instance_id
      WHERE instance.status = 'running' AND instance.graph_json IS NOT NULL
        AND step.retry_at IS NOT NULL AND step.retry_at <= ? AND step.status = 'failed'
      ORDER BY step.instance_id ASC
    `).all(now) as Array<{ instance_id: string }>).map((row) => row.instance_id);
  }

  listExpiredSteps(now: string): WorkflowStepRecord[] {
    return this.db.prepare(`
      SELECT step.* FROM workflow_steps AS step
      INNER JOIN workflow_instances AS instance ON instance.instance_id = step.instance_id
      WHERE instance.graph_json IS NOT NULL AND instance.status = 'running'
        AND step.timeout_at IS NOT NULL AND step.timeout_at <= ?
        AND step.status IN ('pending', 'running', 'waiting', 'failed')
      ORDER BY step.timeout_at ASC, step.rowid ASC
    `).all(now) as WorkflowStepRecord[];
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

  private insertEdge(
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
}

function graphNodeRow(
  instanceId: string,
  node: WorkflowIRNode,
  index: number,
  now: string,
  branchKey: string | null,
): Record<string, unknown> {
  const attempts = node.kind === 'activity' ? Math.max(1, node.retries ?? 3) : 1;
  const waitEvent = node.kind === 'wait'
    ? node.event
    : node.kind === 'activity' ? node.legacyWaitFor ?? null : null;
  return {
    step_id: `wstep_${crypto.randomUUID()}`,
    instance_id: instanceId,
    step_index: index,
    step_name: node.label ?? node.id,
    status: 'pending',
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: attempts,
    retry_at: null,
    wait_event: waitEvent,
    timeout_at: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    node_id: node.id,
    node_kind: node.kind,
    node_path: node.id,
    parent_step_id: null,
    branch_key: branchKey,
    item_key: null,
    item_index: null,
    activation_key: '',
    updated_at: now,
  };
}

function updateInternalRow(
  db: ReactiveDB,
  table: string,
  keyColumn: string,
  key: string,
  changes: Record<string, unknown>,
): void {
  const entries = Object.entries(changes);
  if (entries.length === 0) return;
  const columns = entries.map(([column]) => {
    if (!/^[a-z_][a-z0-9_]*$/u.test(column)) throw new TypeError('Invalid column name');
    return `${column} = ?`;
  });
  db.prepare(`UPDATE ${table} SET ${columns.join(', ')} WHERE ${keyColumn} = ?`)
    .run(...entries.map(([, value]) => value as never), key);
}
