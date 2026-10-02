/** Graph workflow instance and public step persistence. */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowEventCapacityStore } from './workflow-event-capacity-store';
import { deriveWorkflowGraphNodeMetadata } from './workflow-graph-node-metadata';
import type { CreateGraphInstanceInput } from './workflow-graph-records';
import type { WorkflowGraphTopologyStore } from './workflow-graph-topology-store';
import type { WorkflowIRNode } from './workflow-ir';
import { WorkflowRuntimeValueBudget } from './workflow-runtime-budget';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';

/** Owns graph run lifecycle rows and their Sync-visible step projection. */
export class WorkflowGraphRunStore {
  private readonly budget: WorkflowRuntimeValueBudget;
  private readonly eventCapacity: WorkflowEventCapacityStore;

  constructor(
    private readonly db: ReactiveDB,
    private readonly topology: WorkflowGraphTopologyStore,
  ) {
    this.budget = new WorkflowRuntimeValueBudget(db);
    this.eventCapacity = new WorkflowEventCapacityStore(db);
  }

  createInstance(input: CreateGraphInstanceInput, onCreate?: () => void): void {
    this.db.transaction(() => {
      const metadata = deriveWorkflowGraphNodeMetadata(input.graph);
      const instanceRow = {
        instance_id: input.instanceId,
        tenant_id: input.tenantId,
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
      onCreate?.();

      input.graph.nodes.forEach((node, index) => {
        this.db.insert('workflow_steps', graphNodeRow(
          input.instanceId,
          input.tenantId,
          node,
          index,
          input.now,
          metadata.get(node.id)?.branchKey ?? null,
        ));
      });
      input.graph.edges.forEach((edge, ordinal) => {
        this.topology.insertEdge(input.instanceId, edge, ordinal, input.now);
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
      const instanceId = String(row.instance_id ?? '');
      const instance = this.getInstance(instanceId);
      if (!instance) throw new TypeError('Workflow child step requires a valid instance');
      const scoped = { ...row, tenant_id: instance.tenant_id ?? null };
      this.budget.assertNewStep(scoped);
      this.db.insert('workflow_steps', scoped);
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
}

function graphNodeRow(
  instanceId: string,
  tenantId: string | null,
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
    tenant_id: tenantId,
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
