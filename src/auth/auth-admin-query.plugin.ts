/**
 * auth-admin-query.plugin.ts
 *
 * Registers read-only admin configuration and user query routes.
 */

import { Elysia, t } from 'elysia';
import { buildAdminConfigResponse } from './auth-admin-config-response';
import { requireAdminServices, type AuthAdminPluginConfig } from './auth-admin-dependencies';
import { normalizeUserListQuery } from './auth-admin-user-list';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import {
  authRoleSchema,
  authUserIdParamsSchema,
  authUserSearchSchema,
} from './auth-request-schema';
import { AuthError } from './types';

/** Create read-only admin routes mounted below `/auth/admin`. */
export function createAuthAdminQueryPlugin(config: AuthAdminPluginConfig) {
  return new Elysia({ name: 'auth-admin-query' })
    .get('/config', async ({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const { store } = await requireAdminServices(config, request);
      return buildAdminConfigResponse(
        store,
        config.getAuthConfig(),
        config.getMfaService?.() ?? null,
        config.getEmailRuntime(),
      );
    })
    .get('/users', async ({ request, query, set }) => {
      applyAuthPrivateNoStore(set);
      const { store } = await requireAdminServices(config, request);
      const options = normalizeUserListQuery(query);
      const users = store.listUsers(options);
      const total = store.countUsers({
        search: options.search,
        role: options.role,
        status: options.status,
      });
      const hasMore = options.offset + users.length < total;
      return {
        users,
        page: {
          limit: options.limit,
          offset: options.offset,
          count: users.length,
          total,
          hasMore,
          nextOffset: hasMore ? options.offset + users.length : null,
        },
      };
    }, {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
        search: t.Optional(authUserSearchSchema),
        role: t.Optional(authRoleSchema),
        status: t.Optional(t.Union([t.Literal('active'), t.Literal('suspended')])),
      }),
    })
    .get('/users/:userId', async ({ request, params, set }) => {
      applyAuthPrivateNoStore(set);
      const { store } = await requireAdminServices(config, request);
      const user = store.getUserById(params.userId);
      if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      return { user };
    }, {
      params: authUserIdParamsSchema,
    });
}
