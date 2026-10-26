/** Session-only author transport. Guardian owns actor, current permissions and selected organization. */
import { Elysia } from 'elysia';
import {
  createAuthMiddleware,
  type AuthMiddlewareAuthorizationOptions,
} from '../auth/auth.middleware';
import { AuthError, type AuthContext } from '../auth/types';
import type { TokenService } from '../auth/token-service';
import { applyAuthPrivateNoStore } from '../auth/auth-response-cache';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import type { BlogService } from './service';
import {
  blogRecord,
  blogRevision,
  captureBlogAssignment,
  captureBlogProfile,
} from './validation';
import { blogProjectionStream } from './stream';
import { BLOG_API } from './contracts';
import { currentBlogRequest } from './http-authority';
import { readBlogBody } from './http-input';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { createBlogPublicPlugin } from './content-public-plugin';
import type { LoggingRuntime } from '../logging/logging-runtime';
import { projectBlogHttpError } from './http-errors';
export interface BlogPluginConfig {
  getService(): BlogService | null;
  getTokenService(): TokenService | null;
  authorization: AuthMiddlewareAuthorizationOptions;
  getLoggingRuntime?(): LoggingRuntime | null;
}
export function createBlogPlugin(config: BlogPluginConfig) {
  const current = (auth: AuthContext, request: Request) => currentBlogRequest(config, auth, request);
  const mutate = <T>(auth: AuthContext, request: Request, action: (facade: ReturnType<typeof current>['facade']) => T) => {
    const { service } = current(auth, request);
    return withReactiveDBCommitAdmission(service.transactionDomain, () => action(current(auth, request).facade), { signal: request.signal });
  };
  const revision = (body: unknown) =>
    blogRevision(blogRecord(body, ['expectedRevision']).expectedRevision);
  const privatePlugin = new Elysia({ name: 'zero-blog-authors', prefix: BLOG_API })
    .use(createAuthMiddleware(config.getTokenService, config.authorization))
    .onError(({ error, code, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      if (code === 'NOT_FOUND') return;
      const projected = projectBlogHttpError(error, code); set.status = projected.status; return projected.body;
    })
    .onBeforeHandle(({ request, set }) => {
      applyAuthPrivateNoStore(set);
      const url = new URL(request.url),
        allowed =
          request.method === 'GET' && url.pathname === BLOG_API + '/authors'
            ? ['limit', 'after']
            : [];
      for (const [key] of url.searchParams)
        if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
          throw new AuthError('Invalid blog query.', 'BLOG_INVALID_INPUT', 422);
    })
    .get('/config', ({ access, request }) =>
      current(access.requireUser(), request).facade.capabilities(),
    )
    .get('/authors', ({ access, query, request }) =>
      current(access.requireUser(), request).facade.authors.list({
        ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
        ...(query.after === undefined ? {} : { after: query.after }),
      }),
    )
    .get('/authors/:userId', ({ access, params, request }) =>
      current(access.requireUser(), request).facade.authors.get(params.userId),
    )
    .post(
      '/authors',
      async ({ access, request }) => {
        const actor = access.requireUser(),
          body = await readBlogBody(request);
        return mutate(actor, request, facade => facade.authors.assign(
          captureBlogAssignment(body),
        ));
      },
      { parse: 'none' },
    )
    .patch(
      '/authors/:userId/profile',
      async ({ access, params, request }) => {
        const actor = access.requireUser(),
          body = await readBlogBody(request);
        return mutate(actor, request, facade => facade.authors.updateProfile(
          params.userId,
          captureBlogProfile(body),
        ));
      },
      { parse: 'none' },
    )
    .post(
      '/authors/:userId/publication',
      async ({ access, params, request }) => {
        const actor = access.requireUser(),
          body = await readBlogBody(request);
        return mutate(actor, request, facade => facade.authors.publishProfile(
          params.userId,
          revision(body),
        ));
      },
      { parse: 'none' },
    )
    .delete(
      '/authors/:userId/publication',
      async ({ access, params, request }) => {
        const actor = access.requireUser(),
          body = await readBlogBody(request);
        return mutate(actor, request, facade => facade.authors.withdrawProfile(
          params.userId,
          revision(body),
        ));
      },
      { parse: 'none' },
    )
    .get('/live', ({ access, request }) => {
      const { service, facade } = current(access.requireUser(), request);
      const read = () => {
        const capabilities = facade.capabilities();
        return {
          capabilities,
          ...(capabilities.canManageAuthors
            ? { authors: facade.authors.list({ limit: 20 }) }
            : {}),
        };
      };
      read();
      return new Response(blogProjectionStream(service, read, request.signal), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'private, no-store',
        },
      });
    });
  return new Elysia({ name: 'zero-blog' }).use(privatePlugin).use(createBlogPublicPlugin(config));
}
