/** Administrator suspension, activation, and session-revocation routes. */

import { Elysia } from 'elysia';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { assertAdminUserTransition } from './admin-user-guards';
import { requireAdminServices, type AuthAdminPluginConfig } from './auth-admin-dependencies';
import { authUserIdParamsSchema } from './auth-request-schema';
import { AuthError } from './types';

/** Create administrator account-status and session routes. */
export function createAuthAdminStatusPlugin(config: AuthAdminPluginConfig) {
  const schema = { params: authUserIdParamsSchema };
  return new Elysia({ name: 'auth-admin-status' })
    .post('/users/:userId/suspend', async ({ request, params }) => {
      const { store, auth } = await requireAdminServices(config, request);
      const existing = store.getUserById(params.userId);
      if (!existing) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      assertAdminUserTransition({
        store,
        actorUserId: auth.userId,
        user: existing,
        changes: { status: 'suspended' },
      });
      const user = store.updateUser(params.userId, { status: 'suspended' });
      if (existing.status !== 'suspended') store.revokeAllUserTokens(params.userId);
      emitPlatformCode(OBS_CODES.AUTH_ACCOUNT_SUSPENDED, {
        userId: auth.userId,
        metadata: { targetUserId: params.userId },
      });
      return { user };
    }, schema)
    .post('/users/:userId/activate', async ({ request, params }) => {
      const { store, auth } = await requireAdminServices(config, request);
      const user = store.updateUser(params.userId, { status: 'active' });
      if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      emitPlatformCode(OBS_CODES.AUTH_ACCOUNT_REACTIVATED, {
        userId: auth.userId,
        metadata: { targetUserId: params.userId },
      });
      return { user };
    }, schema)
    .post('/users/:userId/revoke-sessions', async ({ request, params }) => {
      const { store } = await requireAdminServices(config, request);
      if (!store.getUserById(params.userId)) {
        throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      }
      store.revokeAllUserTokens(params.userId);
      return { ok: true };
    }, schema);
}
