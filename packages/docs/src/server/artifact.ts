/** Admit the versioned private plugin artifact before any public route becomes available. */
import type { ZeroPluginJsonValue } from '@zero/framework/server';
import type { ResolvedDocsOptions } from '../options';
import type { DocsNode, DocsNavigationEntry } from '../content/types';
import type { DocsBuildData, DocsSnapshot } from './types';
import { docsFailure } from '../content/errors';
import { docsHash, freezeDocsValue } from '../content/identity';
import { assertDocsPlatformRoutes } from './route-ownership';
import { validateDocsSearchMetadata } from './artifact-search';
import { DOCS_MAX_LABEL_LENGTH, DOCS_MAX_ROUTE_LENGTH } from '../content/search-bounds';

const NODES = new Set(['root', 'text', 'paragraph', 'heading', 'emphasis', 'strong', 'delete', 'inlineCode', 'code', 'link', 'image', 'blockquote', 'list', 'listItem', 'thematicBreak', 'break', 'table', 'tableRow', 'tableCell', 'callout', 'footnoteDefinition', 'footnoteReference']);
/** Fail closed before mounting routes when compiled public data violates its schema or bounds. */
export function admitDocsBuildData(input: ZeroPluginJsonValue | undefined, options: ResolvedDocsOptions): DocsBuildData {
  const data = input as unknown as DocsBuildData;
  if (!data || data.version !== 1 || !['development', 'production'].includes(data.mode) || !data.manifest || data.manifest.version !== 1 || data.manifest.basePath !== options.basePath
    || !/^[a-f0-9]{64}$/u.test(data.manifest.hash) || !Array.isArray(data.manifest.pages) || !Array.isArray(data.manifest.assets)
    || !Array.isArray(data.manifest.navigation) || !Array.isArray(data.manifest.redirects) || !data.highlights || typeof data.highlights !== 'object') invalid();
  const routes = new Set<string>(); let nodes = 0;
  function validateNode(node: DocsNode, depth: number): void {
    if (!node || !NODES.has(node.type) || depth > 64 || ++nodes > 25_000) invalid();
    if (node.value !== undefined && typeof node.value !== 'string') invalid();
    if (node.title !== undefined && typeof node.title !== 'string') invalid();
    if (node.code !== undefined && (!node.code || typeof node.code !== 'object' || Array.isArray(node.code))) invalid();
    if (node.url !== undefined && (typeof node.url !== 'string' || /[\u0000-\u0020\\]/u.test(node.url) || !/^(?:\/(?!\/)|https?:|mailto:|tel:)/iu.test(node.url))) invalid();
    if (node.children !== undefined && !Array.isArray(node.children)) invalid();
    for (const child of node.children ?? []) validateNode(child, depth + 1);
  }
  for (const page of data.manifest.pages) {
    if (!page || !validRoute(page.route, options.basePath) || routes.has(page.route) || typeof page.title !== 'string' || typeof page.text !== 'string' || typeof page.markdown !== 'string'
      || typeof page.description !== 'string' || typeof page.searchable !== 'boolean' || !Array.isArray(page.headings) || !Array.isArray(page.assets)
      || page.sourcePath !== null && (typeof page.sourcePath !== 'string' || page.sourcePath.startsWith('/') || /(^|\/)[._]|(^|\/)\.\.(\/|$)|[\\\u0000-\u001f]/u.test(page.sourcePath))) invalid();
    routes.add(page.route); nodes = 0; validateNode(page.body, 0);
    validateDocsSearchMetadata(page, invalid);
    const highlights = data.highlights[page.route]; if (!Array.isArray(highlights)) invalid();
    for (const highlight of highlights) if (highlight !== null && (!highlight || typeof highlight.html !== 'string' || typeof highlight.code !== 'string' || typeof highlight.key !== 'string')) invalid();
  }
  let navigationEntries = 0;
  function validateNavigation(entries: readonly DocsNavigationEntry[], depth: number): void {
    if (entries.length && depth > 64) invalid();
    for (const entry of entries) {
      if (!entry || ++navigationEntries > Math.max(25_000, data.manifest.pages.length * 2)
        || !['page', 'group'].includes(entry.type) || typeof entry.label !== 'string' || entry.label.length > DOCS_MAX_LABEL_LENGTH
        || !validRoute(entry.route, options.basePath) || !routes.has(entry.route)
        || entry.children !== undefined && !Array.isArray(entry.children)) invalid();
      validateNavigation(entry.children ?? [], depth + 1);
    }
  }
  validateNavigation(data.manifest.navigation, 0);
  for (const asset of data.manifest.assets) if (!asset || !/^[a-f0-9]{64}$/u.test(asset.id) || !/^[a-f0-9]{64}$/u.test(asset.hash)
    || !validRoute(asset.route, options.basePath) || !Number.isSafeInteger(asset.size) || asset.size < 0 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/x-icon', 'application/pdf', 'text/plain', 'text/csv', 'application/json'].includes(asset.mime)) invalid();
  for (const redirect of data.manifest.redirects) if (!validRoute(redirect.from, options.basePath) || !routes.has(redirect.to)) invalid();
  assertDocsPlatformRoutes(data.manifest);
  return freezeDocsValue(data);
}
/** Read only declared private asset copies and verify their admitted size and digest. */
export async function readDocsCompiledSnapshot(data: DocsBuildData, files: Readonly<Record<string, string | URL>>): Promise<DocsSnapshot> {
  const assets = new Map<string, Uint8Array>();
  for (const descriptor of data.manifest.assets) {
    const source = files[descriptor.id]; if (!source) invalid();
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await Bun.file(source).slice(0, descriptor.size + 1).arrayBuffer()); } catch { invalid(); }
    if (bytes!.byteLength !== descriptor.size || docsHash(bytes!) !== descriptor.hash) invalid();
    assets.set(descriptor.id, bytes!);
  }
  return Object.freeze({ data, assets });
}
function validRoute(value: unknown, basePath: string): value is string {
  return typeof value === 'string' && value.length <= DOCS_MAX_ROUTE_LENGTH && value.startsWith('/') && !/[?#\\\u0000-\u0020]/u.test(value) && !value.split('/').some(segment => segment === '.' || segment === '..')
    && (basePath === '/' || value === basePath || value.startsWith(basePath + '/'));
}
function invalid(): never { docsFailure('DOCS_SOURCE_INVALID', 'Compiled documentation is missing, incompatible or corrupted. Run the normal Zero build before starting this app.'); }
