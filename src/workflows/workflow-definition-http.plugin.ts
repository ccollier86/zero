/** Platform-administrator HTTP API for database-authored workflow versions. */

import Elysia, { t } from 'elysia';
import { createScopedAuthMiddleware } from '../auth/auth.middleware';
import { AuthError } from '../auth/types';
import { OBS_CODES } from '../observability/codes';
import { getSafeRequestPath } from '../observability/safe-request-path';
import { emitPlatformCode } from '../observability/sink';
import type { WorkflowDefinitionAccessPolicy } from './types';
import { WorkflowDefinitionManager } from './workflow-definition-manager';
import { WorkflowError } from './workflow-error';
import type { WorkflowGraphIR } from './workflow-ir';
import type { WorkflowHttpPluginDependencies } from './workflow-http.plugin';

/** Database definitions remain an admin surface until Guardian supplies policy. */
export function createWorkflowDefinitionAdminHttpPlugin(
  dependencies: WorkflowHttpPluginDependencies,
) {
  return new Elysia({
    name: 'workflow-definition-admin-http',
    prefix: '/workflows/admin/definitions',
  })
    .use(createScopedAuthMiddleware(
      'workflow-definition-admin-auth',
      dependencies.getTokenService,
      dependencies.initializeForRequest,
    ))
    .onError(({ code, error, request, set }) => {
      if (error instanceof WorkflowError) {
        set.status = error.status;
        if (error.status >= 500) emitFailure(error, request, error.status);
        return { error: error.message, code: error.code };
      }
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
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
      emitFailure(error, request, 500);
      return { error: 'Workflow definition request failed', code: 'WORKFLOW_INTERNAL_ERROR' };
    })
    .get('/', ({ requireAdmin }) => {
      requireAdmin();
      return manager(dependencies).listAdmin();
    })
    .get('/activities', ({ requireAdmin }) => {
      requireAdmin();
      return manager(dependencies).listActivities();
    })
    .get('/:definitionId/versions', ({ requireAdmin, params }) => {
      requireAdmin();
      return manager(dependencies).listVersions(params.definitionId.trim())
        .map(publicVersion);
    }, definitionParams())
    .get('/:definitionId/versions/:versionId', ({ requireAdmin, params }) => {
      requireAdmin();
      return editableVersion(manager(dependencies).getVersion(
        params.definitionId.trim(),
        params.versionId.trim(),
      ));
    }, versionParams())
    .post('/publish', ({ requireAdmin, body }) => {
      const auth = requireAdmin();
      const result = manager(dependencies).publish({
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
      }, auth.userId);
      return publicPublication(result);
    }, { body: publishBody() })
    .put('/drafts', ({ requireAdmin, body }) => {
      const auth = requireAdmin();
      const result = manager(dependencies).saveDraft({
        definitionId: body.definitionId.trim(),
        name: body.name.trim(),
        graph: body.graph as WorkflowGraphIR,
        ...(body.inputSchema === undefined ? {} : { inputSchema: body.inputSchema }),
        ...(body.access === undefined
          ? {}
          : { access: body.access as WorkflowDefinitionAccessPolicy }),
        ...(body.draftId === undefined ? {} : { draftId: body.draftId.trim() }),
        ...(body.baseVersionId === undefined
          ? {}
          : { baseVersionId: body.baseVersionId }),
        ...(body.expectedRevision === undefined
          ? {}
          : { expectedRevision: body.expectedRevision }),
        ...(body.editorMetadata === undefined
          ? {}
          : { editorMetadata: body.editorMetadata }),
      }, auth.userId);
      return publicDraft(result);
    }, { body: draftBody() })
    .get('/drafts/:draftId', ({ requireAdmin, params }) => {
      requireAdmin();
      return editableDraft(manager(dependencies).getDraft(params.draftId.trim()));
    }, { params: t.Object({ draftId: nonBlankString() }) })
    .delete('/drafts/:draftId', ({ requireAdmin, params, query }) => {
      requireAdmin();
      return {
        deleted: manager(dependencies).deleteDraft(
          params.draftId.trim(),
          query.expectedRevision,
        ),
      };
    }, {
      params: t.Object({ draftId: nonBlankString() }),
      query: t.Object({
        expectedRevision: t.Optional(t.Numeric({ minimum: 0 })),
      }),
    })
    .post('/drafts/:draftId/publish', ({ requireAdmin, params, body }) => {
      const auth = requireAdmin();
      const result = manager(dependencies).publishDraft(
        params.draftId.trim(),
        auth.userId,
        {
          ...(body.version === undefined ? {} : { version: body.version }),
          ...(body.activate === undefined ? {} : { activate: body.activate }),
          ...(body.expectedActiveVersionId === undefined
            ? {}
            : { expectedActiveVersionId: body.expectedActiveVersionId }),
        },
      );
      return publicPublication(result);
    }, {
      params: t.Object({ draftId: nonBlankString() }),
      body: publicationOptionsBody(),
    })
    .post('/:definitionId/versions/:versionId/activate', ({
      requireAdmin,
      params,
    }) => {
      const auth = requireAdmin();
      return publicResolved(manager(dependencies).activate(
        params.definitionId.trim(),
        params.versionId.trim(),
        auth.userId,
      ));
    }, versionParams())
    .post('/:definitionId/versions/:versionId/retire', ({
      requireAdmin,
      params,
    }) => {
      const auth = requireAdmin();
      return publicResolved(manager(dependencies).retire(
        params.definitionId.trim(),
        params.versionId.trim(),
        auth.userId,
      ));
    }, versionParams());
}

function manager(dependencies: WorkflowHttpPluginDependencies): WorkflowDefinitionManager {
  const service = dependencies.requireReadyService();
  return new WorkflowDefinitionManager(
    dependencies.registry,
    service.getGraphRuntime().versions,
  );
}

function publishBody() {
  return t.Object({
    name: nonBlankString(),
    graph: t.Unknown(),
    inputSchema: t.Optional(t.Unknown()),
    access: t.Optional(t.Unknown()),
    ...publicationOptionProperties(),
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
    expectedRevision: t.Optional(t.Integer({ minimum: 0 })),
    editorMetadata: t.Optional(t.Unknown()),
  });
}

function publicationOptionsBody() {
  return t.Object(publicationOptionProperties());
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

function emitFailure(error: unknown, request: Request, status: number): void {
  emitPlatformCode(OBS_CODES.APP_REQUEST_FAILED, {
    error,
    metadata: { method: request.method, path: getSafeRequestPath(request), status },
  });
}
