/**
 * Elysia composition root for durable workflows.
 *
 * Registry/service ownership lives in workflow-plugin-runtime.ts. Authenticated
 * routes and their public projections live in workflow-http.plugin.ts.
 */

import Elysia from 'elysia';
import { installAppStopBarrier } from '../frontend/server/app-stop-lifecycle';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
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

export function createWorkflowPlugin(
  config: WorkflowPluginConfig,
  lifecycleOptions: WorkflowPluginLifecycleOptions = {},
) {
  const runtime = createWorkflowPluginRuntimeOwner(config, lifecycleOptions);

  return new Elysia({ name: 'workflows' })
    .onStart((appLifecycle) => {
      if (!runtime.managedStartup) {
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
          emitPlatformCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
            error: new AggregateError(
              failures,
              'Workflow startup failed and cleanup was incomplete',
            ),
            metadata: { phase: 'start', plugin: 'workflows' },
          });
        }
        throw error;
      });
      // The managed app readiness barrier awaits this exact promise. Standalone
      // Elysia currently ignores start-hook returns, so retain an observer too.
      void startup.catch(() => undefined);
      return startup;
    })
    .onStop(() => runtime.stop())
    .use(createWorkflowHttpPlugin({
      registry: runtime.registry,
      getTokenService: runtime.getTokenService,
      initializeForRequest: runtime.initializeForRequest,
      requireReadyService: runtime.requireReadyService,
    }));
}
