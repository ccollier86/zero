import { describe, expect, test } from 'bun:test';
import type { NativeIdTokenValidator } from './id-token';
import { NativeLifecycle } from './lifecycle';
import type { NativeIdTokenClaims, NativeOidcMetadata } from './oidc-types';
import { NativeSessionManager } from './session-manager';
import { NativeAuthStateStore } from './state-store';
import { NativeVaultStore } from './vault-store';

const issuer = 'https://zero.test/auth';
const clientId = 'native-test';
const tenantA = { tenantId: 'tenant-a', slug: 'tenant-a', name: 'Tenant A', role: 'owner' };
const tenantB = { tenantId: 'tenant-b', slug: 'tenant-b', name: 'Tenant B', role: 'member' };

describe('NativeSessionManager refresh-proof serialization', () => {
  test('a refresh waits for a tenant list that already owns the proof', async () => {
    const fixture = await createFixture();
    const listed = fixture.manager.listTenants();
    await fixture.listStarted.promise;

    const refreshed = fixture.manager.refresh(true);
    await Promise.resolve();
    expect(fixture.refreshCalls).toBe(0);

    fixture.releaseList();
    expect(await listed).toEqual({ activeTenantId: 'tenant-a', tenants: [tenantA, tenantB] });
    expect(await refreshed).toBe('access-refreshed');
    expect(fixture.refreshCalls).toBe(1);
    expect(fixture.listProofs).toEqual(['refresh-a']);
    expect(fixture.refreshProofs).toEqual(['refresh-a']);
  });

  test('a tenant switch waits for a tenant list that already owns the proof', async () => {
    const fixture = await createFixture();
    const listed = fixture.manager.listTenants();
    await fixture.listStarted.promise;

    const switched = fixture.manager.switchTenant('tenant-b');
    await Promise.resolve();
    expect(fixture.switchCalls).toBe(0);

    fixture.releaseList();
    await listed;
    await switched;
    expect(fixture.switchCalls).toBe(1);
    expect(fixture.listProofs).toEqual(['refresh-a']);
    expect(fixture.switchProofs).toEqual(['refresh-a']);
    expect(fixture.state.state.activeTenant).toEqual(tenantB);
  });
});

async function createFixture() {
  const metadata: NativeOidcMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    revocation_endpoint: `${issuer}/revoke`,
    zero_tenant_sessions: {
      version: 1,
      list_endpoint: `${issuer}/tenants`,
      switch_endpoint: `${issuer}/tenants/switch`,
      proof: 'refresh_token',
    },
  };
  const identity: NativeIdTokenClaims = {
    iss: issuer,
    sub: 'user-1',
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };
  const listGate = deferred<void>();
  const listStarted = deferred<void>();
  const listProofs: string[] = [];
  const refreshProofs: string[] = [];
  const switchProofs: string[] = [];
  let refreshCalls = 0;
  let switchCalls = 0;
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = new URLSearchParams(String(init?.body ?? ''));
    if (url === `${issuer}/tenants`) {
      listProofs.push(body.get('refresh_token') ?? '');
      listStarted.resolve(undefined);
      await listGate.promise;
      return Response.json({ activeTenantId: 'tenant-a', tenants: [tenantA, tenantB] });
    }
    if (url === `${issuer}/token`) {
      refreshCalls += 1;
      refreshProofs.push(body.get('refresh_token') ?? '');
      return Response.json({
        access_token: 'access-refreshed',
        refresh_token: 'refresh-b',
        id_token: 'id-refreshed',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }
    if (url === `${issuer}/tenants/switch`) {
      switchCalls += 1;
      switchProofs.push(body.get('refresh_token') ?? '');
      return Response.json({
        access_token: 'access-switched',
        refresh_token: 'refresh-b',
        id_token: 'id-switched',
        expires_in: 3600,
        token_type: 'Bearer',
        active_tenant: tenantB,
      });
    }
    if (url === `${issuer}/revoke`) return new Response(null, { status: 200 });
    return new Response(null, { status: 404 });
  };
  const vaultValues = new Map<string, string>();
  const vault = new NativeVaultStore({
    async get(key) { return vaultValues.get(key) ?? null; },
    async set(key, value) { vaultValues.set(key, value); },
    async delete(key) { vaultValues.delete(key); },
  }, 'native-session-manager-test');
  const state = new NativeAuthStateStore(Date.now);
  const lifecycle = new NativeLifecycle();
  const validator = {
    async validate() { return identity; },
  } as unknown as NativeIdTokenValidator;
  const manager = new NativeSessionManager({
    metadata,
    issuer,
    clientId,
    fetch,
    vault,
    state,
    validator,
    lifecycle,
    networkTimeoutMs: 1_000,
  });
  await manager.establish({
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    idToken: 'id-a',
    expiresIn: 3600,
    activeTenant: tenantA,
  }, identity, lifecycle.capture());

  return {
    manager,
    state,
    listStarted,
    releaseList: () => listGate.resolve(undefined),
    listProofs,
    refreshProofs,
    switchProofs,
    get refreshCalls() { return refreshCalls; },
    get switchCalls() { return switchCalls; },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
