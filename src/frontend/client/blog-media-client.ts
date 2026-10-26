/** Browser private media facade. Uses the same SDK authentication and generation lifetime for JSON and binary transport. */
import type { BlogTransport } from './blog-content-client';
import { blogQueryString } from './blog-content-client';
import type { BlogBrowserMediaApi } from '../../blog/media-types';
import type { BlogMutationOptions } from '../../blog/content-types';
import { createBlogPreviewAdmission } from './blog-preview-admission';
import { readBlogBinaryJson } from './blog-response-body';

export type BlogBinaryTransport = (path: string, init: RequestInit) => Promise<Response>;
/** Allocation, upload and placement are separate so interrupted uploads never replace an existing publication. */
export function createBlogMediaClient(call: BlogTransport, raw: BlogBinaryTransport | undefined, boundary: () => AbortSignal): BlogBrowserMediaApi {
  const preview = createBlogPreviewAdmission();
  const path = (id: string) => '/media/' + encodeURIComponent(id);
  const key = (options: BlogMutationOptions) => {
    if (!options || typeof options.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(options.requestId)) throw new Error('A stable blog requestId is required.');
    return options.requestId;
  };
  return Object.freeze<BlogBrowserMediaApi>({
    list: (query = {}, options) => call('/media' + blogQueryString(query), 'GET', undefined, options?.signal),
    get: (id, options) => call(path(id), 'GET', undefined, options?.signal),
    allocate: (input, options) => call('/media', 'POST', input, options.signal, key(options)),
    remove: (id, options) => call(path(id), 'DELETE', undefined, options.signal, key(options)),
    async imagePreview(id, options) {
      if (!raw) throw new Error('Image previews require the managed Zero SDK transport.');
      const signal = AbortSignal.any([boundary(), AbortSignal.timeout(30000), ...(options?.signal ? [options.signal] : [])]);
      return preview(signal, async () => {
      const asset = await call<import('../../blog/media-types').BlogMediaAsset>(path(id), 'GET', undefined, signal);
      if (asset.kind !== 'image' || asset.state !== 'ready' || !asset.sizeBytes || asset.sizeBytes > 32 * 1024 * 1024) throw new Error('Image preview is unavailable.');
      const response = await raw(path(id) + '/content', { signal, cache: 'no-store' });
      signal.throwIfAborted();
      if (!response.ok || !response.body || response.headers.get('Content-Type')?.split(';')[0] !== 'image/webp') { await response.body?.cancel().catch(() => {}); throw new Error('Image preview is unavailable.'); }
      const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
      try {
        for (;;) { signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted(); if (part.done) break;
          size += part.value.byteLength; if (size > asset.sizeBytes || size > 32 * 1024 * 1024) throw new Error('Image preview exceeds its admitted size.'); chunks.push(Uint8Array.from(part.value)); }
        if (size !== asset.sizeBytes) throw new Error('Image preview was interrupted.');
        return new Blob(chunks, { type: 'image/webp' });
      } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      });
    },
    async upload(id, body, options) {
      if (!raw) throw new Error('Binary blog upload requires the managed Zero SDK transport.');
      const requestId = key(options), signal = AbortSignal.any([boundary(), AbortSignal.timeout(10 * 60000), ...(options.signal ? [options.signal] : [])]);
      signal.throwIfAborted();
      const upload: BodyInit = body instanceof Uint8Array ? new Blob([Uint8Array.from(body).buffer]) : body;
      const response = await raw(path(id) + '/content', { method: 'PUT', body: upload, signal,
        headers: { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': requestId },
        ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
      });
      signal.throwIfAborted();
      if (!response.ok) {
        const error = await readBlogBinaryJson(response, signal).catch(() => null) as { code?: unknown } | null;
        throw Object.assign(new Error('Blog media upload was not accepted.'), { status: response.status, ...(typeof error?.code === 'string' ? { code: error.code } : {}) });
      }
      const value = await readBlogBinaryJson(response, signal) as import('../../blog/media-types').BlogMediaAsset;
      signal.throwIfAborted();
      if (!value || value.id !== id || value.state !== 'ready' || !['image', 'audio', 'video'].includes(value.kind) || !Number.isSafeInteger(value.sizeBytes) || !value.sizeBytes || value.sizeBytes < 0) throw new Error('The blog upload acknowledgment is invalid; reconcile using the original request identity.');
      return value;
    },
  });
}
