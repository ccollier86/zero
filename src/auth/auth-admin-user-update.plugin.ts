/** Administrator user update/delete routes and transport validation. */

import { Elysia, t } from 'elysia';
import { OBS_CODES } from '../observability/codes';
import { assertAdminMayDeleteUser } from './admin-user-guards';
import { AdminUserUpdateService } from './admin-user-update-service';
import {
  requireAdminMutationServices,
  getAuthAdminEmitter,
  type AuthAdminPluginConfig,
} from './auth-admin-dependencies';
import { AuthError } from './types';
import { canonicalEmailSchema } from './auth-email-schema';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';
import { assertAuthPropertiesBound } from './auth-request-property-bounds';
import {
  authDisplayNameSchema,
  authPropertiesSchema,
  authRoleSchema,
  authUserIdParamsSchema,
  authUsernameSchema,
} from './auth-request-schema';

/** Create administrator user update and deletion routes. */
export function createAuthAdminUserUpdatePlugin(config: AuthAdminPluginConfig) {
  const emitCode = getAuthAdminEmitter(config);
  const params = authUserIdParamsSchema;
  return new Elysia({ name: 'auth-admin-user-update' })
    .patch('/users/:userId', async ({ request, params, body }) => {
      const {
        store,
        propertyService,
        auth,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      const user = new AdminUserUpdateService(store, propertyService, config)
        .update(params.userId, body, assertCurrentAuthority, {
          actor: authAuditActorFromContext(auth),
          request: authAuditRequestFromRequest(request),
        });
      return { user };
    }, {
      params,
      body: t.Object({
        username: t.Optional(authUsernameSchema),
        email: t.Optional(canonicalEmailSchema),
        firstName: t.Optional(authDisplayNameSchema),
        lastName: t.Optional(authDisplayNameSchema),
        role: t.Optional(authRoleSchema),
        status: t.Optional(t.Union([t.Literal('active'), t.Literal('suspended')])),
        passwordChangeRequired: t.Optional(t.Boolean()),
        mfaRequired: t.Optional(t.Boolean()),
        properties: t.Optional(authPropertiesSchema),
      }),
      beforeHandle: ({ body }) => assertAuthPropertiesBound(body.properties),
    })
    .delete('/users/:userId', async ({ request, params }) => {
      const {
        store,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      const auditRequest = authAuditRequestFromRequest(request);
      let actorUserId = '';
      try {
        store.transaction(() => {
          const current = assertCurrentAuthority({ targetUserId: params.userId });
          actorUserId = current.userId;
          const user = store.getUserById(params.userId);
          if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
          assertAdminMayDeleteUser(store, current.userId, user);
          if (!store.deleteUser(params.userId)) {
            throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
          }
          store.appendControlPlaneAudit({
            action: 'account.deleted-by-admin',
            outcome: 'succeeded',
            scope: { kind: 'application' },
            actor: authAuditActorFromContext(current),
            request: auditRequest,
            target: { type: 'user', id: params.userId },
          });
        });
      } catch (error) {
        if (error instanceof AuthError && error.code === 'USER_HAS_TENANT_HISTORY') {
          store.appendControlPlaneAudit({
            action: 'account.deleted-by-admin',
            outcome: 'denied',
            reason: 'tenant-history-retained',
            scope: { kind: 'application' },
            actor: actorUserId
              ? { userId: actorUserId, provenance: 'authenticated-request' }
              : { provenance: 'system' },
            request: auditRequest,
            target: { type: 'user', id: params.userId },
          });
        }
        throw error;
      }
      emitCode(OBS_CODES.AUTH_ADMIN_USER_DELETED, {
        userId: actorUserId,
        metadata: { deletedUserId: params.userId },
      });
      return { ok: true };
    }, { params });
}
