/** Deterministic contained file discovery, applying publication exclusions before any body parsing. */
import { readdir } from 'node:fs/promises';
import { DocsContentError, docsFailure } from './errors';
import { compareDocsPaths } from './identity';
import { containedDocsPath, docsRelativePath } from './paths';
import type { DocsPublicationPolicy } from './publication';
import type { ResolvedDocsLimits } from './limits';

export interface DocsDiscoveredFile { readonly sourcePath: string; readonly size: number; readonly markdown: boolean }
export async function discoverDocsFiles(root: string, policy: DocsPublicationPolicy, limits: ResolvedDocsLimits): Promise<readonly DocsDiscoveredFile[]> {
  const files: DocsDiscoveredFile[] = [], activeDirectories = new Set<string>([root]);
  let inspected = 0, documents = 0;
  async function walk(actualDirectory: string, prefix: string) {
    let entries: string[];
    try { entries = await readdir(actualDirectory); }
    catch { docsFailure('DOCS_SOURCE_INVALID', 'A content directory could not be enumerated.', prefix ? { sourcePath: prefix } : {}); }
    for (const name of entries.sort(compareDocsPaths)) {
      if (++inspected > 50_000) docsFailure('DOCS_LIMIT_EXCEEDED', 'The selected content tree contains too many entries.');
      const sourcePath = prefix ? `${prefix}/${name}` : name;
      // Directory rules must be evaluated as directory rules before recursion.
      if (!policy.admitted(sourcePath, true)) continue;
      const info = await containedDocsPath(root, sourcePath);
      if (info.directory && activeDirectories.has(info.path)) docsFailure('DOCS_SOURCE_INVALID', 'A symlink directory cycle is not supported.', { sourcePath });
      const canonicalPath = docsRelativePath(root, info.path);
      if (canonicalPath !== sourcePath && !policy.admitted(canonicalPath, info.directory)) continue;
      if (info.directory) {
        activeDirectories.add(info.path); await walk(info.path, sourcePath); activeDirectories.delete(info.path);
      } else if (policy.admitted(sourcePath)) {
        const markdown = /\.md$/iu.test(sourcePath);
        if (markdown && ++documents > limits.maxDocuments) docsFailure('DOCS_LIMIT_EXCEEDED', 'The selected collection contains too many documents.');
        files.push(Object.freeze({ sourcePath, size: info.size, markdown }));
      }
    }
  }
  try { await walk(root, ''); }
  catch (cause) { if (cause instanceof DocsContentError) throw cause; docsFailure('DOCS_SOURCE_INVALID', 'Content discovery failed.'); }
  return Object.freeze(files);
}
