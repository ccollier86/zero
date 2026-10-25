/** Session-only author transport. Guardian owns actor, current permissions and selected organization. */
import { Elysia } from 'elysia';
import {
  createAuthMiddleware,
  type AuthMiddlewareAuthorizationOptions,
} from '../auth/auth.middleware';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import {
  requireRequestServiceDataScope,
  serviceDataScopeKey,
} from '../auth/service-data-scope';
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
export interface BlogPluginConfig {
  getService(): BlogService | null;
  getTokenService(): TokenService | null;
  authorization: AuthMiddlewareAuthorizationOptions;
}
export function createBlogPlugin(config: BlogPluginConfig) {
  const current = (auth: AuthContext) => {
    const service = config.getService(),
      tokens = config.getTokenService();
    if (!service || !tokens)
      throw new AuthError(
        'Blog authors are unavailable',
        'BLOG_NOT_READY',
        503,
      );
    const reference = tokens.captureAuthContextAuthority(auth);
    if (!reference) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
    const kernel = config.authorization.getAuthorizationKernel?.() ?? null;
    const accessFor = (identity: AuthContext) =>
      createRequestAuthorizationAccess({
        authContext: identity,
        kernel,
        propertyStore: config.authorization.getPropertyStore?.(),
        roleAssignments: config.authorization.getRoleAssignments?.(),
        assertCurrentProfile: () => tokens.assertCurrentProfile(),
      });
    const access = accessFor(auth),
      scope = requireRequestServiceDataScope(access, () => kernel);
    const assertCurrentAuthoritySync = () => {
      const identity = tokens.resolveAuthContextAuthority(reference);
      if (
        !identity ||
        identity.userId !== auth.userId ||
        serviceDataScopeKey(
          requireRequestServiceDataScope(accessFor(identity), () => kernel),
        ) !== serviceDataScopeKey(scope)
      )
        throw new AuthError(
          'Blog authority changed',
          'AUTH_STATE_CHANGED',
          409,
        );
    };
    return {
      service,
      facade: service.forAuthority({
        access,
        scope,
        assertCurrentAuthoritySync,
      }),
    };
  };
  const revision = (body: unknown) =>
    blogRevision(blogRecord(body, ['expectedRevision']).expectedRevision);
  return new Elysia({ name: 'zero-blog-authors', prefix: BLOG_API })
    .use(createAuthMiddleware(config.getTokenService, config.authorization))
    .onError(({ error, code, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      if (error instanceof AuthError) {
        set.status = error.status;
        return {
          code: error.code,
          error: error.code.startsWith('BLOG_')
            ? error.message
            : getPublicAuthErrorMessage(error),
        };
      }
      if (code === 'PARSE' || code === 'VALIDATION') {
        set.status = 422;
        return { code: 'BLOG_INVALID_INPUT', error: 'Invalid blog request.' };
      }
      if (code === 'NOT_FOUND') return;
      set.status = 500;
      return {
        code: 'BLOG_INTERNAL_ERROR',
        error: 'The blog request could not be completed.',
      };
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
    .get('/config', ({ access }) =>
      current(access.requireUser()).facade.capabilities(),
    )
    .get('/authors', ({ access, query }) =>
      current(access.requireUser()).facade.authors.list({
        ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
        ...(query.after === undefined ? {} : { after: query.after }),
      }),
    )
    .get('/authors/:userId', ({ access, params }) =>
      current(access.requireUser()).facade.authors.get(params.userId),
    )
    .post(
      '/authors',
      async ({ access, request }) => {
        const actor = access.requireUser(),
          body = await readBlogBody(request);
        return current(actor).facade.authors.assign(
          captureBlogAssignment(body),
        );
      },
      { parse: 'none' },
    )
    .patch(
      '/authors/:userId/profile',
      async ({ access, params, request }) => {
        const actor = access.requireUser(),
          body = await readBlogBody(request);
        return current(actor).facade.authors.updateProfile(
          params.userId,
          captureBlogProfile(body),
        );
      },
      { parse: 'none' },
    )
    .post(
      '/authors/:userId/publication',
      async ({ access, params, request }) => {
        const actor = access.requireUser(),
          body = await readBlogBody(request);
        return current(actor).facade.authors.publishProfile(
          params.userId,
          revision(body),
        );
      },
      { parse: 'none' },
    )
    .delete(
      '/authors/:userId/publication',
      async ({ access, params, request }) => {
        const actor = access.requireUser(),
          body = await readBlogBody(request);
        return current(actor).facade.authors.withdrawProfile(
          params.userId,
          revision(body),
        );
      },
      { parse: 'none' },
    )
    .get('/live', ({ access, request }) => {
      const { service, facade } = current(access.requireUser());
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
    })
    .get('/public/:siteSlug/authors/:authorSlug', ({ params }) => {
      const service = config.getService();
      if (!service)
        throw new AuthError(
          'Blog authors are unavailable',
          'BLOG_NOT_READY',
          503,
        );
      return service.publicAuthor(params.siteSlug, params.authorSlug);
    });
}
async function readBlogBody(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
      'application/json' ||
    !request.body
  )
    throw new AuthError('Expected JSON.', 'BLOG_INVALID_INPUT', 422);
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const next = await reader.read();
      request.signal.throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 65536)
        throw new AuthError(
          'Blog request is too large.',
          'BLOG_INVALID_INPUT',
          413,
        );
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      throw new AuthError('Invalid JSON.', 'BLOG_INVALID_INPUT', 422);
    }
  } finally {
    request.signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      /* Reading/cancellation already owns the body lifetime. */
    }
  }
}
