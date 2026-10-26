/** No second auth client: Zero's existing fetch, plus a disposable author-view generation. */
import { BLOG_API } from '../../blog/contracts';
import type {
  BlogClient,
  BlogLiveSnapshot,
  PublicBlogClient,
} from '../../blog/client-contracts';
import type { FetchInit } from './sdk';
import { createBlogContentClient, blogQueryString } from './blog-content-client';
import { watchBlogPosts, watchBlogPost, watchBlogMetrics } from './blog-content-watch';
import { createBlogMediaClient, type BlogBinaryTransport } from './blog-media-client';
import type { BlogMetricsApi } from '../../blog/metrics-types';
import {
  assertBlogAuthor,
  assertBlogCapabilities,
  assertBlogPage,
  assertBlogPublicAuthor,
} from './blog-parser';
export function createBlogClient(
  fetch: <T>(path: string, init?: FetchInit) => Promise<T>,
  raw?: BlogBinaryTransport,
): BlogClient {
  let generation = 0,
    boundary = new AbortController();
  const call = async <T>(
    path: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<T> => {
    const epoch = generation,
      active = AbortSignal.any([
        boundary.signal,
        AbortSignal.timeout(30000),
        ...(signal ? [signal] : []),
      ]);
    active.throwIfAborted();
    const value = await abortable(
      fetch<T>(BLOG_API + path, {
        method,
        ...(requestId ? { headers: { 'Idempotency-Key': requestId } } : {}),
        ...(body === undefined ? {} : { body: structuredClone(body) }),
        signal: active,
      }),
      active,
    );
    active.throwIfAborted();
    if (epoch !== generation)
      throw new DOMException('Blog scope changed.', 'AbortError');
    return value;
  };
  const author = async (
    path: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ) => {
    const value = await call(path, method, body, signal);
    assertBlogAuthor(value);
    return value;
  };
  return Object.freeze({
    ...createBlogContentClient(call),
    media: createBlogMediaClient(call, raw ? (path, init) => raw(BLOG_API + path, init) : undefined, () => boundary.signal),
    metrics: Object.freeze<BlogMetricsApi>({
      capabilities: () => call('/metrics/config', 'GET', undefined),
      page: (query = {}, options) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
        return call('/metrics' + (params.size ? '?' + params : ''), 'GET', undefined, options?.signal);
      },
    }),
    watchPosts(listener, options) {
      return watchBlogPosts((path, signal) => fetch<Response>(BLOG_API + path, { signal, json: false }), boundary.signal, listener, options);
    },
    watchPost(id, listener, options) {
      return watchBlogPost((path, signal) => fetch<Response>(BLOG_API + path, { signal, json: false }), boundary.signal, id, listener, options);
    },
    watchMetrics(listener, options) {
      return watchBlogMetrics((path, signal) => fetch<Response>(BLOG_API + path, { signal, json: false }), boundary.signal, listener, options);
    },
    clear() {
      generation++;
      boundary.abort();
      boundary = new AbortController();
    },
    async capabilities(options) {
      const value = await call('/config', 'GET', undefined, options?.signal);
      assertBlogCapabilities(value);
      return value;
    },
    authors: Object.freeze<BlogClient['authors']>({
      async list(query = {}, options) {
        const search = new URLSearchParams();
        if (query.limit !== undefined) search.set('limit', String(query.limit));
        if (query.after) search.set('after', query.after);
        const value = await call(
          '/authors' + (search.size ? '?' + search : ''),
          'GET',
          undefined,
          options?.signal,
        );
        assertBlogPage(value);
        return value;
      },
      get: (userId, options) =>
        author(
          '/authors/' + encodeURIComponent(userId),
          'GET',
          undefined,
          options?.signal,
        ),
      assign: (input, options) =>
        author('/authors', 'POST', input, options?.signal),
      updateProfile: (userId, input, options) =>
        author(
          '/authors/' + encodeURIComponent(userId) + '/profile',
          'PATCH',
          input,
          options?.signal,
        ),
      publishProfile: (userId, expectedRevision, options) =>
        author(
          '/authors/' + encodeURIComponent(userId) + '/publication',
          'POST',
          { expectedRevision },
          options?.signal,
        ),
      withdrawProfile: (userId, expectedRevision, options) =>
        author(
          '/authors/' + encodeURIComponent(userId) + '/publication',
          'DELETE',
          { expectedRevision },
          options?.signal,
        ),
    }),
    watch(listener, options = {}) {
      const epoch = generation,
        owner = new AbortController(),
        signal = AbortSignal.any([
          boundary.signal,
          owner.signal,
          ...(options.signal ? [options.signal] : []),
        ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const consume = async () => {
        const connection = AbortSignal.any([
          signal,
          AbortSignal.timeout(30000),
        ]);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
          failed = false;
        const cancel = () => {
          void reader?.cancel().catch(() => {});
        };
        try {
          const response = await abortable(
            fetch<Response>(BLOG_API + '/live', {
              signal: connection,
              json: false,
            }),
            connection,
          );
          if (signal.aborted || epoch !== generation) {
            await response.body?.cancel();
            return;
          }
          if (
            !response.body ||
            !response.headers.get('content-type')?.includes('text/event-stream')
          )
            throw new Error('Invalid blog stream.');
          reader = response.body.getReader();
          connection.addEventListener('abort', cancel, { once: true });
          if (connection.aborted) {
            await reader.cancel();
            return;
          }
          const decoder = new TextDecoder('utf-8', { fatal: true });
          let buffer = '',
            data = '';
          for (;;) {
            const chunk = await reader.read();
            connection.throwIfAborted();
            if (signal.aborted || epoch !== generation || chunk.done) break;
            if (chunk.value.byteLength > 1024 * 1024)
              throw new Error('Blog stream is too large.');
            buffer += decoder.decode(chunk.value, { stream: true });
            if (buffer.length > 1024 * 1024)
              throw new Error('Blog stream is too large.');
            for (let newline; (newline = buffer.indexOf('\n')) >= 0; ) {
              const line = buffer.slice(0, newline).replace(/\r$/, '');
              buffer = buffer.slice(newline + 1);
              if (line.startsWith('data:')) {
                data += line.slice(5).trimStart() + '\n';
                if (data.length > 1024 * 1024)
                  throw new Error('Blog event is too large.');
                continue;
              }
              if (line || !data) continue;
              const packet = JSON.parse(data);
              data = '';
              if (packet.version !== 1) throw new Error('Invalid blog event.');
              assertBlogCapabilities(packet.value?.capabilities);
              if (packet.value.authors !== undefined)
                assertBlogPage(packet.value.authors);
              if (!signal.aborted && epoch === generation)
                listener(packet.value as BlogLiveSnapshot);
            }
          }
        } catch (error) {
          failed = true;
          if (!signal.aborted && epoch === generation) {
            try {
              options.onError?.(error);
            } catch {
              /* Observer only. */
            }
          }
        } finally {
          connection.removeEventListener('abort', cancel);
          try {
            await reader?.cancel();
            reader?.releaseLock();
          } catch {
            /* Retired. */
          }
          if (!signal.aborted && epoch === generation)
            timer = setTimeout(
              () => {
                void consume();
              },
              failed ? 3000 : 250,
            );
        }
      };
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
        },
        { once: true },
      );
      void consume();
      return () => {
        owner.abort();
        clearTimeout(timer);
      };
    },
  } satisfies BlogClient);
}
/** Public reads deliberately send no cookies or application credentials. */
export function createPublicBlogClient(
  baseUrl: string,
  fetcher: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = globalThis.fetch,
): PublicBlogClient {
  const base = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid blog base URL.');
  return Object.freeze<PublicBlogClient>({
    metricTicket: (siteSlug, slug, options) => publicContent('posts/' + encodeURIComponent(slug) + '/metrics-ticket', siteSlug, options?.signal),
    observe: (siteSlug, slug, ticket, observation, options) => publicContent('posts/' + encodeURIComponent(slug) + '/observations', siteSlug, options?.signal, { ticket, observation }),
    posts: (siteSlug, query = {}, options) => publicContent('posts' + blogQueryString(query), siteSlug, options?.signal),
    post: (siteSlug, slug, options) => publicContent('posts/' + encodeURIComponent(slug), siteSlug, options?.signal),
    taxonomies: (siteSlug, query = {}, options) => publicContent('taxonomies' + blogQueryString(query), siteSlug, options?.signal),
    taxonomy: (siteSlug, id, options) => publicContent('taxonomies/' + encodeURIComponent(id), siteSlug, options?.signal),
    async author(siteSlug, authorSlug, options) {
      const signal = AbortSignal.any([
        AbortSignal.timeout(30000),
        ...(options?.signal ? [options.signal] : []),
      ]);
      const response = await abortable(
        fetcher(
          base.href.replace(/\/$/, '') +
            BLOG_API +
            '/public/' +
            encodeURIComponent(siteSlug) +
            '/authors/' +
            encodeURIComponent(authorSlug),
          { signal, credentials: 'omit', cache: 'no-store' },
        ),
        signal,
      );
      if (!response.ok || !response.body)
        throw new Error('The public author is unavailable.');
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let text = '',
        bytes = 0;
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        for (;;) {
          signal.throwIfAborted();
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 65536)
            throw new Error('Public author response is too large.');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        const value = JSON.parse(text);
        assertBlogPublicAuthor(value);
        if (value.slug !== authorSlug)
          throw new Error(
            'The public author response did not match its address.',
          );
        return value;
      } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
        try {
          reader.releaseLock();
        } catch {
          /* Exhausted/cancelled native-reader cleanup is best effort. */
        }
      }
    },
  });
  /** Anonymous public snapshots use no cookies; cap decoding independently of arbitrary server response sizes. */
  async function publicContent<T>(path: string, siteSlug: string, inputSignal?: AbortSignal, body?: unknown): Promise<T> {
    const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(inputSignal ? [inputSignal] : [])]);
    const response = await abortable(fetcher(base.href.replace(/\/$/, '') + BLOG_API + '/public/' + encodeURIComponent(siteSlug) + '/' + path,
      { signal, credentials: 'omit', cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }), signal);
    if (!response.ok || !response.body) throw new Error('The public blog content is unavailable.');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    const cancel = () => { void reader.cancel().catch(() => {}); }; let text = '', bytes = 0;
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1536 * 1024) throw new Error('Public blog response is too large.');
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode()) as T;
    } finally {
      signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* Native-reader cleanup is best effort. */ }
    }
  }
}

/** Retire promptly even when an application-supplied transport ignores abort. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(
        signal.reason ?? new DOMException('Request aborted.', 'AbortError'),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) {
          if (value instanceof Response)
            void value.body?.cancel().catch(() => {});
          return;
        }
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
