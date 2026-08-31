/**
 * auth-user-properties.plugin.ts
 *
 * Elysia controller for current-user metadata/property routes. The file owns
 * request validation and authorization; UserStore and UserPropertyService own
 * persistence and write policy.
 */

import { Elysia, t } from 'elysia';
import { extractAuthContext } from './auth-context';
import type { TokenService } from './token-service';
import { AuthError } from './types';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { assertAuthPropertyValueBound } from './auth-request-property-bounds';
import { authPropertyKeySchema } from './auth-request-schema';

export interface AuthUserPropertiesPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getPropertyService: () => UserPropertyService | null;
}

/** Create current-user property routes mounted directly under `/auth`. */
export function createAuthUserPropertiesPlugin(config: AuthUserPropertiesPluginConfig) {
  return new Elysia({ name: 'auth-user-properties' })
    .put(
      '/me/properties/:key',
      async ({ params, body, request }) => {
        const { store, tokenService, propertyService } = requirePropertyServices(config);
        const authContext = await extractAuthContext(request, tokenService);
        if (!authContext) {
          throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
        }

        let value: string;
        try {
          value = propertyService.validateWrite(params.key, body.value, 'user');
        } catch (err) {
          emitPlatformCode(OBS_CODES.AUTH_USER_PROPERTY_REJECTED, {
            error: err,
            userId: authContext.userId,
            metadata: { key: params.key },
          });
          throw err;
        }

        store.setProperty(authContext.userId, params.key, value);
        return { ok: true };
      },
      {
        params: t.Object({ key: authPropertyKeySchema }),
        body: t.Object({ value: t.Unknown() }),
        beforeHandle: ({ body }) => assertAuthPropertyValueBound(body.value),
      }
    )
    .get('/me/properties', async ({ request }) => {
      const { store, tokenService } = requirePropertyServices(config);
      const authContext = await extractAuthContext(request, tokenService);
      if (!authContext) {
        throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
      }

      return { properties: store.getProperties(authContext.userId) };
    })
    .get(
      '/me/properties/:key',
      async ({ params, request }) => {
        const { store, tokenService } = requirePropertyServices(config);
        const authContext = await extractAuthContext(request, tokenService);
        if (!authContext) {
          throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
        }

        const value = store.getProperty(authContext.userId, params.key);
        if (value === null) {
          throw new AuthError('Property not found', 'PROPERTY_NOT_FOUND', 404);
        }

        return { key: params.key, value };
      },
      {
        params: t.Object({ key: authPropertyKeySchema }),
      }
    )
    .delete(
      '/me/properties/:key',
      async ({ params, request }) => {
        const { store, tokenService, propertyService } = requirePropertyServices(config);
        const authContext = await extractAuthContext(request, tokenService);
        if (!authContext) {
          throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
        }

        try {
          propertyService.deleteProperty(authContext.userId, params.key, 'user', store);
        } catch (err) {
          emitPlatformCode(OBS_CODES.AUTH_USER_PROPERTY_REJECTED, {
            error: err,
            userId: authContext.userId,
            metadata: { key: params.key },
          });
          throw err;
        }

        return { ok: true };
      },
      {
        params: t.Object({ key: authPropertyKeySchema }),
      }
    );
}

interface AuthUserPropertyServices {
  store: UserStore;
  tokenService: TokenService;
  propertyService: UserPropertyService;
}

function requirePropertyServices(
  config: AuthUserPropertiesPluginConfig
): AuthUserPropertyServices {
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const propertyService = config.getPropertyService();
  if (!store || !tokenService || !propertyService) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }

  return { store, tokenService, propertyService };
}
