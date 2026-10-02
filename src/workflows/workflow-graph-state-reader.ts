/** Coherent, fail-closed reads of one graph workflow's coordination state. */

import { validateWorkflowGraphPersistedState } from './workflow-graph-persisted-state';
import type { WorkflowGraphSnapshot } from './workflow-graph-planner';
import type { WorkflowGraphStore } from './workflow-graph-store';
import type { WorkflowGraphIR } from './workflow-ir';
import type { WorkflowInstanceRecord } from './types';

export function readValidatedWorkflowGraphState(
  store: WorkflowGraphStore,
  instance: WorkflowInstanceRecord,
  graph: WorkflowGraphIR,
): WorkflowGraphSnapshot {
  const snapshot = {
    graph,
    steps: store.listSteps(instance.instance_id),
    edges: store.listEdges(instance.instance_id),
    decisions: store.listDecisions(instance.instance_id),
    eachItems: store.listInstanceEachItems(instance.instance_id),
    interactions: store.listPersistedInteractions(instance.instance_id),
    interactionResponses: store.listPersistedInteractionResponses(instance.instance_id),
  };
  validateWorkflowGraphPersistedState({ instance, ...snapshot });
  return snapshot;
}
