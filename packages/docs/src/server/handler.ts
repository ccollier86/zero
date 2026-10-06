/** One dispatcher owns every public projection of a currently admitted docs snapshot. */
import { OBS_CODES, isReservedAppRoutePath } from '@zero/framework/server';
import type { ZeroPluginSetupContext } from '@zero/framework/server';
import type { ResolvedDocsOptions } from '../options';
import { searchDocs } from './search';
import { docsAgentIndex, docsSitemap, docsPublicIndex } from './projections';
import { docsAssetResponse, docsErrorResponse, docsReadResponse, docsTextEtag } from './responses';
import { renderDocsPage } from './page';
import type { DocsSnapshotRuntime } from './watch';
import { docsNotFoundPage } from './not-found';

/** Dispatch only a currently admitted snapshot; nonce-bearing HTML never reuses cached markup. */
export function createDocsRequestHandler(runtime: DocsSnapshotRuntime, options: ResolvedDocsOptions, context: ZeroPluginSetupContext) {
  const prefix = options.basePath === '/' ? '' : options.basePath;
  return async (request: Request): Promise<Response> => {
    const snapshot = runtime.current(), generation = runtime.generation();
    const errorResponse = (status: 404 | 503 | 500 | 400, code: string) => docsErrorResponse(status, code, request);
    const readText = (body: string, contentType: string) => docsReadResponse(request, body, contentType, docsTextEtag(body, contentType));
    if (!snapshot) return errorResponse(503, 'DOCS_REBUILD_PENDING');
    const manifest = snapshot.data.manifest, url = new URL(request.url);
    const route = url.pathname.length > 1 ? url.pathname.replace(/\/$/u, '') : url.pathname;
    if (options.basePath === '/' && isReservedAppRoutePath(route)) return errorResponse(404, 'DOCS_NOT_FOUND');
    try {
      if (route === prefix + '/_api/search') {
        if (!options.search) return errorResponse(404, 'DOCS_NOT_FOUND');
        const query = url.searchParams.get('q') ?? ''; if (query.length > 200 || /[\u0000-\u001f]/u.test(query)) return errorResponse(400, 'DOCS_SEARCH_INVALID');
        return readText(JSON.stringify({ results: searchDocs(manifest, query) }), 'application/json; charset=utf-8');
      }
      if (route === prefix + '/_api/manifest') return readText(JSON.stringify(docsPublicIndex(manifest)), 'application/json; charset=utf-8');
      if (route === prefix + '/_api/markdown') {
        const page = manifest.pages.find(item => item.route === url.searchParams.get('path'));
        return page ? readText(page.markdown, 'text/markdown; charset=utf-8') : errorResponse(404, 'DOCS_NOT_FOUND');
      }
      if (route === prefix + '/llms.txt') return readText(docsAgentIndex(manifest, options.title), 'text/plain; charset=utf-8');
      if (route === prefix + '/sitemap.xml') return options.siteUrl ? readText(docsSitemap(manifest, options.siteUrl), 'application/xml; charset=utf-8') : errorResponse(404, 'DOCS_NOT_FOUND');
      const asset = manifest.assets.find(item => item.route === route);
      if (asset) { const bytes = snapshot.assets.get(asset.id); return bytes ? docsAssetResponse(request, asset, bytes) : errorResponse(503, 'DOCS_ASSET_UNAVAILABLE'); }
      const redirect = manifest.redirects.find(item => item.from === route);
      if (redirect) return new Response(null, { status: 308, headers: { Location: redirect.to + url.search, 'Cache-Control': 'public, max-age=0, must-revalidate' } });
      const page = manifest.pages.find(item => item.route === route);
      if (!page) {
        if (route.startsWith(prefix + '/_')) return errorResponse(404, 'DOCS_NOT_FOUND');
        const response = await renderDocsPage(request, docsNotFoundPage(options.basePath), snapshot, options, context, 404);
        return generation === runtime.generation() && snapshot === runtime.current() ? response : errorResponse(503, 'DOCS_REBUILD_PENDING');
      }
      const response = await renderDocsPage(request, page, snapshot, options, context);
      if (generation !== runtime.generation() || snapshot !== runtime.current()) return errorResponse(503, 'DOCS_REBUILD_PENDING');
      return response;
    } catch {
      try { context.emitCode(OBS_CODES.DOCS_REQUEST_FAILED, { metadata: { stage: 'read' } }); } catch { /* A diagnostic sink cannot replace the safe HTTP response. */ }
      return errorResponse(500, 'DOCS_REQUEST_FAILED');
    }
  };
}
