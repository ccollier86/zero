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
   * Reads `authContext` from Elysia's resolve chain (set by auth middleware).
   * API routes (route.ts) are not affected — they use requireAuth/requireAdmin.
   */
  authGuard?: {
    /** Global route auth strategy. Default: 'protected-by-default'. */
    routeAuth?: RouteAuthMode;
    /** Paths that don't require authentication (exact + prefix match). Default: ['/login'] */
    publicPaths?: string[];
    /** Redirect target for unauthenticated users. Default: '/login' */
    loginPath?: string;
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

  return new Elysia({ name: 'router' })

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
    })

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

      // 0. Global auth guard — redirect unauthenticated users before any imports
      //    API routes excluded (they return 401 JSON via requireAuth/requireAdmin)
      if (options.authGuard && !match.apiRoutePath) {
        const {
          routeAuth = 'protected-by-default',
          publicPaths = ['/login'],
          loginPath = '/login',
        } = options.authGuard;
        const globalGuardApplies = routeAuth === 'protected-by-default';
        const isPublic = pathname.startsWith('/_build') || isPublicPath(pathname, publicPaths);
        if (globalGuardApplies && !isPublic && !loaderCtx.auth) {
          return new Response(null, {
            status: 302,
            headers: { Location: loginPath },
          });
        }
      }

      // 1. API route — check if this path has a route.ts with matching method
      if (match.apiRoutePath) {
        const routeModule = await import(match.apiRoutePath);

        // Run route-level middleware if config is exported
        const routeConfig: RouteConfig | undefined = routeModule.config;
        if (routeConfig) {
          const middlewareResult = await runRouteMiddleware(routeConfig, loaderCtx);
          if (middlewareResult) return middlewareResult;
        }

        const method = request.method.toUpperCase();
        const handler: ApiHandler | undefined = routeModule[method];

        if (handler) {
          return handler(loaderCtx);
        }

        // Method not allowed
        if (match.pagePath === null) {
          set.status = 405;
          return { error: 'Method Not Allowed' };
        }
      }

      // 2. Page route — SSR

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
            if (middlewareResult) return middlewareResult;
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
          if (middlewareResult) return middlewareResult;

          // ISR: check cache
          if (routeConfig.revalidate && routeConfig.revalidate > 0) {
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
        if (routeConfig?.revalidate && routeConfig.revalidate > 0 && response.status === 200) {
          // Clone the response body for caching
          const body = await response.clone().text();
          isrCache.set(pathname, {
            body,
            status: response.status,
            timestamp: Date.now(),
            maxAge: routeConfig.revalidate,
          });
        }

        return response;
      }

      // Derive platform config URL from the actual request
      const derivedConfig = options.platformConfig
        ? { ...options.platformConfig, url: url.origin }
        : undefined;

      return renderRoute({
        match,
        request,
        clientEntry: options.clientEntry,
        cssPath: options.cssPath,
        platformConfig: derivedConfig,
        loaderContext: loaderCtx,
        appDir,
      });
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
