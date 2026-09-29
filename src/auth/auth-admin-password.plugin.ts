/** Administrator password replacement and lifecycle-email routes. */

import { Elysia, t } from 'elysia';
import { OBS_CODES } from '../observability/codes';
import { AdminLifecycleEmailService } from './admin-lifecycle-email-service';
import { AdminPasswordRecoveryService } from './admin-password-recovery-service';
import { assertAdminMayResetPassword } from './admin-user-guards';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';
import {
  requireAdminMutationServices,
  getAuthAdminEmitter,
  type AuthAdminPluginConfig,
} from './auth-admin-dependencies';
import { authNewPasswordSchema, authUserIdParamsSchema } from './auth-request-schema';
import { AuthError } from './types';
import type { UserStore } from './user-store';

/** Create administrator password and setup/reset-email routes. */
export function createAuthAdminPasswordPlugin(config: AuthAdminPluginConfig) {
  const emitCode = getAuthAdminEmitter(config);
  const schema = { params: authUserIdParamsSchema };
  return new Elysia({ name: 'auth-admin-password' })
    .post('/users/:userId/reset-password', async ({ request, params, body }) => {
      const {
        store,
        auth,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      const user = requireUser(store, params.userId);
      assertAdminMayResetPassword(auth.userId, user);
      if (!config.getAuthConfig().accountEmails.manualPasswordReset) {
        throw new AuthError('Manual password reset is disabled', 'MANUAL_PASSWORD_RESET_DISABLED', 403);
      }
      const reset = await store.resetPassword(params.userId, body.password, {
        audit: {
          actor: authAuditActorFromContext(auth),
          request: authAuditRequestFromRequest(request),
        },
        beforeCommit: () => {
          const current = assertCurrentAuthority({ targetUserId: params.userId });
          assertAdminMayResetPassword(current.userId, requireUser(store, params.userId));
        },
      });
      if (!reset) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      emitCode(OBS_CODES.AUTH_ADMIN_PASSWORD_RESET, {
        userId: auth.userId,
        metadata: { resetUserId: params.userId },
      });
      return { ok: true };
    }, {
      ...schema,
      body: t.Object({ password: authNewPasswordSchema }),
    })
    .post('/users/:userId/send-setup-email', async ({ request, params }) => {
      const {
        store,
        auth,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      await lifecycle(config, store).sendSetup(
        params.userId,
        assertCurrentAuthority,
        authAuditRequestFromRequest(request),
      );
      emitCode(OBS_CODES.AUTH_ADMIN_SETUP_EMAIL_SENT, {
        userId: auth.userId,
        metadata: { targetUserId: params.userId },
      });
      return { ok: true, setupEmailSent: true };
    }, schema)
    .post('/users/:userId/send-password-reset', async ({ request, params }) => {
      const {
        store,
        auth,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      if (!config.getAuthConfig().accountEmails.passwordReset) {
        throw new AuthError('Password reset email is disabled', 'PASSWORD_RESET_DISABLED', 403);
      }
      await lifecycle(config, store).sendPasswordReset(
        params.userId,
        assertCurrentAuthority,
        authAuditRequestFromRequest(request),
      );
      emitCode(OBS_CODES.AUTH_ADMIN_PASSWORD_RESET_EMAIL_SENT, {
        userId: auth.userId,
        metadata: { resetUserId: params.userId },
      });
      return { ok: true };
    }, schema)
    .post('/users/:userId/clear-password-change-requirement', async ({ request, params }) => {
      const {
        store,
        auth,
        assertCurrentAuthority,
      } = await requireAdminMutationServices(config, request);
      const user = new AdminPasswordRecoveryService(store, emitCode)
        .clearPasswordChangeRequirement(params.userId, assertCurrentAuthority, {
          actor: authAuditActorFromContext(auth),
          request: authAuditRequestFromRequest(request),
        });
      emitCode(OBS_CODES.AUTH_ADMIN_PASSWORD_CHANGE_REQUIREMENT_CLEARED, {
        userId: auth.userId,
        metadata: { targetUserId: params.userId },
      });
      return { user };
    }, schema);
}

function lifecycle(config: AuthAdminPluginConfig, store: UserStore) {
  const tokens = config.getActionTokenService();
  const email = config.getAccountEmailService();
  if (!tokens || !email) throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  return new AdminLifecycleEmailService(store, tokens, email, getAuthAdminEmitter(config));
}

function requireUser(store: UserStore, userId: string) {
  const user = store.getUserById(userId);
  if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  return user;
}
