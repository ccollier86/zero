/** Bounded, content-free errors and safe URL/JSON admission shared by SEO projections. */
import type { SeoJson } from './types';

export class SeoError extends Error {
  readonly code = 'SEO_METADATA_INVALID';
  constructor(readonly field: string) { super(`Invalid SEO metadata: ${field}.`); this.name = 'SeoError'; }
}
export function seoText(value: unknown, field: string, limit = 8192): string {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) throw new SeoError(field);
  return value;
}
export function seoUrl(value: unknown, siteUrl?: string): string {
  const text = seoText(value, 'url', 2048);
  if (!text || /[\\\s]/u.test(text) || text.startsWith('//')) throw new SeoError('url');
  let result: URL;
  try { result = text.startsWith('/') && siteUrl ? new URL(siteUrl.replace(/\/+$/, '') + text) : new URL(text); }
  catch { throw new SeoError('url'); }
  if (!['https:', 'http:'].includes(result.protocol) || result.username || result.password) throw new SeoError('url');
  result.hash = '';
  if (result.href.length > 2048) throw new SeoError('url');
  return result.href;
}
export function seoSiteUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const result = seoUrl(value);
  if (new URL(value).search || new URL(value).hash) throw new SeoError('siteUrl');
  return result.replace(/\/+$/, '');
}
export function escapeSeo(value: string): string {
  return value.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}
/** Do not invoke getters/toJSON or permit cycles, non-JSON objects or nonfinite numbers. */
export function serializeSeoJson(value: SeoJson): string {
  const ancestors = new Set<object>(); let nodes = 0;
  function copy(input: unknown, depth: number): unknown {
    if (++nodes > 10000 || depth > 24) throw new SeoError('jsonLd');
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (!input || typeof input !== 'object' || ancestors.has(input)
      || !Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new SeoError('jsonLd');
    ancestors.add(input);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (Object.getOwnPropertySymbols(input).length || Object.values(descriptors).some(item => item.get || item.set)) throw new SeoError('jsonLd');
      if (Array.isArray(input)) return input.map(item => copy(item, depth + 1));
      return Object.fromEntries(Object.keys(input).map(key => [key, copy(descriptors[key]!.value, depth + 1)]));
    } finally { ancestors.delete(input); }
  }
  const json = JSON.stringify(copy(value, 0));
  if (new TextEncoder().encode(json).byteLength > 65536) throw new SeoError('jsonLd');
  return json.replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e').replace(/&/gu, '\\u0026').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}
