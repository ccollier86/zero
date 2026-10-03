/**
 * storage-studio.router.ts
 *
 * Defines the bounded Elysia HTTP surface for Storage Studio. Domain policy,
 * persistence, provider work, and UI state remain outside this controller.
 */

import { Elysia, t } from 'elysia';
import {
  createAuthMiddleware,
  type AuthMiddlewareAuthorizationOptions,
} from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import { createStorageMutationCommitFence } from './storage-request-authority-fence';
import {
  handleStorageStudioTransportError,
  requireStorageStudioRequestActor,
  runStorageStudioRoute,
  type StorageStudioRouterRuntimeOptions,
} from './storage-studio-router-runtime';

export interface StorageStudioRouterOptions extends StorageStudioRouterRuntimeOptions {
  readonly getTokenService: () => TokenService | null;
  readonly authorization: AuthMiddlewareAuthorizationOptions;
}

const driveIdSchema = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^drv_[A-Za-z0-9-]+$',
});
const operationIdSchema = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
const driveKeySchema = t.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[a-z][a-z0-9_-]*$',
});
const ownerSchema = t.Union([t.Literal('organization'), t.Literal('personal')]);
const lifecycleSchema = t.Union([
  t.Literal('provisioning'),
  t.Literal('ready'),
  t.Literal('degraded'),
  t.Literal('suspended'),
  t.Literal('deleting'),
  t.Literal('deleted'),
  t.Literal('restoring'),
  t.Literal('failed'),
]);

/** Mount below the Storage plugin's `/storage` prefix. */
export function createStorageStudioRouter(options: StorageStudioRouterOptions) {
  return new Elysia({ name: 'storage-studio', prefix: '/studio' })
    .use(createAuthMiddleware(options.getTokenService, options.authorization))
    .onError(({ code, set }) => handleStorageStudioTransportError(code, set))
    .get('/capabilities', ({ access, set }) => {
      applyPrivateNoStore(set.headers);
      const actor = requireStorageStudioRequestActor(access, options);
      return runStorageStudioRoute(set, 'capabilities', 'read', () => (
        actor.service.capabilities(actor.authority)
      ));
    })
    .get('/drives', ({ access, query, set }) => {
      applyPrivateNoStore(set.headers);
      const actor = requireStorageStudioRequestActor(access, options);
      return runStorageStudioRoute(set, 'drives.list', 'read', () => (
        actor.service.listDrives(actor.authority, actor.userProperties, query)
      ));
    }, {
      query: t.Object({
        owner: t.Optional(t.Union([ownerSchema, t.Literal('all')])),
        lifecycle: t.Optional(t.Union([lifecycleSchema, t.Literal('all')])),
        search: t.Optional(t.String({ maxLength: 120 })),
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }, { additionalProperties: false }),
    })
    .post('/drives', ({ access, body, set }) => {
      applyPrivateNoStore(set.headers);
      const actor = requireStorageStudioRequestActor(access, options);
      return runStorageStudioRoute(set, 'drives.provision', 'write', () => (
        actor.service.provisionDrive(
          actor.authority,
          actor.userProperties,
          body,
          createStorageMutationCommitFence(actor.authority.actor, {
            getCredentialResolver: () => (
              options.authorization.getRequestCredentialResolver?.() ?? null
            ),
            getTokenService: options.getTokenService,
            getUserProperties: options.getUserProperties,
          }),
        )
      ));
    }, {
      body: t.Object({
        operationId: operationIdSchema,
        owner: ownerSchema,
        key: driveKeySchema,
        name: t.String({ minLength: 1, maxLength: 120 }),
        maxSize: t.Optional(t.Number({ minimum: 0 })),
        maxFileSize: t.Optional(t.Number({ minimum: 0 })),
        allowedMimeTypes: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 255 }), {
          maxItems: 128,
        })),
        public: t.Optional(t.Boolean()),
        creatorAccess: t.Optional(t.Union([
          t.Literal('none'),
          t.Literal('read'),
          t.Literal('write'),
          t.Literal('admin'),
        ])),
      }, { additionalProperties: false }),
    })
    .get('/drives/by-key/:key', ({ access, params, query, set }) => {
      applyPrivateNoStore(set.headers);
      const actor = requireStorageStudioRequestActor(access, options);
      return runStorageStudioRoute(set, 'drives.get-by-key', 'read', () => (
        actor.service.getDriveByKey(
          actor.authority,
          actor.userProperties,
          params.key,
          query.owner,
        )
      ));
    }, {
      params: t.Object({ key: driveKeySchema }, { additionalProperties: false }),
      query: t.Object({ owner: t.Optional(ownerSchema) }, { additionalProperties: false }),
    })
    .get('/drives/:driveId/jobs', ({ access, params, query, set }) => {
      applyPrivateNoStore(set.headers);
      const actor = requireStorageStudioRequestActor(access, options);
      return runStorageStudioRoute(set, 'drives.jobs', 'read', () => (
        actor.service.listDriveJobs(
          actor.authority,
          actor.userProperties,
          params.driveId,
          query,
        )
      ));
    }, {
      params: t.Object({ driveId: driveIdSchema }, { additionalProperties: false }),
      query: t.Object({
        cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }, { additionalProperties: false }),
    })
    .get('/drives/:driveId', ({ access, params, set }) => {
      applyPrivateNoStore(set.headers);
      const actor = requireStorageStudioRequestActor(access, options);
      return runStorageStudioRoute(set, 'drives.get', 'read', () => (
        actor.service.getDrive(actor.authority, actor.userProperties, params.driveId)
      ));
    }, {
      params: t.Object({ driveId: driveIdSchema }, { additionalProperties: false }),
    })
    .patch('/drives/:driveId', ({ access, params, body, set }) => {
      applyPrivateNoStore(set.headers);
      const actor = requireStorageStudioRequestActor(access, options);
      return runStorageStudioRoute(set, 'drives.update', 'write', () => (
        actor.service.updateDrive(
          actor.authority,
          actor.userProperties,
          params.driveId,
          body,
          createStorageMutationCommitFence(actor.authority.actor, {
            getCredentialResolver: () => (
              options.authorization.getRequestCredentialResolver?.() ?? null
            ),
            getTokenService: options.getTokenService,
            getUserProperties: options.getUserProperties,
          }),
        )
      ));
    }, {
      params: t.Object({ driveId: driveIdSchema }, { additionalProperties: false }),
      body: t.Object({
        operationId: operationIdSchema,
        expectedRevision: t.Integer({ minimum: 1 }),
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        maxSize: t.Optional(t.Number({ minimum: 0 })),
        maxFileSize: t.Optional(t.Number({ minimum: 0 })),
        allowedMimeTypes: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 255 }), {
          maxItems: 128,
        })),
        public: t.Optional(t.Boolean()),
      }, { additionalProperties: false, minProperties: 3 }),
    })
    .post('/drives/:driveId/lifecycle', ({ access, params, body, set }) => {
      applyPrivateNoStore(set.headers);
      const actor = requireStorageStudioRequestActor(access, options);
      return runStorageStudioRoute(set, 'drives.lifecycle', 'write', () => (
        actor.service.changeDriveLifecycle(
          actor.authority,
          actor.userProperties,
          params.driveId,
          body,
          createStorageMutationCommitFence(actor.authority.actor, {
            getCredentialResolver: () => (
              options.authorization.getRequestCredentialResolver?.() ?? null
            ),
            getTokenService: options.getTokenService,
            getUserProperties: options.getUserProperties,
          }),
        )
      ));
    }, {
      params: t.Object({ driveId: driveIdSchema }, { additionalProperties: false }),
      body: t.Object({
        operationId: operationIdSchema,
        expectedRevision: t.Integer({ minimum: 1 }),
        action: t.Union([
          t.Literal('suspend'),
          t.Literal('resume'),
          t.Literal('delete'),
          t.Literal('restore'),
          t.Literal('retry'),
        ]),
      }, { additionalProperties: false }),
    });
}

function applyPrivateNoStore(headers: Record<string, string | number | readonly string[]>): void {
  headers['cache-control'] = 'private, no-store, max-age=0';
}
