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
import { emitPlatformCode } from '../../observability/sink';
import { generateSitemapXml } from './sitemap';
import type { ResolvedSitemapConfig } from './types';

// ─── ISR Cache ────────────────────────────────────────────────────────────

interface CacheEntry {
  body: string;
  status: number;
  timestamp: number;
  maxAge: number;
}

const isrCache = new Map<string, CacheEntry>();

// ─── Router Plugin ─────────────────────────────────────────────────────────

export interface RouterPluginOptions {
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
  const appDir = options.appDir ?? './app';
  const outDir = resolve(options.outDir ?? '.build');
  const routeTree = options.routeTree ?? buildRouteTree(scanRoutes(appDir));

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

      // Skip /_build (handled above)
      if (pathname.startsWith('/_build')) return;

      const match = matchRoute(routeTree, pathname);

      // Build enriched LoaderContext
      const loaderCtx: LoaderContext = {
        params: match.params,
        request,
        // Pull auth from Elysia's resolve chain if available
        auth: (ctx as any).authContext ?? undefined,
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
          const routeConfig: RouteConfig | undefined = routeModule.config;
          if (routeConfig) {
            const middlewareResult = await runRouteMiddleware(routeConfig, loaderCtx);
            if (middlewareResult) return middlewareResult;
          }
          return handler(loaderCtx);
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
      for (const layoutPath of match.layouts) {
        try {
          const layoutModule = await import(layoutPath);
          const layoutConfig: RouteConfig | undefined = layoutModule.config;
          if (layoutConfig) {
            const middlewareResult = await runRouteMiddleware(
              layoutConfig,
              loaderCtx,
              options.authGuard?.loginPath,
            );
            if (middlewareResult) {
              if (
                loaderCtx.auth ||
                layoutConfig.auth ||
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
        } catch (err) {
          // Layout import failed — log and skip (global authGuard handles the common case)
          emitPlatformCode(OBS_CODES.ROUTER_LAYOUT_CONFIG_FAILED, {
            error: err,
            metadata: { layoutPath, path: pathname },
          });
        }
      }

      // Load page module to check for route config
      const pagePath = match.pagePath ?? match.notFoundPath;
      if (pagePath) {
        const pageModule = await import(pagePath);
        const routeConfig: RouteConfig | undefined = pageModule.config;

        if (routeConfig) {
          // Run route-level middleware (auth guards, custom middleware)
          const middlewareResult = await runRouteMiddleware(
            routeConfig,
            loaderCtx,
            options.authGuard?.loginPath,
          );
          if (middlewareResult) {
            if (
              loaderCtx.auth ||
              routeConfig.auth ||
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
            !loaderCtx.auth &&
            !rejectedPageSessionHeader &&
            routeConfig.revalidate &&
            routeConfig.revalidate > 0
          ) {
            const cached = isrCache.get(pathname);
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
          !loaderCtx.auth &&
          !rejectedPageSessionHeader &&
          routeConfig?.revalidate &&
          routeConfig.revalidate > 0 &&
          response.status === 200
        ) {
          // Clone the response body for caching
          const body = await response.clone().text();
          isrCache.set(pathname, {
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

async function runRouteMiddleware(
  config: RouteConfig,
  ctx: LoaderContext,
  loginPath = '/login',
): Promise<Response | null> {
  // Auth guard
  if (config.auth) {
    if (!ctx.auth) {
      // Not authenticated — redirect to login
      return ctx.redirect(loginPath);
    }
    if (config.auth === 'admin' && ctx.auth.role !== 'admin') {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // Custom middleware
  if (config.middleware) {
    const result = await config.middleware(ctx);
    if (result instanceof Response) return result;
  }

  return null;
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
