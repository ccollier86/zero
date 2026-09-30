/**
 * auth.middleware.ts
 *
 * Resolves per-request authentication for Elysia route plugins. This file owns
 * HTTP Authorization header parsing and request-scoped auth helpers; token
 * issuance and user persistence remain in the auth plugin services.
 */

import { Elysia } from 'elysia';
import { readAuthBearerToken } from './auth-bearer-token';
import { extractAuthContext } from './auth-context';
import { getPublicAuthErrorMessage } from './auth-error-response';
import {
  createRequestAuthorizationAccess,
  type AuthorizationRoleAssignmentResolver,
  type AuthorizationPropertyStore,
  type RequestAuthorizationAccess,
} from './authorization-access';
import type {
  AccessRequirement,
  AuthorizationKernel,
  CompiledAccessRequirement,
} from './authorization-kernel';
import type { AuthRequestCredentialResolver } from './auth-api-key-types';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';

/** Route-level authorization understood by the raw Elysia `zeroAuth` macro. */
export type ZeroElysiaAuthRequirement = AccessRequirement;

/** App-local dependencies used to build the request authorization snapshot. */
export interface AuthMiddlewareAuthorizationOptions {
  /** Optional Guardian dispatcher for session and explicitly admitted API-key credentials. */
  getRequestCredentialResolver?: () => AuthRequestCredentialResolver | null;
  getAuthorizationKernel?: () => AuthorizationKernel | null;
  getPropertyStore?: () => AuthorizationPropertyStore | null;
  getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
}

/**
 * One request can pass through the root app and one or more nested Elysia
 * plugins. Cache the live hydration by both Request and the app-local
 * credential resolver (or legacy TokenService) so those layers share one
 * authoritative lookup without coupling separate apps.
 */
const requestAccessResolutions = new WeakMap<
  Request,
  Map<object, Promise<RequestAuthorizationAccess>>
>();

/**
 * Auth middleware — resolves `authContext` + typed helpers into global Elysia context.
 *
 * Uses `resolve` (not `derive`) so types propagate across plugin boundaries.
 * Named plugin — Elysia deduplicates by name, runs once.
 *
 * - Does NOT throw on missing/invalid tokens — sets `authContext: null`
 * - Provides `requireAuth()` and `requireAdmin()` typed helpers
 * - All consuming plugins get proper types without casts
 *
 * Mount AFTER the auth plugin (needs getTokenService() to return non-null):
 * ```ts
 * app
 *   .use(createAuthPlugin({ db }))
 *   .use(createAuthMiddleware(getTokenService))
 *   .use(createNotificationPlugin({ db }))  // gets requireAuth() typed
 * ```
 */
export function createAuthMiddleware(
  getTokenService: () => TokenService | null,
  authorization: AuthMiddlewareAuthorizationOptions = {},
) {
  const dependencies = resolveAuthorizationDependencies(authorization);
  return new Elysia({ name: 'auth-middleware' })
    .onRequest(async ({ request }) => {
      // Elysia normally runs resolve hooks after body parsing. Start and await
      // bearer hydration before a multipart parser can consume a potentially
      // large body. Public multipart routes remain public: rejection is owned
      // by the route-level guard below, not this preload.
      if (isMultipartRequest(request) && readAuthBearerToken(request)) {
        await resolveRequestAuthContext(
          request,
          getTokenService,
          dependencies.getRequestCredentialResolver,
        );
      }
    })
    .resolve(
      { as: 'global' },
      async ({ request }) => {
        const access = await resolveRequestAuthorizationAccess(
          request,
          getTokenService,
          dependencies,
        );
        const authContext = access.context;

        return {
          authContext,
          access,
          requireAuth: () => access.requireUser(),
          requireAdmin: () => access.requirePlatformAdmin(),
        };
      }
    )
    .macro({
      /**
       * Raw Elysia route authorization. Multipart routes compiled by Zero use
       * `createProtectedMultipartRequestGuard()` in addition to this macro so
       * invalid credentials are rejected in Elysia's on-request phase.
       *
       * @example
       * `.post('/import', handler, { zeroAuth: 'user', body: t.Object({ file: t.File() }) })`
       */
      zeroAuth(requirement: ZeroElysiaAuthRequirement) {
        return {
          beforeHandle(context: unknown) {
            const current = context as {
              access: RequestAuthorizationAccess;
              authContext: AuthContext | null;
            };
            current.access.authorize(requirement);
            current.authContext = current.access.context;
          },
        };
      },
    });
}

export type ProtectedMultipartPathMatcher =
  | string
  | RegExp
  | ((request: Request) => boolean);

export interface ProtectedMultipartRequestGuardOptions {
  /** Route requirement enforced before multipart body parsing. */
  requirement?: ZeroElysiaAuthRequirement | CompiledAccessRequirement;
  /** Optional HTTP method or methods. Omit to match every method. */
  method?: string | readonly string[];
  /** Optional absolute route matcher. `:param` and trailing `*` are supported. */
  path?: ProtectedMultipartPathMatcher;
}

/**
 * Build an Elysia on-request hook that rejects a protected multipart request
 * before the framework reads its body. Non-multipart and non-matching routes
 * are left to the normal resolve/before-handle authorization path.
 *
 * Zero's endpoint compiler and built-in upload plugins install this
 * automatically. A raw Elysia multipart route can install the same guard with
 * `.onRequest(createProtectedMultipartRequestGuard(...))` and use `zeroAuth`
 * for its normal route authorization.
 */
export function createProtectedMultipartRequestGuard(
  getTokenService: () => TokenService | null,
  options: ProtectedMultipartRequestGuardOptions = {},
  authorization: AuthMiddlewareAuthorizationOptions = {},
) {
  const requirement = options.requirement ?? 'user';
  const dependencies = resolveAuthorizationDependencies(authorization);
  return async function protectMultipartBeforeParse(context: {
    request: Request;
    set: { status?: number | string };
  }): Promise<undefined | { error: string; code: string }> {
    if (!isMultipartRequest(context.request)) return undefined;
    if (!matchesProtectedMultipartRequest(context.request, options)) return undefined;

    const tokenService = getTokenService();
    const credentialResolver = dependencies.getRequestCredentialResolver();
    if (!tokenService && !credentialResolver) {
      context.set.status = 503;
      return { error: 'Auth not initialized', code: 'AUTH_NOT_READY' };
    }

    const access = await resolveRequestAuthorizationAccess(
      context.request,
      () => tokenService,
      dependencies,
    );
    try {
      access.authorize(requirement);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      context.set.status = error.status;
      return { error: getPublicAuthErrorMessage(error), code: error.code };
    }

    return undefined;
  };
}

/** Resolve one app-local authorization facade, sharing early and normal hooks. */
export async function resolveRequestAuthorizationAccess(
  request: Request,
  getTokenService: () => TokenService | null,
  authorization: AuthMiddlewareAuthorizationOptions = {},
): Promise<RequestAuthorizationAccess> {
  const dependencies = resolveAuthorizationDependencies(authorization);
  const tokenService = getTokenService();
  const credentialResolver = dependencies.getRequestCredentialResolver();
  if (!tokenService && !credentialResolver) {
    return createRequestAuthorizationAccess({
      authContext: null,
      kernel: dependencies.getAuthorizationKernel(),
    });
  }

  let byService = requestAccessResolutions.get(request);
  if (!byService) {
    byService = new Map();
    requestAccessResolutions.set(request, byService);
  }
  const resolutionOwner = credentialResolver ?? tokenService!;
  const existing = byService.get(resolutionOwner);
  if (existing) return existing;

  const resolution = (async () => {
    const authContext = await resolveRequestAuthContext(
      request,
      () => tokenService,
      () => credentialResolver,
    );
    // Built-in TokenService instances own the durable profile fence. Server
    // extensions may instead provide a structural verifier with no mutable
    // profile; preserve that standalone contract as the access facade's no-op.
    const assertCurrentProfile = tokenService
      && typeof tokenService.assertCurrentProfile === 'function'
      ? () => tokenService.assertCurrentProfile()
      : undefined;
    return createRequestAuthorizationAccess({
      authContext,
      kernel: dependencies.getAuthorizationKernel(),
      propertyStore: authContext ? dependencies.getPropertyStore() : null,
      roleAssignments: authContext ? dependencies.getRoleAssignments() : null,
      assertCurrentProfile,
    });
  })();
  byService.set(resolutionOwner, resolution);
  return resolution;
}

/** Resolve and memoize one live auth context for this request and app. */
export async function resolveRequestAuthContext(
  request: Request,
  getTokenService: () => TokenService | null,
  getRequestCredentialResolver?: () => AuthRequestCredentialResolver | null,
): Promise<AuthContext | null> {
  const credentialResolver = getRequestCredentialResolver?.() ?? null;
  if (credentialResolver) return credentialResolver.resolve(request);
  const tokenService = getTokenService();
  if (!tokenService) return null;
  return extractAuthContext(request, tokenService);
}

function isMultipartRequest(request: Request): boolean {
  const contentType = request.headers.get('content-type');
  return contentType?.toLowerCase().startsWith('multipart/form-data') ?? false;
}

function matchesProtectedMultipartRequest(
  request: Request,
  options: ProtectedMultipartRequestGuardOptions,
): boolean {
  if (options.method) {
    const methods = Array.isArray(options.method) ? options.method : [options.method];
    if (!methods.some((method) => method.toUpperCase() === request.method.toUpperCase())) {
      return false;
    }
  }

  if (!options.path) return true;
  if (typeof options.path === 'function') return options.path(request);
  const pathname = new URL(request.url).pathname;
  if (options.path instanceof RegExp) {
    const lastIndex = options.path.lastIndex;
    options.path.lastIndex = 0;
    const matches = options.path.test(pathname);
    options.path.lastIndex = lastIndex;
    return matches;
  }

  return matchesRoutePath(options.path, pathname);
}

function matchesRoutePath(pattern: string, pathname: string): boolean {
  const normalize = (value: string) => {
    const withSlash = value.startsWith('/') ? value : `/${value}`;
    return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
  };
  const patternSegments = normalize(pattern).split('/').filter(Boolean);
  const pathSegments = normalize(pathname).split('/').filter(Boolean);

  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]!;
    if (expected === '*' || expected === ':path*') return true;
    const actual = pathSegments[index];
    if (actual === undefined) return false;
    if (expected.startsWith(':')) continue;
    if (expected !== actual) return false;
  }

  return patternSegments.length === pathSegments.length;
}

function resolveAuthorizationDependencies(
  options: AuthMiddlewareAuthorizationOptions,
): Required<AuthMiddlewareAuthorizationOptions> {
  return {
    // A token-service getter does not identify its owning runtime. Falling
    // back to the process-global compatibility provider here would couple
    // otherwise independent apps and becomes ambiguous as soon as two apps
    // coexist. Legacy user/admin checks need neither dependency; structured
    // policy callers must inject their app-local services explicitly.
    getRequestCredentialResolver:
      options.getRequestCredentialResolver ?? (() => null),
    getAuthorizationKernel: options.getAuthorizationKernel ?? (() => null),
    getPropertyStore: options.getPropertyStore ?? (() => null),
    getRoleAssignments: options.getRoleAssignments ?? (() => null),
  };
}
