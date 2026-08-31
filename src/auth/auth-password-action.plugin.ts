/** Password-reset and initial-password setup HTTP routes. */

import { Elysia, t } from 'elysia';
import type { AuthAccountPluginConfig } from './auth-account-dependencies';
import { completePasswordAction } from './auth-password-action-service';
import { authNewPasswordSchema, authTokenSchema } from './auth-request-schema';
import { clearPageSessionCookie } from './page-session';

const passwordBody = t.Object({
  token: authTokenSchema,
  newPassword: authNewPasswordSchema,
});

export function createAuthPasswordActionPlugin(config: AuthAccountPluginConfig) {
  return new Elysia({ name: 'auth-password-action' })
    .post(
      '/reset-password',
      async ({ body, request, set }) => {
        const response = await completePasswordAction(config, {
          rawToken: body.token,
          newPassword: body.newPassword,
          allowedTypes: ['password_reset', 'admin_password_reset'],
        });
        clearPageSessionCookie(set, request);
        return response;
      },
      { body: passwordBody }
    )
    .post(
      '/setup-password',
      async ({ body, request, set }) => {
        const response = await completePasswordAction(config, {
          rawToken: body.token,
          newPassword: body.newPassword,
          allowedTypes: ['account_setup'],
        });
        clearPageSessionCookie(set, request);
        return response;
      },
      { body: passwordBody }
    );
}
