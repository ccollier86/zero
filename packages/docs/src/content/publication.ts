/** Root-only Git ignore inputs and additive publication policy; no repository/global Git state. */
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import ignore from 'ignore';
import type { CompileDocsContentOptions } from './types';
import { docsFailure } from './errors';
import { canonicalDocsJson, docsHash } from './identity';
import { normalizeDocsSourcePath, readDocsBytes } from './paths';

export interface DocsPublicationPolicy {
  readonly hash: string;
  admitted(path: string, directory?: boolean): boolean;
}
const DENIED_FOLDERS = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'target']);
export async function createDocsPublicationPolicy(root: string, options: CompileDocsContentOptions): Promise<DocsPublicationPolicy> {
  const selectedIgnore = options.ignoreFile === false ? null : options.ignoreFile ?? '.docsignore';
  const matcher = ignore({ ignorecase: false }), excludes = ignore({ ignorecase: false }), includes = ignore({ ignorecase: false });
  let ignoreText = '';
  if (selectedIgnore !== null) {
    normalizeDocsSourcePath(selectedIgnore);
    let exists = false;
    try { await lstat(resolve(root, selectedIgnore)); exists = true; }
    catch (cause) {
      if (!isAbsent(cause) || options.ignoreFile !== undefined) docsFailure('DOCS_IGNORE_INVALID', 'The selected ignore file is unavailable or unreadable.', { field: 'ignoreFile' });
    }
    if (exists) {
      try { ignoreText = new TextDecoder('utf-8', { fatal: true }).decode(await readDocsBytes(root, selectedIgnore, 65_536)); }
      catch { docsFailure('DOCS_IGNORE_INVALID', 'The selected ignore file could not be read as bounded UTF-8 text.', { field: 'ignoreFile' }); }
    }
  }
  const denyPatterns = validatePatterns(options.exclusions ?? [], 'exclusions');
  const includePatterns = options.include === undefined ? null : validatePatterns(options.include, 'include');
  try { matcher.add(ignoreText); excludes.add(denyPatterns); if (includePatterns) includes.add(includePatterns); }
  catch { docsFailure('DOCS_IGNORE_INVALID', 'Publication ignore rules could not be interpreted.'); }
  return Object.freeze({ hash: docsHash(canonicalDocsJson({ selectedIgnore, ignoreText, denyPatterns, includePatterns })),
    admitted(path: string, directory = false): boolean {
      const segments = path.split('/');
      if (path === selectedIgnore || segments.some(segment => segment.startsWith('.') || segment.startsWith('_') || DENIED_FOLDERS.has(segment.toLowerCase()))) return false;
      const candidate = directory ? path + '/' : path;
      try {
        if (matcher.ignores(candidate) || excludes.ignores(candidate)) return false;
        return directory || !includePatterns || includes.ignores(candidate);
      } catch { docsFailure('DOCS_IGNORE_INVALID', 'Publication rules failed for a normalized content path.', { sourcePath: path }); }
    },
  });
}
function validatePatterns(value: readonly string[], field: string): string[] {
  if (!Array.isArray(value) || value.length > 1_000) docsFailure('DOCS_CONFIG_INVALID', 'Publication patterns must be a bounded string array.', { field });
  return value.map(pattern => {
    if (typeof pattern !== 'string' || !pattern.trim() || pattern.length > 2_048 || pattern.startsWith('!') || /[\u0000\r\n]/u.test(pattern)) {
      docsFailure('DOCS_CONFIG_INVALID', 'Config publication patterns are additive positive rules; ordered negation belongs only in .docsignore.', { field });
    }
    return pattern;
  });
}
function isAbsent(cause: unknown): boolean { return !!cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT'; }

