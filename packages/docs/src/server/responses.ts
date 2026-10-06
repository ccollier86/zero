/** Shared public read response policy; assets and projections never bypass snapshot admission. */
import { basename } from 'node:path';
import type { DocsAsset } from '../content/types';
import { docsHash } from '../content/identity';

/** Public, admitted projections revalidate; request-local HTML overrides this policy. */
export function docsHeaders(contentType: string, etag?: string): Headers {
  return new Headers({ 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'public, max-age=0, must-revalidate', ...(etag ? { ETag: etag } : {}) });
}
/** Bind a text projection's validator to its emitted representation and media type. */
export function docsTextEtag(body: string, contentType: string): string {
  return '"' + docsHash(contentType + '\0' + body) + '"';
}
/** Compare a complete valid entity-tag list weakly for the GET/HEAD read contract. */
function matchesReadValidator(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const expected = /^(?:W\/)?"([\x21\x23-\x7e\x80-\xff]*)"$/u.exec(etag)?.[1];
  if (expected === undefined) return false;
  let index = 0, matched = false;
  while (index < header.length) {
    while (/[\t ,]/u.test(header[index] ?? '') && index < header.length) index++;
    if (index === header.length) break;
    if (header.startsWith('W/', index)) index += 2;
    if (header[index++] !== '"') return false;
    const start = index;
    while (index < header.length && header[index] !== '"') {
      const code = header.charCodeAt(index++);
      if (code < 0x21 || code === 0x7f || code > 0xff) return false;
    }
    if (header[index] !== '"') return false;
    if (header.slice(start, index) === expected) matched = true;
    index++;
    while (header[index] === ' ' || header[index] === '\t') index++;
    if (index < header.length && header[index++] !== ',') return false;
  }
  return matched;
}
/** Serve body-free conditional reads while preserving representation/security headers. */
export function docsReadResponse(request: Request, body: BodyInit, contentType: string, etag: string, extra?: HeadersInit): Response {
  const headers = docsHeaders(contentType, etag); new Headers(extra).forEach((value, key) => headers.set(key, value));
  if (['GET', 'HEAD'].includes(request.method) && matchesReadValidator(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
/** Safe static failures remain uncacheable and obey HEAD's body-free contract. */
export function docsErrorResponse(status: 404 | 503 | 500 | 400, code: string, request?: Request): Response {
  const body = JSON.stringify({ code, error: status === 404 ? 'Documentation not found.' : status === 400 ? 'Invalid documentation request.' : 'Documentation is temporarily unavailable.' });
  return new Response(request?.method === 'HEAD' ? null : body, { status,
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(body).byteLength), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
/** Published bytes retain their admitted MIME type, hash and safe disposition. */
export function docsAssetResponse(request: Request, asset: DocsAsset, bytes: Uint8Array): Response {
  const disposition = asset.mime.startsWith('image/') ? 'inline' : 'attachment';
  return docsReadResponse(request, bytes.slice(), asset.mime, '"' + asset.hash + '"',
    { 'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(basename(asset.sourcePath)).replace(/[!'()*]/gu, character => '%' + character.charCodeAt(0).toString(16))}` });
}
