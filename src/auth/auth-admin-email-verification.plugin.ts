/**
 * auth-admin-email-verification.plugin.ts
 *
 * Registers admin email-verification routes and delegates lifecycle behavior
 * to AdminEmailVerificationService.
 */

import { Elysia } from 'elysia';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { AdminEmailVerificationService } from './admin-email-verification-service';
import {
  requireAdminMutationServices,
  type AuthAdminPluginConfig,
} from './auth-admin-dependencies';
import { authUserIdParamsSchema } from './auth-request-schema';
import { AuthError } from './types';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';

/** Create admin verification routes mounted below `/auth/admin`. */
export function createAuthAdminEmailVerificationPlugin(config: AuthAdminPluginConfig) {
  const schema = { params: authUserIdParamsSchema };
  return new Elysia({ name: 'auth-admin-email-verification' })
    .post('/users/:userId/send-verification-email', async ({ request, params }) => {
      const {
        service,
        actorId,
        assertCurrentAuthority,
      } = await services(config, request);
      await service.send(params.userId, assertCurrentAuthority);
      emitPlatformCode(OBS_CODES.AUTH_ADMIN_EMAIL_VERIFICATION_SENT, {
        userId: actorId,
        metadata: { targetUserId: params.userId },
      });
      return { ok: true as const };
    }, schema)
    .post('/users/:userId/verify-email', async ({ request, params }) => {
      const {
        service,
        actorId,
        auth,
        assertCurrentAuthority,
      } = await services(config, request);
      const user = service.verify(params.userId, assertCurrentAuthority, {
        actor: authAuditActorFromContext(auth),
        request: authAuditRequestFromRequest(request),
      });
      emitPlatformCode(OBS_CODES.AUTH_ADMIN_EMAIL_VERIFIED, {
        userId: actorId,
        metadata: { targetUserId: params.userId },
      });
      return { user };
    }, schema);
}

async function services(config: AuthAdminPluginConfig, request: Request) {
  const {
    store,
    auth,
    assertCurrentAuthority,
  } = await requireAdminMutationServices(config, request);
  const tokens = config.getActionTokenService();
  const email = config.getAccountEmailService();
  if (!tokens || !email) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return {
    actorId: auth.userId,
    auth,
    assertCurrentAuthority,
    service: new AdminEmailVerificationService(store, tokens, email, config.getAuthConfig()),
  };
}
