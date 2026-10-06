/** One public compiler boundary: admission, parsing, links, projections, immutable identity and safe telemetry. */
import { basename } from 'node:path';
import type { CompileDocsContentOptions, DocsManifest, DocsPage } from './types';
import { DocsContentError, docsFailure } from './errors';
import { canonicalDocsJson, compareDocsPaths, docsHash, docsLabel, freezeDocsValue, normalizeDocsBasePath } from './identity';
import { resolveDocsLimits } from './limits';
import { readDocsBytes, resolveDocsRoot } from './paths';
import { createDocsPublicationPolicy } from './publication';
import { discoverDocsFiles } from './discovery';
import { admitDocsFrontmatter } from './frontmatter';
import { parseDocsMarkdown } from './markdown';
import { assertDocsReaderRoute, docsSlugRoute, docsSourceRoute } from './routes';
import { buildDocsNavigation } from './navigation';
import { resolveDocsLinks } from './links';
import { docsPublishedMarkdown } from './markdown-projection';
import { buildDocsPassages } from './search-passages';
import { assertDocsLabel, assertDocsRouteLength } from './search-bounds';

export async function compileDocsContent(options: CompileDocsContentOptions): Promise<DocsManifest> {
  let pages: DocsPage[] = [], assetCount = 0;
  const report = (code: 'DOCS_CONTENT_COMPILED' | 'DOCS_CONTENT_FAILED', diagnostics = 0) => {
    try { const returned: unknown = options.emit?.({ code, metadata: { pages: pages.length, assets: assetCount, diagnostics } });
      if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') void Promise.resolve(returned).catch(() => undefined);
    } catch { /* An injected telemetry sink cannot grant publication or break a completed snapshot. */ }
  };
  try {
    if (!options || typeof options !== 'object' || !['development', 'production', undefined].includes(options.mode)
      || options.allowEmpty !== undefined && typeof options.allowEmpty !== 'boolean') docsFailure('DOCS_CONFIG_INVALID', 'Compiler options contain an unsupported mode or allowEmpty value.');
    const root = await resolveDocsRoot(options.contentDir), basePath = normalizeDocsBasePath(options.basePath), limits = resolveDocsLimits(options.limits);
    const policy = await createDocsPublicationPolicy(root, options), files = await discoverDocsFiles(root, policy, limits);
    const admitted: Array<{ sourcePath: string; body: string; sourceHash: string; metadata: ReturnType<typeof admitDocsFrontmatter> & { admitted: true } }> = [];
    let totalBytes = 0;
    for (const file of files) {
      if (!file.markdown) continue;
      const bytes = await readDocsBytes(root, file.sourcePath, limits.maxDocumentBytes);
      let source: string; try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { docsFailure('DOCS_SOURCE_INVALID', 'Markdown must contain valid UTF-8 text.', { sourcePath: file.sourcePath }); }
      const result = admitDocsFrontmatter(source, file.sourcePath, limits.maxFrontmatterBytes);
      if (!result.admitted) continue;
      totalBytes += bytes.byteLength;
      if (totalBytes > limits.maxTotalBytes) docsFailure('DOCS_LIMIT_EXCEEDED', 'Admitted content exceeds its total byte budget.');
      admitted.push({ sourcePath: file.sourcePath, body: result.body, sourceHash: docsHash(bytes), metadata: result });
    }
    if (!admitted.length && (options.mode ?? 'production') === 'production' && !options.allowEmpty) docsFailure('DOCS_COLLECTION_EMPTY', 'No publishable Markdown documents remain; add public content or deliberately enable allowEmpty.');
    const sources = new Set(admitted.map(item => item.sourcePath)), routes = new Set<string>(), semanticIds = new Set<string>();
    for (const item of admitted) {
      const meta = item.metadata.metadata, parsed = parseDocsMarkdown(item.body, item.sourcePath);
      const route = docsSourceRoute(item.sourcePath, meta, sources, basePath);
      assertDocsReaderRoute(route, basePath, item.sourcePath);
      if (routes.has(route)) docsFailure('DOCS_ROUTE_CONFLICT', 'Multiple admitted documents claim the same canonical route.', { sourcePath: item.sourcePath, field: 'slug' });
      routes.add(route);
      if (meta.semanticId && semanticIds.has(meta.semanticId)) docsFailure('DOCS_ROUTE_CONFLICT', 'Multiple admitted documents claim the same semantic ID.', { sourcePath: item.sourcePath, field: 'id' });
      if (meta.semanticId) semanticIds.add(meta.semanticId);
      const title = meta.title ?? parsed.firstH1?.text ?? docsLabel(basename(item.sourcePath));
      assertDocsLabel(title, item.sourcePath); assertDocsRouteLength(route, item.sourcePath);
      assertDocsLabel(meta.navigation.label ?? title, item.sourcePath, 'navigation.label');
      pages.push({ sourcePath: item.sourcePath, route, title, description: meta.description ?? parsed.description,
        ...(parsed.firstH1?.text === title ? { titleHeadingId: parsed.firstH1.id } : {}), semanticId: meta.semanticId,
        navigation: { ...meta.navigation, label: meta.navigation.label ?? title }, searchable: meta.searchable,
        headings: parsed.headings, body: parsed.body, markdown: item.body, text: parsed.text, hash: '', assets: [], generated: false, metadata: meta.extra });
    }
    const structure = buildDocsNavigation(pages, basePath); pages = structure.pages;
    for (const page of pages) {
      assertDocsLabel(page.title, page.sourcePath ?? undefined); assertDocsLabel(page.navigation.label, page.sourcePath ?? undefined, 'navigation.label');
      assertDocsRouteLength(page.route, page.sourcePath ?? undefined);
      Object.assign(page, buildDocsPassages(page.body));
    }
    if (new Set(pages.map(page => page.route)).size !== pages.length) docsFailure('DOCS_ROUTE_CONFLICT', 'Multiple source folders claim the same generated landing route.');
    const assets = await resolveDocsLinks({ root, pages, files, basePath, limits, policy }); assetCount = assets.length;
    if (totalBytes + assets.reduce((sum, asset) => sum + asset.size, 0) > limits.maxTotalBytes) docsFailure('DOCS_LIMIT_EXCEEDED', 'Admitted content and referenced assets exceed the total byte budget.');
    const redirects: Array<{ from: string; to: string }> = [];
    const allRoutes = new Set(pages.map(page => page.route));
    for (const item of admitted) {
      const target = pages.find(page => page.sourcePath === item.sourcePath)!;
      for (const value of item.metadata.metadata.redirects) {
        const from = docsSlugRoute(value, basePath, item.sourcePath);
        assertDocsRouteLength(from, item.sourcePath);
        assertDocsReaderRoute(from, basePath, item.sourcePath);
        if (allRoutes.has(from)) docsFailure('DOCS_ROUTE_CONFLICT', 'A redirect conflicts with a document or another redirect.', { sourcePath: item.sourcePath, field: 'redirects' });
        allRoutes.add(from); redirects.push({ from, to: target.route });
      }
    }
    for (const page of pages) {
      Object.assign(page, { markdown: docsPublishedMarkdown(page.body) });
      Object.assign(page, { hash: docsHash(canonicalDocsJson({ ...page, hash: undefined })) });
    }
    pages.sort((left, right) => compareDocsPaths(left.route, right.route)); redirects.sort((left, right) => compareDocsPaths(left.from, right.from));
    const manifest = { version: 1 as const, basePath, pages, assets, navigation: structure.navigation, redirects,
      hash: docsHash(canonicalDocsJson({ basePath, pages, assets, navigation: structure.navigation, redirects, publication: policy.hash })) };
    // No public snapshot may bridge a source/policy change observed during this build.
    // Recheck only admitted documents; excluded bodies remain unread and unparsed.
    for (const item of admitted) if (docsHash(await readDocsBytes(root, item.sourcePath, limits.maxDocumentBytes)) !== item.sourceHash) docsFailure('DOCS_SOURCE_INVALID', 'A published document changed during compilation; retry the build.', { sourcePath: item.sourcePath });
    if ((await createDocsPublicationPolicy(root, options)).hash !== policy.hash) docsFailure('DOCS_IGNORE_INVALID', 'Publication rules changed during compilation; retry the build.');
    const frozen = freezeDocsValue(manifest); report('DOCS_CONTENT_COMPILED'); return frozen;
  } catch (cause) {
    const error = cause instanceof DocsContentError ? cause : new DocsContentError('DOCS_SOURCE_INVALID', [{ code: 'DOCS_SOURCE_INVALID', message: 'Documentation compilation failed without publishing a snapshot.' }]);
    report('DOCS_CONTENT_FAILED', error.diagnostics.length); throw error;
  }
}
