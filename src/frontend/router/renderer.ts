import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import type { SyncMode } from '../../sync/types';
import type { MatchResult, RouteModule, PageMeta, LoaderContext, RouteConfig } from './types';
import { serverErrorHtml, notFoundHtml } from '../client/error-boundary';
import { hasUseClientDirective } from './scanner';
import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';

// ─── Module Cache ──────────────────────────────────────────────────────────

const moduleCache = new Map<string, RouteModule>();

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

// ─── Renderer ──────────────────────────────────────────────────────────────

export interface PlatformConfig {
  url: string;
  auth?: boolean;
  stateSync?: boolean;
  tableSyncModes?: Record<string, SyncMode>;
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
}

/**
 * Render a matched route to a ReadableStream using React 19 streaming SSR.
 *
 * 1. Loads all layout + page modules
 * 2. Runs loader if present
 * 3. Nests layouts outside-in: Root > Section > Page
 * 4. Injects __ROUTE_DATA__ + __PLATFORM_CONFIG__ into <head>
 * 5. Streams HTML via renderToReadableStream
 */
export async function renderRoute(options: RenderOptions): Promise<Response> {
  const { match, request, clientEntry, cssPath, platformConfig, loaderContext } = options;
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
    // Load all modules in parallel
    const [pageModule, ...layoutModules] = await Promise.all([
      loadModule(pagePath),
      ...match.layouts.map(loadModule),
    ]);

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

    let element = createElement(PageComponent, {
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

    // Check if this page is a client component ("use client" directive)
    // Server components: render to HTML only, zero JS shipped
    // Client components: render to HTML + ship JS for hydration
    const isClientPage = hasUseClientDirective(pagePath);

    // Render to streaming HTML
    const ssrErrors: unknown[] = [];
    const stream = await renderToReadableStream(element, {
      // Only ship client JS for "use client" pages.
      // Must use bootstrapModules (not bootstrapScripts) because the bundle
      // is built with format:'esm' — browsers reject import/export in regular <script> tags.
      // bootstrapModules emits <script type="module"> which handles ESM correctly.
      bootstrapModules: isClientPage && clientEntry ? [clientEntry] : undefined,
      onError(error: unknown) {
        ssrErrors.push(error);
        emitPlatformCode(OBS_CODES.RENDERER_SSR_ERROR, {
          error,
          metadata: { pagePath, path: new URL(request.url).pathname },
        });
      },
    });

    // Build HTML shell with meta + CSS + route data
    // Only inject __ROUTE_DATA__ and __PLATFORM_CONFIG__ for client pages
    const htmlHead = buildHtmlHead(meta, cssPath, isClientPage ? match : undefined, isClientPage ? loaderData : undefined, isClientPage ? platformConfig : undefined);
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
  platformConfig?: PlatformConfig
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

  return parts.join('\n    ');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
