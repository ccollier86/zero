/** Bounded SSE publishing client. SDK generation ownership is supplied by the caller; it never caches cross-session projections. */
import type { BlogPage, BlogPostSummary, BlogPostsWatchOptions, BlogPostRecord } from '../../blog/content-types';
import { blogQueryString } from './blog-content-client';
import type { BlogMetricsPage, BlogMetricsQuery } from '../../blog/metrics-types';

/** Reconnect through the authenticated SDK; retire promptly on abort, logout or scope replacement. */
export function watchBlogPosts(open: (path: string, signal: AbortSignal) => Promise<Response>, boundary: AbortSignal,
  listener: (page: BlogPage<BlogPostSummary>) => void, options: BlogPostsWatchOptions = {}): () => void {
  return watchProjection(open, '/posts/live' + blogQueryString(options.query), boundary, listener, value => {
    if (!value || !Array.isArray(value.items) || value.items.length > 100 || !Number.isSafeInteger(value.total)) throw new Error('Invalid publishing snapshot.');
  }, options);
}
/** Exact-record live reads detect changes to older posts without depending on the leading page of a list. */
export function watchBlogPost(open: (path: string, signal: AbortSignal) => Promise<Response>, boundary: AbortSignal, id: string,
  listener: (post: BlogPostRecord) => void, options: { signal?: AbortSignal; onError?: (error: unknown) => void } = {}): () => void {
  return watchProjection(open, '/posts/' + encodeURIComponent(id) + '/live', boundary, listener, value => {
    if (!value || value.id !== id || !Number.isSafeInteger(value.revision) || !value.content || value.content.document?.version !== 1) throw new Error('Invalid article snapshot.');
  }, options);
}
/** Aggregate counters use the same coalesced, current-authority lifecycle as article projections. */
export function watchBlogMetrics(open: (path: string, signal: AbortSignal) => Promise<Response>, boundary: AbortSignal,
  listener: (page: BlogMetricsPage) => void, options: { query?: BlogMetricsQuery; signal?: AbortSignal; onError?: (error: unknown) => void } = {}): () => void {
  const query = new URLSearchParams();
  for (const key of ['postId', 'since', 'until', 'limit', 'offset'] as const) if (options.query?.[key] !== undefined) query.set(key, String(options.query[key]));
  return watchProjection(open, '/metrics/live' + (query.size ? '?' + query : ''), boundary, listener, value => {
    if (!value || !Array.isArray(value.items) || value.items.length > 100 || !Number.isSafeInteger(value.total)) throw new Error('Invalid metrics snapshot.');
  }, options);
}
function watchProjection<T>(open: (path: string, signal: AbortSignal) => Promise<Response>, path: string, boundary: AbortSignal,
  listener: (value: T) => void, validate: (value: any) => void, options: { signal?: AbortSignal; onError?: (error: unknown) => void }): () => void {
  const owner = new AbortController(), signal = AbortSignal.any([boundary, owner.signal, ...(options.signal ? [options.signal] : [])]);
  let retry: ReturnType<typeof setTimeout> | undefined;
  const consume = async () => {
    const connection = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, failed = false;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    try {
      const response = await open(path, connection);
      if (connection.aborted) { await response.body?.cancel(); return; }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Invalid publishing stream.');
      reader = response.body.getReader(); connection.addEventListener('abort', cancel, { once: true });
      const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
      for (;;) {
        const chunk = await reader.read(); connection.throwIfAborted();
        if (chunk.done) break;
        if (chunk.value.byteLength > 1536 * 1024) throw new Error('Publishing stream is too large.');
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 1536 * 1024) throw new Error('Publishing stream is too large.');
        for (let end; (end = buffer.indexOf('\n\n')) >= 0;) {
          const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const value = JSON.parse(data);
          if (value.version !== 1 || value.error) throw new Error('Publishing access must be revalidated.');
          validate(value.value);
          if (!signal.aborted) listener(value.value);
        }
      }
    } catch (error) { failed = true; if (!signal.aborted) try { options.onError?.(error); } catch { /* Observer only. */ } }
    finally {
      connection.removeEventListener('abort', cancel); await reader?.cancel().catch(() => {});
      try { reader?.releaseLock(); } catch { /* Native-reader cleanup is best effort. */ }
      if (!signal.aborted) retry = setTimeout(() => { void consume(); }, failed ? 3000 : 250);
    }
  };
  signal.addEventListener('abort', () => { clearTimeout(retry); }, { once: true });
  void consume(); return () => { owner.abort(); clearTimeout(retry); };
}
