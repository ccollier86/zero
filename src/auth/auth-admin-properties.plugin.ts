/** Administrator user-property routes and configured field validation. */

import { Elysia, t } from 'elysia';
import { requireAdminServices, type AuthAdminPluginConfig } from './auth-admin-dependencies';
import {
  assertAuthPropertiesBound,
  assertAuthPropertyValueBound,
} from './auth-request-property-bounds';
import {
  authPropertiesSchema,
  authPropertyKeySchema,
  authUserIdParamsSchema,
  authUserIdSchema,
} from './auth-request-schema';
import { AuthError } from './types';

/** Create admin user-property mutation routes. */
export function createAuthAdminPropertiesPlugin(config: AuthAdminPluginConfig) {
  const userParams = authUserIdParamsSchema;
  return new Elysia({ name: 'auth-admin-properties' })
    .put('/users/:userId/properties/:key', async ({ request, params, body }) => {
      const { store, propertyService } = await requireAdminServices(config, request);
      assertUser(store.getUserById(params.userId));
      const value = propertyService.validateWrite(params.key, body.value, 'admin');
      store.setProperty(params.userId, params.key, value);
      return { ok: true };
    }, {
      params: t.Object({
        userId: authUserIdSchema,
        key: authPropertyKeySchema,
      }),
      body: t.Object({ value: t.Unknown() }),
      beforeHandle: ({ body }) => assertAuthPropertyValueBound(body.value),
    })
    .patch('/users/:userId/properties', async ({ request, params, body }) => {
      const { store, propertyService } = await requireAdminServices(config, request);
      assertUser(store.getUserById(params.userId));
      const properties = propertyService.validateWrites(body.properties, 'admin');
      store.setProperties(params.userId, properties);
      return { ok: true };
    }, {
      params: userParams,
      body: t.Object({ properties: authPropertiesSchema }),
      beforeHandle: ({ body }) => assertAuthPropertiesBound(body.properties),
    })
    .delete('/users/:userId/properties/:key', async ({ request, params }) => {
      const { store, propertyService } = await requireAdminServices(config, request);
      assertUser(store.getUserById(params.userId));
      propertyService.deleteProperty(params.userId, params.key, 'admin', store);
      return { ok: true };
    }, {
      params: t.Object({
        userId: authUserIdSchema,
        key: authPropertyKeySchema,
      }),
    });
}

function assertUser(user: unknown): void {
  if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
}
