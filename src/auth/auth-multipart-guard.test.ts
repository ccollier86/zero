import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import type { AnyElysia } from 'elysia';

import type { TokenService } from './token-service';
import { resolveAuthBehaviorConfig } from './auth-config';
import { createAuthorizationKernel } from './authorization-kernel';
import {
  createAuthMiddleware,
  createProtectedMultipartRequestGuard,
} from './auth.middleware';
import { AuthError, type AuthContext } from './types';

describe('early multipart authentication', () => {
  test('standalone verifiers without a profile capability retain normal enforcement', async () => {
    const tokens = {
      resolveAuthContext: async (token: string): Promise<AuthContext | null> => (
        token === 'valid'
          ? { userId: 'u_standalone', email: 'standalone@example.test', role: 'user' }
          : null
      ),
    } as unknown as TokenService;
    const app = withAuthErrors(
      new Elysia()
        .use(createAuthMiddleware(() => tokens))
        .onRequest(createProtectedMultipartRequestGuard(() => tokens, {
          method: 'POST', path: '/standalone-upload',
        }))
        .post('/standalone-upload', ({ requireAuth }) => ({
          userId: requireAuth().userId,
        }), {
          zeroAuth: 'user',
          body: t.Object({ file: t.File() }),
        })
    );

    const denied = await app.handle(multipartRequest('/standalone-upload', 'invalid'));
    const allowed = await app.handle(multipartRequest('/standalone-upload', 'valid'));

    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ userId: 'u_standalone' });
  });

  test('the zeroAuth macro rejects an invalid bearer before handler execution', async () => {
    let handlerRuns = 0;
    let hydrationRuns = 0;
    const tokens = fakeTokenService(async () => {
      hydrationRuns += 1;
      return null;
    });
    const app = withAuthErrors(
      new Elysia()
        .use(createAuthMiddleware(() => tokens))
        .onRequest(createProtectedMultipartRequestGuard(() => tokens, {
          method: 'POST', path: '/upload',
        }))
        .post('/upload', () => {
          handlerRuns += 1;
          return { ok: true };
        }, {
          zeroAuth: 'user',
          body: t.Object({ file: t.File() }),
        })
    );

    const response = await app.handle(multipartRequest('/upload', 'invalid'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
    expect(handlerRuns).toBe(0);
    expect(hydrationRuns).toBe(1);
  });

  test('preload, parser guard, and resolve share one live hydration', async () => {
    let hydrationRuns = 0;
    const auth: AuthContext = {
      userId: 'u_1',
      email: 'person@example.com',
      role: 'user',
    };
    const tokens = fakeTokenService(async () => {
      hydrationRuns += 1;
      return auth;
    });
    const app = withAuthErrors(
      new Elysia()
        .use(createAuthMiddleware(() => tokens))
        .onRequest(createProtectedMultipartRequestGuard(() => tokens, {
          method: 'POST', path: '/upload',
        }))
        .post('/upload', ({ requireAuth, body }) => ({
          userId: requireAuth().userId,
          name: body.file.name,
        }), {
          zeroAuth: 'user',
          body: t.Object({ file: t.File() }),
        })
    );

    const response = await app.handle(multipartRequest('/upload', 'valid'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'u_1', name: 'sample.pdf' });
    expect(hydrationRuns).toBe(1);
  });

  test('rechecks a cached multipart access facade after body parsing', async () => {
    let currentProfile = true;
    let handlerRuns = 0;
    const tokens = fakeTokenService(
      async () => ({
        userId: 'u_1',
        email: 'person@example.com',
        role: 'user',
      }),
      () => {
        if (currentProfile) return;
        throw new AuthError(
          'This runtime auth profile is stale',
          'AUTH_PROFILE_CHANGED',
          503,
        );
      },
    );
    const app = withAuthErrors(
      new Elysia()
        .use(createAuthMiddleware(() => tokens))
        .onRequest(createProtectedMultipartRequestGuard(() => tokens, {
          method: 'POST', path: '/profile-change-upload',
        }))
        .post('/profile-change-upload', () => {
          handlerRuns += 1;
          return { ok: true };
        }, {
          zeroAuth: 'user',
          body: t.Object({ file: t.File() }),
          parse: () => {
            currentProfile = false;
            return undefined;
          },
        })
    );

    const response = await app.handle(
      multipartRequest('/profile-change-upload', 'valid'),
    );

    expect(response.status).toBe(503);
    expect(handlerRuns).toBe(0);
  });

  test('admin multipart routes reject an ordinary user before the handler', async () => {
    let handlerRuns = 0;
    const tokens = fakeTokenService(async () => ({
      userId: 'u_1',
      email: 'person@example.com',
      role: 'user',
    }));
    const app = withAuthErrors(
      new Elysia()
        .use(createAuthMiddleware(() => tokens))
        .onRequest(createProtectedMultipartRequestGuard(() => tokens, {
          requirement: 'admin', method: 'POST', path: '/admin-upload',
        }))
        .post('/admin-upload', () => {
          handlerRuns += 1;
          return { ok: true };
        }, {
          zeroAuth: 'admin',
          body: t.Object({ file: t.File() }),
        })
    );

    const response = await app.handle(multipartRequest('/admin-upload', 'valid'));

    expect(response.status).toBe(403);
    expect(handlerRuns).toBe(0);
  });

  test('the raw structured multipart guard rejects before parsing', async () => {
    let parserRuns = 0;
    let handlerRuns = 0;
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        permissions: {
          'documents:read': { label: 'Read documents' },
          'documents:write': { label: 'Write documents' },
        },
        roles: {
          clinician: { permissions: ['documents:read'] },
          owner: { allPermissions: true },
        },
      },
    }));
    const tokens = fakeTokenService(async (token) => ({
      userId: 'u_clinician',
      email: 'clinician@example.test',
      role: 'user',
      sessionKind: 'web',
      sessionId: 'ses_clinician',
      sessionGeneration: 0,
      sessionScopeKind: 'tenant',
      sessionScopeId: 'ten_clinic',
      tenantId: 'ten_clinic',
      membershipId: 'tmem_clinician',
      tenantRole: token === 'owner' ? 'owner' : 'clinician',
      tenantAuthorizationGeneration: 0,
      membershipAuthorizationGeneration: 0,
    }));
    const authorization = {
      getAuthorizationKernel: () => kernel,
      getPropertyStore: () => null,
    };
    const requirement = {
      tenant: 'required',
      permission: 'documents:write',
    } as const;
    const app = withAuthErrors(
      new Elysia()
        .use(createAuthMiddleware(() => tokens, authorization))
        .onRequest(createProtectedMultipartRequestGuard(
          () => tokens,
          { requirement, method: 'POST', path: '/structured-upload' },
          authorization,
        ))
        .post('/structured-upload', () => {
          handlerRuns += 1;
          return { ok: true };
        }, {
          zeroAuth: requirement,
          body: t.Object({ file: t.File() }),
          parse: () => {
            parserRuns += 1;
            return undefined;
          },
        })
    );

    const response = await app.handle(multipartRequest('/structured-upload', 'valid'));
    const allowed = await app.handle(multipartRequest('/structured-upload', 'owner'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
    expect(allowed.status).toBe(200);
    expect(parserRuns).toBe(1);
    expect(handlerRuns).toBe(1);
  });

  test('public multipart routes remain public', async () => {
    const app = new Elysia()
      .use(createAuthMiddleware(() => null))
      .post('/public-upload', ({ body }) => body.file.name, {
        body: t.Object({ file: t.File() }),
      });

    const response = await app.handle(multipartRequest('/public-upload'));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('sample.pdf');
  });
});

function fakeTokenService(
  resolveAuthContext: (token: string) => Promise<AuthContext | null>,
  assertCurrentProfile: () => void = () => {},
): TokenService {
  return { resolveAuthContext, assertCurrentProfile } as unknown as TokenService;
}

function multipartRequest(path: string, token?: string): Request {
  const body = new FormData();
  body.append('file', new File(['pdf'], 'sample.pdf', { type: 'application/pdf' }));
  return new Request(`http://zero.test${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body,
  });
}

function withAuthErrors(app: AnyElysia): AnyElysia {
  return app.onError(({ error, set }) => {
    if (!(error instanceof AuthError)) return undefined;
    set.status = error.status;
    return { error: error.message, code: error.code };
  });
}
