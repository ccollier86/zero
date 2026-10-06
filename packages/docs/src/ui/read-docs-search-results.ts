/** Admits bounded public search responses before links or match ranges reach the UI. */
import type { DocsSearchResult } from './types';
import type { DocsMatchRange } from '../search/text';

function invalid(): never { throw new Error('Invalid documentation search response.'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) invalid();
  return value;
}
export function readDocsSearchRoute(value: unknown, base: string, pageOnly = false): string {
  const path = text(value, pageOnly ? 4096 : 4096 + 1 + 2304);
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020]/u.test(path)) invalid();
  const url = new URL(path, 'https://zero-docs.invalid');
  const prefix = base === '/' ? '/' : `${base}/`;
  if (url.origin !== 'https://zero-docs.invalid' || url.pathname !== path.split('#')[0] || url.search || pageOnly && url.hash
    || !(url.pathname === base || url.pathname.startsWith(prefix))) invalid();
  if (url.hash && decodeURIComponent(url.hash.slice(1)).length > 256) invalid();
  return path;
}
function ranges(value: unknown, field: string): readonly DocsMatchRange[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) invalid();
  let previous = 0;
  return value.map((item) => {
    const range = record(item), start = range.start, end = range.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < previous
      || (end as number) <= (start as number) || (end as number) > field.length) invalid();
    previous = end as number;
    // Do not split a UTF-16 surrogate pair when rendering a highlighted range.
    if (isLowSurrogate(field.charCodeAt(start as number))
      || isLowSurrogate(field.charCodeAt(end as number))) invalid();
    return { start: start as number, end: end as number };
  });
}
function isLowSurrogate(value: number): boolean { return value >= 0xdc00 && value <= 0xdfff; }

/** Accept legacy plain results too; all new context stays within the same published mount. */
export function readDocsSearchResults(value: unknown, base: string): readonly DocsSearchResult[] {
  const data = record(value);
  if (!Array.isArray(data.results) || data.results.length > 20) invalid();
  const seen = new Set<string>();
  return data.results.map((item) => {
    const result = record(item);
    const target = readDocsSearchRoute(result.route, base);
    const pageRoute = readDocsSearchRoute(result.pageRoute ?? target.split('#')[0], base, true);
    if (new URL(target, 'https://zero-docs.invalid').pathname
      !== new URL(pageRoute, 'https://zero-docs.invalid').pathname) invalid();
    const title = text(result.title, 256), excerpt = text(result.excerpt, 240);
    const section = result.section === undefined ? undefined : text(result.section, 256);
    const path = readDocsSearchRoute(text(result.path ?? pageRoute, 4096), base, true);
    if (path !== pageRoute) invalid();
    const pageHash = result.pageHash === undefined ? undefined : text(result.pageHash, 128);
    const passageId = result.passageId === undefined ? undefined : text(result.passageId, 64);
    if (passageId && !/^docs-p-\d+$/u.test(passageId)) invalid();
    const key = `${target}\0${passageId ?? ''}`;
    if (seen.has(key)) invalid();
    seen.add(key);
    const ancestry = result.sectionPath;
    if (ancestry !== undefined && (!Array.isArray(ancestry) || ancestry.length > 6)) invalid();
    const sectionPath = ancestry === undefined ? undefined : (ancestry as unknown[]).map((label) => text(label, 256));
    const match = result.matches === undefined ? {} : record(result.matches);
    return {
      route: target, pageRoute, path, title, excerpt,
      ...(pageHash ? { pageHash } : {}),
      ...(section !== undefined ? { section } : {}),
      ...(passageId ? { passageId } : {}),
      ...(sectionPath ? { sectionPath } : {}),
      matches: { title: ranges(match.title, title), section: ranges(match.section, section ?? ''), excerpt: ranges(match.excerpt, excerpt) },
    };
  });
}
