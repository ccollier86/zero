/**
 * auth-admin-mfa.plugin.ts
 *
 * Registers admin MFA transport routes. Authentication and state transitions
 * are delegated to shared dependencies and AdminMfaUserService.
 */

import { Elysia } from 'elysia';
import { getEmailRuntime } from '../email';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { AdminMfaUserService } from './admin-mfa-user-service';
import {
  requireAdminMfaService,
  requireAdminServices,
  type AuthAdminPluginConfig,
} from './auth-admin-dependencies';
import { authUserIdParamsSchema } from './auth-request-schema';
import { AuthError } from './types';

/** Create admin MFA routes mounted below `/auth/admin`. */
export function createAuthAdminMfaPlugin(config: AuthAdminPluginConfig) {
  const params = { params: authUserIdParamsSchema };
  return new Elysia({ name: 'auth-admin-mfa' })
    .get('/users/:userId/mfa', async ({ request, params }) => {
      const { service } = await services(config, request);
      return service.getStatus(params.userId);
    }, params)
    .post('/users/:userId/mfa/require', async ({ request, params }) => {
      const { service, actorId } = await services(config, request);
      const user = service.require(params.userId);
      emit(OBS_CODES.AUTH_ADMIN_MFA_REQUIRED, actorId, params.userId);
      return { user };
    }, params)
    .post('/users/:userId/mfa/clear-requirement', async ({ request, params }) => {
      const { service, actorId } = await services(config, request);
      const user = service.clearRequirement(params.userId);
      emit(OBS_CODES.AUTH_ADMIN_MFA_CLEARED, actorId, params.userId);
      return { user };
    }, params)
    .post('/users/:userId/mfa/reset', async ({ request, params }) => {
      const { service, actorId } = await services(config, request);
      const result = service.reset(params.userId, actorId);
      emitPlatformCode(OBS_CODES.AUTH_ADMIN_MFA_RESET, {
        userId: actorId,
        metadata: { targetUserId: params.userId, ...result },
      });
      return { ok: true as const, ...result };
    }, params);
}

async function services(config: AuthAdminPluginConfig, request: Request) {
  const { store, auth } = await requireAdminServices(config, request);
  const readiness = config.getMfaService?.();
  if (!readiness) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return {
    actorId: auth.userId,
    service: new AdminMfaUserService(
      store,
      requireAdminMfaService(config),
      readiness,
      getEmailRuntime().enabled
    ),
  };
}

function emit(code: typeof OBS_CODES.AUTH_ADMIN_MFA_REQUIRED, actorId: string, target: string) {
  emitPlatformCode(code, { userId: actorId, metadata: { targetUserId: target } });
}
