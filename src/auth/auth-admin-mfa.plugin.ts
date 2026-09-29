/**
 * auth-admin-mfa.plugin.ts
 *
 * Registers admin MFA transport routes. Authentication and state transitions
 * are delegated to shared dependencies and AdminMfaUserService.
 */

import { Elysia } from 'elysia';
import { OBS_CODES } from '../observability/codes';
import { AdminMfaUserService } from './admin-mfa-user-service';
import {
  requireAdminMfaService,
  getAuthAdminEmitter,
  requireAdminMutationServices,
  requireAdminServices,
  type AuthAdminPluginConfig,
} from './auth-admin-dependencies';
import { authUserIdParamsSchema } from './auth-request-schema';
import { AuthError } from './types';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';
import { applyAuthPrivateNoStore } from './auth-response-cache';

/** Create admin MFA routes mounted below `/auth/admin`. */
export function createAuthAdminMfaPlugin(config: AuthAdminPluginConfig) {
  const params = { params: authUserIdParamsSchema };
  return new Elysia({ name: 'auth-admin-mfa' })
    .get('/users/:userId/mfa', async ({ request, params, set }) => {
      applyAuthPrivateNoStore(set);
      const { service, assertCurrentAuthority } = await services(config, request);
      const status = service.getStatus(params.userId);
      assertCurrentAuthority();
      return status;
    }, params)
    .post('/users/:userId/mfa/require', async ({ request, params }) => {
      const {
        service,
        actorId,
        auth,
        assertCurrentAuthority,
      } = await mutationServices(config, request);
      const user = service.require(params.userId, assertCurrentAuthority, {
        actor: authAuditActorFromContext(auth),
        request: authAuditRequestFromRequest(request),
      });
      emit(config, OBS_CODES.AUTH_ADMIN_MFA_REQUIRED, actorId, params.userId);
      return { user };
    }, params)
    .post('/users/:userId/mfa/clear-requirement', async ({ request, params }) => {
      const {
        service,
        actorId,
        auth,
        assertCurrentAuthority,
      } = await mutationServices(config, request);
      const user = service.clearRequirement(params.userId, assertCurrentAuthority, {
        actor: authAuditActorFromContext(auth),
        request: authAuditRequestFromRequest(request),
      });
      emit(config, OBS_CODES.AUTH_ADMIN_MFA_CLEARED, actorId, params.userId);
      return { user };
    }, params)
    .post('/users/:userId/mfa/reset', async ({ request, params }) => {
      const {
        service,
        actorId,
        auth,
        assertCurrentAuthority,
      } = await mutationServices(config, request);
      const result = service.reset(params.userId, assertCurrentAuthority, {
        actor: authAuditActorFromContext(auth),
        request: authAuditRequestFromRequest(request),
      });
      getAuthAdminEmitter(config)(OBS_CODES.AUTH_ADMIN_MFA_RESET, {
        userId: actorId,
        metadata: { targetUserId: params.userId, ...result },
      });
      return { ok: true as const, ...result };
    }, params);
}

async function services(config: AuthAdminPluginConfig, request: Request) {
  const { store, auth, assertCurrentAuthority } = await requireAdminServices(config, request);
  const readiness = config.getMfaService?.();
  if (!readiness) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return {
    actorId: auth.userId,
    auth,
    assertCurrentAuthority,
    service: new AdminMfaUserService(
      store,
      requireAdminMfaService(config),
      readiness,
      config.getEmailRuntime().enabled,
      getAuthAdminEmitter(config),
    ),
  };
}

async function mutationServices(config: AuthAdminPluginConfig, request: Request) {
  const {
    store,
    auth,
    assertCurrentAuthority,
  } = await requireAdminMutationServices(config, request);
  const readiness = config.getMfaService?.();
  if (!readiness) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return {
    actorId: auth.userId,
    auth,
    assertCurrentAuthority,
    service: new AdminMfaUserService(
      store,
      requireAdminMfaService(config),
      readiness,
      config.getEmailRuntime().enabled,
      getAuthAdminEmitter(config),
    ),
  };
}

function emit(config: AuthAdminPluginConfig, code: typeof OBS_CODES.AUTH_ADMIN_MFA_REQUIRED,
  actorId: string, target: string) {
  getAuthAdminEmitter(config)(code, { userId: actorId, metadata: { targetUserId: target } });
}
