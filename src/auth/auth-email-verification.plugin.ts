/** Email-verification completion HTTP route. */

import { Elysia, t } from 'elysia';
import {
  requireAccountTokenService,
  type AuthAccountPluginConfig,
} from './auth-account-dependencies';
import { completeEmailVerification } from './auth-email-verification-service';
import { authTokenSchema } from './auth-request-schema';
import { syncPageSessionCookie } from './page-session';
import { authAuditRequestFromRequest } from './auth-audit-service';

export function createAuthEmailVerificationPlugin(config: AuthAccountPluginConfig) {
  return new Elysia({ name: 'auth-email-verification' }).post(
    '/verify-email',
    async ({ body, request, set }) => {
      const response = await completeEmailVerification(
        config,
        body.token,
        authAuditRequestFromRequest(request),
      );
      await syncPageSessionCookie(
        set, request, requireAccountTokenService(config), response,
        { clearWhenMissing: true }
      );
      return response;
    },
    { body: t.Object({ token: authTokenSchema }) }
  );
}
