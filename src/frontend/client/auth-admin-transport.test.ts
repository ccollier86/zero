import { describe, expect, it } from 'bun:test';
import {
  AUTH_ADMIN_REQUEST_TIMEOUT_MS,
  AuthAdminTransport,
} from './auth-admin-transport';

describe('AuthAdminTransport', () => {
  it('keeps the public admin request timeout at 15 seconds', () => {
    expect(AUTH_ADMIN_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it('uses the injected authenticated fetch and response error normalizer', async () => {
    const expected = new Error('normalized admin failure');
    let fallback: string | undefined;
    const transport = new AuthAdminTransport({
      baseUrl: 'http://zero.test',
      authenticatedFetch: async (url) => {
        expect(url).toBe('http://zero.test/auth/admin/config');
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      },
      assertResponseCurrent: () => {},
      createResponseError: (_response, _body, message) => {
        fallback = message;
        return expected;
      },
      createTimeoutError: () => new Error('unexpected timeout'),
    });

    let thrown: unknown;
    try {
      await transport.getAdminConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(expected);
    expect(fallback).toBe('Admin auth request failed');
  });

  it('posts the explicit password-change recovery route', async () => {
    const transport = new AuthAdminTransport({
      baseUrl: 'http://zero.test',
      authenticatedFetch: async (url, init) => {
        expect(url).toBe(
          'http://zero.test/auth/admin/users/target%2Fuser/clear-password-change-requirement',
        );
        expect(init?.method).toBe('POST');
        return Response.json({ user: { userId: 'target/user' } });
      },
      assertResponseCurrent: () => {},
      createResponseError: () => new Error('unexpected response error'),
      createTimeoutError: () => new Error('unexpected timeout'),
    });

    const user = await transport.clearAdminPasswordChangeRequirement('target/user');
    expect(user.userId).toBe('target/user');
  });

  it('bounds wall-clock time when authenticated fetch never settles', async () => {
    const expected = new Error('normalized admin timeout');
    const transport = new AuthAdminTransport({
      baseUrl: 'http://zero.test',
      authenticatedFetch: () => new Promise(() => {}),
      assertResponseCurrent: () => {},
      createResponseError: () => new Error('unexpected response error'),
      createTimeoutError: () => expected,
      requestTimeoutMs: 1,
    });

    let thrown: unknown;
    try {
      await transport.getAdminConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(expected);
  });

  it('keeps the timeout active while a response body is being read', async () => {
    const expected = new Error('body-read timeout');
    const transport = new AuthAdminTransport({
      baseUrl: 'http://zero.test',
      authenticatedFetch: async () => new Response(new ReadableStream({
        start() {
          // Intentionally never enqueue or close: headers resolve, body does not.
        },
      })),
      assertResponseCurrent: () => {},
      createResponseError: () => new Error('unexpected response error'),
      createTimeoutError: () => expected,
      requestTimeoutMs: 1,
    });

    let thrown: unknown;
    try {
      await transport.getAdminConfig();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(expected);
  });

  it('keeps caller cancellation distinct from an admin timeout', async () => {
    const transport = new AuthAdminTransport({
      baseUrl: 'http://zero.test',
      authenticatedFetch: () => new Promise(() => {}),
      assertResponseCurrent: () => {},
      createResponseError: () => new Error('unexpected response error'),
      createTimeoutError: () => new Error('unexpected timeout'),
      requestTimeoutMs: 1_000,
    });
    const controller = new AbortController();
    const callerReason = new DOMException('caller cancelled', 'AbortError');
    const requestJson = (
      transport as unknown as {
        requestJson<T>(path: string, init?: RequestInit): Promise<T>;
      }
    ).requestJson.bind(transport);

    const pending = requestJson('/auth/admin/config', { signal: controller.signal });
    controller.abort(callerReason);

    let thrown: unknown;
    try {
      await pending;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(callerReason);
  });
});
