import { docsFailure } from './errors';

/** Arrays keep semantic order; object keys sort so source key order cannot change build identity. */
export function canonicalDocsJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
}
export function docsHash(value: string | Uint8Array): string { return new Bun.CryptoHasher('sha256').update(value).digest('hex'); }
export function freezeDocsValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDocsValue(child);
    Object.freeze(value);
  }
  return value;
}
export function docsLabel(value: string): string {
  return value.replace(/\.md$/iu, '').replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    .replace(/^\p{L}/u, letter => letter.toUpperCase()) || 'Documentation';
}
export function normalizeDocsBasePath(value = '/docs'): string {
  if (typeof value !== 'string') docsFailure('DOCS_CONFIG_INVALID', 'basePath must be a string.', { field: 'basePath' });
  if (value === '/') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || /[?#%\\\u0000-\u001f]/u.test(value)) {
    docsFailure('DOCS_CONFIG_INVALID', 'basePath must be an absolute pathname without encoded segments, a query or a fragment.', { field: 'basePath' });
  }
  const segments = value.replace(/\/+$/u, '').slice(1).split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) docsFailure('DOCS_CONFIG_INVALID', 'basePath contains an invalid path segment.', { field: 'basePath' });
  return '/' + segments.map(encodeDocsSegment).join('/');
}
export function joinDocsRoute(basePath: string, segments: readonly string[]): string {
  return (basePath === '/' ? '' : basePath) + (segments.length ? '/' + segments.map(encodeDocsSegment).join('/') : '') || '/';
}
/** Encode route punctuation too: canonical paths must never introduce route-pattern or Markdown syntax. */
function encodeDocsSegment(value: string): string { return encodeURIComponent(value.normalize('NFC')).replace(/[!'()*]/gu, character => '%' + character.charCodeAt(0).toString(16).toUpperCase()); }
export const compareDocsPaths = (left: string, right: string): number => {
  const result = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare(left, right);
  return result || (left < right ? -1 : left > right ? 1 : 0);
};
