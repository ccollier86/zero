/** Administrator user update/delete routes and transport validation. */

import { Elysia, t } from 'elysia';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { assertAdminMayDeleteUser } from './admin-user-guards';
import { AdminUserUpdateService } from './admin-user-update-service';
import { requireAdminServices, type AuthAdminPluginConfig } from './auth-admin-dependencies';
import { AuthError } from './types';
import { canonicalEmailSchema } from './auth-email-schema';
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
  const params = authUserIdParamsSchema;
  return new Elysia({ name: 'auth-admin-user-update' })
    .patch('/users/:userId', async ({ request, params, body }) => {
      const { store, propertyService, auth } = await requireAdminServices(config, request);
      const user = new AdminUserUpdateService(store, propertyService, config)
        .update(params.userId, body, auth.userId);
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
      const { store, auth } = await requireAdminServices(config, request);
      const user = store.getUserById(params.userId);
      if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      assertAdminMayDeleteUser(store, auth.userId, user);
      store.deleteUser(params.userId);
      emitPlatformCode(OBS_CODES.AUTH_ADMIN_USER_DELETED, {
        userId: auth.userId,
        metadata: { deletedUserId: params.userId },
      });
      return { ok: true };
    }, { params });
}
