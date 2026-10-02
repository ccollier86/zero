/** Authenticated HTTP boundary for durable workflows. */

import Elysia, { t } from 'elysia';
import {
  createScopedAuthMiddleware,
  type AuthMiddlewareAuthorizationOptions,
} from '../auth/auth.middleware';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import { effectiveServiceDataRoles } from '../auth/service-data-authority';
import {
  requireRequestServiceDataScope,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import type { TokenService } from '../auth/token-service';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import { AuthError } from '../auth/types';
import { OBS_CODES } from '../observability/codes';
import { getSafeRequestPath } from '../observability/safe-request-path';
import { WorkflowDefinitionManager } from './workflow-definition-manager';
import {
  canManageWorkflowScope,
  workflowAccessPrincipal,
} from './workflow-access';
import { workflowDefinitionScopeFromServiceDataScope } from './workflow-definition-scope';
import { MAX_WORKFLOW_DEFINITION_NAME_LENGTH } from './workflow-definition-identifiers';
import { WorkflowError, workflowNotFound } from './workflow-error';
import {
  toPublicWorkflowEvent,
  toPublicWorkflowInstance,
  toPublicWorkflowStep,
} from './workflow-public-record';
import type { WorkflowRegistry } from './workflow-registry';
import { getWorkflowGraphRuntime, type WorkflowService } from './workflow-service';
import type { WorkflowStatus } from './types';
import { MAX_WORKFLOW_EVENT_NAME_LENGTH } from './workflow-runtime-store';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

export interface WorkflowHttpPluginDependencies {
  registry: WorkflowRegistry;
  getTokenService: () => TokenService | null;
  authorization?: AuthMiddlewareAuthorizationOptions;
  initializeForRequest: () => Promise<void>;
  requireReadyService: () => WorkflowService;
  observability?: WorkflowObservability;
}

export function createWorkflowHttpPlugin(
  dependencies: WorkflowHttpPluginDependencies,
) {
  const {
    registry,
    getTokenService,
    initializeForRequest,
    requireReadyService,
    authorization,
  } = dependencies;
  const observability = dependencies.observability ?? createWorkflowObservability();
  const getAuthorizationKernel = authorization?.getAuthorizationKernel ?? (() => null);
  const requestScope = (access: RequestAuthorizationAccess): ServiceDataScope =>
    requireRequestServiceDataScope(access, getAuthorizationKernel);

  return new Elysia({ name: 'workflow-http', prefix: '/workflows' })
    // The scoped middleware owns readiness and auth in one resolve stage, so
    // the first request cannot snapshot an unavailable token service.
    .use(createScopedAuthMiddleware(
      'workflow-auth-middleware',
      getTokenService,
      initializeForRequest,
      authorization,
    ))
    .onError(({ code, error, request, set }) => {
      if (error instanceof WorkflowError) {
        set.status = error.status;
        if (error.status >= 500) {
          emitWorkflowRequestFailure(observability, error, request, error.status);
        }
        return {
          error: error.status >= 500 ? 'Workflow request failed' : error.message,
          code: error.code,
          ...(error.retryable ? { retryable: true } : {}),
        };
      }
      if (error instanceof AuthError) {
        set.status = error.status;
        if (error.status >= 500) {
          emitWorkflowRequestFailure(observability, error, request, error.status);
        }
        return { error: getPublicAuthErrorMessage(error), code: error.code };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return {
          error: 'Invalid workflow request',
          code: 'WORKFLOW_REQUEST_INVALID',
        };
      }
      if (code === 'PARSE') {
        set.status = 400;
        return {
          error: 'Invalid workflow request body',
          code: 'WORKFLOW_REQUEST_PARSE_FAILED',
        };
      }
      if (code === 'NOT_FOUND') {
        set.status = 404;
        return {
          error: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        };
      }

      set.status = 500;
      emitWorkflowRequestFailure(observability, error, request, 500);
      return {
        error: 'Workflow request failed',
        code: 'WORKFLOW_INTERNAL_ERROR',
      };
    })
    .get('/', ({ access, query }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      return workflowService.listInstances({
        status: query.status ?? undefined,
        name: query.name?.trim() || undefined,
        startedBy: canManageWorkflowScope(access, scope) ? undefined : auth.userId,
        scope,
        limit: query.limit,
      }).map(toPublicWorkflowInstance);
    }, {
      query: t.Object({
        status: t.Optional(workflowStatusSchema()),
        name: t.Optional(nonBlankString()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })),
      }),
    })
    .get('/definitions', ({ access }) => {
      access.requireUser();
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const manager = new WorkflowDefinitionManager(
        registry,
        getWorkflowGraphRuntime(workflowService).versions,
        workflowDefinitionScopeFromServiceDataScope(scope),
      );
      return manager.listVisible(workflowAccessPrincipal(access, scope)).map((summary) => ({
        name: summary.name,
        steps: summary.steps,
      }));
    })
    .post('/', async ({ access, body }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const name = body.name.trim();
      const instanceId = await workflowService.runAsActor(
        name,
        body.input,
        auth,
        { ...(body.version === undefined ? {} : { version: body.version }) },
      );
      return { instanceId };
    }, {
      body: t.Object({
        name: t.String({
          minLength: 1,
          maxLength: MAX_WORKFLOW_DEFINITION_NAME_LENGTH,
          pattern: '\\S',
        }),
        input: t.Optional(t.Unknown()),
        version: t.Optional(t.Integer({ minimum: 1 })),
      }),
    })
    .get('/:id', ({ access, params }) => {
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      return toPublicWorkflowInstance(
        requireWorkflowAccess(workflowService, params.id.trim(), access, scope),
      );
    }, idParams())
    .get('/:id/steps', ({ access, params }) => {
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      const instance = requireWorkflowAccess(workflowService, instanceId, access, scope);
      return workflowService.getSteps(instanceId, scope)
        .map((step) => toPublicWorkflowStep(
          step,
          instance.steps_json,
          instance,
        ));
    }, idParams())
    .get('/:id/events', ({ access, params }) => {
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      const instance = requireWorkflowAccess(workflowService, instanceId, access, scope);
      return workflowService.getEvents(instanceId, scope)
        .map((event) => toPublicWorkflowEvent(event, instance));
    }, idParams())
    .get('/:id/topology', ({ access, params }) => {
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, access, scope);
      const topology = workflowService.getPublicTopology(instanceId, scope);
      if (!topology) throw workflowNotFound();
      return topology;
    }, idParams())
    .get('/:id/interactions', ({ access, params }) => {
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, access, scope);
      return getWorkflowGraphRuntime(workflowService).interactions.listByInstance(instanceId);
    }, idParams())
    .post('/:id/interactions/:interactionId/responses', async ({
      access,
      params,
      body,
    }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      if (!workflowService.getInstance(instanceId, scope)) throw workflowNotFound();
      const graph = getWorkflowGraphRuntime(workflowService);
      const interaction = graph.interactions.get(params.interactionId.trim());
      if (!interaction || interaction.instanceId !== instanceId) throw workflowNotFound();
      const assertCurrentResponder = workflowService.captureActorAuthorityAssertion(auth);
      return graph.submitInteraction({
        interactionId: interaction.interactionId,
        submissionId: body.submissionId.trim(),
        actor: {
          actorId: auth.userId,
          tenantId: scope.tenantId,
          roles: effectiveServiceDataRoles(access, scope),
          claims: { email: auth.email },
        },
        payload: body.payload,
        channel: body.channel?.trim() || 'web',
        assertCurrentResponder,
      });
    }, {
      params: t.Object({
        id: nonBlankString(),
        interactionId: nonBlankString(),
      }),
      body: t.Object({
        submissionId: nonBlankString(),
        payload: t.Unknown(),
        channel: t.Optional(nonBlankString()),
      }),
    })
    .post('/:id/events', async ({ access, params, body }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, access, scope);
      const actorFence = workflowService.captureActorAuthorityFence(auth);
      const matched = await workflowService.sendEvent(
        instanceId,
        body.eventName.trim(),
        body.payload,
        auth.userId,
        scope,
        {
          actorId: auth.userId,
          tenantId: scope.tenantId,
          roles: effectiveServiceDataRoles(access, scope),
          claims: { email: auth.email },
        },
        {
          assertCurrentAuthority: actorFence.assertCurrentAuthority,
          actorAuthority: actorFence.authority,
        },
      );
      return { ok: true, matched };
    }, {
      params: idParams().params,
      body: t.Object({
        eventName: t.String({
          minLength: 1,
          maxLength: MAX_WORKFLOW_EVENT_NAME_LENGTH,
          pattern: '\\S',
        }),
        payload: t.Optional(t.Unknown()),
      }),
    })
    .post('/:id/cancel', async ({ access, params }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, access, scope);
      await workflowService.cancel(instanceId, scope, {
        assertCurrentAuthority: workflowService.captureActorAuthorityAssertion(auth),
      });
      return { ok: true };
    }, idParams())
    .post('/:id/pause', async ({ access, params }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, access, scope);
      await workflowService.pause(instanceId, scope, {
        assertCurrentAuthority: workflowService.captureActorAuthorityAssertion(auth),
      });
      return { ok: true };
    }, idParams())
    .post('/:id/resume', async ({ access, params }) => {
      const auth = access.requireUser();
      const scope = requestScope(access);
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, access, scope);
      await workflowService.resume(instanceId, scope, {
        assertCurrentAuthority: workflowService.captureActorAuthorityAssertion(auth),
      });
      return { ok: true };
    }, idParams());
}

function idParams() {
  return {
    params: t.Object({ id: nonBlankString() }),
  };
}

function requireWorkflowAccess(
  workflowService: WorkflowService,
  instanceId: string,
  access: RequestAuthorizationAccess,
  scope: ServiceDataScope,
): NonNullable<ReturnType<WorkflowService['getInstance']>> {
  const auth = access.requireUser();
  const instance = workflowService.getInstance(instanceId, scope);
  if (!instance
    || (!canManageWorkflowScope(access, scope) && instance.started_by !== auth.userId)) {
    throw workflowNotFound();
  }
  return instance;
}

function emitWorkflowRequestFailure(
  observability: WorkflowObservability,
  error: unknown,
  request: Request,
  status: number,
): void {
  observability.emitNow(OBS_CODES.APP_REQUEST_FAILED, {
    error,
    metadata: {
      method: request.method,
      path: getSafeRequestPath(request),
      status,
    },
  });
}

function nonBlankString() {
  return t.String({ minLength: 1, pattern: '\\S' });
}

function workflowStatusSchema() {
  const status: Record<WorkflowStatus, ReturnType<typeof t.Literal>> = {
    pending: t.Literal('pending'),
    running: t.Literal('running'),
    completed: t.Literal('completed'),
    failed: t.Literal('failed'),
    cancelled: t.Literal('cancelled'),
    paused: t.Literal('paused'),
  };
  return t.Union(Object.values(status));
}
