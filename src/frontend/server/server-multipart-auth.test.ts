import { describe, expect, test } from 'bun:test';
import { t } from 'elysia';

import type { TokenService } from '../../auth/token-service';
import type { AuthContext } from '../../auth/types';
import { ZERO_AUTH_TOKEN_SERVICE } from '../../runtime/service-keys';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  createServerExtensionApp,
  defineEndpoint,
  defineRouter,
} from './server-extensions';

describe('server extension multipart auth', () => {
  test('a protected endpoint rejects before its parser and handler run', async () => {
    const runtime = runtimeWithAuth(async () => null);
    let parserRuns = 0;
    let handlerRuns = 0;
    const app = await createServerExtensionApp({
      runtime,
      extensions: [defineEndpoint({
        method: 'POST',
        path: '/document-import',
        auth: 'user',
        body: t.Object({ file: t.File() }),
        parse: () => {
          parserRuns += 1;
          return undefined;
        },
        handler: () => {
          handlerRuns += 1;
          return { ok: true };
        },
      })],
    });

    const response = await app.handle(uploadRequest('/document-import', 'invalid'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
    expect(parserRuns).toBe(0);
    expect(handlerRuns).toBe(0);
  });

  test('nested protected routers match their full prefix before parsing', async () => {
    const runtime = runtimeWithAuth(async () => null);
    let parserRuns = 0;
    const app = await createServerExtensionApp({
      runtime,
      extensions: [defineRouter({
        name: 'staff-tools',
        prefix: '/api/staff',
        auth: 'user',
        routes: [defineRouter({
          name: 'documents',
          prefix: '/document-tools',
          routes: [defineEndpoint({
            method: 'POST',
            path: '/pdf-text',
            body: t.Object({ file: t.File() }),
            parse: () => {
              parserRuns += 1;
              return undefined;
            },
            handler: () => ({ ok: true }),
          })],
        })],
      })],
    });

    const response = await app.handle(uploadRequest(
      '/api/staff/document-tools/pdf-text',
      'invalid',
    ));

    expect(response.status).toBe(401);
    expect(parserRuns).toBe(0);
  });

  test('a valid multipart bearer is hydrated once and reaches the handler', async () => {
    let hydrationRuns = 0;
    const runtime = runtimeWithAuth(async () => {
      hydrationRuns += 1;
      return {
        userId: 'u_staff',
        email: 'staff@example.com',
        role: 'user',
      };
    });
    const app = await createServerExtensionApp({
      runtime,
      extensions: [defineEndpoint({
        method: 'POST',
        path: '/document-import',
        auth: 'user',
        body: t.Object({ file: t.File() }),
        handler: ({ user, body }) => ({
          userId: user.userId,
          name: body.file.name,
        }),
      })],
    });

    const response = await app.handle(uploadRequest('/document-import', 'valid'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      userId: 'u_staff',
      name: 'import.pdf',
    });
    expect(hydrationRuns).toBe(1);
  });
});

function runtimeWithAuth(
  resolveAuthContext: (token: string) => Promise<AuthContext | null>,
): ZeroAppRuntime {
  const runtime = new ZeroAppRuntime('multipart-test');
  runtime.set(
    ZERO_AUTH_TOKEN_SERVICE,
    { resolveAuthContext } as unknown as TokenService,
  );
  return runtime;
}

function uploadRequest(path: string, token: string): Request {
  const body = new FormData();
  body.append('file', new File(['pdf'], 'import.pdf', { type: 'application/pdf' }));
  return new Request(`http://zero.test${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
}
