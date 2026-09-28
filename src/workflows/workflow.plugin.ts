/**
 * workflow.plugin.ts
 *
 * Elysia plugin for durable workflows. Defines tables on start,
 * creates the registry/service, registers scheduler jobs for
 * retry polling and timeout checking, and exposes REST routes.
 *
 * Uses auth middleware (resolve-based) — requireAuth is typed,
 * available directly from context. No casts needed.
 */

import Elysia, { t } from 'elysia';
import {
  createAuthMiddleware,
  type AuthMiddlewareAuthorizationOptions,
} from '../auth/auth.middleware';
import {
  requireRequestServiceDataScope,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import {
  getAuthStore,
  getAuthorizationKernel as getLegacyAuthorizationKernel,
  getAuthorizationRoleService,
  getTokenService,
} from '../auth/auth.plugin';
import { AuthError } from '../auth/types';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ReactiveDB } from '../sync/reactive-db';
import { WorkflowRegistry } from './workflow-registry';
import { WorkflowService } from './workflow-service';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { TokenService } from '../auth/token-service';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_WORKFLOW_REGISTRY,
  ZERO_WORKFLOW_SERVICE,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ensureNullableTenantColumn } from '../runtime/tenant-schema';
import { AuthWorkflowExecutionAuthorityProvider } from './auth-workflow-execution-authority';
import {
  defineWorkflowExecutionAuthorityTables,
  WorkflowExecutionAuthorityStore,
  type WorkflowExecutionServiceProvider,
} from './workflow-execution-authority';
import { canManageWorkflowScope } from './workflow-access';

export interface WorkflowPluginConfig {
  db: ReactiveDB;
  /** App-local runtime used by managed createApp() composition. */
  runtime?: ZeroAppRuntime;
  /** Explicit auth dependency; defaults to the legacy compatibility getter. */
  getTokenService?: () => TokenService | null;
  /** App-local authorization dependencies for tenant-bound instances. */
  authorization?: AuthMiddlewareAuthorizationOptions;
  /** Optional request-equivalent, scope-closed service facade for handlers. */
  executionServices?: WorkflowExecutionServiceProvider;
  /** Explicit lifecycle dependency used by managed createApp() composition. */
  ensureAuthReady?: () => Promise<void>;
  /** Called synchronously so handlers can be registered before listen(). */
  onRegistryCreated?: (registry: WorkflowRegistry) => void;
  /** Managed app-factory seam for completing async startup before publication. */
  onInitializerCreated?: (initialize: () => Promise<void>) => void;
  /** Called after startup creates and recovers the workflow service. */
  onServiceCreated?: (service: WorkflowService) => void;
}

const workflowRegistryProviders = new CompatibilityProviderRegistry<WorkflowRegistry>(
  'Workflow registry',
);
const workflowServiceProviders = new CompatibilityProviderRegistry<WorkflowService>(
  'Workflow service',
);

/** Get the workflow registry (for registering handlers/workflows) */
export function getWorkflowRegistry(): WorkflowRegistry | null {
  return workflowRegistryProviders.get();
}

/** Get the workflow service (for starting/controlling workflows) */
export function getWorkflowService(): WorkflowService | null {
  return workflowServiceProviders.get();
}

/** Define runtime workflow tables with tenant-scoped instance children. */
export function defineWorkflowTables(db: ReactiveDB): void {
  ensureNullableTenantColumn(db, 'workflow_instances');
  ensureNullableTenantColumn(db, 'workflow_steps');
  ensureNullableTenantColumn(db, 'workflow_events');

  // Definitions describe application code and are deliberately global.
  db.defineTable('workflow_definitions', {
    definition_id: 'text primary key',
    name: 'text unique not null',
    version: 'integer not null default 1',
    steps_json: 'text not null',
    input_schema: 'text',
    created_at: 'text not null',
    updated_at: 'text not null',
  });
  db.defineTable('workflow_instances', {
    instance_id: 'text primary key',
    tenant_id: 'text',
    definition_id: 'text not null',
    name: 'text not null',
    status: "text not null default 'pending'",
    current_step: 'integer not null default 0',
    input: 'text',
    output: 'text',
    error: 'text',
    started_by: 'text',
    steps_json: 'text',
    created_at: 'text not null',
    updated_at: 'text not null',
    completed_at: 'text',
  });
  db.defineTable('workflow_steps', {
    step_id: 'text primary key',
    tenant_id: 'text',
    instance_id: 'text not null',
    step_index: 'integer not null',
    step_name: 'text not null',
    status: "text not null default 'pending'",
    input: 'text',
    output: 'text',
    error: 'text',
    retries: 'integer not null default 0',
    max_retries: 'integer not null default 3',
    retry_at: 'text',
    wait_event: 'text',
    timeout_at: 'text',
    started_at: 'text',
    completed_at: 'text',
    created_at: 'text not null',
  });
  db.defineTable('workflow_events', {
    event_id: 'text primary key',
    tenant_id: 'text',
    instance_id: 'text not null',
    event_name: 'text not null',
    payload: 'text',
    sent_by: 'text',
    created_at: 'text not null',
  });
  db.exec('CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant ON workflow_instances(tenant_id)');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_steps_tenant_instance
    ON workflow_steps(tenant_id, instance_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_events_tenant_instance
    ON workflow_events(tenant_id, instance_id)`);
  defineWorkflowExecutionAuthorityTables(db);
}

export function createWorkflowPlugin(config: WorkflowPluginConfig) {
  const owner = {};
  const registry = new WorkflowRegistry();
  let service: WorkflowService | null = null;
  const registryRegistration = workflowRegistryProviders.register(owner, () => registry);
  let serviceRegistration: ReturnType<typeof workflowServiceProviders.register> | null = null;
  let startupPromise: Promise<void> | null = null;
  let cleanedUp = false;
  config.runtime?.set(ZERO_WORKFLOW_REGISTRY, registry);
  config.onRegistryCreated?.(registry);
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (service) config.runtime?.clear(ZERO_WORKFLOW_SERVICE, service);
    config.runtime?.clear(ZERO_WORKFLOW_REGISTRY, registry);
    serviceRegistration?.unregister();
    serviceRegistration = null;
    registryRegistration.unregister();
    service = null;
  };
  config.runtime?.addCleanup(cleanup);
  const getWorkflowTokenService = config.getTokenService
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTH_TOKEN_SERVICE)
      : getTokenService);
  const getAuthorizationKernel = config.authorization?.getAuthorizationKernel
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTHORIZATION_KERNEL)
      : getLegacyAuthorizationKernel);
  const getPropertyStore = config.authorization?.getPropertyStore
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTH_STORE)
      : getAuthStore);
  const getRoleAssignments = config.authorization?.getRoleAssignments
    ?? (config.runtime
      ? () => config.runtime!.get(ZERO_AUTHORIZATION_ROLE_SERVICE)
      : getAuthorizationRoleService);
  const authorization: AuthMiddlewareAuthorizationOptions = {
    ...config.authorization,
    getAuthorizationKernel,
  };
  const requestScope = (access: Parameters<typeof requireRequestServiceDataScope>[0]) =>
    requireRequestServiceDataScope(access, getAuthorizationKernel);

  const initialize = (): Promise<void> => {
    if (startupPromise) return startupPromise;
    if (cleanedUp) {
      return Promise.reject(new Error('[workflows] Cannot start after its app runtime has stopped.'));
    }
    startupPromise = (async () => {
      const db = config.db;
      defineWorkflowTables(db);
      await config.ensureAuthReady?.();
      const { tokens, kernel, properties } = await waitForWorkflowAuthServices({
        getTokens: getWorkflowTokenService,
        getKernel: getAuthorizationKernel,
        getProperties: getPropertyStore,
      });
      const authorityStore = new WorkflowExecutionAuthorityStore(db);
      const authorityProvider = new AuthWorkflowExecutionAuthorityProvider({
        tokens,
        kernel,
        properties,
        roleAssignments: getRoleAssignments(),
        authorityStore,
      });

      const created = new WorkflowService(
        db,
        registry,
        kernel.tenancy.mode,
        {
          authorityStore,
          authorityProvider,
          serviceProvider: config.executionServices ?? null,
        },
      );

      // Recover before publishing the service. A failed recovery must not
      // leave a compatibility/runtime provider that can accept new work.
      const recovered = await created.recoverInFlight();
      if (cleanedUp) {
        throw new Error('[workflows] App runtime stopped during workflow startup.');
      }
      const createdRegistration = workflowServiceProviders.register(owner, () => created);
      try {
        config.runtime?.set(ZERO_WORKFLOW_SERVICE, created);
        config.onServiceCreated?.(created);
        service = created;
        serviceRegistration = createdRegistration;
      } catch (error) {
        config.runtime?.clear(ZERO_WORKFLOW_SERVICE, created);
        createdRegistration.unregister();
        throw error;
      }

      if (recovered > 0) {
        emitPlatformCode(OBS_CODES.WORKFLOWS_RECOVERED, {
          metadata: { recovered },
        });
      }

      emitPlatformCode(OBS_CODES.WORKFLOWS_INITIALIZED);
    })().catch((error) => {
      cleanup();
      throw error;
    });
    // Bun/Elysia does not await onStart. Requests await the same promise and
    // this eager handler prevents an unhandled rejection with no traffic.
    void startupPromise.catch(() => undefined);
    return startupPromise;
  };
  config.onInitializerCreated?.(initialize);

  return new Elysia({ name: 'workflows', prefix: '/workflows' })

    .use(createAuthMiddleware(getWorkflowTokenService, authorization))

    .onStart((lifecycle) => {
      void initialize().catch(async (startupError) => {
        cleanup();
        try {
          await lifecycle.server?.stop(true);
        } catch (transportError) {
          emitPlatformCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
            error: new AggregateError(
              [startupError, transportError],
              '[workflows] Startup failed and the listener could not be stopped.',
            ),
            metadata: { phase: 'start', plugin: 'workflows' },
          });
        }
      });
    })

    .onRequest(() => initialize())

    .onStop(() => {
      cleanup();
      emitPlatformCode(OBS_CODES.WORKFLOWS_STOPPED);
    })

    .derive({ as: 'scoped' }, () => {
      if (!service) {
        throw new Error('Workflow service not available');
      }
      return { workflowService: service, workflowRegistry: registry };
    })

    // ─── Routes ──────────────────────────────────────

    // List workflow instances
    .get('/', ({ access, workflowService, query }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      return workflowService.listInstances({
        status: query.status ?? undefined,
        name: query.name ?? undefined,
        startedBy: canManageWorkflowScope(access, scope) ? undefined : auth.userId,
        scope,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
    }, {
      query: t.Object({
        status: t.Optional(t.String()),
        name: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    })

    // List registered workflow definitions
    .get('/definitions', ({ access, workflowRegistry }) => {
      access.requireUser();
      requestScope(access);
      return workflowRegistry.listWorkflows().map(w => ({
        name: w.name,
        steps: w.steps.map(s => ({
          name: s.name,
          handler: s.handler,
          waitFor: s.waitFor,
          condition: s.condition,
        })),
      }));
    })

    // Start a new workflow
    .post('/', async ({ access, workflowService, body }) => {
      const auth = access.requireUser();
      requestScope(access);
      const instanceId = await workflowService.runAsActor(
        body.name,
        body.input,
        auth,
      );
      return { instanceId };
    }, {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        input: t.Optional(t.Unknown()),
      }),
    })

    // Get workflow instance
    .get('/:id', ({ access, workflowService, params }) => {
      const scope = requestScope(access);
      return requireWorkflowAccess(workflowService, params.id, access, scope);
    })

    // Get workflow steps
    .get('/:id/steps', ({ access, workflowService, params }) => {
      const scope = requestScope(access);
      requireWorkflowAccess(workflowService, params.id, access, scope);
      return workflowService.getSteps(params.id, scope);
    })

    // Get workflow events
    .get('/:id/events', ({ access, workflowService, params }) => {
      const scope = requestScope(access);
      requireWorkflowAccess(workflowService, params.id, access, scope);
      return workflowService.getEvents(params.id, scope);
    })

    // Send event to workflow
    .post('/:id/events', async ({ access, workflowService, params, body }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      requireWorkflowAccess(workflowService, params.id, access, scope);
      const matched = await workflowService.sendEvent(
        params.id,
        body.eventName,
        body.payload,
        auth.userId,
        scope,
      );
      return { ok: true, matched };
    }, {
      body: t.Object({
        eventName: t.String({ minLength: 1 }),
        payload: t.Optional(t.Unknown()),
      }),
    })

    // Cancel workflow
    .post('/:id/cancel', ({ access, workflowService, params }) => {
      const scope = requestScope(access);
      requireWorkflowAccess(workflowService, params.id, access, scope);
      workflowService.cancel(params.id, scope);
      return { ok: true };
    })

    // Pause workflow
    .post('/:id/pause', ({ access, workflowService, params }) => {
      const scope = requestScope(access);
      requireWorkflowAccess(workflowService, params.id, access, scope);
      workflowService.pause(params.id, scope);
      return { ok: true };
    })

    // Resume workflow
    .post('/:id/resume', async ({ access, workflowService, params }) => {
      const scope = requestScope(access);
      requireWorkflowAccess(workflowService, params.id, access, scope);
      await workflowService.resume(params.id, scope);
      return { ok: true };
    });
}

/**
 * HTTP workflow records belong to the identity that started them. Single mode
 * preserves platform-admin compatibility. Multi mode requires live tenant
 * owner/allPermissions/workflows:manage authority to administer peer records;
 * a global platform role never crosses that tenant boundary by itself.
 */
function requireWorkflowAccess(
  workflowService: WorkflowService,
  instanceId: string,
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
): Record<string, unknown> {
  const auth = access.requireUser();
  const instance = workflowService.getInstance(instanceId, scope);
  if (
    !instance ||
    (!canManageWorkflowScope(access, scope) && instance.started_by !== auth.userId)
  ) {
    throw new AuthError('Workflow not found', 'NOT_FOUND', 404);
  }
  return instance;
}

async function waitForWorkflowAuthServices(input: {
  getTokens: () => TokenService | null;
  getKernel: () => NonNullable<ReturnType<NonNullable<
    AuthMiddlewareAuthorizationOptions['getAuthorizationKernel']
  >>> | null;
  getProperties: () => NonNullable<ReturnType<NonNullable<
    AuthMiddlewareAuthorizationOptions['getPropertyStore']
  >>> | null;
}): Promise<{
  tokens: TokenService;
  kernel: NonNullable<ReturnType<typeof input.getKernel>>;
  properties: NonNullable<ReturnType<typeof input.getProperties>>;
}> {
  const deadline = Date.now() + 10_000;
  do {
    const tokens = input.getTokens();
    const kernel = input.getKernel();
    const properties = input.getProperties();
    if (tokens && kernel && properties) return { tokens, kernel, properties };
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  } while (Date.now() < deadline);
  throw new Error(
    '[workflows] Auth services must be initialized before workflow startup.',
  );
}
