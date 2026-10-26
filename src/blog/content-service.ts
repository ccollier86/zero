/** Guardian-bound publishing facade. It chooses authority/site, validates input and delegates persistence to fixed Fabric commands. */
import { AuthError } from '../auth/types';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { BlogService, BlogAuthority } from './service';
import type { ScopedBlog, ResolvedBlogConfig } from './types';
import type { BlogContentRuntime } from './content-runtime';
import type { LoggingRuntime } from '../logging/logging-runtime';
import { runWithLoggingAttribution } from '../logging/logging-attribution';
import type { BlogMediaService, BlogServerMediaApi, BlogMediaSnapshot } from './media-service';
import { unavailableBlogMedia } from './content-unavailable';
import type { BlogMetricsApi, BlogMetricsPage } from './metrics-types';
import type { BlogMetricsService } from './metrics-service';
import { blogArray, blogId, blogSlug, captureBlogPostContent, captureBlogQuery, captureBlogTerm } from './content-validation';
import { blogRecord, blogRevision } from './validation';
import { contentHash } from './content-rows';
import type { BlogMutationOptions, BlogPostContent, BlogPostRecord, BlogPostsApi, BlogTaxonomiesApi, BlogPublishedPost, BlogPublishedSummary, BlogPage, BlogPostQuery, BlogTaxonomyTerm } from './content-types';

export interface ScopedBlogContent { posts: BlogPostsApi; taxonomies: BlogTaxonomiesApi; media: BlogServerMediaApi; metrics: BlogMetricsApi }
/** Actor contexts are minted here, never accepted from the HTTP body or caller options. */
export class BlogContentService {
  constructor(readonly runtime: BlogContentRuntime, private readonly authors: BlogService, private readonly config: ResolvedBlogConfig, private readonly logging?: LoggingRuntime, private readonly media?: BlogMediaService, private readonly metrics?: BlogMetricsService) {}
  /** Low-stakes public observations are explicit app policy, separate from private audit collection. */
  get publicMetricsEnabled(): boolean { return this.metrics?.config.enabled === true; }
  forAuthority(authority: BlogAuthority, authorFacade: Pick<ScopedBlog, 'capabilities' | 'authors'>): ScopedBlogContent {
    const user = authority.access.requireUser();
    const guard = (write = false) => {
      invokeSynchronousAuthCallback(authority.assertCurrentAuthoritySync, { component: 'blog-publishing', invariant: 'live-authority', message: 'Blog authority must be synchronous.' });
      const current = authority.access.requireUser();
      if (current.credentialKind === 'api-key' || current.userId !== user.userId || current.sessionKind === 'native' && (!current.scope?.includes('blog:read') || write && !current.scope.includes('blog:write'))) throw new AuthError('Blog access is not permitted.', 'BLOG_FORBIDDEN', 403);
      const capabilities = authorFacade.capabilities();
      if (capabilities.state !== 'ready') throw new AuthError('Blog publishing is unavailable.', 'BLOG_NOT_READY', 503);
      return capabilities;
    };
    const permitted = (requirement: ResolvedBlogConfig['managePosts']) => {
      try { authority.access.authorize(requirement); return true; }
      catch (error) { if (error instanceof AuthError && error.status < 500) return false; throw error; }
    };
    const actor = (write = false) => {
      const capabilities = guard(write), manage = permitted(this.config.managePosts), self = capabilities.self;
      if (!capabilities.site || !manage && self?.status !== 'active') throw new AuthError('Blog author access is not permitted.', 'BLOG_FORBIDDEN', 403);
      return { siteId: capabilities.site.id, actorId: user.userId, manage, publish: (user.sessionKind !== 'native' || Boolean(user.scope?.includes('blog:publish'))) && (this.config.publishPosts === null || permitted(this.config.publishPosts)) };
    };
    const options = (value: BlogMutationOptions) => {
      if (!value || typeof value.requestId !== 'string') throw new AuthError('A stable blog request identity is required.', 'BLOG_INVALID_INPUT', 422);
      blogId(value.requestId); value.signal?.throwIfAborted();
      return { requestId: `blog:${contentHash([user.userId, value.requestId])}`, signal: value.signal };
    };
    const readFinal = (captured: ReturnType<typeof actor>, write = false) => () => {
      const current = actor(write);
      if (current.siteId !== captured.siteId || current.actorId !== captured.actorId || current.manage !== captured.manage) throw new AuthError('Blog read authority changed.', 'AUTH_STATE_CHANGED', 409);
    };
    const final = (captured: ReturnType<typeof actor>, authorId?: string, publication = false) => () => {
      const now = actor(true);
      if (now.siteId !== captured.siteId || now.actorId !== captured.actorId || now.manage !== captured.manage || now.publish !== captured.publish) throw new AuthError('Blog authority changed.', 'AUTH_STATE_CHANGED', 409);
      if (publication && !now.publish) throw new AuthError('Blog publication is not permitted.', 'BLOG_FORBIDDEN', 403);
      if (authorId) {
        const author = this.authors.contentAuthor(authority, authorId, now.manage);
        if (publication && !author.publication) throw new AuthError('Publish the required author profile first.', 'BLOG_AUTHOR_INCOMPLETE', 422);
      }
    };
    const write = <T>(name: string, input: unknown, opts: ReturnType<typeof options>, check: () => void): Promise<T> => {
      const operation = () => this.runtime.write<T>(name, input, opts.requestId, check, opts.signal);
      if (!this.logging) return operation();
      return runWithLoggingAttribution(this.logging, {
        sourceId: `blog-request:${contentHash([user.userId]).slice(0, 40)}`, origin: 'backend', scope: { kind: 'application', tenantId: null },
        actor: { kind: 'user', id: user.userId, sessionId: user.sessionId ?? null, initiatorId: null },
        requestId: opts.requestId, correlationId: null, policyVersion: this.logging.config.policyVersion,
      }, check, operation);
    };
    const createOrEdit = async (id: string | null, expectedRevision: number | null, input: unknown, value: BlogMutationOptions) => {
      const content = captureBlogPostContent(input), captured = actor(true), opts = options(value), check = final(captured, content.authorId);
      check();
      const postId = id === null ? `post_${contentHash([captured.siteId, captured.actorId, value.requestId]).slice(0, 40)}` : blogId(id);
      return write<BlogPostRecord>(id === null ? 'blog.post.create' : 'blog.post.update', { actor: captured, id: postId, content,
        ...(expectedRevision === null ? {} : { expectedRevision: blogRevision(expectedRevision) }) }, opts, check);
    };
    const state = async (action: 'publish' | 'withdraw' | 'trash' | 'restore', id: string, expectedRevision: number, value: BlogMutationOptions, restoreRevision?: number) => {
      const captured = actor(true), opts = options(value), postId = blogId(id);
      const post = await this.runtime.read<BlogPostRecord>('blog.post', { actor: captured, id: postId }, readFinal(captured, true), opts.signal);
      const restored = action === 'restore' ? await this.runtime.read<BlogPostContent>('blog.revision', { actor: captured, id: postId, revision: blogRevision(restoreRevision) }, readFinal(captured, true), opts.signal) : null;
      const authorId = (restored ?? post.content).authorId;
      const publication = action === 'publish' ? this.authors.contentAuthor(authority, authorId, captured.manage).publication : null;
      const guardFinal = final(captured, action === 'publish' || action === 'restore' ? authorId : undefined, action === 'publish' || action === 'withdraw');
      const check = () => {
        guardFinal();
        if (action === 'publish' && (!publication || this.authors.contentAuthor(authority, authorId, captured.manage).publication?.name !== publication.name)) throw new AuthError('The public author profile changed.', 'BLOG_AUTHOR_INCOMPLETE', 422);
      }; check();
      return write<BlogPostRecord>(action === 'publish' ? 'blog.post.publish' : action === 'restore' ? 'blog.post.restore' : 'blog.post.state', {
        actor: captured, id: postId, expectedRevision: blogRevision(expectedRevision), ...(action === 'publish' ? { authorName: publication!.name } : action === 'restore' ? { revision: blogRevision(restoreRevision) } : { action }),
      }, opts, check);
    };
    const posts = Object.freeze<BlogPostsApi>({
      capabilities: async () => { const capabilities = guard(), manage = permitted(this.config.managePosts), active = capabilities.self?.status === 'active', writable = user.sessionKind !== 'native' || Boolean(user.scope?.includes('blog:write'));
        return { state: 'ready', canManage: writable && manage, canCreate: writable && (manage || active), canPublishOwn: writable && (manage || active) && (user.sessionKind !== 'native' || Boolean(user.scope?.includes('blog:publish'))) && (this.config.publishPosts === null || permitted(this.config.publishPosts)), basePath: this.config.basePath }; },
      list: (input = {}, opts) => { const captured = actor(), query = captureBlogQuery(input); return this.runtime.read('blog.posts', { actor: captured, query }, readFinal(captured), opts?.signal); },
      get: (id, opts) => { const captured = actor(); return this.runtime.read('blog.post', { actor: captured, id: blogId(id) }, readFinal(captured), opts?.signal); },
      create: (input, opts) => createOrEdit(null, null, input, opts), update: (id, revision, input, opts) => createOrEdit(id, revision, input, opts),
      publish: (id, revision, opts) => state('publish', id, revision, opts), withdraw: (id, revision, opts) => state('withdraw', id, revision, opts), trash: (id, revision, opts) => state('trash', id, revision, opts),
      restore: (id, expectedRevision, revision, opts) => state('restore', id, expectedRevision, opts, revision),
      revisions: (id, query = {}, opts) => { const captured = actor(), q = captureBlogQuery(query); return this.runtime.read('blog.revisions', { actor: captured, id: blogId(id), limit: q.limit, offset: q.offset }, readFinal(captured), opts?.signal); },
    });
    const writeTerm = (id: string, expectedRevision: number, input: unknown, value: BlogMutationOptions) => {
      const captured = actor(true), opts = options(value), term = captureBlogTerm(input);
      if (!captured.manage) throw new AuthError('Blog taxonomy management is not permitted.', 'BLOG_FORBIDDEN', 403);
      return write('blog.term.write', { actor: captured, id: blogId(id), expectedRevision: blogRevision(expectedRevision, true), term }, opts, final(captured)) as ReturnType<BlogTaxonomiesApi['create']>;
    };
    const metrics = Object.freeze<BlogMetricsApi>({
      capabilities: async () => { guard(); return { enabled: this.metrics?.config.enabled ?? false, retentionDays: this.metrics?.config.retentionDays ?? 90 }; },
      page: (query = {}, opts) => {
        const captured = actor();
        if (!this.metrics?.config.enabled) throw new AuthError('Blog metrics is disabled.', 'BLOG_METRICS_DISABLED', 503);
        return this.runtime.read<BlogMetricsPage>('blog.metrics', { actor: captured, query, retentionDays: this.metrics.config.retentionDays }, readFinal(captured), opts?.signal);
      },
    });
    return Object.freeze({ posts, metrics, media: this.media?.forAuthority({ actor, options, write }) ?? unavailableBlogMedia(), taxonomies: Object.freeze<BlogTaxonomiesApi>({
      list: (query = {}, opts) => { const captured = actor(); blogRecord(query, ['kind', 'limit', 'offset']); return this.runtime.read('blog.terms', { siteId: captured.siteId, ...query }, readFinal(captured), opts?.signal); },
      create: (input, opts) => writeTerm(`term_${contentHash([user.userId, opts.requestId]).slice(0, 40)}`, 0, input, opts),
      update: (id, revision, input, opts) => writeTerm(id, revision, input, opts),
      remove: (id, revision, opts) => { const captured = actor(true), request = options(opts); if (!captured.manage) throw new AuthError('Blog taxonomy management is not permitted.', 'BLOG_FORBIDDEN', 403);
        return write('blog.term.remove', { actor: captured, id: blogId(id), expectedRevision: blogRevision(revision) }, request, final(captured)); },
    }) });
  }
  async publicPosts(siteSlug: string, input: BlogPostQuery = {}, signal?: AbortSignal): Promise<BlogPage<BlogPublishedSummary>> {
    const site = this.authors.publicSite(siteSlug), query = captureBlogQuery(input);
    return this.runtime.read('blog.posts', { public: true, siteId: site.id, query }, () => { if (this.authors.publicSite(siteSlug).id !== site.id) throw new AuthError('Blog publication is unavailable.', 'BLOG_POST_NOT_FOUND', 404); }, signal);
  }
  async publicPost(siteSlug: string, slug: string, signal?: AbortSignal): Promise<BlogPublishedPost> {
    const site = this.authors.publicSite(siteSlug), result = await this.runtime.read<BlogPublishedPost | null>('blog.public.post', { siteId: site.id, slug: blogSlug(slug) }, () => { this.authors.publicSite(siteSlug); }, signal);
    if (!result) throw new AuthError('Blog article is unavailable.', 'BLOG_POST_NOT_FOUND', 404); return result;
  }
  /** Keyset-only discovery through the same publication plane, without loading drafts or full article bodies. */
  async publicSitemap(siteSlug: string, after?: string): Promise<readonly { id: string; slug: string; updatedAt: number }[]> {
    const site = this.authors.publicSite(siteSlug);
    return this.runtime.read('blog.public.sitemap', { siteId: site.id, ...(after ? { after } : {}) }, () => { this.authors.publicSite(siteSlug); });
  }
  /** Archive discovery excludes private, unused and explicitly noindex taxonomy records. */
  async publicTaxonomySitemap(siteSlug: string, after?: string): Promise<readonly { id: string; kind: 'category' | 'tag' }[]> {
    const site = this.authors.publicSite(siteSlug);
    return this.runtime.read('blog.public.taxonomy-sitemap', { siteId: site.id, ...(after ? { after } : {}) }, () => { this.authors.publicSite(siteSlug); });
  }
  async publicTerms(siteSlug: string, query: { kind?: 'category' | 'tag'; limit?: number; offset?: number }, signal?: AbortSignal) {
    blogRecord(query, ['kind', 'limit', 'offset']); const site = this.authors.publicSite(siteSlug);
    return this.runtime.read('blog.terms', { ...query, siteId: site.id, public: true }, () => { this.authors.publicSite(siteSlug); }, signal);
  }
  /** Resolve one deliberately public category/tag without depending on directory pagination. */
  async publicTerm(siteSlug: string, id: string, signal?: AbortSignal): Promise<BlogTaxonomyTerm> {
    const site = this.authors.publicSite(siteSlug);
    return this.runtime.read('blog.public.term', { siteId: site.id, id: blogId(id) }, () => { this.authors.publicSite(siteSlug); }, signal);
  }
  /** Resolve only deliberately public referenced terms, in fixed actor-sized batches. Missing/withdrawn terms never expose private metadata. */
  async publicTermsById(siteSlug: string, ids: readonly string[], signal?: AbortSignal): Promise<readonly BlogTaxonomyTerm[]> {
    const site = this.authors.publicSite(siteSlug), selected = blogArray(ids, 100).map(blogId);
    return this.runtime.read('blog.public.terms', { siteId: site.id, ids: selected }, () => { this.authors.publicSite(siteSlug); }, signal);
  }
  /** Optional observations are bound to an existing publication, never a caller-selected database or account. */
  async publicMetricTicket(siteSlug: string, postSlug: string, signal?: AbortSignal) {
    const site = this.authors.publicSite(siteSlug);
    const post = await this.runtime.read<{ id: string }>('blog.public.identity', { siteId: site.id, slug: blogSlug(postSlug) }, () => { this.authors.publicSite(siteSlug); }, signal);
    if (!this.metrics) throw new AuthError('Blog metrics is disabled.', 'BLOG_METRICS_DISABLED', 503);
    return this.metrics.issue(site.id, post.id);
  }
  async publicMetricObservation(siteSlug: string, postSlug: string, input: unknown, signal?: AbortSignal) {
    const site = this.authors.publicSite(siteSlug), check = () => { this.authors.publicSite(siteSlug); };
    const post = await this.runtime.read<{ id: string }>('blog.public.identity', { siteId: site.id, slug: blogSlug(postSlug) }, check, signal);
    if (!this.metrics) throw new AuthError('Blog metrics is disabled.', 'BLOG_METRICS_DISABLED', 503);
    return this.metrics.observe(site.id, post.id, input, check, signal);
  }
  /** Public media is addressable only through a currently published post's accepted reference. */
  async publicMedia(siteSlug: string, postSlug: string, id: string, range?: string | null, signal?: AbortSignal) {
    if (!this.media) throw new AuthError('Blog media is unavailable.', 'BLOG_NOT_READY', 503);
    const site = this.authors.publicSite(siteSlug);
    const input = { siteId: site.id, postSlug: blogSlug(postSlug), id: blogId(id) }, check = () => { this.authors.publicSite(siteSlug); };
    const snapshot = await this.runtime.read<BlogMediaSnapshot>('blog.media.public', input, check, signal);
    const download = await this.media.open(snapshot, check, range);
    try {
      const current = await this.runtime.read<BlogMediaSnapshot>('blog.media.public', input, check, signal);
      if (current.checksum !== snapshot.checksum) throw new AuthError('Blog media is unavailable.', 'BLOG_MEDIA_NOT_FOUND', 404);
      return download;
    } catch (error) { await download.stream.cancel().catch(() => {}); throw error; }
  }
}
