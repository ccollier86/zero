/** Administrator suspension, activation, and session-revocation routes. */

import { Elysia } from 'elysia';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { assertAdminUserTransition } from './admin-user-guards';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';
import {
  requireAdminMutationServices,
  type AuthAdminPluginConfig,
} from './auth-admin-dependencies';
import { authUserIdParamsSchema } from './auth-request-schema';
import { AuthError } from './types';

/** Create administrator account-status and session routes. */
export function createAuthAdminStatusPlugin(config: AuthAdminPluginConfig) {
  const schema = { params: authUserIdParamsSchema };
  return new Elysia({ name: 'auth-admin-status' })
    .post('/users/:userId/suspend', async ({ request, params }) => {
      const { store, assertCurrentAuthority } = await requireAdminMutationServices(config, request);
      let actorUserId = '';
      const user = store.transaction(() => {
        const auth = assertCurrentAuthority();
        actorUserId = auth.userId;
        const existing = store.getUserById(params.userId);
        if (!existing) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        assertAdminUserTransition({
          store,
          actorUserId: auth.userId,
          user: existing,
          changes: { status: 'suspended' },
        });
        const updated = store.updateUser(params.userId, { status: 'suspended' });
        if (!updated) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        if (existing.status !== 'suspended') store.revokeAllUserTokens(params.userId);
        store.appendControlPlaneAudit({
          action: 'account.suspended',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: authAuditActorFromContext(auth),
          request: authAuditRequestFromRequest(request),
          target: { type: 'user', id: params.userId },
          metadata: { changed: existing.status !== 'suspended' },
        });
        return updated;
      });
      emitPlatformCode(OBS_CODES.AUTH_ACCOUNT_SUSPENDED, {
        userId: actorUserId,
        metadata: { targetUserId: params.userId },
      });
      return { user };
    }, schema)
    .post('/users/:userId/activate', async ({ request, params }) => {
      const { store, assertCurrentAuthority } = await requireAdminMutationServices(config, request);
      let actorUserId = '';
      const user = store.transaction(() => {
        const auth = assertCurrentAuthority();
        actorUserId = auth.userId;
        const existing = store.getUserById(params.userId);
        if (!existing) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        const updated = store.updateUser(params.userId, { status: 'active' });
        if (!updated) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        store.appendControlPlaneAudit({
          action: 'account.activated',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: authAuditActorFromContext(auth),
          request: authAuditRequestFromRequest(request),
          target: { type: 'user', id: params.userId },
          metadata: { changed: existing.status !== 'active' },
        });
        return updated;
      });
      emitPlatformCode(OBS_CODES.AUTH_ACCOUNT_REACTIVATED, {
        userId: actorUserId,
        metadata: { targetUserId: params.userId },
      });
      return { user };
    }, schema)
    .post('/users/:userId/revoke-sessions', async ({ request, params }) => {
      const { store, assertCurrentAuthority } = await requireAdminMutationServices(config, request);
      store.transaction(() => {
        const auth = assertCurrentAuthority();
        if (!store.getUserById(params.userId)) {
          throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        }
        store.revokeAllUserTokens(params.userId);
        store.appendControlPlaneAudit({
          action: 'account.sessions-revoked',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: authAuditActorFromContext(auth),
          request: authAuditRequestFromRequest(request),
          target: { type: 'user', id: params.userId },
        });
      });
      return { ok: true };
    }, schema);
}
