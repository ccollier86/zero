/** Password-login HTTP route. */

import { Elysia, t } from 'elysia';
import { loginUser } from './auth-login-service';
import {
  requireSessionTokenService,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { authLoginIdentifierSchema, authPasswordSchema } from './auth-request-schema';
import { syncPageSessionCookie } from './page-session';

export function createAuthLoginPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-login' }).post(
    '/login',
    async ({ body, request, set }) => {
      const response = await loginUser(config, body);
      await syncPageSessionCookie(
        set, request, requireSessionTokenService(config), response,
        { clearWhenMissing: true }
      );
      return response;
    },
    {
      body: t.Object({
        username: authLoginIdentifierSchema,
        password: authPasswordSchema,
      }),
    }
  );
}
