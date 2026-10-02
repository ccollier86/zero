/** Dependency assembly for one app-local graph workflow runtime. */

import type { ReactiveDB } from '../sync/reactive-db';
import type { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import { WorkflowEachController } from './workflow-each-controller';
import { WorkflowGraphActivityExecutor } from './workflow-graph-activity-executor';
import { WorkflowGraphDefinitionResolver } from './workflow-graph-definition-resolver';
import { WorkflowGraphDriver } from './workflow-graph-driver';
import { WorkflowGraphInstanceController } from './workflow-graph-instance-controller';
import { createWorkflowGraphInteractionAuthority } from './workflow-graph-interaction-authority';
import { WorkflowGraphInteractionValidator } from './workflow-graph-interaction-validator';
import { WorkflowGraphRecoveryCoordinator } from './workflow-graph-recovery';
import { WorkflowGraphStartCoordinator } from './workflow-graph-start-coordinator';
import { WorkflowGraphStore } from './workflow-graph-store';
import { WorkflowGraphTransitionController } from './workflow-graph-transitions';
import { WorkflowGraphWakeScheduler } from './workflow-graph-wake-scheduler';
import { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import { WorkflowInteractionService } from './workflow-interaction-service';
import { WorkflowInteractionStore } from './workflow-interaction-store';
import { WorkflowMemoryStore } from './workflow-memory-store';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';
import type { WorkflowRegistry } from './workflow-registry';
import { WorkflowRuntimeStore } from './workflow-runtime-store';
import { resolveWorkflowShutdownGraceMs } from './workflow-shutdown-policy';
import { WorkflowStructuralNodeController } from './workflow-structural-node-controller';
import { WorkflowWaitController } from './workflow-wait-controller';
import type { WorkflowWakeTimer } from './workflow-wake-coordinator';
import type { WorkflowRuntimeFence } from './workflow-runtime-fence';

export interface WorkflowGraphRuntimeCompositionOptions {
  now?: () => Date;
  /** Shared legacy/graph event inbox owner for one workflow service. */
  runtime?: WorkflowRuntimeStore;
  shutdownGraceMs?: number;
  interactionAuthority?: WorkflowInteractionAuthority;
  wakeTimer?: WorkflowWakeTimer | false;
  /** Shared app-local Guardian authority gate used by every graph activity. */
  authority: WorkflowExecutionAuthorityGate;
  /** Shared app-local, transaction-aware workflow event boundary. */
  observability?: WorkflowObservability;
  /** Exact durable runtime generation required by every graph commit. */
  runtimeFence?: WorkflowRuntimeFence;
}

export interface WorkflowGraphRuntimeHooks {
  advance(instanceId: string): Promise<void>;
  dispatch(instanceId: string, phase: string): void;
}

export interface WorkflowGraphRuntimeComposition {
  now: () => Date;
  authority: WorkflowExecutionAuthorityGate;
  store: WorkflowGraphStore;
  runtime: WorkflowRuntimeStore;
  versions: WorkflowDefinitionVersionStore;
  definitions: WorkflowGraphDefinitionResolver;
  memory: WorkflowMemoryStore;
  interactionValidator: WorkflowGraphInteractionValidator;
  interactions: WorkflowInteractionService;
  wakes: WorkflowGraphWakeScheduler;
  activityExecutor: WorkflowGraphActivityExecutor;
  transitions: WorkflowGraphTransitionController;
  instances: WorkflowGraphInstanceController;
  driver: WorkflowGraphDriver;
  recovery: WorkflowGraphRecoveryCoordinator;
  starts: WorkflowGraphStartCoordinator;
}

export function createWorkflowGraphRuntimeComposition(
  db: ReactiveDB,
  registry: WorkflowRegistry,
  options: WorkflowGraphRuntimeCompositionOptions,
  hooks: WorkflowGraphRuntimeHooks,
): WorkflowGraphRuntimeComposition {
  const authority = options.authority;
  const now = options.now ?? (() => new Date());
  const observability = options.observability ?? createWorkflowObservability(db);
  const store = new WorkflowGraphStore(db, options.runtimeFence);
  const runtime = options.runtime
    ?? new WorkflowRuntimeStore(db, authority.store, now, options.runtimeFence);
  const versions = new WorkflowDefinitionVersionStore(
    db,
    () => now().toISOString(),
    observability,
    options.runtimeFence ?? null,
  );
  const definitions = new WorkflowGraphDefinitionResolver(versions, registry);
  const memory = new WorkflowMemoryStore(db, { clock: now, observability });
  const shutdownGraceMs = resolveWorkflowShutdownGraceMs(options.shutdownGraceMs);
  const interactionValidator = new WorkflowGraphInteractionValidator(
    registry,
    store,
    memory,
    authority,
    shutdownGraceMs,
    observability,
  );
  const interactions = new WorkflowInteractionService(
    new WorkflowInteractionStore(db, options.runtimeFence),
    {
      authority: options.interactionAuthority
        ?? createWorkflowGraphInteractionAuthority(store, observability),
      clock: now,
      shutdownGraceMs,
      requireRunningInstance: true,
      beforeDecision: (interaction) => authority.validateInstance(interaction.instanceId),
      validateActivity: (activityId, context) => (
        interactionValidator.validate(activityId, context)
      ),
      observability,
    },
  );
  const wakes = new WorkflowGraphWakeScheduler({
    retry: (instanceId) => hooks.dispatch(instanceId, 'retry'),
    timeout: (instanceId, stepId, expectedAt) => {
      instances.expire(instanceId, stepId, expectedAt);
    },
  }, now, options.wakeTimer ?? false, observability);
  const activityExecutor = new WorkflowGraphActivityExecutor(
    store,
    runtime,
    registry.activities,
    memory,
    authority,
    {
      now,
      shutdownGraceMs,
      onRetryScheduled: (instanceId, stepId, at) => (
        wakes.armRetry(instanceId, stepId, at)
      ),
      onTimeoutScheduled: (instanceId, stepId, at) => (
        wakes.armTimeout(instanceId, stepId, at)
      ),
    },
    observability,
  );
  const structures = new WorkflowStructuralNodeController(
    store,
    memory,
    now,
    observability,
  );
  const each = new WorkflowEachController(
    store,
    activityExecutor,
    memory,
    authority,
    now,
    observability,
  );
  const waits = new WorkflowWaitController(
    store,
    runtime,
    activityExecutor,
    interactions,
    memory,
    authority,
    now,
    observability,
  );
  const instances = new WorkflowGraphInstanceController(
    store,
    runtime,
    activityExecutor,
    interactions,
    wakes,
    hooks.dispatch,
    authority,
    now,
    observability,
  );
  const transitions = new WorkflowGraphTransitionController(
    store,
    runtime,
    activityExecutor,
    interactions,
    wakes,
    (instanceId, stepId, expectedAt) => instances.expire(instanceId, stepId, expectedAt),
    now,
    observability,
  );
  const driver = new WorkflowGraphDriver({
    store,
    runtime,
    activityExecutor,
    interactionValidator,
    interactions,
    structures,
    each,
    waits,
    instances,
    definitions,
    authority,
    observability,
  });
  const recovery = new WorkflowGraphRecoveryCoordinator(
    store,
    definitions,
    instances,
    hooks.dispatch,
    observability,
  );
  const starts = new WorkflowGraphStartCoordinator(
    store,
    definitions,
    versions,
    authority,
    hooks.advance,
    now,
    observability,
  );

  store.transaction(() => definitions.publishRegisteredDefinitions());
  return {
    now,
    authority,
    store,
    runtime,
    versions,
    definitions,
    memory,
    interactionValidator,
    interactions,
    wakes,
    activityExecutor,
    transitions,
    instances,
    driver,
    recovery,
    starts,
  };
}
