/** Browser-safe versioned publishing contracts. These values contain no database, transport or editor ownership. */
export interface BlogInlineText {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}
/** Alternative text belongs to the image placement, not only its reusable asset. */
export interface BlogImageReference {
  mediaId: string;
  alt: string;
  decorative?: boolean;
  caption?: string;
}
export type BlogDocumentBlock = { id: string } & (
  | { type: 'paragraph'; content: readonly BlogInlineText[] }
  | { type: 'heading'; level: 2 | 3 | 4 | 5 | 6; content: readonly BlogInlineText[] }
  | { type: 'quote'; content: readonly BlogInlineText[]; attribution?: string }
  | { type: 'list'; ordered: boolean; items: readonly (readonly BlogInlineText[])[] }
  | { type: 'callout'; tone: 'info' | 'warning' | 'error' | 'success' | 'tip'; title?: string; content: readonly BlogInlineText[] }
  | { type: 'code'; code: string; language: string; filename?: string }
  | { type: 'image'; image: BlogImageReference }
  | { type: 'gallery'; images: readonly BlogImageReference[]; layout: 'grid' | 'carousel' | 'stack'; columns: 2 | 3 | 4 }
  | { type: 'video'; mediaId: string; title: string; poster?: BlogImageReference }
  | { type: 'audio'; mediaId: string; title: string; artist?: string; cover?: BlogImageReference }
  | { type: 'embed'; url: string; title: string; description?: string }
  | { type: 'divider' }
);
export interface BlogDocument { version: 1; blocks: readonly BlogDocumentBlock[] }
export interface BlogPostSeo {
  title: string | null;
  description: string | null;
  noIndex: boolean;
  socialImage: BlogImageReference | null;
}
export interface BlogPostContent {
  title: string;
  slug: string;
  excerpt: string;
  authorId: string;
  document: BlogDocument;
  featuredImage: BlogImageReference | null;
  categoryIds: readonly string[];
  tagIds: readonly string[];
  seo: BlogPostSeo;
}
export type BlogPostStatus = 'draft' | 'published' | 'withdrawn' | 'trashed';
export interface BlogPostRecord {
  id: string;
  siteId: string;
  revision: number;
  publicRevision: number;
  status: BlogPostStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  hasUnpublishedChanges: boolean;
  content: BlogPostContent;
}
export interface BlogPostSummary extends Omit<BlogPostRecord, 'content'> {
  title: string;
  slug: string;
  excerpt: string;
  authorId: string;
}
export interface BlogPostQuery {
  search?: string;
  status?: BlogPostStatus;
  authorId?: string;
  categoryId?: string;
  tagId?: string;
  limit?: number;
  offset?: number;
  order?: 'recent' | 'oldest' | 'relevance';
}
export interface BlogPage<T> { items: readonly T[]; total: number; limit: number; offset: number; hasMore: boolean }
export interface BlogRevisionRecord { id: string; postId: string; revision: number; actorId: string; createdAt: number; action: 'create' | 'edit' | 'publish' | 'withdraw' | 'trash' | 'restore'; content: BlogPostContent }
export interface BlogTaxonomyTerm {
  id: string; siteId: string; kind: 'category' | 'tag'; slug: string; name: string; description: string;
  parentId: string | null; revision: number; seoTitle: string | null; seoDescription: string | null; noIndex: boolean;
}
export type BlogTermInput = Omit<BlogTaxonomyTerm, 'id' | 'siteId' | 'revision'>;
export interface BlogPublishedPost {
  id: string; siteId: string; publicRevision: number; publishedAt: number; updatedAt: number;
  content: BlogPostContent;
  /** A retained previous slug redirects only while its post remains published. */
  author: { id: string; name: string };
  redirectTo: string | null;
}
export interface BlogPublishedSummary {
  id: string; siteId: string; publicRevision: number; publishedAt: number; updatedAt: number;
  title: string; slug: string; excerpt: string; authorId: string; featuredImage: BlogImageReference | null;
  /** Explicit public name at publication, never a private account fallback. */
  author: { id: string; name: string };
  categoryIds: readonly string[];
  tagIds: readonly string[];
}
export interface BlogPublishingCapabilities { state: 'ready' | 'disabled'; canCreate: boolean; canManage: boolean; canPublishOwn: boolean; basePath: string }
export interface BlogMutationOptions { requestId: string; signal?: AbortSignal }
/** Scope and actor are fixed by Guardian; no method accepts a database or tenant selector. */
export interface BlogPostsApi {
  capabilities(): Promise<BlogPublishingCapabilities>;
  list(query?: BlogPostQuery, options?: { signal?: AbortSignal }): Promise<BlogPage<BlogPostSummary>>;
  get(id: string, options?: { signal?: AbortSignal }): Promise<BlogPostRecord>;
  create(content: BlogPostContent, options: BlogMutationOptions): Promise<BlogPostRecord>;
  update(id: string, expectedRevision: number, content: BlogPostContent, options: BlogMutationOptions): Promise<BlogPostRecord>;
  publish(id: string, expectedRevision: number, options: BlogMutationOptions): Promise<BlogPostRecord>;
  withdraw(id: string, expectedRevision: number, options: BlogMutationOptions): Promise<BlogPostRecord>;
  trash(id: string, expectedRevision: number, options: BlogMutationOptions): Promise<BlogPostRecord>;
  revisions(id: string, query?: { limit?: number; offset?: number }, options?: { signal?: AbortSignal }): Promise<BlogPage<BlogRevisionRecord>>;
  restore(id: string, expectedRevision: number, revision: number, options: BlogMutationOptions): Promise<BlogPostRecord>;
}
export interface BlogPostsWatchOptions { query?: BlogPostQuery; signal?: AbortSignal; onError?: (error: unknown) => void }
export interface BlogTaxonomiesApi {
  list(query?: { kind?: 'category' | 'tag'; limit?: number; offset?: number }, options?: { signal?: AbortSignal }): Promise<BlogPage<BlogTaxonomyTerm>>;
  create(input: BlogTermInput, options: BlogMutationOptions): Promise<BlogTaxonomyTerm>;
  update(id: string, expectedRevision: number, input: BlogTermInput, options: BlogMutationOptions): Promise<BlogTaxonomyTerm>;
  remove(id: string, expectedRevision: number, options: BlogMutationOptions): Promise<{ removed: true }>;
}
