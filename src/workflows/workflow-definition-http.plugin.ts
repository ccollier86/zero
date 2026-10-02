/** Platform-administrator HTTP API for database-authored workflow versions. */

import Elysia, { t } from 'elysia';
import { createScopedAuthMiddleware } from '../auth/auth.middleware';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import {
  requireRequestServiceDataScope,
} from '../auth/service-data-scope';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import { AuthError } from '../auth/types';
import { OBS_CODES } from '../observability/codes';
import { getSafeRequestPath } from '../observability/safe-request-path';
import type { WorkflowDefinitionAccessPolicy } from './types';
import { canManageWorkflowScope } from './workflow-access';
import { WorkflowDefinitionManager } from './workflow-definition-manager';
import { workflowDefinitionScopeFromServiceDataScope } from './workflow-definition-scope';
import { MAX_WORKFLOW_DEFINITION_NAME_LENGTH } from './workflow-definition-identifiers';
import { WorkflowError } from './workflow-error';
import type { WorkflowGraphIR } from './workflow-ir';
import type { WorkflowHttpPluginDependencies } from './workflow-http.plugin';
import { getWorkflowGraphRuntime } from './workflow-service';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

/** Scope-bound management API for database-authored workflow versions. */
export function createWorkflowDefinitionAdminHttpPlugin(
  dependencies: WorkflowHttpPluginDependencies,
) {
  const observability = dependencies.observability ?? createWorkflowObservability();
  return new Elysia({
    name: 'workflow-definition-admin-http',
    prefix: '/workflows/admin/definitions',
  })
    .use(createScopedAuthMiddleware(
      'workflow-definition-admin-auth',
      dependencies.getTokenService,
      dependencies.initializeForRequest,
      dependencies.authorization,
    ))
    .onError(({ code, error, request, set }) => {
      if (error instanceof WorkflowError) {
        set.status = error.status;
        if (error.status >= 500) emitFailure(observability, error, request, error.status);
        return {
          error: error.status >= 500
            ? 'Workflow definition request failed'
            : error.message,
          code: error.code,
          ...(error.retryable ? { retryable: true } : {}),
        };
      }
      if (error instanceof AuthError) {
        set.status = error.status;
        if (error.status >= 500) emitFailure(observability, error, request, error.status);
        return { error: getPublicAuthErrorMessage(error), code: error.code };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Invalid workflow definition request', code: 'WORKFLOW_REQUEST_INVALID' };
      }
      if (code === 'PARSE') {
        set.status = 400;
        return { error: 'Invalid workflow definition request body', code: 'WORKFLOW_REQUEST_PARSE_FAILED' };
      }
      if (code === 'NOT_FOUND') {
        set.status = 404;
        return { error: 'Workflow definition not found', code: 'WORKFLOW_NOT_FOUND' };
      }
      set.status = 500;
      emitFailure(observability, error, request, 500);
      return { error: 'Workflow definition request failed', code: 'WORKFLOW_INTERNAL_ERROR' };
    })
    .get('/', ({ access }) => {
      const context = managementContext(dependencies, access);
      return context.manager.listAdmin();
    })
    .get('/activities', ({ access }) => {
      const context = managementContext(dependencies, access);
      return context.manager.listActivities();
    })
    .get('/:definitionId/versions', ({ access, params }) => {
      const context = managementContext(dependencies, access);
      return context.manager.listVersions(params.definitionId.trim())
        .map(publicVersion);
    }, definitionParams())
    .get('/:definitionId/versions/:versionId', ({ access, params }) => {
      const context = managementContext(dependencies, access);
      return editableVersion(context.manager.getVersion(
        params.definitionId.trim(),
        params.versionId.trim(),
      ));
    }, versionParams())
    .post('/publish', ({ access, body }) => {
      const context = managementContext(dependencies, access);
      const result = context.manager.publish({
        name: body.name.trim(),
        graph: body.graph as WorkflowGraphIR,
        ...(body.inputSchema === undefined ? {} : { inputSchema: body.inputSchema }),
        ...(body.access === undefined
          ? {}
          : { access: body.access as WorkflowDefinitionAccessPolicy }),
        ...(body.version === undefined ? {} : { version: body.version }),
        ...(body.activate === undefined ? {} : { activate: body.activate }),
        ...(body.expectedActiveVersionId === undefined
          ? {}
          : { expectedActiveVersionId: body.expectedActiveVersionId }),
      }, context.actorId, context.assertCurrentAuthority);
      return publicPublication(result);
    }, { body: publishBody() })
    .put('/drafts', ({ access, body }) => {
      const context = managementContext(dependencies, access);
      const updating = body.draftId !== undefined;
      if (updating !== (body.expectedRevision !== undefined)) {
        throw new WorkflowError(
          'Existing workflow draft updates require draftId and expectedRevision together',
          'WORKFLOW_REQUEST_INVALID',
          422,
        );
      }
      const common = {
        definitionId: body.definitionId.trim(),
        name: body.name.trim(),
        graph: body.graph as WorkflowGraphIR,
        ...(body.inputSchema === undefined ? {} : { inputSchema: body.inputSchema }),
        ...(body.access === undefined
          ? {}
          : { access: body.access as WorkflowDefinitionAccessPolicy }),
        ...(body.baseVersionId === undefined
          ? {}
          : { baseVersionId: body.baseVersionId }),
        ...(body.editorMetadata === undefined
          ? {}
          : { editorMetadata: body.editorMetadata }),
      };
      const result = context.manager.saveDraft(updating
        ? {
          ...common,
          draftId: body.draftId!.trim(),
          expectedRevision: body.expectedRevision!,
        }
        : common, context.actorId, context.assertCurrentAuthority);
      return publicDraft(result);
    }, { body: draftBody() })
    .get('/drafts/:draftId', ({ access, params }) => {
      const context = managementContext(dependencies, access);
      return editableDraft(context.manager.getDraft(params.draftId.trim()));
    }, { params: t.Object({ draftId: nonBlankString() }) })
    .delete('/drafts/:draftId', ({ access, params, query }) => {
      const context = managementContext(dependencies, access);
      return {
        deleted: context.manager.deleteDraft(
          params.draftId.trim(),
          query.expectedRevision,
          context.assertCurrentAuthority,
        ),
      };
    }, {
      params: t.Object({ draftId: nonBlankString() }),
      query: t.Object({
        expectedRevision: t.Numeric({ minimum: 1 }),
      }),
    })
    .post('/drafts/:draftId/publish', ({ access, params, body }) => {
      const context = managementContext(dependencies, access);
      const result = context.manager.publishDraft(
        params.draftId.trim(),
        context.actorId,
        {
          expectedRevision: body.expectedRevision,
          ...(body.version === undefined ? {} : { version: body.version }),
          ...(body.activate === undefined ? {} : { activate: body.activate }),
          ...(body.expectedActiveVersionId === undefined
            ? {}
            : { expectedActiveVersionId: body.expectedActiveVersionId }),
        },
        context.assertCurrentAuthority,
      );
      return publicPublication(result);
    }, {
      params: t.Object({ draftId: nonBlankString() }),
      body: draftPublicationBody(),
    })
    .post('/:definitionId/versions/:versionId/activate', ({
      access,
      params,
    }) => {
      const context = managementContext(dependencies, access);
      return publicResolved(context.manager.activate(
        params.definitionId.trim(),
        params.versionId.trim(),
        context.actorId,
        context.assertCurrentAuthority,
      ));
    }, versionParams())
    .post('/:definitionId/versions/:versionId/retire', ({
      access,
      params,
    }) => {
      const context = managementContext(dependencies, access);
      return publicResolved(context.manager.retire(
        params.definitionId.trim(),
        params.versionId.trim(),
        context.actorId,
        context.assertCurrentAuthority,
      ));
    }, versionParams());
}

function managementContext(
  dependencies: WorkflowHttpPluginDependencies,
  access: RequestAuthorizationAccess,
): {
  manager: WorkflowDefinitionManager;
  actorId: string;
  assertCurrentAuthority: () => void;
} {
  const actor = access.requireUser();
  const scope = requireRequestServiceDataScope(
    access,
    dependencies.authorization?.getAuthorizationKernel ?? (() => null),
  );
  if (!canManageWorkflowScope(access, scope)) {
    throw new AuthError('Forbidden', 'FORBIDDEN', 403);
  }
  const service = dependencies.requireReadyService();
  return {
    manager: new WorkflowDefinitionManager(
      dependencies.registry,
      getWorkflowGraphRuntime(service).versions,
      workflowDefinitionScopeFromServiceDataScope(scope),
    ),
    actorId: actor.userId,
    assertCurrentAuthority: service.captureActorAuthorityAssertion(actor),
  };
}

function publishBody() {
  return t.Object({
    name: workflowDefinitionName(),
    graph: t.Unknown(),
    inputSchema: t.Optional(t.Unknown()),
    access: t.Optional(t.Unknown()),
    ...publicationOptionProperties(),
  });
}

function workflowDefinitionName() {
  return t.String({
    minLength: 1,
    maxLength: MAX_WORKFLOW_DEFINITION_NAME_LENGTH,
    pattern: '\\S',
  });
}

function draftBody() {
  return t.Object({
    definitionId: nonBlankString(),
    name: nonBlankString(),
    graph: t.Unknown(),
    inputSchema: t.Optional(t.Unknown()),
    access: t.Optional(t.Unknown()),
    draftId: t.Optional(nonBlankString()),
    baseVersionId: t.Optional(t.Union([nonBlankString(), t.Null()])),
    expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
    editorMetadata: t.Optional(t.Unknown()),
  });
}

function draftPublicationBody() {
  return t.Object({
    expectedRevision: t.Integer({ minimum: 1 }),
    ...publicationOptionProperties(),
  });
}

function publicationOptionProperties() {
  return {
    version: t.Optional(t.Integer({ minimum: 1 })),
    activate: t.Optional(t.Boolean()),
    expectedActiveVersionId: t.Optional(t.Union([nonBlankString(), t.Null()])),
  };
}

function definitionParams() {
  return { params: t.Object({ definitionId: nonBlankString() }) };
}

function versionParams() {
  return {
    params: t.Object({
      definitionId: nonBlankString(),
      versionId: nonBlankString(),
    }),
  };
}

function nonBlankString() {
  return t.String({ minLength: 1, pattern: '\\S' });
}

function publicPublication(result: ReturnType<WorkflowDefinitionManager['publish']>) {
  return { ...publicResolved(result), created: result.created, activated: result.activated };
}

function publicResolved(result: ReturnType<WorkflowDefinitionManager['activate']>) {
  return {
    definitionId: result.catalog.definition_id,
    name: result.catalog.name,
    activeVersionId: result.catalog.active_version_id,
    version: publicVersion(result.version),
  };
}

function publicVersion(version: ReturnType<WorkflowDefinitionManager['listVersions']>[number]) {
  return {
    versionId: version.version_id,
    version: version.version_number,
    source: version.source,
    format: version.graph_format,
    schemaVersion: version.schema_version,
    fingerprint: version.fingerprint,
    status: version.status,
    createdAt: version.created_at,
    retiredAt: version.retired_at,
  };
}

function publicDraft(result: ReturnType<WorkflowDefinitionManager['saveDraft']>) {
  return {
    draftId: result.draft.draft_id,
    definitionId: result.draft.definition_id,
    baseVersionId: result.draft.base_version_id,
    fingerprint: result.draft.fingerprint,
    revision: result.draft.revision,
    createdAt: result.draft.created_at,
    updatedAt: result.draft.updated_at,
  };
}

function editableVersion(result: ReturnType<WorkflowDefinitionManager['getVersion']>) {
  return {
    definitionId: result.catalog.definition_id,
    name: result.catalog.name,
    version: publicVersion(result.version),
    graph: result.graph,
    inputSchema: result.inputSchema,
    access: result.accessPolicy,
  };
}

function editableDraft(result: ReturnType<WorkflowDefinitionManager['getDraft']>) {
  return {
    ...publicDraft(result),
    graph: result.graph,
    inputSchema: result.inputSchema,
    access: result.accessPolicy,
    editorMetadata: result.editorMetadata,
  };
}

function emitFailure(
  observability: WorkflowObservability,
  error: unknown,
  request: Request,
  status: number,
): void {
  observability.emitNow(OBS_CODES.APP_REQUEST_FAILED, {
    error,
    metadata: { method: request.method, path: getSafeRequestPath(request), status },
  });
}
