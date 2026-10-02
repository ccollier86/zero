/**
 * App-local lifecycle owner for the workflow registry, service, and jobs.
 *
 * Registration finishes before recovery, publication happens only after
 * recovery, and teardown drains execution before its database/runtime owner.
 */

import type { AuthMiddlewareAuthorizationOptions } from '../auth/auth.middleware';
import {
  getAuthRequestCredentialResolver,
  getAuthStore,
  getAuthorizationKernel,
  getAuthorizationRoleService,
  getTokenService as getDefaultTokenService,
} from '../auth/auth.plugin';
import type { TokenService } from '../auth/token-service';
import { OBS_CODES } from '../observability/codes';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_SCHEDULER_SERVICE,
  ZERO_WORKFLOW_REGISTRY,
  ZERO_WORKFLOW_SERVICE,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { getScheduler, type SchedulerService } from '../scheduler';
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthWorkflowExecutionAuthorityProvider } from './auth-workflow-execution-authority';
import {
  WorkflowExecutionAuthorityStore,
  type WorkflowExecutionServiceProvider,
} from './workflow-execution-authority';
import { WorkflowError, formatWorkflowError } from './workflow-error';
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
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

export interface WorkflowPluginConfig {
  db: ReactiveDB;
  /** App-local owner used by managed createApp() composition. */
  runtime?: ZeroAppRuntime;
  /** Concrete app scheduler. Managed apps should always inject this. */
  scheduler?: SchedulerService;
  /** Register all handlers and definitions before recovery begins. */
  register?: (registry: WorkflowRegistry) => void | Promise<void>;
  /** Compatibility synchronous registration hook. Prefer register. */
  onRegistryCreated?: (registry: WorkflowRegistry) => void;
  /** Explicit token dependency for app-local composition and tests. */
  getTokenService?: () => TokenService | null;
  /** Guardian request authorization dependencies. */
  authorization?: AuthMiddlewareAuthorizationOptions;
  /** Managed-app readiness boundary run before auth capture and recovery. */
  ensureAuthReady?: () => Promise<void>;
  /** Request-equivalent, scope-closed service facade exposed as ctx.zero. */
  executionServices?: WorkflowExecutionServiceProvider;
  /** Maximum wait for cooperative handler cancellation during shutdown. */
  shutdownGraceMs?: number;
  /** Guardian/app policy adapter for graph interaction responders. */
  interactionAuthority?: WorkflowInteractionAuthority;
  /** Managed app-factory seam for awaiting startup before publication. */
  onInitializerCreated?: (initialize: () => Promise<void>) => void;
  /** Observe the recovered, published service owned by this app. */
  onServiceCreated?: (service: WorkflowService) => void;
}

export type WorkflowPluginLifecycleOptions =
  | {
      managedStartup?: false;
      onInitializerCreated?: (initialize: () => Promise<void>) => void;
      onStopCreated?: (stop: () => Promise<void>) => void;
      onServiceCreated?: (service: WorkflowService) => void;
    }
  | {
      managedStartup: true;
      onInitializerCreated: (initialize: () => Promise<void>) => void;
      onStopCreated?: (stop: () => Promise<void>) => void;
      onServiceCreated?: (service: WorkflowService) => void;
    };

export interface WorkflowPluginRuntimeOwner {
  readonly registry: WorkflowRegistry;
  readonly observability: WorkflowObservability;
  readonly getTokenService: () => TokenService | null;
  readonly authorization: AuthMiddlewareAuthorizationOptions;
  readonly managedStartup: boolean;
  initialize(): Promise<void>;
  initializeForRequest(): Promise<void>;
  requireReadyService(): WorkflowService;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Compatibility getter for the most recently composed live owner. */
export function getWorkflowRegistry(): WorkflowRegistry | null {
  const owner = getCurrentWorkflowRuntimeOwner();
  return owner?.visible ? owner.registry : null;
}

/** Compatibility getter; managed code should use ZERO_WORKFLOW_SERVICE. */
export function getWorkflowService(): WorkflowService | null {
  const owner = getCurrentWorkflowRuntimeOwner();
  return owner?.visible ? owner.service : null;
}

/** Drain the compatibility-visible workflow owner, if one exists. */
export async function stopWorkflowRuntime(): Promise<void> {
  const owner = getCurrentWorkflowRuntimeOwner();
  await owner?.stop();
}

export function createWorkflowPluginRuntimeOwner(
  config: WorkflowPluginConfig,
  lifecycleOptions: WorkflowPluginLifecycleOptions = {},
): WorkflowPluginRuntimeOwner {
  const observability = createWorkflowObservability(config.db, config.runtime);
  try {
    defineWorkflowTables(config.db);
  } catch (error) {
    observability.emitNow(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
      error,
      metadata: { phase: 'schema' },
    });
    throw workflowStartupError(error);
  }

  const registry = new WorkflowRegistry();
  const getWorkflowTokenService = config.getTokenService
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTH_TOKEN_SERVICE)
      : getDefaultTokenService);
  const getKernel = config.authorization?.getAuthorizationKernel
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTHORIZATION_KERNEL)
      : getAuthorizationKernel);
  const getProperties = config.authorization?.getPropertyStore
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTH_STORE)
      : getAuthStore);
  const getRoleAssignments = config.authorization?.getRoleAssignments
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTHORIZATION_ROLE_SERVICE)
      : getAuthorizationRoleService);
  const getRequestCredentialResolver =
    config.authorization?.getRequestCredentialResolver
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER)
      : getAuthRequestCredentialResolver);
  const authorization: AuthMiddlewareAuthorizationOptions = {
    ...config.authorization,
    getAuthorizationKernel: getKernel,
    getPropertyStore: getProperties,
    getRoleAssignments,
    getRequestCredentialResolver,
  };

  let service: WorkflowService | null = null;
  let startingService: WorkflowService | null = null;
  let lostService: WorkflowService | null = null;
  let initializePromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopped = false;
  let lifecycleStarted = false;
  let runtimeCleanupRegistration: (() => void) | null = null;
  const disposalByService = new WeakMap<WorkflowService, Promise<void>>();
  const scheduler = createWorkflowSchedulerOwner(
    () => service,
    () => config.scheduler
      ?? config.runtime?.get(ZERO_SCHEDULER_SERVICE)
      ?? getScheduler(),
  );
  const publishedOwner: PublishedWorkflowRuntimeOwner = {
    registry,
    service: null,
    visible: true,
    stop,
  };
  const unpublishOwner = publishWorkflowRuntimeOwner(publishedOwner);
  config.runtime?.set(ZERO_WORKFLOW_REGISTRY, registry);

  const retireLostService = (target: WorkflowService, error: WorkflowError): void => {
    if (service !== target && startingService !== target) return;
    if (service === target) service = null;
    if (startingService === target) startingService = null;
    lostService = target;
    lifecycleStarted = false;
    if (publishedOwner.service === target) publishedOwner.service = null;
    config.runtime?.clear(ZERO_WORKFLOW_SERVICE, target);
    try {
      // The scheduler owner unregisters only the jobs it installed on its
      // captured scheduler, so a separately composed replacement is untouched.
      scheduler.stop();
    } catch (cleanupError) {
      observability.emitNow(OBS_CODES.APP_LIFECYCLE_FAILED, {
        error: cleanupError,
        metadata: {
          phase: 'ownership-loss',
          plugin: 'workflows',
          cause: error.code,
        },
      });
    }
  };

  const hideOwner = (expectedService: WorkflowService | null = null): void => {
    publishedOwner.visible = false;
    publishedOwner.service = null;
    if (expectedService) {
      config.runtime?.clear(ZERO_WORKFLOW_SERVICE, expectedService);
    }
    config.runtime?.clear(ZERO_WORKFLOW_REGISTRY, registry);
    unpublishOwner();
  };

  let registration: Promise<void>;
  try {
    config.onRegistryCreated?.(registry);
    registration = Promise.resolve(config.register?.(registry)).then(() => undefined);
  } catch (error) {
    hideOwner();
    observability.emitNow(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
      error,
      metadata: { phase: 'registration' },
    });
    throw workflowStartupError(error);
  }
  void registration.catch(() => undefined);

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
      assertStarting();
      startupPhase = 'auth-readiness';
      await config.ensureAuthReady?.();
      assertStarting();

      const tokens = getWorkflowTokenService();
      const kernel = getKernel();
      const properties = getProperties();
      const authorityStore = new WorkflowExecutionAuthorityStore(config.db);
      const authorityProvider = tokens && kernel && properties
        ? new AuthWorkflowExecutionAuthorityProvider({
            tokens,
            requestCredentials: getRequestCredentialResolver(),
            kernel,
            properties,
            roleAssignments: getRoleAssignments(),
            authorityStore,
          })
        : null;
      if (config.runtime && !authorityProvider) {
        throw new WorkflowError(
          'Guardian workflow authority services are not available',
          'WORKFLOW_STARTUP_FAILED',
          503,
        );
      }

      startupPhase = 'recovery';
      let recoveringService!: WorkflowService;
      recoveringService = new WorkflowService(config.db, registry, {
        tenancyMode: kernel?.tenancy.mode ?? 'single',
        shutdownGraceMs: config.shutdownGraceMs,
        interactionAuthority: config.interactionAuthority,
        authorityStore,
        authorityProvider,
        serviceProvider: config.executionServices ?? null,
        observability,
        onRuntimeOwnershipLost: (error) => retireLostService(recoveringService, error),
      });
      created = recoveringService;
      startingService = recoveringService;
      let publicationStarted = false;
      let publicationCompleted = false;
      let recovered: number;
      try {
        recovered = await recoveringService.recoverInFlight(() => {
          publicationStarted = true;
          assertStarting();
          service = recoveringService;
          startingService = null;
          publishedOwner.service = recoveringService;
          config.runtime?.set(ZERO_WORKFLOW_SERVICE, recoveringService);
          try {
            config.onServiceCreated?.(recoveringService);
            lifecycleOptions.onServiceCreated?.(recoveringService);
            assertStarting();
            publicationCompleted = true;
          } catch (error) {
            config.runtime?.clear(ZERO_WORKFLOW_SERVICE, recoveringService);
            publishedOwner.service = null;
            service = null;
            startingService = recoveringService;
            throw error;
          }
        });
      } catch (error) {
        observability.emitNow(
          publicationStarted && !publicationCompleted
            ? OBS_CODES.WORKFLOWS_PUBLICATION_FAILED
            : OBS_CODES.WORKFLOWS_RECOVERY_FAILED,
          { error, metadata: { phase: publicationStarted ? 'publication' : 'recovery' } },
        );
        if (publicationStarted && !publicationCompleted) startupPhase = 'publication';
        throw error;
      }
      assertStarting();
      if (recovered > 0) {
        observability.emitNow(OBS_CODES.WORKFLOWS_RECOVERED, { metadata: { recovered } });
      }
      observability.emitNow(OBS_CODES.WORKFLOWS_INITIALIZED);
    })().catch(async (error) => {
      const failedService = service ?? startingService ?? created;
      service = null;
      startingService = null;
      lifecycleStarted = false;
      hideOwner(failedService);
      const failures: unknown[] = [error];
      if (failedService) {
        try {
          await disposeOnce(failedService);
        } catch (disposeError) {
          failures.push(disposeError);
        }
        if (lostService === failedService) lostService = null;
      }
      // A failed managed initialization unpublishes this owner, so the
      // process-wide compatibility stop helper can no longer find it. Release
      // the jobs here rather than waiting for an eventual Elysia stop hook.
      try {
        scheduler.stop();
      } catch (schedulerError) {
        failures.push(schedulerError);
      }
      const failure = failures.length === 1
        ? failures[0]
        : new AggregateError(failures, 'Workflow startup and cleanup both failed');
      observability.emitNow(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
        error: failure,
        metadata: { phase: startupPhase },
      });
      throw workflowStartupError(failure);
    });
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
      const current = service ?? startingService ?? lostService;
      service = null;
      startingService = null;
      lostService = null;
      hideOwner(current);
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
      runtimeCleanupRegistration?.();
      runtimeCleanupRegistration = null;
      throwFailures(failures, 'Workflow shutdown failed');
      observability.emitNow(OBS_CODES.WORKFLOWS_STOPPED);
    })().catch((error) => {
      observability.emitNow(OBS_CODES.APP_LIFECYCLE_FAILED, {
        error,
        metadata: { phase: 'stop', plugin: 'workflows' },
      });
      throw error;
    });
    void stopPromise.catch(() => undefined);
    return stopPromise;
  }

  try {
    config.onInitializerCreated?.(initialize);
    lifecycleOptions.onInitializerCreated?.(initialize);
    lifecycleOptions.onStopCreated?.(stop);
    runtimeCleanupRegistration = config.runtime?.addCleanup(stop) ?? null;
  } catch (error) {
    stopped = true;
    hideOwner();
    observability.emitNow(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
      error,
      metadata: { phase: 'lifecycle-publication' },
    });
    throw workflowStartupError(error);
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
      observability.emitNow(OBS_CODES.WORKFLOWS_STARTUP_FAILED, {
        error,
        metadata: { phase: 'scheduler' },
      });
      throw workflowStartupError(error);
    }
    if (!lifecycleOptions.managedStartup) await initialize();
  };

  return {
    registry,
    observability,
    getTokenService: getWorkflowTokenService,
    authorization,
    managedStartup: lifecycleOptions.managedStartup === true,
    initialize,
    initializeForRequest,
    requireReadyService,
    start,
    stop,
  };
}

function workflowStartupError(error?: unknown): WorkflowError {
  if (error instanceof WorkflowError
    && (error.code === 'WORKFLOW_STARTUP_FAILED'
      || error.code === 'WORKFLOW_NOT_READY'
      || error.code === 'WORKFLOW_RUNTIME_OWNED'
      || error.code === 'WORKFLOW_RUNTIME_LEASE_LOST')) {
    return error;
  }
  const detail = error === undefined ? '' : `: ${formatWorkflowError(error)}`;
  return new WorkflowError(
    `Workflow service failed to start${detail}`,
    'WORKFLOW_STARTUP_FAILED',
    503,
  );
}

function throwFailures(failures: unknown[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}
