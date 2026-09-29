/** Authenticated password-change route. */

import { Elysia, t } from 'elysia';
import { extractAuthContext } from './auth-context';
import {
  requireSessionServices,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { authNewPasswordSchema, authPasswordSchema } from './auth-request-schema';
import { syncPageSessionCookie } from './page-session';
import { AuthError } from './types';
import {
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';
import { captureAuthSessionIdentityAdmission } from './auth-session-identity-proof';

export function createAuthChangePasswordPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-change-password' }).post(
    '/change-password',
    async ({ body, request, set }) => {
      const { store, tokenService } = requireSessionServices(config);
      const auth = await extractAuthContext(request, tokenService);
      if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
      const admission = captureAuthSessionIdentityAdmission(auth, tokenService);

      const receipt = await store.updatePasswordForAuthentication(
        auth.userId,
        body.currentPassword,
        body.newPassword,
        {
          actor: authAuditActorFromContext(auth),
          request: authAuditRequestFromRequest(request),
        },
        {
          expectedAuthGeneration: admission.authGeneration,
          admit: admission.consume,
        },
      );
      if (!receipt) {
        throw new AuthError(
          'Current password is incorrect', 'INVALID_PASSWORD', 400
        );
      }
      const user = store.getUserById(auth.userId);
      if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      if (user.status === 'suspended') {
        throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
      }

      const tokens = await tokenService.issueTokenPair(user, {
        binding: auth.tenantId && auth.membershipId
          ? { tenantId: auth.tenantId, membershipId: auth.membershipId }
          : undefined,
        expectedAuthGeneration: receipt.authGeneration,
      });
      const response = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
      await syncPageSessionCookie(set, request, tokenService, response);
      return response;
    },
    {
      body: t.Object({
        currentPassword: authPasswordSchema,
        newPassword: authNewPasswordSchema,
      }),
    }
  );
}
