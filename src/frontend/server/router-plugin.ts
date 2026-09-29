import { Elysia } from 'elysia';
import { resolve } from 'path';
import { scanRoutes } from '../router/scanner';
import { buildRouteTree } from '../router/route-tree';
import { matchRoute } from '../router/matcher';
import { renderRoute } from '../router/renderer';
import type { PlatformConfig } from '../router/renderer';
import type { RouteNode, ApiHandler, LoaderContext, RouteConfig } from '../router/types';
import { isPublicPath, type RouteAuthMode } from '../router/auth-policy';
import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../../observability/sink';
import type { PlatformObservabilityRuntime } from '../../observability/types';
import { generateSitemapXml } from './sitemap';
import type { ResolvedSitemapConfig } from './types';
import {
  createRequestAuthorizationAccess,
  type AuthorizationPropertyStore,
  type AuthorizationRoleAssignmentResolver,
  type RequestAuthorizationAccess,
} from '../../auth/authorization-access';
import {
  compileAccessRequirement,
  isCompiledAccessRequirement,
  mergeAccessRequirements,
  type AccessRequirement,
  type AuthorizationKernel,
  type CompiledAccessRequirement,
} from '../../auth/authorization-kernel';
import { AuthError, type AuthContext } from '../../auth/types';

// ─── ISR Cache ────────────────────────────────────────────────────────────

interface CacheEntry {
  body: string;
  status: number;
  timestamp: number;
  maxAge: number;
}

// ─── Router Plugin ─────────────────────────────────────────────────────────

export interface RouterPluginOptions {
  /** App-owned observability target supplied by managed createApp(). */
  observability?: PlatformObservabilityRuntime;
  /** Route tree root (pre-built, or we build from appDir) */
  routeTree?: RouteNode;
  /** App directory to scan. Used if routeTree not provided. */
  appDir?: string;
  /** Build artifact directory that backs `/_build/*`. Default: './.build'. */
  outDir?: string;
  /** Public URL path to the client JS bundle */
  clientEntry?: string;
  /** Public URL path to the CSS file */
  cssPath?: string;
  /** Platform config injected into HTML for client hydration */
  platformConfig?: PlatformConfig;
  /**
   * Global auth guard for page routes.
   * Redirects unauthenticated users to loginPath for all non-public routes.
   * Bearer identity comes from Elysia's resolve chain. A page-only resolver can
   * additionally restore SSR identity from a server-readable session cookie.
   * API routes (route.ts) are not affected — they use requireAuth/requireAdmin.
   */
  authGuard?: {
    /** Global route auth strategy. Default: 'protected-by-default'. */
    routeAuth?: RouteAuthMode;
    /** Paths that don't require authentication (exact + prefix match). Default: ['/login'] */
    publicPaths?: string[];
    /** Redirect target for unauthenticated users. Default: '/login' */
    loginPath?: string;
    /** Resolve ambient identity for safe page requests only. Never used by APIs. */
    resolvePageAuth?: (
      request: Request
    ) => Promise<NonNullable<LoaderContext['auth']> | null>;
    /** Build a deletion header after an attempted page credential is rejected. */
    clearRejectedPageSession?: (request: Request) => string | null;
  };
  /** App-local authorization services used by file pages, layouts, and route.ts APIs. */
  authorization?: {
    getKernel: () => AuthorizationKernel | null;
    getPropertyStore?: () => AuthorizationPropertyStore | null;
    getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
  };
  /** Optional automatic sitemap route mounted before the file-router catch-all. */
  sitemap?: {
    config: ResolvedSitemapConfig;
    publicUrl?: string;
    routeAuth: RouteAuthMode;
    publicPaths: string[];
  };
}

/**
 * Create an Elysia plugin that handles:
 * 1. API routes (route.ts files) — matched by method
 * 2. Page routes (page.tsx files) — SSR'd with React
 *
 * Features:
 * - Route-level middleware via `export const config: RouteConfig`
 * - Auth guards (config.auth = 'required' | 'admin')
 * - ISR caching (config.revalidate = seconds)
 * - Enriched LoaderContext (auth, redirect helper)
 * - Platform config URL derived from request (not hardcoded)
 *
 * Mount this LAST so API plugins get priority.
 */
export function createRouterPlugin(options: RouterPluginOptions) {
  const emit = options.observability
    ? emitPlatformCodeTo.bind(null, options.observability)
    : emitPlatformCode;
  const appDir = options.appDir ?? './app';
  const outDir = resolve(options.outDir ?? '.build');
  const routeTree = options.routeTree ?? buildRouteTree(scanRoutes(appDir));
  const isrCache = new Map<string, CacheEntry>();

  const router = new Elysia({ name: 'router' })

    // Serve static build artifacts (JS chunks, source maps)
    .get('/_build/*', async ({ params }) => {
      const filePath = resolve(outDir, (params as any)['*']);

      // Path traversal protection — resolved path must stay inside outDir
      if (!filePath.startsWith(outDir + '/')) {
        return new Response('Forbidden', { status: 403 });
      }

      const file = Bun.file(filePath);
      if (await file.exists()) {
        // Return Response with headers directly — Elysia doesn't merge
        // set.headers into raw Response objects, so we must set them here.
        return new Response(file, {
          headers: {
            'Content-Type': file.type,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

  if (options.sitemap) {
    router.get(options.sitemap.config.path, async ({ request }) => {
      const body = await generateSitemapXml({
        routeTree,
        config: options.sitemap!.config,
        requestUrl: request.url,
        publicUrl: options.sitemap!.publicUrl,
        routeAuth: options.sitemap!.routeAuth,
        publicPaths: options.sitemap!.publicPaths,
      });

      return new Response(body, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
        },
      });
    });
  }

  return router

    // Catch-all: try API routes first, then SSR pages
    .all('/*', async ({ request, set, ...ctx }) => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const isrCacheKey = `${url.origin}${pathname}${url.search}`;
      const isIsrRequest = request.method === 'GET'
        && !request.headers.has('authorization')
        && !request.headers.has('cookie');

      // Skip /_build (handled above)
      if (pathname.startsWith('/_build')) return;

      const match = matchRoute(routeTree, pathname);

      // Build enriched LoaderContext
      const bearerAuth = ((ctx as { authContext?: AuthContext | null }).authContext
        ?? null);
      const loaderCtx: LoaderContext = {
        params: match.params,
        request,
        // Pull auth from Elysia's resolve chain if available
        auth: bearerAuth ?? undefined,
        access: resolveRouterAccess({
          authContext: bearerAuth,
          existing: (ctx as { access?: RequestAuthorizationAccess }).access,
          options,
        }),
        redirect: (redirectUrl: string, status = 302) =>
          new Response(null, {
            status,
            headers: { Location: redirectUrl },
          }),
      };

      // 1. API route — check if this path has a route.ts with matching method
      if (match.apiRoutePath) {
        const routeModule = await import(match.apiRoutePath);
        const method = request.method.toUpperCase();
        const handler: ApiHandler | undefined = routeModule[method];

        // Cookie identity is deliberately unavailable here. Only run the API
        // route's middleware when this method actually has an API handler;
        // colocated page requests must be allowed to continue to page routing.
        if (handler) {
          let apiRequiresAuth = false;
          const kernel = options.authorization?.getKernel() ?? null;
          let apiAccess = compileRouteAccess(false, kernel);

          // A colocated route.ts remains inside its parent layout auth
          // boundary. Evaluate inherited auth root-to-leaf with Bearer identity
          // only. Layout middleware is page-oriented and does not implicitly
          // run for APIs; route.ts may declare its own API middleware below.
          for (const layoutPath of match.layouts) {
            try {
              const layoutModule = await import(layoutPath);
              const layoutConfig: RouteConfig | undefined = layoutModule.config;
              if (layoutConfig) {
                apiAccess = mergeRouteAccess(apiAccess, layoutConfig.auth, kernel);
                apiRequiresAuth ||= apiAccess.user === 'required';
                const middlewareResult = await runRouteMiddleware(
                  layoutConfig,
                  loaderCtx,
                  {
                    requirement: apiAccess,
                    requestKind: 'api',
                    runCustomMiddleware: false,
                  },
                );
                if (middlewareResult) {
                  return withPrivateApiHeaders(middlewareResult);
                }
              }
            } catch {
              emit(OBS_CODES.ROUTER_LAYOUT_CONFIG_FAILED, {
                metadata: { stage: 'api-layout-policy' },
              });
              return withPrivateApiHeaders(
                new Response('Route policy unavailable', { status: 500 })
              );
            }
          }

          const routeConfig: RouteConfig | undefined = routeModule.config;
          if (routeConfig) {
            apiAccess = mergeRouteAccess(apiAccess, routeConfig.auth, kernel);
            apiRequiresAuth ||= apiAccess.user === 'required';
            const middlewareResult = await runRouteMiddleware(
              routeConfig,
              loaderCtx,
              { requirement: apiAccess, requestKind: 'api' },
            );
            if (middlewareResult) {
              return withPrivateApiHeaders(middlewareResult);
            }
          }
          const response = await handler(loaderCtx);
          return loaderCtx.auth || apiRequiresAuth
            ? withPrivateApiHeaders(response)
            : response;
        }

        // Method not allowed
        if (match.pagePath === null) {
          set.status = 405;
          return { error: 'Method Not Allowed' };
        }
      }

      // 2. Page route — SSR

      // Resolve the HttpOnly page session only after a real API handler has
      // been ruled out. The resolver itself limits cookies to GET/HEAD and
      // refuses fallback when an Authorization header was supplied.
      if (!loaderCtx.auth && options.authGuard?.resolvePageAuth) {
        loaderCtx.auth =
          (await options.authGuard.resolvePageAuth(request)) ?? undefined;
        if (loaderCtx.auth) {
          loaderCtx.access = resolveRouterAccess({
            authContext: loaderCtx.auth,
            options,
          });
        }
      }
      const rejectedPageSessionHeader = loaderCtx.auth
        ? null
        : options.authGuard?.clearRejectedPageSession?.(request) ?? null;

      // Global page guard. Keeping this below API dispatch preserves strict
      // Bearer-only authentication for route.ts handlers.
      if (options.authGuard) {
        const {
          routeAuth = 'protected-by-default',
          publicPaths = [
            '/login',
            '/register',
            '/forgot-password',
            '/reset-password',
            '/setup-password',
            '/verify-email',
          ],
          loginPath = '/login',
        } = options.authGuard;
        const globalGuardApplies = routeAuth === 'protected-by-default';
        const isPublic =
          pathname.startsWith('/_build') || isPublicPath(pathname, publicPaths);
        if (globalGuardApplies && !isPublic && !loaderCtx.auth) {
          return withPrivatePageHeaders(
            new Response(null, {
              status: 302,
              headers: { Location: loginPath },
            }),
            rejectedPageSessionHeader
          );
        }
      }

      // Check layout configs for auth guards (walk root → leaf)
      // Layouts can export `config: RouteConfig` to enforce auth on all children.
      const pageKernel = options.authorization?.getKernel() ?? null;
      let pageAccess = compileRouteAccess(false, pageKernel);
      for (const layoutPath of match.layouts) {
        try {
          const layoutModule = await import(layoutPath);
          const layoutConfig: RouteConfig | undefined = layoutModule.config;
          if (layoutConfig) {
            pageAccess = mergeRouteAccess(pageAccess, layoutConfig.auth, pageKernel);
            const middlewareResult = await runRouteMiddleware(
              layoutConfig,
              loaderCtx,
              {
                requirement: pageAccess,
                loginPath: options.authGuard?.loginPath,
              },
            );
            if (middlewareResult) {
              if (
                loaderCtx.auth ||
                pageAccess.user === 'required' ||
                rejectedPageSessionHeader
              ) {
                return withPrivatePageHeaders(
                  middlewareResult,
                  rejectedPageSessionHeader
                );
              }
              return middlewareResult;
            }
          }
        } catch {
          // A layout config is an inherited authorization boundary. Import or
          // middleware evaluation failures must never weaken that boundary.
          emit(OBS_CODES.ROUTER_LAYOUT_CONFIG_FAILED, {
            metadata: { stage: 'page-layout-policy' },
          });
          return withPrivatePageHeaders(
            new Response('Route policy unavailable', { status: 500 }),
            rejectedPageSessionHeader
          );
        }
      }

      // Load page module to check for route config
      const pagePath = match.pagePath ?? match.notFoundPath;
      if (pagePath) {
        const pageModule = await import(pagePath);
        const routeConfig: RouteConfig | undefined = pageModule.config;

        if (routeConfig) {
          // Run route-level middleware after monotonically inheriting every
          // layout requirement. A child `auth: false` cannot weaken a parent.
          let middlewareResult: Response | null;
          try {
            pageAccess = mergeRouteAccess(pageAccess, routeConfig.auth, pageKernel);
            middlewareResult = await runRouteMiddleware(
              routeConfig,
              loaderCtx,
              {
                requirement: pageAccess,
                loginPath: options.authGuard?.loginPath,
              },
            );
          } catch {
            emit(OBS_CODES.ROUTER_LAYOUT_CONFIG_FAILED, {
              metadata: { stage: 'page-policy' },
            });
            return withPrivatePageHeaders(
              new Response('Route policy unavailable', { status: 500 }),
              rejectedPageSessionHeader,
            );
          }
          if (middlewareResult) {
            if (
              loaderCtx.auth ||
              pageAccess.user === 'required' ||
              rejectedPageSessionHeader
            ) {
              return withPrivatePageHeaders(
                middlewareResult,
                rejectedPageSessionHeader
              );
            }
            return middlewareResult;
          }

          // ISR: check cache
          if (
            isIsrRequest &&
            !loaderCtx.auth &&
            !rejectedPageSessionHeader &&
            routeConfig.revalidate &&
            routeConfig.revalidate > 0
          ) {
            const cached = isrCache.get(isrCacheKey);
            if (cached && Date.now() - cached.timestamp < cached.maxAge * 1000) {
              return new Response(cached.body, {
                status: cached.status,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'X-Cache': 'HIT',
                  'Cache-Control': `s-maxage=${cached.maxAge}, stale-while-revalidate`,
                },
              });
            }
          }
        }

        // Derive platform config URL from the actual request
        const derivedConfig = options.platformConfig
          ? { ...options.platformConfig, url: url.origin }
          : undefined;

        const response = await renderRoute({
          match,
          request,
          clientEntry: options.clientEntry,
          cssPath: options.cssPath,
          platformConfig: derivedConfig,
          loaderContext: loaderCtx,
          appDir,
        });

        // ISR: cache the response
        if (
          isIsrRequest &&
          !loaderCtx.auth &&
          !rejectedPageSessionHeader &&
          routeConfig?.revalidate &&
          routeConfig.revalidate > 0 &&
          response.status === 200
        ) {
          // Clone the response body for caching
          const body = await response.clone().text();
          isrCache.set(isrCacheKey, {
            body,
            status: response.status,
            timestamp: Date.now(),
            maxAge: routeConfig.revalidate,
          });
        }

        return loaderCtx.auth || rejectedPageSessionHeader
          ? withPrivatePageHeaders(response, rejectedPageSessionHeader)
          : response;
      }

      // Derive platform config URL from the actual request
      const derivedConfig = options.platformConfig
        ? { ...options.platformConfig, url: url.origin }
        : undefined;

      const response = await renderRoute({
        match,
        request,
        clientEntry: options.clientEntry,
        cssPath: options.cssPath,
        platformConfig: derivedConfig,
        loaderContext: loaderCtx,
        appDir,
      });
      return loaderCtx.auth || rejectedPageSessionHeader
        ? withPrivatePageHeaders(response, rejectedPageSessionHeader)
        : response;
    });
}

// ─── Route Middleware Runner ──────────────────────────────────────────────

function resolveRouterAccess(input: {
  authContext: AuthContext | null;
  existing?: RequestAuthorizationAccess;
  options: RouterPluginOptions;
}): RequestAuthorizationAccess {
  if (input.existing && input.existing.context === input.authContext) {
    return input.existing;
  }
  return createRequestAuthorizationAccess({
    authContext: input.authContext,
    kernel: input.options.authorization?.getKernel() ?? null,
    propertyStore: input.authContext
      ? input.options.authorization?.getPropertyStore?.() ?? null
      : null,
    roleAssignments: input.authContext
      ? input.options.authorization?.getRoleAssignments?.() ?? null
      : null,
  });
}

function compileRouteAccess(
  requirement: AccessRequirement | CompiledAccessRequirement,
  kernel: AuthorizationKernel | null,
): CompiledAccessRequirement {
  if (isCompiledAccessRequirement(requirement)) {
    return kernel
      ? kernel.merge(requirement, false)
      : mergeAccessRequirements(requirement, false);
  }
  return kernel?.compile(requirement) ?? compileAccessRequirement(requirement);
}

function mergeRouteAccess(
  parent: CompiledAccessRequirement,
  child: AccessRequirement | undefined,
  kernel: AuthorizationKernel | null,
): CompiledAccessRequirement {
  if (child === undefined) return parent;
  return kernel
    ? kernel.merge(parent, child)
    : mergeAccessRequirements(parent, child);
}

async function runRouteMiddleware(
  config: RouteConfig,
  ctx: LoaderContext,
  options: {
    requirement: CompiledAccessRequirement;
    loginPath?: string;
    requestKind?: 'page' | 'api';
    runCustomMiddleware?: boolean;
  },
): Promise<Response | null> {
  const requestKind = options.requestKind ?? 'page';

  try {
    ctx.access.authorize(options.requirement);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    // Browser pages enter the configured login flow only when identity is
    // absent. Authenticated authorization failures never masquerade as login.
    if (requestKind === 'page' && error.status === 401) {
      return ctx.redirect(options.loginPath ?? '/login');
    }
    const message = error.status >= 500 ? 'Route policy unavailable' : error.message;
    return requestKind === 'api'
      ? Response.json(
          { error: message, code: error.code },
          { status: error.status },
        )
      : new Response(message, { status: error.status });
  }

  // Custom middleware
  if (options.runCustomMiddleware !== false && config.middleware) {
    const result = await config.middleware(ctx);
    if (result instanceof Response) return result;
  }

  return null;
}

function withPrivateApiHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');

  const vary = new Set(
    (headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  vary.add('Authorization');
  headers.set('Vary', [...vary].join(', '));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withPrivatePageHeaders(
  response: Response,
  rejectedCookieHeader?: string | null
): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  if (rejectedCookieHeader) {
    headers.append('Set-Cookie', rejectedCookieHeader);
  }

  const vary = new Set(
    (headers.get('Vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  vary.add('Cookie');
  vary.add('Authorization');
  headers.set('Vary', [...vary].join(', '));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
