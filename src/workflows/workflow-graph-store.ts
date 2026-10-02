/**
 * Stable graph-runtime persistence facade.
 *
 * Focused stores own run/step rows, topology and decisions, fan-out items, and
 * recovery-only interaction reads. This facade keeps the original transaction
 * and method contract for runtime callers.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowEachItemStore } from './workflow-each-item-store';
import { WorkflowGraphInteractionReader } from './workflow-graph-interaction-reader';
import type {
  CreateGraphInstanceInput,
  WorkflowEachItemRecord,
  WorkflowGraphDecisionRecord,
  WorkflowGraphEdgeRecord,
  WorkflowPersistedInteractionRecord,
  WorkflowPersistedInteractionResponseRecord,
} from './workflow-graph-records';
import { WorkflowGraphRunStore } from './workflow-graph-run-store';
import { WorkflowGraphTopologyStore } from './workflow-graph-topology-store';
import type { WorkflowGraphIR } from './workflow-ir';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';
import {
  workflowRuntimeTransaction,
  type WorkflowRuntimeFence,
} from './workflow-runtime-fence';

export type {
  CreateGraphInstanceInput,
  WorkflowEachItemRecord,
  WorkflowGraphDecisionRecord,
  WorkflowGraphEdgeRecord,
  WorkflowPersistedInteractionRecord,
  WorkflowPersistedInteractionResponseRecord,
} from './workflow-graph-records';

/** Route graph persistence through focused stores without changing callers. */
export class WorkflowGraphStore {
  private readonly runs: WorkflowGraphRunStore;
  private readonly topology: WorkflowGraphTopologyStore;
  private readonly eachItems: WorkflowEachItemStore;
  private readonly interactions: WorkflowGraphInteractionReader;

  constructor(
    private readonly db: ReactiveDB,
    private readonly runtimeFence: WorkflowRuntimeFence | null = null,
  ) {
    this.topology = new WorkflowGraphTopologyStore(db);
    this.runs = new WorkflowGraphRunStore(db, this.topology);
    this.eachItems = new WorkflowEachItemStore(db);
    this.interactions = new WorkflowGraphInteractionReader(db);
  }

  transaction<T>(operation: () => T): T {
    return workflowRuntimeTransaction(this.db, this.runtimeFence, operation);
  }

  createInstance(input: CreateGraphInstanceInput, onCreate?: () => void): void {
    this.transaction(() => this.runs.createInstance(input, onCreate));
  }

  getInstance(instanceId: string): WorkflowInstanceRecord | null {
    return this.runs.getInstance(instanceId);
  }

  getStep(stepId: string): WorkflowStepRecord | null {
    return this.runs.getStep(stepId);
  }

  getNodeStep(instanceId: string, nodeId: string): WorkflowStepRecord | null {
    return this.runs.getNodeStep(instanceId, nodeId);
  }

  listSteps(instanceId: string): WorkflowStepRecord[] {
    return this.runs.listSteps(instanceId);
  }

  listRootSteps(instanceId: string): WorkflowStepRecord[] {
    return this.runs.listRootSteps(instanceId);
  }

  listEdges(instanceId: string): WorkflowGraphEdgeRecord[] {
    return this.topology.listEdges(instanceId);
  }

  getDecision(
    instanceId: string,
    nodeId: string,
    activationKey = '',
  ): WorkflowGraphDecisionRecord | null {
    return this.topology.getDecision(instanceId, nodeId, activationKey);
  }

  insertDecision(row: WorkflowGraphDecisionRecord): void {
    this.transaction(() => this.topology.insertDecision(row));
  }

  listDecisions(instanceId: string): WorkflowGraphDecisionRecord[] {
    return this.topology.listDecisions(instanceId);
  }

  listEachItems(instanceId: string, nodeId: string): WorkflowEachItemRecord[] {
    return this.eachItems.list(instanceId, nodeId);
  }

  getEachItem(itemId: string): WorkflowEachItemRecord | null {
    return this.eachItems.get(itemId);
  }

  listInstanceEachItems(instanceId: string): WorkflowEachItemRecord[] {
    return this.eachItems.listByInstance(instanceId);
  }

  listPersistedInteractions(instanceId: string): WorkflowPersistedInteractionRecord[] {
    return this.interactions.list(instanceId);
  }

  listPersistedInteractionResponses(
    instanceId: string,
  ): WorkflowPersistedInteractionResponseRecord[] {
    return this.interactions.listResponses(instanceId);
  }

  insertEachItem(row: WorkflowEachItemRecord): void {
    this.transaction(() => this.eachItems.insert(row));
  }

  updateEachItem(itemId: string, changes: Record<string, unknown>): void {
    this.transaction(() => this.eachItems.update(itemId, changes));
  }

  updateInstance(instanceId: string, changes: Record<string, unknown>): void {
    this.transaction(() => this.runs.updateInstance(instanceId, changes));
  }

  updateStep(stepId: string, changes: Record<string, unknown>): void {
    this.transaction(() => this.runs.updateStep(stepId, changes));
  }

  insertStep(row: Record<string, unknown>): void {
    this.transaction(() => this.runs.insertStep(row));
  }

  /** Recovery-only aggregate byte-accounting integrity check. */
  validateRuntimeBudget(instanceId: string): void {
    this.runs.validateRuntimeBudget(instanceId);
  }

  listNonterminalInstances(): WorkflowInstanceRecord[] {
    return this.runs.listNonterminalInstances();
  }

  listDueInstanceIds(now: string): string[] {
    return this.runs.listDueInstanceIds(now);
  }

  listExpiredSteps(now: string): WorkflowStepRecord[] {
    return this.runs.listExpiredSteps(now);
  }

  parseGraph(instance: WorkflowInstanceRecord): WorkflowGraphIR {
    return this.topology.parseGraph(instance);
  }
}
