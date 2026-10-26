/** Serializable published-only reader props shared by SSR and progressive enhancement. No private client/author records. */
import type { BlogPost, BlogCategory } from '../components/blog/blog.types';

export interface BlogPublicPageModel {
  version: 1;
  nonce: string;
  site: string;
  basePath: string;
  siteName: string;
  title?: string;
  description?: string;
  canonical?: string;
  categories: readonly BlogCategory[];
  posts: readonly BlogPost[];
  article: BlogPost | null;
  query: { search: string; category: string | null; tag: string | null; page: number };
  total: number;
  pageSize: number;
  metricsEnabled?: boolean;
}
/** Script data only: escape HTML parser terminators, not React text nodes. */
export function serializeBlogPage(model: BlogPublicPageModel): string {
  return JSON.stringify(model).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
