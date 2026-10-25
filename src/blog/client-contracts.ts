/** Browser-safe author contracts. Transport uses the existing Zero SDK authentication boundary. */
import type {
  BlogAuthorRecord,
  BlogAuthorPage,
  BlogCapabilities,
  BlogPublicAuthor,
  AssignBlogAuthorInput,
  UpdateBlogAuthorProfileInput,
} from './types';
export { BLOG_API } from './contracts';
export type * from './types';
export interface BlogLiveSnapshot {
  capabilities: BlogCapabilities;
  authors?: BlogAuthorPage;
}
export interface BlogClient {
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
export interface PublicBlogClient {
  author(
    siteSlug: string,
    authorSlug: string,
    options?: { signal?: AbortSignal },
  ): Promise<BlogPublicAuthor>;
}
export { createPublicBlogClient } from '../frontend/client/blog-client';
