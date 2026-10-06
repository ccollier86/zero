/** Resolve every local reference against the same admitted pages/assets, never a second raw-file scanner. */
import { dirname, posix } from 'node:path';
import type { DocsAsset, DocsNode, DocsPage } from './types';
import type { DocsDiscoveredFile } from './discovery';
import type { ResolvedDocsLimits } from './limits';
import { createDocsAsset } from './assets';
import { docsFailure } from './errors';
import { docsFolderRoute } from './routes';
import type { DocsPublicationPolicy } from './publication';

type MutableNode = { -readonly [Key in keyof DocsNode]: DocsNode[Key] };
export async function resolveDocsLinks({ root, pages, files, basePath, limits, policy }: {
  root: string; pages: DocsPage[]; files: readonly DocsDiscoveredFile[]; basePath: string; limits: ResolvedDocsLimits; policy: DocsPublicationPolicy;
}): Promise<readonly DocsAsset[]> {
  const bySource = new Map(pages.filter(page => page.sourcePath).map(page => [page.sourcePath!, page]));
  const byRoute = new Map(pages.map(page => [page.route, page])), available = new Set(files.map(file => file.sourcePath));
  const anchorsByRoute = new Map(pages.map(page => { const anchors = new Set(page.headings.map(heading => heading.id)); collectIds(page.body, anchors); return [page.route, anchors] as const; }));
  const assets = new Map<string, DocsAsset>();
  for (const page of pages) {
    const ids = new Set<string>();
    async function walk(node: DocsNode) {
      if (node.type === 'link' || node.type === 'image') {
        const original = node.url ?? '';
        if (!original || original.length > 8_192 || /[\u0000-\u0020\u007f\\]/u.test(original)) failure('A link URL is empty, oversized or contains unsafe characters.');
        if (original.startsWith('//')) failure('Protocol-relative URLs are not supported; supply an explicit HTTPS URL.');
        const scheme = /^([a-z][a-z\d+.-]*):/iu.exec(original)?.[1]?.toLowerCase();
        if (scheme) {
          if (!['http', 'https', 'mailto', 'tel'].includes(scheme) || node.type === 'image' && !['http', 'https'].includes(scheme)) failure('This URL scheme is not permitted in documentation.');
          if (scheme === 'http' || scheme === 'https') {
            let url: URL; try { url = new URL(original); } catch { return failure('An external URL is malformed.'); }
            if (!url.hostname || url.username || url.password) failure('External URLs must identify a host without embedded credentials.');
          }
        } else {
          const hashIndex = original.indexOf('#'), beforeHash = hashIndex < 0 ? original : original.slice(0, hashIndex);
          const queryIndex = beforeHash.indexOf('?'), path = queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex);
          const query = queryIndex < 0 ? '' : beforeHash.slice(queryIndex), fragment = hashIndex < 0 ? '' : original.slice(hashIndex);
          let decoded: string; try { decoded = decodeURIComponent(path); } catch { return failure('A local reference has invalid URI encoding.'); }
          if (/[\u0000-\u001f\u007f%\\]/u.test(decoded)) failure('A local reference contains unsafe encoded path characters.');
          let target: DocsPage | undefined;
          if (!decoded) target = page;
          else target = byRoute.get(path.replace(/\/$/u, '') || '/') ?? byRoute.get(decoded.replace(/\/$/u, '') || '/');
          const routeRelative = decoded.startsWith('/') && basePath !== '/' && (decoded === basePath || decoded.startsWith(basePath + '/'))
            ? decoded.slice(basePath.length) : decoded;
          const source = posix.normalize(routeRelative.startsWith('/') ? routeRelative.slice(1)
            : posix.join(page.sourcePath ? dirname(page.sourcePath).replace(/\\/gu, '/') : '', routeRelative)).replace(/\/$/u, '');
          if (source === '..' || source.startsWith('../') || posix.isAbsolute(source)) failure('A local reference escapes the selected content root.');
          if (!target) target = bySource.get(source) ?? bySource.get(source + '.md') ?? bySource.get(source.replace(/\/$/u, '') + '/index.md') ?? bySource.get(source.replace(/\/$/u, '') + '/README.md');
          if (!target && !posix.extname(source)) target = byRoute.get(source === '.' ? basePath : docsFolderRoute(source, basePath));
          if (target && node.type === 'link') {
            if (fragment) {
              let anchor: string; try { anchor = decodeURIComponent(fragment.slice(1)); } catch { return failure('A heading fragment has invalid URI encoding.'); }
              const anchors = anchorsByRoute.get(target.route)!;
              if (anchor && !anchors.has(anchor)) failure('A local heading fragment does not exist on its target page.');
            }
            (node as MutableNode).url = target.route + query + fragment;
          } else {
            if (target || !available.has(source)) failure('A referenced page or asset is missing or excluded from publication.');
            let asset = assets.get(source);
            if (!asset) { asset = await createDocsAsset(root, source, basePath, node.type === 'image', limits, policy); assets.set(source, asset); }
            if (node.type === 'image' && !asset.mime.startsWith('image/')) failure('An image reference must select an admitted image asset.');
            ids.add(asset.id); (node as MutableNode).url = asset.route + query + fragment;
          }
        }
      }
      for (const child of node.children ?? []) await walk(child);
    }
    function failure(message: string): never { docsFailure('DOCS_LINK_INVALID', message, { sourcePath: page.sourcePath ?? undefined, field: 'link' }); }
    await walk(page.body);
    (page as { assets: readonly string[] }).assets = [...ids].sort();
  }
  return Object.freeze([...assets.values()].sort((left, right) => left.sourcePath < right.sourcePath ? -1 : left.sourcePath > right.sourcePath ? 1 : 0));
}
function collectIds(node: DocsNode, result: Set<string>) { if (node.id) result.add(node.id); for (const child of node.children ?? []) collectIds(child, result); }
