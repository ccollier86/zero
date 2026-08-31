/** Self-service registration HTTP route and request validation. */

import { Elysia, t } from 'elysia';
import { canonicalEmailSchema } from './auth-email-schema';
import {
  authDisplayNameSchema,
  authNativeContinuationSchema,
  authNewPasswordSchema,
  authUsernameSchema,
} from './auth-request-schema';
import { registerUser } from './auth-registration-service';
import {
  requireSessionTokenService,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { syncPageSessionCookie } from './page-session';

export function createAuthRegistrationPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-registration' }).post(
    '/register',
    async ({ body, request, set }) => {
      const response = await registerUser(config, body);
      await syncPageSessionCookie(
        set, request, requireSessionTokenService(config), response,
        { clearWhenMissing: true }
      );
      return response;
    },
    {
      body: t.Object({
        username: authUsernameSchema,
        email: canonicalEmailSchema,
        password: authNewPasswordSchema,
        firstName: t.Optional(authDisplayNameSchema),
        lastName: t.Optional(authDisplayNameSchema),
        mfaEnrollment: t.Optional(t.Boolean()),
        nativeContinuation: t.Optional(authNativeContinuationSchema),
      }),
    }
  );
}
