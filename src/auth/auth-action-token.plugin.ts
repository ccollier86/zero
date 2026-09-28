/** Read-only action-token inspection route used by lifecycle pages. */

import { Elysia, t } from 'elysia';
import {
  requireAccountServices,
  type AuthAccountPluginConfig,
} from './auth-account-dependencies';
import { authTokenSchema } from './auth-request-schema';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import type { UserRecord } from './types';

export function createAuthActionTokenPlugin(config: AuthAccountPluginConfig) {
  return new Elysia({ name: 'auth-action-token' }).get(
    '/action-token/:token',
    ({ params, set }) => {
      applyAuthPrivateNoStore(set);
      const { record, user } = requireAccountServices(config)
        .actionTokens.inspect(params.token);
      return {
        valid: true,
        type: record.type,
        expiresAt: record.expiresAt,
        user: toActionTokenUserResponse(user),
      };
    },
    { params: t.Object({ token: authTokenSchema }) }
  );
}

function toActionTokenUserResponse(user: UserRecord) {
  return { userId: user.userId, username: user.username, email: user.email };
}
