/** Canonical source-to-route ownership; index/README fallbacks never choose collision winners by scan order. */
import { basename, dirname } from 'node:path';
import { slug } from 'github-slugger';
import { docsFailure } from './errors';
import { joinDocsRoute } from './identity';
import type { DocsPageMetadata } from './frontmatter';

export function docsSourceRoute(sourcePath: string, metadata: DocsPageMetadata, sources: ReadonlySet<string>, basePath: string): string {
  if (metadata.slug !== undefined) return docsSlugRoute(metadata.slug, basePath, sourcePath);
  const directory = dirname(sourcePath).replace(/\\/gu, '/'), filename = basename(sourcePath);
  const stem = filename.slice(0, -3), lower = stem.toLowerCase();
  const hasIndex = [...sources].some(source => dirname(source).replace(/\\/gu, '/') === directory && basename(source).toLowerCase() === 'index.md');
  const landing = lower === 'index' || lower === 'readme' && !hasIndex;
  const segments = directory === '.' ? [] : directory.split('/').map(segment => routeSegment(segment, sourcePath));
  if (!landing) segments.push(routeSegment(stem, sourcePath));
  return joinDocsRoute(basePath, segments);
}
export function docsSlugRoute(value: string, basePath: string, sourcePath?: string): string {
  if (value === '/') return basePath;
  if (/[?#%\\\u0000-\u0020]/u.test(value) || value.startsWith('//')) docsFailure('DOCS_METADATA_INVALID', 'A slug must contain unencoded path segments without a query or fragment.', { sourcePath, field: 'slug' });
  const segments = value.replace(/^\//u, '').replace(/\/$/u, '').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.') || segment.startsWith('_'))) docsFailure('DOCS_METADATA_INVALID', 'A slug contains an invalid or reserved path segment.', { sourcePath, field: 'slug' });
  return joinDocsRoute(basePath, segments);
}
export function docsFolderRoute(folder: string, basePath: string): string {
  return joinDocsRoute(basePath, folder ? folder.split('/').map(segment => routeSegment(segment)) : []);
}
/** Internal reader projections have explicit ownership; authored routes cannot silently disappear behind them. */
export function assertDocsReaderRoute(route: string, basePath: string, sourcePath?: string): void {
  const suffix = basePath === '/' ? route : route.slice(basePath.length);
  if (suffix === '/llms.txt' || suffix === '/sitemap.xml' || ['/_api', '/_assets'].some(prefix => suffix === prefix || suffix.startsWith(prefix + '/'))) docsFailure('DOCS_ROUTE_CONFLICT', 'An authored page or redirect claims a reserved documentation reader route.', { sourcePath, field: 'slug' });
}
function routeSegment(value: string, sourcePath?: string): string {
  const result = slug(value.normalize('NFC'));
  if (!result || result === '.' || result === '..' || result.startsWith('.') || result.startsWith('_')) docsFailure('DOCS_ROUTE_CONFLICT', 'A filename/folder does not produce a usable route; supply an explicit slug or rename it.', { sourcePath });
  return result;
}
