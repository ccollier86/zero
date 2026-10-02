/** Two-phase graph recovery: validate/normalize before publication, dispatch after. */

import { OBS_CODES } from '../observability/codes';
import type { WorkflowGraphDefinitionResolver } from './workflow-graph-definition-resolver';
import type { WorkflowGraphInstanceController } from './workflow-graph-instance-controller';
import { readValidatedWorkflowGraphState } from './workflow-graph-state-reader';
import type { WorkflowGraphStore } from './workflow-graph-store';
import { WorkflowError } from './workflow-error';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

export class WorkflowGraphRecoveryCoordinator {
  private state: 'idle' | 'prepared' | 'activated' = 'idle';
  private runningIds: string[] = [];

  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly definitions: WorkflowGraphDefinitionResolver,
    private readonly instances: WorkflowGraphInstanceController,
    private readonly dispatch: (instanceId: string, phase: string) => void,
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  prepare(): number {
    if (this.state !== 'idle') throw invalid('is an initialization-only operation');
    const candidates = this.store.listNonterminalInstances();
    const validated = candidates.map((instance) => {
      try {
        this.store.validateRuntimeBudget(instance.instance_id);
        const graph = this.definitions.resolvePinned(instance);
        readValidatedWorkflowGraphState(this.store, instance, graph);
        return instance;
      } catch (error) {
        this.observability.emitNow(OBS_CODES.WORKFLOW_ADVANCE_FAILED, {
          error,
          metadata: { instanceId: instance.instance_id, phase: 'recovery-preflight' },
        });
        throw new WorkflowError(
          `Cannot recover workflow "${instance.instance_id}": persisted graph state is invalid`,
          'WORKFLOW_STATE_INVALID',
          500,
        );
      }
    });
    let recovered = 0;
    this.store.transaction(() => {
      for (const instance of validated) {
        recovered += this.instances.normalizeAfterRestart(instance.instance_id);
      }
    });
    this.runningIds = validated.filter((instance) => instance.status === 'running')
      .map((instance) => instance.instance_id);
    this.state = 'prepared';
    return recovered;
  }

  activate(): void {
    if (this.state !== 'prepared') throw invalid('is not prepared');
    this.state = 'activated';
    for (const instanceId of this.runningIds) {
      this.instances.armInstance(instanceId);
      this.dispatch(instanceId, 'recovery');
    }
  }
}

function invalid(reason: string): WorkflowError {
  return new WorkflowError(`Workflow graph recovery ${reason}`, 'WORKFLOW_STATE_INVALID', 409);
}
