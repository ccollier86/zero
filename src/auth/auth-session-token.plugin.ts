/** Refresh-token rotation and logout routes. */

import { Elysia, t } from 'elysia';
import {
  revokeAndClearPageSessionCookie,
  syncPageSessionCookie,
} from './page-session';
import {
  requireSessionTokenService,
  type AuthSessionPluginConfig,
} from './auth-session-dependencies';
import { authTokenSchema } from './auth-request-schema';
import { AuthError } from './types';

export function createAuthSessionTokenPlugin(config: AuthSessionPluginConfig) {
  return new Elysia({ name: 'auth-session-token' })
    .post(
      '/refresh',
      async ({ body, request, set }) => {
        const tokens = requireSessionTokenService(config);
        const result = await tokens.rotateRefreshToken(body.refreshToken);
        if (!result) {
          await revokeAndClearPageSessionCookie(set, request, tokens);
          throw new AuthError(
            'Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN', 401
          );
        }
        const response = {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        };
        await syncPageSessionCookie(set, request, tokens, response);
        return response;
      },
      { body: t.Object({ refreshToken: authTokenSchema }) }
    )
    .post(
      '/logout',
      async ({ body, request, set }) => {
        const tokens = requireSessionTokenService(config);
        if (body.refreshToken) tokens.revokeRefreshTokenByRaw(body.refreshToken);
        await revokeAndClearPageSessionCookie(set, request, tokens);
        return { ok: true };
      },
      {
        body: t.Object({
          refreshToken: t.Optional(authTokenSchema),
        }),
      }
    );
}
