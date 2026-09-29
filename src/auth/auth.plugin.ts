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
import { getSafeRequestPath } from '../observability/safe-request-path';
import { createAuthAccountPlugin } from './auth-account.plugin';
import { createAuthAdminPlugin } from './auth-admin.plugin';
import { getPublicAuthErrorMessage } from './auth-error-response';
import { createAuthApplicationAdministrationPlugin } from './auth-application-administration.plugin';
import { createAuthAuthorizationPlugin } from './auth-authorization.plugin';
import { createAuthAuditPlugin } from './auth-audit.plugin';
import { resolveAuthBehaviorConfig } from './auth-config';
import { createAuthMfaPlugin } from './auth-mfa.plugin';
import {
  createAuthRuntime,
  registerAuthRuntimeCompatibility,
} from './auth-runtime';
import { createAuthSessionPlugin } from './auth-session.plugin';
import { createAuthUserPropertiesPlugin } from './auth-user-properties.plugin';
import { createAuthTenantAdministrationPlugin } from './auth-tenant-administration.plugin';
import { createAuthPlatformAdministrationPlugin } from './auth-platform-administration.plugin';
import { createAuthTenantOnboardingPlugin } from './auth-tenant-onboarding.plugin';
import { createAuthVerifiedDomainPlugin } from './auth-verified-domain.plugin';
import { emitAuthRequestValidationRejected } from './auth-request-validation';
import { createAuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { applyAuthPrivateNoStore } from './auth-response-cache';
import {
  AuthError,
  type AuthBehaviorConfig,
  type AuthPluginConfig,
} from './types';
import { createNativeAuthPlugin } from './oidc/auth-native.plugin';
import { resolveNativeRuntimeConfig } from './oidc/native-runtime-config';

export {
  getAuthAuditService,
  getAuthEmailOutbox,
  getAuthSessionService,
  getAuthStore,
  getAuthorizationKernel,
  getAuthorizationRoleService,
  getMfaChallengeService,
  getMfaMethodStore,
  getMfaService,
  getTokenService,
  getVerifiedDomainOnboardingService,
} from './auth-runtime';

/** Create the root auth plugin mounted at `/auth`. */
export function createAuthPlugin(config: AuthPluginConfig) {
  const authConfig = resolveAuthBehaviorConfig(authBehaviorConfig(config));
  const nativeRuntime = resolveNativeRuntimeConfig(config, authConfig);
  const runtime = createAuthRuntime(config, authConfig);
  const emitCode = createAuthPlatformCodeEmitter(config.runtime);
  if (config.onRuntimeCreated) {
    invokeSynchronousAuthCallback(
      () => config.onRuntimeCreated!(runtime),
      {
        component: 'auth-plugin',
        invariant: 'runtime-created-callback-async',
        message: '[auth] onRuntimeCreated callback must be synchronous.',
        emitCode,
      },
    );
  }
  const compatibilityOwner = {};
  const compatibilityRegistration = registerAuthRuntimeCompatibility(
    compatibilityOwner,
    runtime,
  );
  let compatibilityRegistered = true;
  const unregisterCompatibility = () => {
    if (!compatibilityRegistered) return;
    compatibilityRegistered = false;
    compatibilityRegistration.unregister();
  };
  let startupPromise: Promise<void> | null = null;
  const ensureStarted = (): Promise<void> => {
    if (startupPromise) return startupPromise;
    startupPromise = runtime.start();
    // Bun/Elysia does not await plugin onStart promises. Attach a rejection
    // handler immediately; request admission awaits this exact promise below.
    void startupPromise.catch(() => undefined);
    return startupPromise;
  };
  config.runtime?.addCleanup(async () => {
    try {
      await runtime.stop();
    } finally {
      unregisterCompatibility();
    }
  });

  const getUserStore = () => runtime.getStore();
  const getAuditService = () => runtime.getAuditService();
  const getTokenService = () => runtime.getTokenService();
  const getTenancyService = () => runtime.getTenancyService();
  const getAuthTenantSessionService = () => runtime.getAuthTenantSessionService();
  const getApplicationAdministrationService = () => (
    runtime.getApplicationAdministrationService()
  );
  const getTenantAdministrationService = () => runtime.getTenantAdministrationService();
  const getPlatformTenantAdministrationService = () => (
    runtime.getPlatformTenantAdministrationService()
  );
  const getTenantOnboardingService = () => runtime.getTenantOnboardingService();
  const getVerifiedDomainOnboardingService = () => (
    runtime.getVerifiedDomainOnboardingService()
  );
  const getAuthorizationKernel = () => runtime.getAuthorizationKernel();
  const getAuthorizationRoleService = () => runtime.getAuthorizationRoleService();
  const getRequestAdmissionService = () => runtime.getRequestAdmissionService();
  const getPropertyService = () => runtime.getPropertyService();
  const getActionTokenService = () => runtime.getActionTokenService();
  const getAccountEmailService = () => runtime.getAccountEmailService();
  const getAuthEmailOutbox = () => runtime.getAuthEmailOutbox();
  const getMfaService = () => runtime.getMfaService();
  const getMfaChallengeService = () => runtime.getMfaChallengeService();
  const getNativeAuthorizationService = () => runtime.getNativeAuthorizationService();
  const getRegistrationIntentStore = () => runtime.getRegistrationIntentStore();
  const getEmailRuntime = () => runtime.getEmailRuntime();

  return new Elysia({ name: 'auth', prefix: '/auth' })
    .onStart((lifecycle) => {
      void ensureStarted().catch(async (startupError) => {
        emitCode(OBS_CODES.AUTH_START_FAILED, {
          error: startupError,
          metadata: { plugin: 'auth' },
        });
        try {
          await runtime.stop();
        } catch (cleanupError) {
          emitCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
            error: new AggregateError(
              [startupError, cleanupError],
              '[auth] Startup and cleanup both failed.',
            ),
            metadata: { phase: 'start', plugin: 'auth' },
          });
        } finally {
          unregisterCompatibility();
        }
        try {
          await lifecycle.server?.stop(true);
        } catch (transportError) {
          emitCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
            error: new AggregateError(
              [startupError, transportError],
              '[auth] Startup failed and the listener could not be stopped.',
            ),
            metadata: { phase: 'start', plugin: 'auth' },
          });
        }
      });
    })
    .onRequest(async ({ request, set }) => {
      await ensureStarted();
      if (isAuthNamespaceRequest(request)) runtime.assertCurrentProfile();
      // Auth POST responses commonly contain access, refresh, continuation,
      // recovery, or setup credentials. Apply one fail-closed cache policy at
      // the namespace boundary so new routes cannot accidentally omit it.
      // JWKS is the sole deliberately cacheable auth representation.
      if (isAuthNamespaceRequest(request) && !isAuthPublicKeyRequest(request)) {
        applyAuthPrivateNoStore(set);
      }
    })
    .onStop(async () => {
      try {
        await runtime.stop();
      } finally {
        unregisterCompatibility();
      }
    })
    .derive({ as: 'global' }, () => runtime.getContext())
    .onError({ as: 'global' }, ({ code, error, request, set }) => {
      // Elysia invokes request hooks before plugin-local error handlers. Keep
      // the auth namespace on one public-safe boundary without changing error
      // handling for the rest of the host application.
      if (!isAuthNamespaceRequest(request)) return undefined;
      if (error instanceof AuthError) {
        if (error.code === 'AUTH_VALIDATION_FAILED') {
          emitAuthRequestValidationRejected(request, emitCode);
        }
        if (error.status >= 500) {
          emitCode(OBS_CODES.APP_REQUEST_FAILED, {
            metadata: {
              method: request.method,
              path: getSafeRequestPath(request),
              status: error.status,
              authCode: error.code,
            },
          });
        }
        set.status = error.status;
        return {
          error: getPublicAuthErrorMessage(error),
          code: error.code,
        };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        emitAuthRequestValidationRejected(request, emitCode);
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
      emitCode(OBS_CODES.APP_REQUEST_FAILED, {
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
      getUserStore,
      getTokenService,
      getPropertyService,
      getActionTokenService,
      getAccountEmailService,
      getMfaService,
      getMfaChallengeService,
      getNativeAuthorizationService,
      getRegistrationIntentStore,
      getTenancyService,
      getAuthTenantSessionService,
      getRequestAdmissionService,
      getEmailRuntime,
      getAuthConfig: () => authConfig,
      emitCode,
    }))
    .use(createAuthAccountPlugin({
      getUserStore,
      getTokenService,
      getActionTokenService,
      getAccountEmailService,
      getAuthEmailOutbox,
      getMfaChallengeService,
      getNativeAuthorizationService,
      getRegistrationIntentStore,
      getAuthConfig: () => authConfig,
      getAuthTenantSessionService,
      emitCode,
    }))
    .use(createAuthMfaPlugin({
      getUserStore,
      getTokenService,
      getMfaChallengeService,
      getAuthConfig: () => authConfig,
      getAuthTenantSessionService,
    }))
    .use(createAuthAdminPlugin({
      getUserStore,
      getTokenService,
      getAuthorizationKernel,
      getAuthorizationRoleService,
      getPropertyService,
      getActionTokenService,
      getAccountEmailService,
      getMfaService,
      getMfaChallengeService,
      getEmailRuntime,
      getAuthConfig: () => authConfig,
      emitCode,
    }))
    .use(createAuthUserPropertiesPlugin({
      getUserStore,
      getTokenService,
      getPropertyService,
      emitCode,
    }))
    .use(createAuthAuthorizationPlugin({
      getUserStore,
      getTokenService,
      getAuthorizationKernel,
      getAuthorizationRoleService,
    }))
    .use(createAuthAuditPlugin({
      getService: getAuditService,
      getUserStore,
      getTokenService,
      getAuthorizationKernel,
      getAuthorizationRoleService,
    }))
    .use(authConfig.tenancy?.mode === 'single'
      && authConfig.authorization?.mode === 'advanced'
      ? createAuthApplicationAdministrationPlugin({
          getUserStore,
          getTokenService,
          getAuthorizationKernel,
          getAuthorizationRoleService,
          getApplicationAdministrationService,
        })
      : new Elysia({ name: 'auth-application-administration-disabled' }))
    .use(createAuthTenantAdministrationPlugin({
      getUserStore,
      getTokenService,
      getTenancyService,
      getAuthorizationKernel,
      getAuthorizationRoleService,
      getTenantAdministrationService,
    }))
    .use(authConfig.tenancy?.mode === 'multi'
      ? createAuthPlatformAdministrationPlugin({
          getUserStore,
          getTokenService,
          getTenancyService,
          getAuthorizationKernel,
          getAuthorizationRoleService,
          getTenantAdministrationService,
          getTenantOnboardingService,
          getPlatformTenantAdministrationService,
          getAccountEmailService,
          getAuthEmailOutbox,
        })
      : new Elysia({ name: 'auth-platform-administration-disabled' }))
    .use(authConfig.tenancy?.mode === 'multi'
      ? createAuthTenantOnboardingPlugin({
          getService: getTenantOnboardingService,
          getUserStore,
          getTokenService,
          getPropertyService,
          getTenantSessionService: getAuthTenantSessionService,
          getMfaChallengeService,
          getRequestAdmissionService,
          getAuthorizationKernel,
          getAuthorizationRoleService,
          getAuthConfig: () => authConfig,
          getAccountEmailService,
          getAuthEmailOutbox,
        })
      : new Elysia({ name: 'auth-tenant-onboarding-disabled' }))
    .use(authConfig.tenancy?.mode === 'multi'
      ? createAuthVerifiedDomainPlugin({
          getService: getVerifiedDomainOnboardingService,
          getUserStore,
          getTokenService,
          getTenantSessionService: getAuthTenantSessionService,
          getRequestAdmissionService,
          getAuthorizationKernel,
          getAuthorizationRoleService,
          getAccountEmailService,
          getAuthEmailOutbox,
        })
      : new Elysia({ name: 'auth-verified-domain-disabled' }))
    .use(nativeRuntime
      ? createNativeAuthPlugin({
          ...nativeRuntime,
          emitCode,
          getService: getNativeAuthorizationService,
          getTokenService,
          getUserStore,
        })
      : new Elysia({ name: 'auth-native-disabled' }))
    .all('/*', ({ set }) => {
      set.status = 404;
      return {
        error: 'Auth route not found',
        code: 'AUTH_ROUTE_NOT_FOUND',
      };
    });
}

function isAuthPublicKeyRequest(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  return pathname === '/auth/jwks';
}

function isAuthNamespaceRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return pathname === '/auth' || pathname.startsWith('/auth/');
}

/** Keep plugin wiring fields outside the strict developer auth behavior shape. */
function authBehaviorConfig(config: AuthPluginConfig): AuthBehaviorConfig {
  const {
    db: _db,
    runtime: _runtime,
    emailRuntime: _emailRuntime,
    getEmailRuntime: _getEmailRuntime,
    platformTokenService: _platformTokenService,
    getPlatformTokenService: _getPlatformTokenService,
    onRuntimeCreated: _onRuntimeCreated,
    accessTokenTTL: _accessTokenTTL,
    refreshTokenTTL: _refreshTokenTTL,
    nativeIssuer: _nativeIssuer,
    nativeAudience: _nativeAudience,
    loginPath: _loginPath,
    registrationPath: _registrationPath,
    ...behavior
  } = config;
  return behavior;
}
