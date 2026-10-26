/** Browser-safe author contracts. Transport uses the existing Zero SDK authentication boundary. */
import type {
  BlogAuthorRecord,
  BlogAuthorPage,
  BlogCapabilities,
  BlogPublicAuthor,
  AssignBlogAuthorInput,
  UpdateBlogAuthorProfileInput,
} from './types';
import type { BlogPostsApi, BlogTaxonomiesApi, BlogPostsWatchOptions, BlogPage, BlogPostSummary, BlogPostRecord } from './content-types';
import type { BlogBrowserMediaApi } from './media-types';
import type { BlogMetricsApi, BlogMetricTicket, BlogMetricObservation, BlogMetricsPage, BlogMetricsQuery } from './metrics-types';
import type { PublicBlogContentClient } from '../frontend/client/blog-content-client';
export { BLOG_API } from './contracts';
export type * from './types';
export type * from './content-types';
export type * from './media-types';
export type * from './metrics-types';
export interface BlogLiveSnapshot {
  capabilities: BlogCapabilities;
  authors?: BlogAuthorPage;
}
export interface BlogClient {
  posts: BlogPostsApi;
  taxonomies: BlogTaxonomiesApi;
  media: BlogBrowserMediaApi;
  metrics: BlogMetricsApi;
  watchPosts(listener: (page: BlogPage<BlogPostSummary>) => void, options?: BlogPostsWatchOptions): () => void;
  watchPost(id: string, listener: (post: BlogPostRecord) => void, options?: { signal?: AbortSignal; onError?: (error: unknown) => void }): () => void;
  watchMetrics(listener: (page: BlogMetricsPage) => void, options?: { query?: BlogMetricsQuery; signal?: AbortSignal; onError?: (error: unknown) => void }): () => void;
  clear(): void;
  capabilities(options?: { signal?: AbortSignal }): Promise<BlogCapabilities>;
  authors: {
    list(
      query?: { limit?: number; after?: string },
      options?: { signal?: AbortSignal },
    ): Promise<BlogAuthorPage>;
    get(
      userId: string,
      options?: { signal?: AbortSignal },
    ): Promise<BlogAuthorRecord>;
    assign(
      input: AssignBlogAuthorInput,
      options?: { signal?: AbortSignal },
    ): Promise<BlogAuthorRecord>;
    updateProfile(
      userId: string,
      input: UpdateBlogAuthorProfileInput,
      options?: { signal?: AbortSignal },
    ): Promise<BlogAuthorRecord>;
    publishProfile(
      userId: string,
      expectedRevision: number,
      options?: { signal?: AbortSignal },
    ): Promise<BlogAuthorRecord>;
    withdrawProfile(
      userId: string,
      expectedRevision: number,
      options?: { signal?: AbortSignal },
    ): Promise<BlogAuthorRecord>;
  };
  watch(
    listener: (snapshot: BlogLiveSnapshot) => void,
    options?: { signal?: AbortSignal; onError?: (error: unknown) => void },
  ): () => void;
}
export interface PublicBlogClient extends PublicBlogContentClient {
  metricTicket(siteSlug: string, postSlug: string, options?: { signal?: AbortSignal }): Promise<BlogMetricTicket>;
  observe(siteSlug: string, postSlug: string, ticket: string, observation: BlogMetricObservation, options?: { signal?: AbortSignal }): Promise<{ accepted: true; duplicate: boolean }>;
  author(
    siteSlug: string,
    authorSlug: string,
    options?: { signal?: AbortSignal },
  ): Promise<BlogPublicAuthor>;
}
export { createPublicBlogClient } from '../frontend/client/blog-client';
