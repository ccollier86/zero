/** Thin native publishing transport. Guardian chooses actors; the service owns invariants and Fabric owns commits. */
import { Elysia } from 'elysia';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { AuthError } from '../auth/types';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import { BLOG_API } from './contracts';
import type { BlogPluginConfig } from './plugin';
import { currentBlogRequest } from './http-authority';
import { readBlogBody, readBlogQuery } from './http-input';
import { blogId } from './content-validation';
import { blogRecord, blogRevision } from './validation';
import type { BlogPostContent, BlogPostQuery, BlogTermInput } from './content-types';
import { blogContentProjectionStream } from './content-stream';
import type { BlogMediaInput } from './media-types';
import { blogMediaResponse } from './media-response';
import { projectBlogHttpError } from './http-errors';

const POST_QUERY = ['search', 'status', 'authorId', 'categoryId', 'tagId', 'limit', 'offset', 'order'];
const TERM_QUERY = ['kind', 'limit', 'offset'];
function mutation(request: Request) {
  return { requestId: blogId(request.headers.get('Idempotency-Key')), signal: request.signal };
}
/** No automatic retries: the caller retains the same request identity for uncertain results. */
export function createBlogContentPlugin(config: BlogPluginConfig) {
  const current = (auth: Parameters<typeof currentBlogRequest>[1], request: Request) => currentBlogRequest(config, auth, request).facade;
  return new Elysia({ name: 'zero-blog-content', prefix: BLOG_API })
    .use(createAuthMiddleware(config.getTokenService, config.authorization))
    .onBeforeHandle(({ set }) => { set.headers['Cache-Control'] = 'private, no-store'; })
    .onError(({ error, code, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      if (code === 'NOT_FOUND') return;
      const projected = projectBlogHttpError(error, code); set.status = projected.status; return projected.body;
    })
    .get('/posts/config', ({ access, request }) => { readBlogQuery(request, []); return current(access.requireUser(), request).posts.capabilities(); })
    .get('/posts/live', async ({ access, request }) => {
      const context = currentBlogRequest(config, access.requireUser(), request), query = readBlogQuery(request, POST_QUERY) as BlogPostQuery;
      // Admit before starting a 200 stream, so unauthenticated/unassigned requests receive their actual failure status.
      await context.facade.posts.list({ ...query, limit: 1 }, { signal: request.signal });
      const read = () => context.facade.posts.list(query, { signal: request.signal });
      return new Response(blogContentProjectionStream(context.service.publishing.runtime, context.service, read, request.signal), {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
      });
    })
    .get('/posts', ({ access, request }) => current(access.requireUser(), request).posts.list(readBlogQuery(request, POST_QUERY) as BlogPostQuery, { signal: request.signal }))
    .get('/posts/:id/live', async ({ access, params, request }) => {
      readBlogQuery(request, []);
      const context = currentBlogRequest(config, access.requireUser(), request), id = blogId(params.id);
      await context.facade.posts.get(id, { signal: request.signal });
      return new Response(blogContentProjectionStream(context.service.publishing.runtime, context.service, () => context.facade.posts.get(id, { signal: request.signal }), request.signal), {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
      });
    })
    .get('/posts/:id', ({ access, params, request }) => { readBlogQuery(request, []); return current(access.requireUser(), request).posts.get(params.id, { signal: request.signal }); })
    .post('/posts', async ({ access, request }) => {
      const actor = access.requireUser(), options = mutation(request); readBlogQuery(request, []);
      const content = await readBlogBody(request, 640 * 1024);
      return current(actor, request).posts.create(content as BlogPostContent, options);
    }, { parse: 'none' })
    .put('/posts/:id', async ({ access, params, request }) => {
      const actor = access.requireUser(), options = mutation(request); readBlogQuery(request, []);
      const body = blogRecord(await readBlogBody(request, 640 * 1024), ['expectedRevision', 'content']);
      return current(actor, request).posts.update(params.id, blogRevision(body.expectedRevision), body.content as BlogPostContent, options);
    }, { parse: 'none' })
    .post('/posts/:id/:action', async ({ access, params, request }) => {
      const actor = access.requireUser(), options = mutation(request); readBlogQuery(request, []);
      if (!['publish', 'withdraw', 'trash', 'restore'].includes(params.action)) throw new AuthError('Invalid blog action.', 'BLOG_INVALID_INPUT', 422);
      const body = blogRecord(await readBlogBody(request), params.action === 'restore' ? ['expectedRevision', 'revision'] : ['expectedRevision']);
      const posts = current(actor, request).posts, revision = blogRevision(body.expectedRevision);
      if (params.action === 'restore') return posts.restore(params.id, revision, blogRevision(body.revision), options);
      return posts[params.action as 'publish' | 'withdraw' | 'trash'](params.id, revision, options);
    }, { parse: 'none' })
    .get('/posts/:id/revisions', ({ access, params, request }) => current(access.requireUser(), request).posts.revisions(params.id, readBlogQuery(request, ['limit', 'offset']), { signal: request.signal }))
    .get('/taxonomies', ({ access, request }) => current(access.requireUser(), request).taxonomies.list(readBlogQuery(request, TERM_QUERY) as { kind?: 'category' | 'tag' }, { signal: request.signal }))
    .post('/taxonomies', async ({ access, request }) => {
      const actor = access.requireUser(), options = mutation(request); readBlogQuery(request, []);
      const term = await readBlogBody(request);
      return current(actor, request).taxonomies.create(term as BlogTermInput, options);
    }, { parse: 'none' })
    .put('/taxonomies/:id', async ({ access, params, request }) => {
      const actor = access.requireUser(), options = mutation(request); readBlogQuery(request, []);
      const body = blogRecord(await readBlogBody(request), ['expectedRevision', 'term']);
      return current(actor, request).taxonomies.update(params.id, blogRevision(body.expectedRevision), body.term as BlogTermInput, options);
    }, { parse: 'none' })
    .delete('/taxonomies/:id', async ({ access, params, request }) => {
      const actor = access.requireUser(), options = mutation(request); readBlogQuery(request, []);
      const body = blogRecord(await readBlogBody(request), ['expectedRevision']);
      return current(actor, request).taxonomies.remove(params.id, blogRevision(body.expectedRevision), options);
    }, { parse: 'none' })
    .get('/media', ({ access, request }) => current(access.requireUser(), request).media.list(readBlogQuery(request, ['kind', 'limit', 'offset']) as { kind?: 'image' | 'audio' | 'video' }, { signal: request.signal }))
    .get('/media/:id', ({ access, params, request }) => { readBlogQuery(request, []); return current(access.requireUser(), request).media.get(params.id, { signal: request.signal }); })
    .post('/media', async ({ access, request }) => {
      const actor = access.requireUser(), options = mutation(request); readBlogQuery(request, []);
      const input = await readBlogBody(request); return current(actor, request).media.allocate(input as BlogMediaInput, options);
    }, { parse: 'none' })
    .put('/media/:id/content', async ({ access, params, request }) => {
      const actor = access.requireUser(), options = mutation(request); readBlogQuery(request, []);
      if (!request.body || request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/octet-stream') throw new AuthError('Expected binary media content.', 'BLOG_INVALID_INPUT', 422);
      return current(actor, request).media.upload(params.id, request.body, options);
    }, { parse: 'none' })
    .get('/media/:id/content', async ({ access, params, request }) => {
      readBlogQuery(request, []); const context = currentBlogRequest(config, access.requireUser(), request);
      return blogMediaResponse(await context.service.publishing.forAuthority(context.authority, context.facade).media.open(params.id, request.headers.get('Range'), request.signal));
    })
    .delete('/media/:id', ({ access, params, request }) => { readBlogQuery(request, []); return current(access.requireUser(), request).media.remove(params.id, mutation(request)); }, { parse: 'none' })
    .get('/metrics/config', ({ access, request }) => { readBlogQuery(request, []); return current(access.requireUser(), request).metrics.capabilities(); })
    .get('/metrics/live', async ({ access, request }) => {
      const context = currentBlogRequest(config, access.requireUser(), request), query = readBlogQuery(request, ['postId', 'since', 'until', 'limit', 'offset']);
      await context.facade.metrics.page({ ...query, limit: 1 }, { signal: request.signal });
      return new Response(blogContentProjectionStream(context.service.publishing.runtime, context.service, () => context.facade.metrics.page(query, { signal: request.signal }), request.signal), {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
      });
    })
    .get('/metrics', ({ access, request }) => current(access.requireUser(), request).metrics.page(readBlogQuery(request, ['postId', 'since', 'until', 'limit', 'offset']), { signal: request.signal }));
}
