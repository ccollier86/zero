import type { Elysia } from 'elysia';
import { OBS_CODES, emitPlatformCode } from '../../observability';
import { installAppStartBarrier } from './app-start-lifecycle';

export interface WorkflowAppLifecycle {
  /** Freeze the platform dependency set immediately before workflow mounting. */
  captureDependencyBoundary(): void;
  /** Gate recovery until every captured platform start hook has settled. */
  ensureDependenciesReady(): Promise<void>;
  /** Receive the workflow plugin's single-flight initializer during composition. */
  captureInitializer(initialize: () => Promise<void>): void;
  /** Receive the workflow plugin's identity-scoped shutdown owner. */
  captureStopper(stop: () => Promise<void>): void;
  /** Stop only the workflow runtime composed into this application. */
  stopOwnedRuntime(): Promise<void>;
  /** Install the managed initializer immediately after workflow composition. */
  installStartupBoundary(): void;
}

/** Coordinate workflow recovery with Elysia's non-awaited start-hook lifecycle. */
export function createWorkflowAppLifecycle(
  app: Elysia,
  hasAuthRuntime: () => boolean,
): WorkflowAppLifecycle {
  let initializeWorkflows: (() => Promise<void>) | null = null;
  let stopWorkflows: (() => Promise<void>) | null = null;
  let appStartReady: Promise<void> | null = null;

  return {
    captureDependencyBoundary(): void {
      if (appStartReady) {
        throw new Error('[workflows] Startup dependency boundary is already installed.');
      }
      // Only hooks already mounted at this exact point are workflow recovery
      // dependencies. App extensions and caller hooks mounted later may depend
      // on workflow readiness and must never be folded back into this barrier.
      appStartReady = installAppStartBarrier(app).ready;
    },

    async ensureDependenciesReady(): Promise<void> {
      if (!app.server || !appStartReady) {
        throw new Error('[workflows] App lifecycle has not started.');
      }
      await appStartReady;
      if (!hasAuthRuntime()) {
        throw new Error('[workflows] Auth services failed to initialize before recovery.');
      }
    },

    captureInitializer(initialize): void {
      initializeWorkflows = initialize;
    },

    captureStopper(stop): void {
      stopWorkflows = stop;
    },

    async stopOwnedRuntime(): Promise<void> {
      await stopWorkflows?.();
    },

    installStartupBoundary(): void {
      if (!initializeWorkflows) return;
      if (!appStartReady) {
        throw new Error('[workflows] Startup dependency boundary is not installed.');
      }

      const initialize = initializeWorkflows;
      app.onStart((lifecycle) => {
        void initialize().catch(async (error) => {
          try {
            await lifecycle.stop(true);
          } catch (stopError) {
            emitPlatformCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
              error: new AggregateError(
                [error, stopError],
                'Workflow startup failed and the listener could not be stopped',
              ),
              metadata: { phase: 'start', plugin: 'workflows' },
            });
          }
        });
      });
    },
  };
}
