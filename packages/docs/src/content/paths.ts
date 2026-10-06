/** Filesystem containment has no direct Bun realpath/lstat equivalent; reads use Bun.file. */
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { docsFailure } from './errors';

export function docsRelativePath(root: string, path: string): string {
  const value = relative(root, path);
  if (value === '..' || value.startsWith('..' + sep) || isAbsolute(value)) docsFailure('DOCS_SOURCE_INVALID', 'A content file resolves outside its selected root.');
  return value.split(sep).join('/');
}
export async function resolveDocsRoot(contentDir: string): Promise<string> {
  if (typeof contentDir !== 'string' || !isAbsolute(contentDir)) docsFailure('DOCS_CONFIG_INVALID', 'Resolve contentDir against the application configuration root before compiling.', { field: 'contentDir' });
  try {
    const root = await realpath(contentDir);
    if (!(await lstat(root)).isDirectory()) docsFailure('DOCS_CONFIG_INVALID', 'contentDir must select an existing directory.', { field: 'contentDir' });
    return root;
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'DocsContentError') throw cause;
    docsFailure('DOCS_CONFIG_INVALID', 'contentDir is unavailable or unreadable.', { field: 'contentDir' });
  }
}
export function normalizeDocsSourcePath(path: string): string {
  if (!path || path.includes('\\') || isAbsolute(path) || /[\u0000-\u001f]/u.test(path)) docsFailure('DOCS_SOURCE_INVALID', 'A source reference must be a contained relative pathname.');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) docsFailure('DOCS_SOURCE_INVALID', 'A source reference contains an invalid path segment.');
  return parts.join('/');
}
export async function containedDocsPath(root: string, sourcePath: string): Promise<{ path: string; size: number; directory: boolean }> {
  const normalized = normalizeDocsSourcePath(sourcePath);
  try {
    const actual = await realpath(resolve(root, normalized));
    docsRelativePath(root, actual);
    const info = await lstat(actual);
    if (!info.isFile() && !info.isDirectory()) docsFailure('DOCS_SOURCE_INVALID', 'Only regular files and directories are supported.', { sourcePath });
    return { path: actual, size: info.size, directory: info.isDirectory() };
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'DocsContentError') throw cause;
    docsFailure('DOCS_SOURCE_INVALID', 'A selected content path is missing or unreadable.', { sourcePath });
  }
}
export async function readDocsBytes(root: string, sourcePath: string, maximum: number, expectedPath?: string): Promise<Uint8Array> {
  const admitted = await containedDocsPath(root, sourcePath);
  if (expectedPath !== undefined && admitted.path !== expectedPath) docsFailure('DOCS_SOURCE_INVALID', 'A content target changed after admission; retry the build.', { sourcePath });
  if (admitted.directory) docsFailure('DOCS_SOURCE_INVALID', 'A regular file was expected.', { sourcePath });
  if (admitted.size > maximum) docsFailure('DOCS_LIMIT_EXCEEDED', 'A content file exceeds its admitted byte limit.', { sourcePath });
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await Bun.file(admitted.path).slice(0, maximum + 1).arrayBuffer()); }
  catch { docsFailure('DOCS_SOURCE_INVALID', 'A content file could not be read.', { sourcePath }); }
  if (bytes.byteLength > maximum) docsFailure('DOCS_LIMIT_EXCEEDED', 'A content file exceeds its admitted byte limit.', { sourcePath });
  // Revalidate after the read: a source tree changing symlink targets is not publication authority.
  const current = await containedDocsPath(root, sourcePath);
  if (current.path !== admitted.path) docsFailure('DOCS_SOURCE_INVALID', 'A content target changed during compilation; retry the build.', { sourcePath });
  return bytes;
}
