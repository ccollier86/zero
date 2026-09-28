/** Administrator user-property routes and configured field validation. */

import { Elysia, t } from 'elysia';
import {
  requireAdminMutationServices,
  requireAdminServices,
  type AuthAdminPluginConfig,
} from './auth-admin-dependencies';
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
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';

/** Create admin user-property mutation routes. */
export function createAuthAdminPropertiesPlugin(config: AuthAdminPluginConfig) {
  const userParams = authUserIdParamsSchema;
  return new Elysia({ name: 'auth-admin-properties' })
    .put('/users/:userId/properties/:key', async ({ request, params, body }) => {
      const {
        store,
        propertyService,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      store.transaction(() => {
        const auth = assertCurrentAuthority();
        assertUser(store.getUserById(params.userId));
        const value = propertyService.validateWrite(params.key, body.value, 'admin');
        const invalidatesAuthority = propertyService.isPolicyTrusted(params.key)
          && store.getProperty(params.userId, params.key) !== value;
        store.setProperty(params.userId, params.key, value);
        if (invalidatesAuthority) store.revokeAllUserTokens(params.userId);
        recordPropertyMutation(store, auth, request, params.userId, invalidatesAuthority);
      });
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
      const {
        store,
        propertyService,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      store.transaction(() => {
        const auth = assertCurrentAuthority();
        assertUser(store.getUserById(params.userId));
        const properties = propertyService.validateWrites(body.properties, 'admin');
        const invalidatesAuthority = Object.entries(properties).some(([key, value]) =>
          propertyService.isPolicyTrusted(key)
          && store.getProperty(params.userId, key) !== value);
        store.setProperties(params.userId, properties);
        if (invalidatesAuthority) store.revokeAllUserTokens(params.userId);
        recordPropertyMutation(store, auth, request, params.userId, invalidatesAuthority);
      });
      return { ok: true };
    }, {
      params: userParams,
      body: t.Object({ properties: authPropertiesSchema }),
      beforeHandle: ({ body }) => assertAuthPropertiesBound(body.properties),
    })
    .delete('/users/:userId/properties/:key', async ({ request, params }) => {
      const {
        store,
        propertyService,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      store.transaction(() => {
        const auth = assertCurrentAuthority();
        assertUser(store.getUserById(params.userId));
        const invalidatesAuthority = propertyService.isPolicyTrusted(params.key)
          && store.getProperty(params.userId, params.key) !== null;
        propertyService.deleteProperty(params.userId, params.key, 'admin', store);
        if (invalidatesAuthority) store.revokeAllUserTokens(params.userId);
        recordPropertyMutation(store, auth, request, params.userId, invalidatesAuthority);
      });
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

function recordPropertyMutation(
  store: Awaited<ReturnType<typeof requireAdminServices>>['store'],
  auth: Awaited<ReturnType<typeof requireAdminServices>>['auth'],
  request: Request,
  userId: string,
  invalidatesAuthority: boolean,
): void {
  store.appendControlPlaneAudit({
    action: 'account.properties-updated-by-admin',
    outcome: 'succeeded',
    scope: { kind: 'application' },
    actor: authAuditActorFromContext(auth),
    request: authAuditRequestFromRequest(request),
    target: { type: 'user', id: userId },
    metadata: { 'security-boundary-changed': invalidatesAuthority },
  });
}
