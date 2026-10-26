/** Stable disabled publishing facade. Author-only installations never open a content database. */
import { AuthError } from '../auth/types';
import type { BlogPostsApi, BlogTaxonomiesApi } from './content-types';
import type { BlogMediaApi } from './media-types';
import type { BlogServerMediaApi } from './media-service';
import type { BlogMetricsApi } from './metrics-types';

const unavailable = async (): Promise<never> => {
  throw new AuthError('Blog content publishing is not enabled.', 'BLOG_CONTENT_DISABLED', 503);
};
/** Capability inspection is harmless; every content operation fails explicitly. */
export function unavailableBlogContent(basePath: string): { posts: BlogPostsApi; taxonomies: BlogTaxonomiesApi; media: BlogMediaApi; metrics: BlogMetricsApi } {
  return Object.freeze({
    posts: Object.freeze<BlogPostsApi>({
      capabilities: async () => ({ state: 'disabled', canCreate: false, canManage: false, canPublishOwn: false, basePath }),
      list: unavailable, get: unavailable, create: unavailable, update: unavailable,
      publish: unavailable, withdraw: unavailable, trash: unavailable,
      revisions: unavailable, restore: unavailable,
    }),
    taxonomies: Object.freeze<BlogTaxonomiesApi>({ list: unavailable, create: unavailable, update: unavailable, remove: unavailable }),
    media: unavailableBlogMedia(),
    metrics: Object.freeze<BlogMetricsApi>({ capabilities: async () => ({ enabled: false, retentionDays: 90 }), page: unavailable }),
  });
}
/** Stable author-only media surface without Storage or actor side effects. */
export function unavailableBlogMedia(): BlogServerMediaApi {
  return Object.freeze({ list: unavailable, get: unavailable, allocate: unavailable, upload: unavailable, remove: unavailable, open: unavailable });
}
