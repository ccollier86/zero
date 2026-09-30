/**
 * server-route.ts
 *
 * Provides the app-owned Elysia route factory for package-mode apps. This file
 * owns route-context ergonomics only; managed createApp() composition binds
 * platform services to the app's explicit ZeroAppRuntime.
 */

import { Elysia } from 'elysia';
import type { ElysiaConfig } from 'elysia';

import { createAuthMiddleware } from '../../auth/auth.middleware';
import {
  getAuthRequestCredentialResolver,
  getAuthorizationKernel,
  getAuthStore,
  getTokenService,
} from '../../auth/auth.plugin';
import { createLazyServerRouteServices } from './server-services';
import {
  createDeferredServerRequestServices,
  type ServerRequestServices,
} from './server-request-services';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
} from '../../runtime/service-keys';
export {
  createLazyServerRouteServices,
  getServerRouteServices,
} from './server-services';
export type {
  ServerAuthServices,
  ServerObservabilityServices,
  ServerRouteServices,
} from './server-services';
export type { ServerRequestServices } from './server-request-services';
export { UnsafeServerServiceAccessError } from './server-request-services';

/** Options accepted by createServerRoute(). */
export type ServerRouteOptions = ElysiaConfig<string>;

/**
 * Create an app-owned Elysia route plugin with Zero service helpers.
 *
 * The returned instance includes auth middleware for typed `authContext`,
 * `requireAuth()`, and `requireAdmin()` helpers, plus a `zero` object containing
 * server-only platform services. Mount these plugins through createApp()'s
 * app-owned backend extension loader or directly with `app.use()`.
 */
export function createServerRoute(
  options?: ServerRouteOptions,
  runtime?: ZeroAppRuntime,
) {
  return new Elysia(options)
    .use(createAuthMiddleware(
      runtime
        ? () => runtime.get(ZERO_AUTH_TOKEN_SERVICE)
        : getTokenService,
      {
        getRequestCredentialResolver: runtime
          ? () => runtime.get(ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER)
          : getAuthRequestCredentialResolver,
        getAuthorizationKernel: runtime
          ? () => runtime.get(ZERO_AUTHORIZATION_KERNEL)
          : getAuthorizationKernel,
        getPropertyStore: runtime
          ? () => runtime.get(ZERO_AUTH_STORE)
          : getAuthStore,
        getRoleAssignments: runtime
          ? () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE)
          : undefined,
      },
    ))
    .resolve({ as: 'global' }, function resolveZeroRouteServices(context) {
      const inherited = (context as {
        zero?: ServerRequestServices;
      }).zero;
      return {
        zero: inherited ?? createDeferredServerRequestServices({
          request: context.request,
          access: context.access,
          services: createLazyServerRouteServices(runtime),
        }),
      };
    });
}
