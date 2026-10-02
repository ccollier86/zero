/**
 * Lifecycle owner for the workflow registry, service, and scheduler jobs.
 *
 * This module deliberately contains no HTTP concerns. It owns composition-time
 * registration, startup recovery, publication, and best-effort shutdown.
 */

import { getTokenService as getDefaultTokenService } from '../auth/auth.plugin';
import type { TokenService } from '../auth/token-service';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowError } from './workflow-error';
import type { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import { WorkflowRegistry } from './workflow-registry';
import {
  getCurrentWorkflowRuntimeOwner,
  publishWorkflowRuntimeOwner,
  type PublishedWorkflowRuntimeOwner,
} from './workflow-runtime-owner-store';
import { createWorkflowSchedulerOwner } from './workflow-scheduler-owner';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';
import type { WorkflowRuntimeOwnershipOptions } from './workflow-runtime-owner-lease';

export interface WorkflowPluginConfig {
  db: ReactiveDB;
  /** Register app handlers and definitions before recovery begins. */
  register?: (registry: WorkflowRegistry) => void | Promise<void>;
  /** Explicit token dependency for standalone composition and tests. */
  getTokenService?: () => TokenService | null;
  /** Managed-app readiness boundary run before recovery. */
  ensureAuthReady?: () => Promise<void>;
  /** Maximum wait for cooperative handler cancellation during shutdown. */
  shutdownGraceMs?: number;
  /** Guardian/app policy adapter for graph interaction responders. */
  interactionAuthority?: WorkflowInteractionAuthority;
  /** Durable single-owner lease configuration. Intended chiefly for deterministic tests. */
  runtimeOwnership?: WorkflowRuntimeOwnershipOptions;
}

export type WorkflowPluginLifecycleOptions =
  | {
      /** Normal plugin-owned startup, with an optional focused-test seam. */
      managedStartup?: false;
      onInitializerCreated?: (initialize: () => Promise<void>) => void;
      /** Capture this exact runtime owner's idempotent shutdown function. */
      onStopCreated?: (stop: () => Promise<void>) => void;
      onServiceCreated?: (service: WorkflowService) => void;
    }
  | {
      /** Managed composition must provide the owner that starts recovery. */
      managedStartup: true;
      onInitializerCreated: (initialize: () => Promise<void>) => void;
      /** Capture this exact runtime owner's idempotent shutdown function. */
      onStopCreated?: (stop: () => Promise<void>) => void;
      onServiceCreated?: (service: WorkflowService) => void;
    };

export interface WorkflowPluginRuntimeOwner {
  readonly registry: WorkflowRegistry;
  readonly getTokenService: () => TokenService | null;
  readonly managedStartup: boolean;
  initialize(): Promise<void>;
  initializeForRequest(): Promise<void>;
  requireReadyService(): WorkflowService;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Return the registry owned by the currently composed workflow plugin. */
export function getWorkflowRegistry(): WorkflowRegistry | null {
  const owner = getCurrentWorkflowRuntimeOwner();
  return owner?.visible ? owner.registry : null;
}

/** Return the fully initialized workflow service, never a recovering service. */
export function getWorkflowService(): WorkflowService | null {
  const owner = getCurrentWorkflowRuntimeOwner();
  return owner?.visible ? owner.service : null;
}

/** Await workflow attempt drainage before managed database teardown. */
export async function stopWorkflowRuntime(): Promise<void> {
  // Capture one coherent owner before yielding. If another app is composed or
  // stopped meanwhile, this call still drains the owner it observed.
  const owner = getCurrentWorkflowRuntimeOwner();
  await owner?.stop();
}

export function createWorkflowPluginRuntimeOwner(
  config: WorkflowPluginConfig,
  lifecycleOptions: WorkflowPluginLifecycleOptions = {},
): WorkflowPluginRuntimeOwner {
  try {
    defineWorkflowTables(config.db);
  } catch (error) {
    emitPlatformCode(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
      error,
      metadata: { phase: 'schema' },
    });
    throw workflowStartupError();
  }

  const registry = new WorkflowRegistry();
  const getTokenService = config.getTokenService ?? getDefaultTokenService;
  let service: WorkflowService | null = null;
  let startingService: WorkflowService | null = null;
  let initializePromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopped = false;
  let lifecycleStarted = false;
  const disposalByService = new WeakMap<WorkflowService, Promise<void>>();
  const scheduler = createWorkflowSchedulerOwner(() => service);
  const publishedOwner: PublishedWorkflowRuntimeOwner = {
    registry,
    service: null,
    visible: true,
    stop,
  };
  const unpublishOwner = publishWorkflowRuntimeOwner(publishedOwner);

  let registration: Promise<void>;
  try {
    registration = Promise.resolve(config.register?.(registry)).then(() => undefined);
  } catch (error) {
    unpublishOwner();
    emitPlatformCode(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
      error,
      metadata: { phase: 'registration' },
    });
    throw workflowStartupError();
  }
  void registration.catch(() => undefined);

  const clearReadyService = (): void => {
    publishedOwner.service = null;
  };

  const disposeOnce = (target: WorkflowService): Promise<void> => {
    const existing = disposalByService.get(target);
    if (existing) return existing;
    const disposing = Promise.resolve().then(() => target.dispose());
    disposalByService.set(target, disposing);
    return disposing;
  };

  const assertStarting = (): void => {
    if (stopped) {
      throw new WorkflowError(
        'Workflow service stopped during startup',
        'WORKFLOW_STARTUP_FAILED',
        503,
      );
    }
  };

  const initialize = (): Promise<void> => {
    if (initializePromise) return initializePromise;
    if (stopped) {
      return Promise.reject(new WorkflowError(
        'Workflow service is not available',
        'WORKFLOW_NOT_READY',
        503,
      ));
    }

    let created: WorkflowService | null = null;
    let startupPhase = 'registration';
    initializePromise = (async () => {
      await registration;
      startupPhase = 'availability';
      assertStarting();
      startupPhase = 'auth-readiness';
      await config.ensureAuthReady?.();
      assertStarting();

      startupPhase = 'recovery';
      const recoveringService = new WorkflowService(config.db, registry, {
        shutdownGraceMs: config.shutdownGraceMs,
        interactionAuthority: config.interactionAuthority,
        runtimeOwnership: config.runtimeOwnership,
      });
      created = recoveringService;
      startingService = recoveringService;
      let recovered: number;
      let publicationStarted = false;
      let publicationCompleted = false;
      try {
        recovered = await recoveringService.recoverInFlight(() => {
          publicationStarted = true;
          assertStarting();
          service = recoveringService;
          startingService = null;
          publishedOwner.service = recoveringService;

          lifecycleOptions.onServiceCreated?.(recoveringService);
          assertStarting();
          publicationCompleted = true;
        });
      } catch (error) {
        if (publicationStarted && !publicationCompleted) {
          startupPhase = 'publication';
          emitPlatformCode(OBS_CODES.WORKFLOWS_PUBLICATION_FAILED, {
            error,
            metadata: { phase: 'publication' },
          });
        } else {
          emitPlatformCode(OBS_CODES.WORKFLOWS_RECOVERY_FAILED, {
            error,
            metadata: { phase: 'recovery' },
          });
        }
        throw error;
      }

      assertStarting();

      if (recovered > 0) {
        emitPlatformCode(OBS_CODES.WORKFLOWS_RECOVERED, {
          metadata: { recovered },
        });
      }
      emitPlatformCode(OBS_CODES.WORKFLOWS_INITIALIZED);
    })().catch(async (error) => {
      const failedService = service ?? startingService ?? created;
      clearReadyService();
      // Keep the failed owner as the global cleanup target until stop() drains
      // scheduler ownership, while exposing neither its registry nor service.
      publishedOwner.visible = false;
      service = null;
      startingService = null;
      let failure = error;
      if (failedService) {
        try {
          await disposeOnce(failedService);
        } catch (disposeError) {
          failure = new AggregateError(
            [error, disposeError],
            'Workflow startup and cleanup both failed',
          );
        }
      }
      emitPlatformCode(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
        error: failure,
        metadata: { phase: startupPhase },
      });
      throw workflowStartupError();
    });

    // Elysia invokes start hooks synchronously. Keep a rejection handler
    // attached even when no request arrives to await the startup barrier.
    void initializePromise.catch(() => undefined);
    return initializePromise;
  };

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopped = true;
    lifecycleStarted = false;
    stopPromise = (async () => {
      const failures: unknown[] = [];
      try {
        scheduler.stop();
      } catch (error) {
        failures.push(error);
      }
      const current = service ?? startingService;
      clearReadyService();
      unpublishOwner();
      service = null;
      startingService = null;
      if (current) {
        const initialization = initializePromise?.catch(() => undefined);
        const settlements = await Promise.allSettled([
          disposeOnce(current),
          ...(initialization ? [initialization] : []),
        ]);
        for (const settlement of settlements) {
          if (settlement.status === 'rejected') failures.push(settlement.reason);
        }
      }
      throwFailures(failures, 'Workflow shutdown failed');
      emitPlatformCode(OBS_CODES.WORKFLOWS_STOPPED);
    })().catch((error) => {
      emitPlatformCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
        error,
        metadata: { phase: 'stop', plugin: 'workflows' },
      });
      throw error;
    });
    // Bun's Elysia adapter does not await stop hooks. Managed createApp() and
    // explicit callers still receive the rejection through stopWorkflowRuntime.
    void stopPromise.catch(() => undefined);
    return stopPromise;
  }

  try {
    lifecycleOptions.onInitializerCreated?.(initialize);
    lifecycleOptions.onStopCreated?.(stop);
  } catch (error) {
    stopped = true;
    unpublishOwner();
    emitPlatformCode(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
      error,
      metadata: { phase: 'lifecycle-publication' },
    });
    throw workflowStartupError();
  }

  const initializeForRequest = async (): Promise<void> => {
    if (!lifecycleStarted || stopped) {
      throw new WorkflowError(
        'Workflow service is not available',
        'WORKFLOW_NOT_READY',
        503,
      );
    }
    await initialize();
  };

  const requireReadyService = (): WorkflowService => {
    if (!service) {
      throw new WorkflowError(
        'Workflow service is not available',
        'WORKFLOW_NOT_READY',
        503,
      );
    }
    return service;
  };

  const start = async (): Promise<void> => {
    try {
      scheduler.start();
      lifecycleStarted = true;
    } catch (error) {
      emitPlatformCode(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
        error,
        metadata: { phase: 'scheduler' },
      });
      throw workflowStartupError();
    }
    if (!lifecycleOptions.managedStartup) await initialize();
  };

  return {
    registry,
    getTokenService,
    managedStartup: lifecycleOptions.managedStartup === true,
    initialize,
    initializeForRequest,
    requireReadyService,
    start,
    stop,
  };
}

function workflowStartupError(): WorkflowError {
  return new WorkflowError(
    'Workflow service failed to start',
    'WORKFLOW_STARTUP_FAILED',
    503,
  );
}

function throwFailures(failures: unknown[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}
