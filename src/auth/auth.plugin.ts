/**
 * auth.plugin.ts
 *
 * Composition root for Zero auth. This file owns auth plugin lifecycle wiring,
 * shared error mapping, and subplugin registration only. Auth schema, runtime
 * services, session routes, account routes, admin routes, MFA routes, and user
 * property routes live in dedicated files.
 */

import { Elysia } from 'elysia';
import { EmailError } from '../email/email-error';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { getSafeRequestPath } from '../observability/safe-request-path';
import { createAuthAccountPlugin } from './auth-account.plugin';
import { createAuthAdminPlugin } from './auth-admin.plugin';
import { resolveAuthBehaviorConfig } from './auth-config';
import { createAuthMfaPlugin } from './auth-mfa.plugin';
import {
  getAccountEmailService,
  getActionTokenService,
  getAuthRuntimeContext,
  getAuthEmailOutbox,
  getAuthStore,
  getMfaChallengeService,
  getMfaService,
  getNativeAuthorizationService,
  getPropertyService,
  getRegistrationIntentStore,
  getTokenService,
  startAuthRuntime,
  stopAuthRuntime,
} from './auth-runtime';
import { createAuthSessionPlugin } from './auth-session.plugin';
import { createAuthUserPropertiesPlugin } from './auth-user-properties.plugin';
import { emitAuthRequestValidationRejected } from './auth-request-validation';
import { AuthError, type AuthPluginConfig } from './types';
import { createNativeAuthPlugin } from './oidc/auth-native.plugin';
import { resolveNativeRuntimeConfig } from './oidc/native-runtime-config';

export {
  getAuthEmailOutbox,
  getAuthStore,
  getMfaChallengeService,
  getMfaMethodStore,
  getMfaService,
  getTokenService,
} from './auth-runtime';

/** Create the root auth plugin mounted at `/auth`. */
export function createAuthPlugin(config: AuthPluginConfig) {
  const authConfig = resolveAuthBehaviorConfig(config);
  const nativeRuntime = resolveNativeRuntimeConfig(config, authConfig);
  let runtimeStarted = false;

  return new Elysia({ name: 'auth', prefix: '/auth' })
    .onStart(async () => {
      runtimeStarted = true;
      await startAuthRuntime(config, authConfig);
    })
    .onStop(async () => {
      if (!runtimeStarted) return;
      runtimeStarted = false;
      await stopAuthRuntime();
    })
    .derive({ as: 'global' }, () => getAuthRuntimeContext())
    .onError(({ code, error, request, set }) => {
      if (error instanceof AuthError) {
        if (error.code === 'AUTH_VALIDATION_FAILED') {
          emitAuthRequestValidationRejected(request);
        }
        set.status = error.status;
        return {
          error: error.message,
          code: error.code,
        };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        emitAuthRequestValidationRejected(request);
        return {
          error: 'Invalid auth request',
          code: 'AUTH_VALIDATION_FAILED',
        };
      }
      if (code === 'PARSE') {
        set.status = 400;
        return {
          error: 'Invalid auth request body',
          code: 'AUTH_REQUEST_PARSE_FAILED',
        };
      }
      if (code === 'NOT_FOUND') {
        set.status = 404;
        return {
          error: 'Auth route not found',
          code: 'AUTH_ROUTE_NOT_FOUND',
        };
      }
      if (error instanceof EmailError) {
        set.status = error.status;
        return {
          error: error.status >= 500
            ? 'Email delivery failed. Check the email provider configuration and logs.'
            : 'Email delivery was rejected.',
          code: error.code,
        };
      }

      set.status = 500;
      emitPlatformCode(OBS_CODES.APP_REQUEST_FAILED, {
        error,
        metadata: {
          method: request.method,
          path: getSafeRequestPath(request),
          status: 500,
        },
      });
      return {
        error: 'Auth request failed',
        code: 'AUTH_INTERNAL_ERROR',
      };
    })
    .use(createAuthSessionPlugin({
      getUserStore: getAuthStore,
      getTokenService,
      getPropertyService,
      getActionTokenService,
      getAccountEmailService,
      getMfaService,
      getMfaChallengeService,
      getNativeAuthorizationService,
      getRegistrationIntentStore,
      getAuthConfig: () => authConfig,
    }))
    .use(createAuthAccountPlugin({
      getUserStore: getAuthStore,
      getTokenService,
      getActionTokenService,
      getAccountEmailService,
      getAuthEmailOutbox,
      getMfaChallengeService,
      getNativeAuthorizationService,
      getRegistrationIntentStore,
      getAuthConfig: () => authConfig,
    }))
    .use(createAuthMfaPlugin({
      getUserStore: getAuthStore,
      getTokenService,
      getMfaChallengeService,
      getAuthConfig: () => authConfig,
    }))
    .use(createAuthAdminPlugin({
      getUserStore: getAuthStore,
      getTokenService,
      getPropertyService,
      getActionTokenService,
      getAccountEmailService,
      getMfaService,
      getMfaChallengeService,
      getAuthConfig: () => authConfig,
    }))
    .use(createAuthUserPropertiesPlugin({
      getUserStore: getAuthStore,
      getTokenService,
      getPropertyService,
    }))
    .use(nativeRuntime
      ? createNativeAuthPlugin({
          ...nativeRuntime,
          getService: getNativeAuthorizationService,
          getTokenService,
          getUserStore: getAuthStore,
        })
      : new Elysia({ name: 'auth-native-disabled' }));
}
