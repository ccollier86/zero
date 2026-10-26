/** Browser publishing transport. Reuses the SDK's generation/abort boundary and stable mutation identities. */
import type { BlogPostsApi, BlogTaxonomiesApi, BlogMutationOptions, BlogPostQuery, BlogPostRecord, BlogPage, BlogPostSummary, BlogTaxonomyTerm, BlogPublishedPost, BlogPublishedSummary } from '../../blog/content-types';

export type BlogTransport = <T>(path: string, method: string, body: unknown, signal?: AbortSignal, requestId?: string) => Promise<T>;
/** Closed query serialization; unknown client options cannot turn into arbitrary native parameters. */
export function blogQueryString(input: object = {}): string {
  const params = new URLSearchParams();
  for (const key of ['search', 'status', 'authorId', 'categoryId', 'tagId', 'limit', 'offset', 'order', 'kind'] as const) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) params.set(key, String(value));
  }
  return params.size ? '?' + params : '';
}
function requestId(options: BlogMutationOptions): string {
  if (!options || typeof options.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(options.requestId)) throw new Error('A stable blog requestId is required.');
  return options.requestId;
}
/** No automatic retry or new UUID is minted behind the caller's back after an uncertain mutation. */
export function createBlogContentClient(call: BlogTransport): { posts: BlogPostsApi; taxonomies: BlogTaxonomiesApi } {
  const mutate = <T>(path: string, method: string, body: unknown, options: BlogMutationOptions) => call<T>(path, method, body, options.signal, requestId(options));
  const post = (id: string) => '/posts/' + encodeURIComponent(id);
  return Object.freeze({
    posts: Object.freeze<BlogPostsApi>({
      capabilities: () => call('/posts/config', 'GET', undefined),
      list: (query = {}, options) => call<BlogPage<BlogPostSummary>>('/posts' + blogQueryString(query), 'GET', undefined, options?.signal),
      get: (id, options) => call<BlogPostRecord>(post(id), 'GET', undefined, options?.signal),
      create: (content, options) => mutate('/posts', 'POST', content, options),
      update: (id, expectedRevision, content, options) => mutate(post(id), 'PUT', { expectedRevision, content }, options),
      publish: (id, expectedRevision, options) => mutate(post(id) + '/publish', 'POST', { expectedRevision }, options),
      withdraw: (id, expectedRevision, options) => mutate(post(id) + '/withdraw', 'POST', { expectedRevision }, options),
      trash: (id, expectedRevision, options) => mutate(post(id) + '/trash', 'POST', { expectedRevision }, options),
      revisions: (id, query = {}, options) => call(post(id) + '/revisions' + blogQueryString(query), 'GET', undefined, options?.signal),
      restore: (id, expectedRevision, revision, options) => mutate(post(id) + '/restore', 'POST', { expectedRevision, revision }, options),
    }),
    taxonomies: Object.freeze<BlogTaxonomiesApi>({
      list: (query = {}, options) => call<BlogPage<BlogTaxonomyTerm>>('/taxonomies' + blogQueryString(query), 'GET', undefined, options?.signal),
      create: (term, options) => mutate('/taxonomies', 'POST', term, options),
      update: (id, expectedRevision, term, options) => mutate('/taxonomies/' + encodeURIComponent(id), 'PUT', { expectedRevision, term }, options),
      remove: (id, expectedRevision, options) => mutate('/taxonomies/' + encodeURIComponent(id), 'DELETE', { expectedRevision }, options),
    }),
  });
}
export interface PublicBlogContentClient {
  posts(siteSlug: string, query?: Omit<BlogPostQuery, 'status'>, options?: { signal?: AbortSignal }): Promise<BlogPage<BlogPublishedSummary>>;
  post(siteSlug: string, slug: string, options?: { signal?: AbortSignal }): Promise<BlogPublishedPost>;
  taxonomies(siteSlug: string, query?: { kind?: 'category' | 'tag'; limit?: number; offset?: number }, options?: { signal?: AbortSignal }): Promise<BlogPage<BlogTaxonomyTerm>>;
  taxonomy(siteSlug: string, id: string, options?: { signal?: AbortSignal }): Promise<BlogTaxonomyTerm>;
}
