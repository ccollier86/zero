/**
 * server-route.ts
 *
 * Provides the app-owned Elysia route factory for package-mode apps. This file
 * owns route-context ergonomics only; platform services remain initialized by
 * createApp() and are resolved through their existing singleton boundaries.
 */

import { Elysia } from 'elysia';
import type { ElysiaConfig } from 'elysia';

import { createAuthMiddleware } from '../../auth/auth.middleware';
import { getTokenService } from '../../auth/auth.plugin';
import { createLazyServerRouteServices } from './server-services';
export {
  createLazyServerRouteServices,
  getServerRouteServices,
} from './server-services';
export type {
  ServerAuthServices,
  ServerObservabilityServices,
  ServerRouteServices,
} from './server-services';

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
export function createServerRoute(options?: ServerRouteOptions) {
  return new Elysia(options)
    .use(createAuthMiddleware(getTokenService))
    .resolve({ as: 'global' }, function resolveZeroRouteServices() {
      return {
        zero: createLazyServerRouteServices(),
      };
    });
}
