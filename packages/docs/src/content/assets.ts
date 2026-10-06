/** Only referenced passive assets become public; reads revalidate containment and content identity. */
import { basename, extname } from 'node:path';
import type { DocsAsset } from './types';
import type { ResolvedDocsLimits } from './limits';
import { docsFailure } from './errors';
import { docsHash, joinDocsRoute } from './identity';
import { containedDocsPath, docsRelativePath, readDocsBytes, resolveDocsRoot } from './paths';
import type { DocsPublicationPolicy } from './publication';

const MIME: Readonly<Record<string, string>> = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json' });
export async function createDocsAsset(root: string, sourcePath: string, basePath: string, image: boolean, limits: ResolvedDocsLimits, policy?: DocsPublicationPolicy): Promise<DocsAsset> {
  const mime = MIME[extname(sourcePath).toLowerCase()];
  if (!mime || image && !mime.startsWith('image/')) docsFailure('DOCS_ASSET_INVALID', 'This referenced asset type is not supported; SVG, HTML and executable files are never served.', { sourcePath });
  const target = await admittedAssetTarget(root, sourcePath, mime);
  if (policy && !policy.admitted(docsRelativePath(root, target))) docsFailure('DOCS_ASSET_INVALID', 'An attachment target is excluded from publication.', { sourcePath });
  const bytes = await readDocsBytes(root, sourcePath, limits.maxAssetBytes, target), hash = docsHash(bytes), id = docsHash(sourcePath + '\0' + hash);
  return Object.freeze({ id, sourcePath, hash, mime, size: bytes.byteLength,
    route: joinDocsRoute(basePath, ['_assets', id, basename(sourcePath)]) });
}
/** Production copiers use this admitted descriptor rather than copying a source directory indiscriminately. */
export async function readDocsAsset(contentDir: string, asset: DocsAsset): Promise<Uint8Array> {
  const root = await resolveDocsRoot(contentDir), target = await admittedAssetTarget(root, asset.sourcePath, asset.mime);
  const bytes = await readDocsBytes(root, asset.sourcePath, asset.size, target);
  if (bytes.byteLength !== asset.size || docsHash(bytes) !== asset.hash) docsFailure('DOCS_ASSET_INVALID', 'An admitted asset changed before packaging; rebuild the snapshot.', { sourcePath: asset.sourcePath });
  return bytes;
}
/** Extension aliases cannot turn classified Markdown, SVG or HTML into an apparently passive attachment. */
async function admittedAssetTarget(root: string, sourcePath: string, mime: string): Promise<string> {
  const target = await containedDocsPath(root, sourcePath), canonical = docsRelativePath(root, target.path);
  if (target.directory || MIME[extname(canonical).toLowerCase()] !== mime || canonical.split('/').some(part => /^[._]/u.test(part))) docsFailure('DOCS_ASSET_INVALID', 'An attachment must resolve to the same admitted passive type; Markdown and active documents are not raw attachments.', { sourcePath });
  return target.path;
}
