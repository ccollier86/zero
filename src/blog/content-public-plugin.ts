/** Anonymous published-only blog routes. Local classification applies only to these selected handlers, never to a URL namespace. */
import { Elysia } from 'elysia';
import { AuthError } from '../auth/types';
import { markPublicLoggingRequest } from '../logging/logging-public-request';
import { BLOG_API } from './contracts';
import type { BlogPluginConfig } from './plugin';
import { readBlogBody, readBlogQuery } from './http-input';
import type { BlogPostQuery } from './content-types';
import { blogMediaResponse } from './media-response';

/** Current public site/publication and media-reference admission still run for every public response. */
export function createBlogPublicPlugin(config: BlogPluginConfig) {
  const service = () => {
    const blog = config.getService();
    if (!blog) throw new AuthError('Blog content is unavailable.', 'BLOG_NOT_READY', 503);
    return blog;
  };
  return new Elysia({ name: 'zero-blog-public', prefix: BLOG_API + '/public' })
    .onTransform(({ request }) => { markPublicLoggingRequest(request); })
    .onBeforeHandle(({ set }) => { set.headers['Cache-Control'] = 'private, no-store'; })
    .onError(({ error, code, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      if (error instanceof AuthError) { set.status = error.status; return { code: error.code, error: error.code.startsWith('BLOG_') ? error.message : 'The public blog is unavailable.' }; }
      if (code === 'NOT_FOUND') return;
      set.status = 500; return { code: 'BLOG_INTERNAL_ERROR', error: 'The public blog is unavailable.' };
    })
    .get('/:siteSlug/authors/:authorSlug', ({ params, request }) => { readBlogQuery(request, []); return service().publicAuthor(params.siteSlug, params.authorSlug); })
    .get('/:siteSlug/posts', ({ params, request }) => service().publishing.publicPosts(params.siteSlug, readBlogQuery(request, ['search', 'authorId', 'categoryId', 'tagId', 'limit', 'offset', 'order']) as BlogPostQuery, request.signal))
    .get('/:siteSlug/posts/:slug', ({ params, request }) => { readBlogQuery(request, []); return service().publishing.publicPost(params.siteSlug, params.slug, request.signal); })
    .get('/:siteSlug/taxonomies', ({ params, request }) => service().publishing.publicTerms(params.siteSlug, readBlogQuery(request, ['kind', 'limit', 'offset']) as { kind?: 'category' | 'tag' }, request.signal))
    .get('/:siteSlug/taxonomies/:id', ({ params, request }) => { readBlogQuery(request, []); return service().publishing.publicTerm(params.siteSlug, params.id, request.signal); })
    .get('/:siteSlug/posts/:slug/media/:id', async ({ params, request }) => {
      readBlogQuery(request, []);
      return blogMediaResponse(await service().publishing.publicMedia(params.siteSlug, params.slug, params.id, request.headers.get('Range'), request.signal));
    })
    .get('/:siteSlug/posts/:slug/metrics-ticket', ({ params, request }) => { readBlogQuery(request, []); return service().publishing.publicMetricTicket(params.siteSlug, params.slug, request.signal); })
    .post('/:siteSlug/posts/:slug/observations', async ({ params, request }) => {
      readBlogQuery(request, []); const input = await readBlogBody(request, 8192);
      return service().publishing.publicMetricObservation(params.siteSlug, params.slug, input, request.signal);
    }, { parse: 'none' });
}
