/** Admin user-creation HTTP route and request validation. */

import { Elysia, t } from 'elysia';
import { AdminUserCreateService } from './admin-user-create-service';
import { requireAdminServices, type AuthAdminPluginConfig } from './auth-admin-dependencies';
import { canonicalEmailSchema } from './auth-email-schema';
import { assertAuthPropertiesBound } from './auth-request-property-bounds';
import {
  authDisplayNameSchema,
  authNewPasswordSchema,
  authPropertiesSchema,
  authRoleSchema,
  authUsernameSchema,
} from './auth-request-schema';

/** Create the administrator user-creation route. */
export function createAuthAdminUserCreatePlugin(config: AuthAdminPluginConfig) {
  return new Elysia({ name: 'auth-admin-user-create' }).post(
    '/users',
    async ({ request, body }) => {
      const { store, propertyService, auth } = await requireAdminServices(config, request);
      return new AdminUserCreateService(store, propertyService, config).create(body, auth.userId);
    },
    {
      body: t.Object({
        username: authUsernameSchema,
        email: canonicalEmailSchema,
        password: t.Optional(authNewPasswordSchema),
        firstName: t.Optional(authDisplayNameSchema),
        lastName: t.Optional(authDisplayNameSchema),
        role: t.Optional(authRoleSchema),
        passwordChangeRequired: t.Optional(t.Boolean()),
        mfaRequired: t.Optional(t.Boolean()),
        sendSetupEmail: t.Optional(t.Boolean()),
        properties: t.Optional(authPropertiesSchema),
      }),
      beforeHandle: ({ body }) => assertAuthPropertiesBound(body.properties),
    }
  );
}
