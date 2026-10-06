/** Request-local SSR composition without an application authentication/hydration shell. */
import { renderServerPage } from '@zero/framework/server';
import type { ZeroPluginSetupContext } from '@zero/framework/server';
import type { ResolvedDocsOptions } from '../options';
import type { DocsPage, DocsNavigationEntry } from '../content/types';
import type { DocsSnapshot } from './types';
import type { DocsPageLink, DocsPageProps } from '../ui/types';
import { DocsApp } from '../ui/docs-app';
import { docsHeaders } from './responses';
import { docsHash } from '../content/identity';

/** Render each request with a fresh CSP nonce and a validator for its actual emitted HTML. */
export async function renderDocsPage(request: Request, page: DocsPage, snapshot: DocsSnapshot, options: ResolvedDocsOptions, context: ZeroPluginSetupContext, status = 200): Promise<Response> {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const links: DocsPageLink[] = []; const seen = new Set<string>();
  const pagesByRoute = new Map(snapshot.data.manifest.pages.map(item => [item.route, item]));
  function visit(entries: readonly DocsNavigationEntry[]) { for (const entry of entries) {
    if (!seen.has(entry.route)) { const target = pagesByRoute.get(entry.route); if (target) { links.push({ route: target.route, title: target.title }); seen.add(target.route); } }
    visit(entry.children ?? []);
  } }
  visit(snapshot.data.manifest.navigation); const index = links.findIndex(link => link.route === page.route);
  const editUrl = options.editUrl && page.sourcePath ? options.editUrl + page.sourcePath.split('/').map(encodeURIComponent).join('/') : undefined;
  const props: DocsPageProps = { page, navigation: snapshot.data.manifest.navigation, highlights: snapshot.data.highlights[page.route] ?? [], nonce,
    presentation: { title: options.title, basePath: options.basePath, breadcrumbs: options.breadcrumbs, search: options.search,
      toc: options.toc, pageNavigation: options.pageNavigation, headerLinks: options.headerLinks, themeStorageKey: options.themeStorageKey, ...(editUrl ? { editUrl } : {}) },
    ...(index > 0 ? { previous: links[index - 1] } : {}), ...(index >= 0 && index < links.length - 1 ? { next: links[index + 1] } : {}) };
  // Render HEAD's GET-equivalent representation before omitting its body. The
  // renderer's early HEAD return would otherwise omit CSP/render failure metadata.
  const renderRequest = request.method === 'HEAD' ? new Request(request, { method: 'GET' }) : request;
  const response = await renderServerPage({ component: DocsApp, props, request: renderRequest, appDir: context.appDir, frontend: context.frontend,
    pluginName: options.name, rootId: 'zero-docs-root', nonce, status, meta: { title: `${page.title} · ${options.title}`, description: page.description }, emitCode: context.emitCode });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headers = docsHeaders(response.headers.get('Content-Type') ?? 'text/html; charset=utf-8', '"' + docsHash(bytes) + '"');
  // A 304 with a fresh nonce could replace the cached CSP while retaining old
  // nonce-bearing markup. Request-local HTML is never shared or revalidated.
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Content-Length', String(bytes.byteLength));
  headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`);
  if (options.siteUrl && status < 400) headers.set('Link', `<${options.siteUrl + page.route}>; rel="canonical"`);
  if (response.status >= 400) headers.set('Cache-Control', 'no-store');
  // Final generation admission happens after complete rendering, including any asynchronous React work.
  return new Response(request.method === 'HEAD' ? null : bytes, { status: response.status, headers });
}
