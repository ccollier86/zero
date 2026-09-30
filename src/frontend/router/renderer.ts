import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReactNode } from 'react';
import type { SyncMode } from '../../sync/types';
import type { MatchResult, RouteModule, PageMeta, LoaderContext, RouteConfig } from './types';
import { serverErrorHtml, notFoundHtml } from '../client/error-boundary';
import { hasUseClientDirective } from './scanner';
import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import type { RouteAuthMode } from './auth-policy';

// ─── Module Cache ──────────────────────────────────────────────────────────

const moduleCache = new Map<string, RouteModule>();

type ReactRuntime = typeof import('react');
type ReactDomServerRuntime = typeof import('react-dom/server');

interface SsrReactRuntime {
  createElement: ReactRuntime['createElement'];
  renderToReadableStream: ReactDomServerRuntime['renderToReadableStream'];
}

const reactRuntimeCache = new Map<string, Promise<SsrReactRuntime>>();

/**
 * Import a route module, caching the result.
 * In development, the cache can be invalidated for hot reload.
 */
async function loadModule(path: string): Promise<RouteModule> {
  const cached = moduleCache.get(path);
  if (cached) return cached;

  const mod = await import(path) as RouteModule;
  moduleCache.set(path, mod);
  return mod;
}

/** Clear module cache — used for hot reload in dev. */
export function invalidateModule(path: string): void {
  moduleCache.delete(path);
}

/** Clear all cached modules. */
export function invalidateAll(): void {
  moduleCache.clear();
}

/**
 * Load React from the consuming app rather than from the framework source tree.
 *
 * Package-mode development often installs Zero through `file:` or a symlink.
 * In that shape the framework repo can still have its own dev dependency copy
 * of React, while the app has another copy. React hooks require a single module
 * identity between components and renderer, so SSR resolves both `react` and
 * `react-dom/server` through the app directory.
 */
async function loadSsrReactRuntime(appDir = './app'): Promise<SsrReactRuntime> {
  const appRoot = resolve(appDir, '..');
  const cacheKey = appRoot;
  const cached = reactRuntimeCache.get(cacheKey);
  if (cached) return cached;

  const runtime = (async () => {
    const requireFromApp = createRequire(pathToFileURL(resolve(appRoot, 'package.json')).href);
    const [reactPath, reactDomServerPath] = [
      requireFromApp.resolve('react'),
      requireFromApp.resolve('react-dom/server'),
    ];
    const [react, reactDomServer] = await Promise.all([
      import(pathToFileURL(reactPath).href) as Promise<ReactRuntime>,
      import(pathToFileURL(reactDomServerPath).href) as Promise<ReactDomServerRuntime>,
    ]);

    if (typeof react.createElement !== 'function' || typeof reactDomServer.renderToReadableStream !== 'function') {
      throw new Error('[renderer] Could not resolve React SSR runtime from the app. Install compatible react and react-dom dependencies.');
    }

    return {
      createElement: react.createElement,
      renderToReadableStream: reactDomServer.renderToReadableStream,
    };
  })();

  reactRuntimeCache.set(cacheKey, runtime);
  return runtime;
}

// ─── Renderer ──────────────────────────────────────────────────────────────

export interface PlatformConfig {
  url: string;
  auth?: boolean;
  email?: boolean;
  stateSync?: boolean;
  tableSyncModes?: Record<string, SyncMode>;
  publicPaths?: string[];
  routeAuth?: RouteAuthMode;
  loginPath?: string;
  postLoginPath?: string;
}

export interface RenderOptions {
  /** Matched route info */
  match: MatchResult;
  /** Original request */
  request: Request;
  /** Path to the client JS bundle entry */
  clientEntry?: string;
  /** CSS file path for <link> tag */
  cssPath?: string;
  /** Platform config injected as window.__PLATFORM_CONFIG__ */
  platformConfig?: PlatformConfig;
  /** Enriched loader context (with auth, redirect helper) from router plugin */
  loaderContext?: LoaderContext;
  /** App route directory, used to resolve React from the consuming app. */
  appDir?: string;
}

/**
 * Render a matched route to a ReadableStream using React 19 streaming SSR.
 *
 * 1. Loads the matched page module, and layout modules for SSR routes
 * 2. Runs loader if present
 * 3. Nests layouts outside-in: Root > Section > Page
 * 4. Injects __ROUTE_DATA__ + __PLATFORM_CONFIG__ into <head>
 * 5. Streams HTML via renderToReadableStream
 */
export async function renderRoute(options: RenderOptions): Promise<Response> {
  const { match, request, clientEntry, cssPath, platformConfig, loaderContext, appDir } = options;
  const isDev = process.env.NODE_ENV !== 'production';

  // If no page matched and we have a not-found path, render that
  const pagePath = match.pagePath ?? match.notFoundPath;
  if (!pagePath) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const isNotFound = !match.pagePath;

  try {
    // Check if this route crosses a client component boundary.
    // Server routes render HTML directly. Client routes render an app shell and
    // let the browser bundle mount the route, which keeps package-mode apps on
    // one React module identity even when Zero is installed through `file:`.
    const isClientRoute = hasUseClientDirective(pagePath)
      || match.layouts.some((layoutPath) => hasUseClientDirective(layoutPath));

    const pageModule = await loadModule(pagePath);

    // Run page loader if present — use enriched context from router plugin
    const loaderCtx: LoaderContext = loaderContext ?? {
      params: match.params,
      request,
      redirect: (url: string, status = 302) =>
        new Response(null, { status, headers: { Location: url } }),
    };
    let loaderData: unknown;
    if (pageModule.loader) {
      const result = await pageModule.loader(loaderCtx);
      // If loader returns a Response (e.g., redirect), return it directly
      if (result instanceof Response) return result;
      loaderData = result;
    }

    // Resolve page meta
    const meta = resolveMeta(pageModule.meta, match.params);

    // Build the page element
    const PageComponent = pageModule.default;
    if (!PageComponent) {
      const err = new Error(`Page module "${pagePath}" has no default export`);
      emitPlatformCode(OBS_CODES.RENDERER_PAGE_EXPORT_MISSING, {
        error: err,
        metadata: { pagePath, path: new URL(request.url).pathname },
      });
      return new Response(serverErrorHtml(err, isDev), {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const htmlHead = buildHtmlHead(
      meta,
      cssPath,
      isClientRoute ? match : undefined,
      isClientRoute ? loaderData : undefined,
      isClientRoute ? platformConfig : undefined,
      isClientRoute ? 'client' : 'ssr',
      isClientRoute ? clientEntry : undefined,
    );

    if (isClientRoute) {
      return htmlShellResponse('', htmlHead, isNotFound ? 404 : 200);
    }

    const { createElement, renderToReadableStream } = await loadSsrReactRuntime(appDir);
    const layoutModules = await Promise.all(match.layouts.map(loadModule));

    let element: ReactNode = createElement(PageComponent, {
      params: match.params,
      ...(loaderData != null ? { data: loaderData } : {}),
    } as any);

    // Wrap in layouts from innermost → outermost
    for (let i = layoutModules.length - 1; i >= 0; i--) {
      const LayoutComponent = layoutModules[i].default;
      if (LayoutComponent) {
        element = createElement(LayoutComponent, { params: match.params } as any, element);
      }
    }

    // Render to streaming HTML
    const ssrErrors: unknown[] = [];
    const stream = await renderToReadableStream(element, {
      onError(error: unknown) {
        ssrErrors.push(error);
        emitPlatformCode(OBS_CODES.RENDERER_SSR_ERROR, {
          error,
          metadata: { pagePath, path: new URL(request.url).pathname },
        });
      },
    });

    const wrappedStream = wrapWithHtmlShell(stream, htmlHead);

    return new Response(wrappedStream, {
      status: isNotFound ? 404 : 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (err) {
    // Catch-all: module loading, loader execution, or render failures
    const error = err instanceof Error ? err : new Error(String(err));
    emitPlatformCode(OBS_CODES.RENDERER_FATAL_ERROR, {
      error,
      metadata: { pagePath, path: new URL(request.url).pathname },
    });
    return new Response(serverErrorHtml(error, isDev), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function resolveMeta(
  meta: RouteModule['meta'],
  params: Record<string, string>
): PageMeta {
  if (!meta) return {};
  if (typeof meta === 'function') return meta(params);
  return meta;
}

/**
 * Serialize data for embedding in a <script> tag.
 * Escapes < and > to prevent XSS via closing tags.
 */
function serializeForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function buildHtmlHead(
  meta: PageMeta,
  cssPath?: string,
  match?: MatchResult,
  loaderData?: unknown,
  platformConfig?: PlatformConfig,
  renderMode?: 'client' | 'ssr',
  clientEntry?: string,
): string {
  const parts: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
  ];

  if (meta.title) {
    parts.push(`<title>${escapeHtml(meta.title)}</title>`);
  }
  if (meta.description) {
    parts.push(`<meta name="description" content="${escapeHtml(meta.description)}">`);
  }
  if (cssPath) {
    parts.push(`<link rel="stylesheet" href="${cssPath}">`);
  }

  // Inject route data for client hydration
  if (match) {
    const routeData = {
      pattern: match.pattern,
      params: match.params,
      loaderData: loaderData ?? null,
      renderMode: renderMode ?? 'ssr',
    };
    parts.push(
      `<script>window.__ROUTE_DATA__=${serializeForScript(routeData)}</script>`
    );
  }

  // Inject platform config for client providers
  if (platformConfig) {
    parts.push(
      `<script>window.__PLATFORM_CONFIG__=${serializeForScript(platformConfig)}</script>`
    );
  }

  if (clientEntry) {
    parts.push(`<script type="module" src="${escapeHtml(clientEntry)}"></script>`);
  }

  return parts.join('\n    ');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlShellResponse(body: string, headContent: string, status: number): Response {
  return new Response(`<!DOCTYPE html>
<html lang="en">
  <head>
    ${headContent}
  </head>
  <body>
    <div id="root">${body}</div>
  </body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Wrap a React SSR stream with an HTML document shell.
 * Prepends <!DOCTYPE html><html>...<body><div id="root">
 * and appends </div></body></html>.
 */
function wrapWithHtmlShell(
  reactStream: ReadableStream<Uint8Array>,
  headContent: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    ${headContent}
  </head>
  <body>
    <div id="root">`
  );
  const suffix = encoder.encode(
    `</div>
  </body>
</html>`
  );

  let prefixSent = false;
  const reader = reactStream.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixSent) {
        controller.enqueue(prefix);
        prefixSent = true;
      }

      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(suffix);
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel();
    },
  });
}
