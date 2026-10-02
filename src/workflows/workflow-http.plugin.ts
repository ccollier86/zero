/** Authenticated HTTP boundary for durable workflows. */

import Elysia, { t } from 'elysia';
import { createScopedAuthMiddleware } from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import { AuthError } from '../auth/types';
import { OBS_CODES } from '../observability/codes';
import { getSafeRequestPath } from '../observability/safe-request-path';
import { emitPlatformCode } from '../observability/sink';
import { WorkflowDefinitionManager } from './workflow-definition-manager';
import { WorkflowError, workflowNotFound } from './workflow-error';
import {
  toPublicWorkflowEvent,
  toPublicWorkflowInstance,
  toPublicWorkflowStep,
} from './workflow-public-record';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowService } from './workflow-service';
import type { WorkflowStatus } from './types';
import { MAX_WORKFLOW_EVENT_NAME_LENGTH } from './workflow-runtime-store';

export interface WorkflowHttpPluginDependencies {
  registry: WorkflowRegistry;
  getTokenService: () => TokenService | null;
  initializeForRequest: () => Promise<void>;
  requireReadyService: () => WorkflowService;
}

export function createWorkflowHttpPlugin(
  dependencies: WorkflowHttpPluginDependencies,
) {
  const {
    registry,
    getTokenService,
    initializeForRequest,
    requireReadyService,
  } = dependencies;

  return new Elysia({ name: 'workflow-http', prefix: '/workflows' })
    // The scoped middleware owns readiness and auth in one resolve stage, so
    // the first request cannot snapshot an unavailable token service.
    .use(createScopedAuthMiddleware(
      'workflow-auth-middleware',
      getTokenService,
      initializeForRequest,
    ))
    .onError(({ code, error, request, set }) => {
      if (error instanceof WorkflowError) {
        set.status = error.status;
        if (error.status >= 500) emitWorkflowRequestFailure(error, request, error.status);
        return {
          error: error.status >= 500 ? 'Workflow request failed' : error.message,
          code: error.code,
          ...(error.retryable ? { retryable: true } : {}),
        };
      }
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
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
      emitWorkflowRequestFailure(error, request, 500);
      return {
        error: 'Workflow request failed',
        code: 'WORKFLOW_INTERNAL_ERROR',
      };
    })
    .get('/', ({ requireAuth, query }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      return workflowService.listInstances({
        status: query.status ?? undefined,
        name: query.name?.trim() || undefined,
        startedBy: auth.role === 'admin' ? undefined : auth.userId,
        limit: query.limit,
      }).map(toPublicWorkflowInstance);
    }, {
      query: t.Object({
        status: t.Optional(workflowStatusSchema()),
        name: t.Optional(nonBlankString()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })),
      }),
    })
    .get('/definitions', ({ requireAuth }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const manager = new WorkflowDefinitionManager(
        registry,
        workflowService.getGraphRuntime().versions,
      );
      return manager.listVisible(auth).map((summary) => ({
        name: summary.name,
        steps: summary.steps,
      }));
    })
    .post('/', async ({ requireAuth, body }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const name = body.name.trim();
      const manager = new WorkflowDefinitionManager(
        registry,
        workflowService.getGraphRuntime().versions,
      );
      manager.assertCanStart(name, body.version, auth);
      const instanceId = await workflowService.start(
        name,
        body.input,
        auth.userId,
        { ...(body.version === undefined ? {} : { version: body.version }) },
      );
      return { instanceId };
    }, {
      body: t.Object({
        name: nonBlankString(),
        input: t.Optional(t.Unknown()),
        version: t.Optional(t.Integer({ minimum: 1 })),
      }),
    })
    .get('/:id', ({ requireAuth, params }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      return toPublicWorkflowInstance(
        requireWorkflowAccess(workflowService, params.id.trim(), auth),
      );
    }, idParams())
    .get('/:id/steps', ({ requireAuth, params }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      const instance = requireWorkflowAccess(workflowService, instanceId, auth);
      return workflowService.getSteps(instanceId)
        .map((step) => toPublicWorkflowStep(
          step,
          instance.steps_json,
          instance.graph_json,
        ));
    }, idParams())
    .get('/:id/events', ({ requireAuth, params }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      const instance = requireWorkflowAccess(workflowService, instanceId, auth);
      return workflowService.getEvents(instanceId)
        .map((event) => toPublicWorkflowEvent(event, instance.graph_json));
    }, idParams())
    .get('/:id/interactions', ({ requireAuth, params }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, auth);
      return workflowService.getGraphRuntime().interactions.listByInstance(instanceId);
    }, idParams())
    .post('/:id/interactions/:interactionId/responses', async ({
      requireAuth,
      params,
      body,
    }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      if (!workflowService.getInstance(instanceId)) throw workflowNotFound();
      const graph = workflowService.getGraphRuntime();
      const interaction = graph.interactions.get(params.interactionId.trim());
      if (!interaction || interaction.instanceId !== instanceId) throw workflowNotFound();
      return graph.submitInteraction({
        interactionId: interaction.interactionId,
        submissionId: body.submissionId.trim(),
        actor: {
          actorId: auth.userId,
          roles: [auth.role],
          claims: { email: auth.email },
        },
        payload: body.payload,
        channel: body.channel?.trim() || 'web',
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
    .post('/:id/events', async ({ requireAuth, params, body }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, auth);
      const matched = await workflowService.sendEvent(
        instanceId,
        body.eventName.trim(),
        body.payload,
        auth.userId,
        {
          actorId: auth.userId,
          roles: [auth.role],
          claims: { email: auth.email },
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
    .post('/:id/cancel', async ({ requireAuth, params }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, auth);
      await workflowService.cancel(instanceId);
      return { ok: true };
    }, idParams())
    .post('/:id/pause', async ({ requireAuth, params }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, auth);
      await workflowService.pause(instanceId);
      return { ok: true };
    }, idParams())
    .post('/:id/resume', async ({ requireAuth, params }) => {
      const auth = requireAuth();
      const workflowService = requireReadyService();
      const instanceId = params.id.trim();
      requireWorkflowAccess(workflowService, instanceId, auth);
      await workflowService.resume(instanceId);
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
  auth: { userId: string; role: string },
): NonNullable<ReturnType<WorkflowService['getInstance']>> {
  const instance = workflowService.getInstance(instanceId);
  if (!instance || (auth.role !== 'admin' && instance.started_by !== auth.userId)) {
    throw workflowNotFound();
  }
  return instance;
}

function emitWorkflowRequestFailure(
  error: unknown,
  request: Request,
  status: number,
): void {
  emitPlatformCode(OBS_CODES.APP_REQUEST_FAILED, {
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
