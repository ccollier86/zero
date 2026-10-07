import { describe, expect, test } from 'bun:test';
import {
  AuthAuthorizationTransport,
  parseAuthAuthorizationSnapshot,
} from './auth-authorization-transport';
import { hasAuthorizationPermission } from './auth-authorization-types';
import { createAuthClientError } from './auth-errors';

describe('AuthAuthorizationTransport', () => {
  test('uses the dedicated authenticated endpoint and parses a safe scope', async () => {
    let requested: { url: string; init?: RequestInit } | null = null;
    const transport = new AuthAuthorizationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async (url, init) => {
        requested = { url, init };
        return Response.json(validSnapshot());
      },
      assertResponseCurrent: () => {},
      createResponseError: () => new Error('unexpected'),
    });

    await expect(transport.getCurrent()).resolves.toMatchObject({
      identity: { userId: 'user-1' },
      scope: { kind: 'application', permissions: ['records:read'] },
    });
    expect(requested).toMatchObject({
      url: 'https://zero.test/auth/authorization',
      init: { method: 'GET', cache: 'no-store' },
    });
  });

  for (const held of ['headers', 'body'] as const) {
    test(`automatic reads bound stalled ${held} and cannot admit their late projection`, async () => {
      let release!: (value: Response) => void;
      let releaseBody!: (value: unknown) => void;
      let accepted = 0, bodyReads = 0;
      let requestSignal: AbortSignal | null = null;
      const headers = new Promise<Response>(resolve => { release = resolve; });
      const body = new Promise<unknown>(resolve => { releaseBody = resolve; });
      const response = Response.json(validSnapshot());
      response.json = async () => { bodyReads++; return held === 'body' ? body : validSnapshot(); };
      const transport = new AuthAuthorizationTransport({
        baseUrl: 'https://zero.test', requestTimeoutMs: 5,
        authenticatedFetch: async (_url, init) => {
          requestSignal = init?.signal ?? null;
          return held === 'headers' ? headers : response;
        },
        assertResponseCurrent: () => { accepted++; },
        createResponseError: () => new Error('unexpected'),
      });
      await expect(transport.getCurrent()).rejects.toMatchObject({ name: 'TimeoutError' });
      expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
      release(response); releaseBody(validSnapshot());
      await Bun.sleep(0);
      expect(accepted).toBe(0);
      expect(bodyReads).toBe(held === 'body' ? 1 : 0);
      await expect(transport.getCurrent()).resolves.toMatchObject({ revision: 'revision-1' });
      expect(accepted).toBe(1);
    });
  }

  test('caller cancellation settles an ignored abort and prevents late admission', async () => {
    const controller = new AbortController();
    let release!: (value: Response) => void;
    let entered!: () => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let accepted = 0, bodyReads = 0;
    const transport = new AuthAuthorizationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => { entered(); return pending; },
      assertResponseCurrent: () => { accepted++; },
      createResponseError: () => new Error('unexpected'),
    });
    const lookup = transport.getCurrent(controller.signal);
    await started; controller.abort();
    await expect(lookup).rejects.toMatchObject({ name: 'AbortError' });
    const response = Response.json(validSnapshot());
    response.json = async () => { bodyReads++; return validSnapshot(); };
    release(response); await Bun.sleep(0);
    expect(accepted).toBe(0); expect(bodyReads).toBe(0);
  });

  for (const status of [401, 403]) {
    test(`definitive ${status} denial does not wait for or read a stalled error body`, async () => {
      let bodyReads = 0, accepted = 0;
      const response = Response.json({ error: 'synthetic private denial' }, { status });
      response.json = () => { bodyReads++; return new Promise(() => {}); };
      const transport = new AuthAuthorizationTransport({
        baseUrl: 'https://zero.test',
        authenticatedFetch: async () => response,
        assertResponseCurrent: () => { accepted++; },
        createResponseError: createAuthClientError,
      });
      await expect(transport.getCurrent()).rejects.toMatchObject({ status, body: null });
      expect(bodyReads).toBe(0); expect(accepted).toBe(0);
    }, 1_000);
  }

  test('already-cancelled and retired-scope reads cannot request or admit authority', async () => {
    const controller = new AbortController(); controller.abort();
    let requested = 0;
    const transport = new AuthAuthorizationTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => { requested++; return Response.json(validSnapshot()); },
      assertResponseCurrent: () => { throw new Error('Retired authorization scope'); },
      createResponseError: () => new Error('unexpected'),
    });
    await expect(transport.getCurrent(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(requested).toBe(0);
    await expect(transport.getCurrent()).rejects.toThrow('Retired authorization scope');
    expect(requested).toBe(1);
  });

  test('rejects malformed and cross-profile scope projections', () => {
    expect(() => parseAuthAuthorizationSnapshot({})).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      profile: { tenancy: 'single', authorization: 'advanced' },
      scope: {
        ...validSnapshot().scope,
        kind: 'tenant',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
      },
    })).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      applicationScope: {
        ...validSnapshot().scope,
        kind: 'tenant',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
      },
    })).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      applicationScope: {
        ...validSnapshot().scope,
        permissions: ['application.users:read'],
      },
    })).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      profile: { tenancy: 'multi', authorization: 'advanced' },
      scope: {
        kind: 'tenant',
        scopeId: 'tenant-admin',
        tenantId: 'tenant-admin',
        membershipId: 'membership-admin',
        roles: ['administrator'],
        permissions: ['tenant:read'],
        allPermissions: false,
        revision: 'tenant-scope-1',
      },
      applicationScope: {
        kind: 'application',
        scopeId: 'wrong-scope',
        roles: ['administrator'],
        permissions: ['application.users:read'],
        allPermissions: false,
        revision: 'application-scope-1',
      },
    })).toThrow('invalid');
    expect(() => parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      scope: {
        ...validSnapshot().scope,
        roles: ['reader', 'reader'],
      },
    })).toThrow('invalid');
  });

  test('parses a separate administration application scope for permission hints', () => {
    const parsed = parseAuthAuthorizationSnapshot({
      ...validSnapshot(),
      profile: { tenancy: 'multi', authorization: 'advanced' },
      scope: {
        kind: 'tenant',
        scopeId: 'tenant-admin',
        tenantId: 'tenant-admin',
        membershipId: 'membership-admin',
        roles: ['administrator'],
        permissions: ['tenant:read'],
        allPermissions: false,
        revision: 'tenant-scope-1',
      },
      applicationScope: {
        kind: 'application',
        scopeId: 'application',
        roles: ['administrator'],
        permissions: ['application.users:read'],
        allPermissions: false,
        revision: 'application-scope-1',
      },
    });
    expect(hasAuthorizationPermission(parsed, 'tenant:read')).toBe(true);
    expect(hasAuthorizationPermission(parsed, 'application.users:read')).toBe(true);
    expect(hasAuthorizationPermission(parsed, 'application.users:manage')).toBe(false);
  });
});

function validSnapshot() {
  return {
    version: 1,
    identity: { userId: 'user-1', platformRole: 'user' },
    profile: { tenancy: 'single', authorization: 'advanced' },
    scope: {
      kind: 'application',
      scopeId: 'application',
      roles: ['reader'],
      permissions: ['records:read'],
      allPermissions: false,
      revision: 'scope-1',
    },
    revision: 'revision-1',
  };
}
