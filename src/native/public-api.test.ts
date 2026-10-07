import { describe, expect, test } from 'bun:test';
import type { ZeroNativeAuth, ZeroNativeAuthOptions } from './index';
import { createZeroNativeAuth } from './index';
import { createNativeTestHarness } from './test-support';

describe('createZeroNativeAuth', () => {
  test('provides the simple native API without a client secret', async () => {
    const harness = await createNativeTestHarness();
    const auth: ZeroNativeAuth = harness.auth;

    expect(auth.getUser()).toBeNull();
    expect((await auth.initialize()).status).toBe('anonymous');
    expect((await auth.signIn()).status).toBe('authenticated');
    expect(auth.getUser()?.sub).toBe('user-1');

    const authorization = new URL(harness.authUrl());
    expect(authorization.pathname).toBe('/auth/authorize');
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('state')?.length).toBeGreaterThanOrEqual(43);
    expect(authorization.searchParams.get('nonce')?.length).toBeGreaterThanOrEqual(43);

    const tokenRequest = harness.tokenBodies[0]!;
    expect(tokenRequest.get('client_id')).toBe('desktop-test');
    expect(tokenRequest.get('client_secret')).toBeNull();
    expect(tokenRequest.get('code_verifier')?.length).toBeGreaterThanOrEqual(43);

    const stored = [...harness.vault.values()].join('\n');
    expect(stored).toContain('refresh-initial');
    expect(stored).not.toContain('access-initial');
    const response = await auth.fetch('/api/private');
    expect(await response.json()).toEqual({ authorization: 'Bearer access-initial' });

    await auth.signOut();
    expect(auth.getUser()).toBeNull();
    expect(auth.state.status).toBe('anonymous');
    expect(harness.vault.size).toBe(0);
  });
  test('signUp requests the provider registration continuation', async () => {
    const harness = await createNativeTestHarness();
    await harness.auth.signUp({ loginHint: 'new@example.com' });
    const authorization = new URL(harness.authUrl());
    expect(authorization.searchParams.get('prompt')).toBe('create');
    expect(authorization.searchParams.get('login_hint')).toBe('new@example.com');
  });
  test('the ergonomic option type uses app-facing adapter names', () => {
    const compileOnly = (_options: ZeroNativeAuthOptions) => createZeroNativeAuth(_options);
    expect(typeof compileOnly).toBe('function');
  });

  test('accepts an existing auth issuer and HTTP localhost for development', async () => {
    let discoveryUrl = '';
    const auth = createZeroNativeAuth({
      serverUrl: 'http://localhost:4000/auth/',
      clientId: 'desktop-test',
      browser: { async open() {} },
      callback: { async prepare() { throw new Error('unused'); } },
      secureStorage: {
        async get() { return null; }, async set() {}, async delete() {},
      },
      async fetch(input) {
        discoveryUrl = String(input);
        return new Response(null, { status: 503 });
      },
    });
    await auth.initialize().catch(() => undefined);
    expect(discoveryUrl).toBe('http://localhost:4000/auth/.well-known/openid-configuration');
    expect(() => createZeroNativeAuth({
      serverUrl: 'https://zero.example/custom/path',
      clientId: 'desktop-test', browser: { async open() {} },
      callback: { async prepare() { throw new Error('unused'); } },
      secureStorage: { async get() { return null; }, async set() {}, async delete() {} },
    })).toThrow('Zero app origin');
  });

  test('rejects unsupported application scopes before opening the browser', () => {
    expect(() => createZeroNativeAuth({
      serverUrl: 'https://zero.example',
      clientId: 'desktop-test',
      browser: { async open() {} },
      callback: { async prepare() { throw new Error('unused'); } },
      secureStorage: { async get() { return null; }, async set() {}, async delete() {} },
      // Exercise the runtime guard for untyped JavaScript callers.
      scopes: ['records:read'] as any,
    })).toThrow('Only declared Zero identity and own-account scopes are supported');
  });

  test('rejects unsafe explicit secure-storage namespaces', () => {
    const base = {
      serverUrl: 'https://zero.example', clientId: 'desktop-test',
      browser: { async open() {} },
      callback: { async prepare() { throw new Error('unused'); } },
      secureStorage: { async get() { return null; }, async set() {}, async delete() {} },
    };
    expect(() => createZeroNativeAuth({ ...base, storageNamespace: 'bad\u0000key' }))
      .toThrow('storageNamespace');
    expect(() => createZeroNativeAuth({ ...base, storageNamespace: 'x'.repeat(201) }))
      .toThrow('storageNamespace');
  });
});
