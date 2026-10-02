/** Elysia composition root for durable workflows. */

import Elysia from 'elysia';
import { installAppStopBarrier } from '../frontend/server/app-stop-lifecycle';
import { OBS_CODES } from '../observability/codes';
import { createWorkflowDefinitionAdminHttpPlugin } from './workflow-definition-http.plugin';
import { createWorkflowHttpPlugin } from './workflow-http.plugin';
import {
  createWorkflowPluginRuntimeOwner,
  getWorkflowRegistry,
  getWorkflowService,
  stopWorkflowRuntime,
  type WorkflowPluginConfig,
  type WorkflowPluginLifecycleOptions,
} from './workflow-plugin-runtime';

export type { WorkflowPluginConfig } from './workflow-plugin-runtime';
export { getWorkflowRegistry, getWorkflowService, stopWorkflowRuntime };
export { defineWorkflowTables } from './workflow-schema';

export function createWorkflowPlugin(
  config: WorkflowPluginConfig,
  lifecycleOptions: WorkflowPluginLifecycleOptions = {},
) {
  const runtime = createWorkflowPluginRuntimeOwner(config, lifecycleOptions);
  const httpDependencies = {
    registry: runtime.registry,
    getTokenService: runtime.getTokenService,
    authorization: runtime.authorization,
    initializeForRequest: runtime.initializeForRequest,
    requireReadyService: runtime.requireReadyService,
    observability: runtime.observability,
  };

  return new Elysia({ name: 'workflows' })
    .onStart((appLifecycle) => {
      if (!config.runtime) {
        installAppStopBarrier(appLifecycle, runtime.stop);
      }
      const startup = runtime.start().catch(async (error) => {
        const failures: unknown[] = [error];
        try {
          await runtime.stop();
        } catch (stopError) {
          failures.push(stopError);
        }
        try {
          await appLifecycle.stop(true);
        } catch (stopError) {
          failures.push(stopError);
        }
        if (failures.length > 1) {
          runtime.observability.emitNow(OBS_CODES.APP_LIFECYCLE_FAILED, {
            error: new AggregateError(
              failures,
              'Workflow startup failed and cleanup was incomplete',
            ),
            metadata: { phase: 'start', plugin: 'workflows' },
          });
        }
        throw error;
      });
      void startup.catch(() => undefined);
      return startup;
    })
    .onStop(() => runtime.stop())
    .use(createWorkflowHttpPlugin(httpDependencies))
    .use(createWorkflowDefinitionAdminHttpPlugin(httpDependencies));
}
