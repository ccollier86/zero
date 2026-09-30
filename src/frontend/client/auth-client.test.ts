/**
 * auth-client.test.ts
 *
 * Verifies browser auth-client transport helpers. These tests own SDK request
 * contract checks only; backend route behavior is covered by auth integration
 * tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  AuthClient,
  AuthClientError,
  isAuthEmailVerificationRequiredResult,
  isAuthTenantSelectionRequiredResult,
} from './auth-client';
import { AuthSessionController } from './auth-session';
import type {
  AuthAuthorizationScopeLifecycle,
  AuthEmailVerificationRequiredResult,
} from './auth-client';

const originalFetch = globalThis.fetch;
const REFRESH_TOKEN_STORAGE_KEY = '__platform_refresh_token';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
});

describe('AuthClient admin helpers', () => {
  it('exposes authenticated application administration as a namespaced surface', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'application-access-1',
          refreshToken: 'application-refresh-1',
        });
      }
      if (url.endsWith('/auth/application/users/u_self/roles')) {
        return Response.json({
          user: applicationAccessUser('u_self'),
          actorAuthorizationChanged: true,
        });
      }
      if (url.endsWith('/auth/refresh')) {
        return Response.json({
          user: authUser(),
          accessToken: 'application-access-2',
          refreshToken: 'application-refresh-2',
        });
      }
      return Response.json({ error: 'Unexpected request' }, { status: 500 });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    const result = await client.applicationAdmin.replaceUserRoles(
      'u_self',
      ['reader'],
      'application:application:1',
    );

    expect(result).toMatchObject({
      user: { identity: { userId: 'u_self' }, roles: ['reader'] },
      actorAuthorizationChanged: true,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      'http://zero.test/auth/login',
      'http://zero.test/auth/application/users/u_self/roles',
      'http://zero.test/auth/refresh',
    ]);
    expect(new Headers(requests[1]!.init?.headers).get('Authorization'))
      .toBe('Bearer application-access-1');
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      roles: ['reader'],
      expectedRevision: 'application:application:1',
    });
    expect(client.accessToken).toBe('application-access-2');
  });

  it('lists admin users with supported query params', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({
        users: [],
        page: {
          limit: 25,
          offset: 10,
          count: 0,
          total: 0,
          hasMore: false,
          nextOffset: null,
        },
      });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.listAdminUsers({
      limit: 25,
      offset: 10,
      search: 'ops',
      role: 'admin',
      status: 'active',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      'http://zero.test/auth/admin/users?limit=25&offset=10&search=ops&role=admin&status=active',
    );
    expect(result.page.limit).toBe(25);
  });

  it('creates admin users with a JSON body', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({
        user: {
          userId: 'u_1',
          username: 'ada',
          email: 'ada@example.com',
          firstName: null,
          lastName: null,
          role: 'user',
          status: 'active',
          passwordChangeRequired: true,
          emailVerifiedAt: null,
          emailVerificationRequired: false,
          mfaRequired: false,
          properties: {},
          createdAt: 1,
          updatedAt: null,
        },
        setupEmailSent: true,
      });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.createAdminUser({
      username: 'ada',
      email: 'ada@example.com',
      sendSetupEmail: true,
    });

    expect(requests[0]!.url).toBe('http://zero.test/auth/admin/users');
    expect(requests[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      username: 'ada',
      email: 'ada@example.com',
      sendSetupEmail: true,
    });
    expect(result.setupEmailSent).toBe(true);
  });

  it('sets and deletes admin user properties', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.setAdminUserProperty('u_1', 'department', 'billing');
    await client.deleteAdminUserProperty('u_1', 'department');

    expect(requests[0]!.url).toBe('http://zero.test/auth/admin/users/u_1/properties/department');
    expect(requests[0]!.init?.method).toBe('PUT');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({ value: 'billing' });
    expect(requests[1]!.url).toBe('http://zero.test/auth/admin/users/u_1/properties/department');
    expect(requests[1]!.init?.method).toBe('DELETE');
  });

  it('manages admin MFA and email-verification lifecycle routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/mfa')) {
        return Response.json({ methods: [], required: false, requirement: 'none' });
      }
      if (url.endsWith('/mfa/reset')) {
        return Response.json({ ok: true, deletedMethods: 1, invalidatedChallenges: 2 });
      }
      if (url.endsWith('/send-verification-email')) return Response.json({ ok: true });
      return Response.json({ user: authUser() });
    });

    const client = new AuthClient('http://zero.test');
    const status = await client.getAdminUserMfa('u/1');
    await client.requireAdminUserMfa('u/1');
    await client.clearAdminUserMfaRequirement('u/1');
    const reset = await client.resetAdminUserMfa('u/1');
    await client.sendAdminVerificationEmail('u/1');
    await client.verifyAdminUserEmail('u/1');

    expect(status.requirement).toBe('none');
    expect(reset).toEqual({ ok: true, deletedMethods: 1, invalidatedChallenges: 2 });
    expect(requests.map((request) => [request.url, request.init?.method ?? 'GET'])).toEqual([
      ['http://zero.test/auth/admin/users/u%2F1/mfa', 'GET'],
      ['http://zero.test/auth/admin/users/u%2F1/mfa/require', 'POST'],
      ['http://zero.test/auth/admin/users/u%2F1/mfa/clear-requirement', 'POST'],
      ['http://zero.test/auth/admin/users/u%2F1/mfa/reset', 'POST'],
      ['http://zero.test/auth/admin/users/u%2F1/send-verification-email', 'POST'],
      ['http://zero.test/auth/admin/users/u%2F1/verify-email', 'POST'],
    ]);
  });

  it('surfaces structured admin route errors', async () => {
    mockFetch(() => new Response(
      JSON.stringify({ error: 'Forbidden', code: 'FORBIDDEN' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));

    const client = new AuthClient('http://zero.test');
    try {
      await client.getAdminConfig();
      throw new Error('Expected getAdminConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthClientError);
      expect((err as AuthClientError).message).toBe('Forbidden');
      expect((err as AuthClientError).status).toBe(403);
      expect((err as AuthClientError).code).toBe('FORBIDDEN');
    }
  });
});

describe('AuthClient authorization surface', () => {
  it('loads, observes, and refreshes the live no-store authorization projection', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let authorizationRead = 0;
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'authorization-access',
          refreshToken: 'authorization-refresh',
        });
      }
      if (url.endsWith('/auth/authorization')) {
        authorizationRead += 1;
        return Response.json({
          version: 1,
          identity: { userId: 'u_1', platformRole: 'user' },
          profile: { tenancy: 'single', authorization: 'advanced' },
          scope: {
            kind: 'application',
            scopeId: 'application',
            roles: ['reader'],
            permissions: authorizationRead === 1 ? ['records:read'] : [],
            allPermissions: false,
            revision: `scope-${authorizationRead}`,
          },
          revision: `snapshot-${authorizationRead}`,
        });
      }
      return Response.json({ error: 'Unexpected request' }, { status: 500 });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationRevalidationIntervalMs: 0,
    });
    await client.login('ada', 'password');
    let notifications = 0;
    const unsubscribe = client.subscribeAuthorization(() => { notifications += 1; });

    await expect(client.getAuthorization()).resolves.toMatchObject({
      scope: { permissions: ['records:read'] },
    });
    expect(client.authorizationState.status).toBe('ready');
    await expect(client.refreshAuthorization()).resolves.toMatchObject({
      scope: { permissions: [] },
    });
    expect(client.authorization?.revision).toBe('snapshot-2');
    expect(notifications).toBeGreaterThan(0);

    const authorizationRequests = requests.filter(({ url }) => (
      url.endsWith('/auth/authorization')
    ));
    expect(authorizationRequests).toHaveLength(2);
    expect(new Headers(authorizationRequests[0]!.init?.headers).get('Authorization'))
      .toBe('Bearer authorization-access');
    expect(authorizationRequests[0]!.init?.cache).toBe('no-store');

    unsubscribe();
    client.dispose();
  });
});

describe('AuthClient token lifecycle', () => {
  it('settles account, action-token, MFA, and invitation loading after failures', async () => {
    const scenarios = [
      {
        path: '/auth/login',
        fallback: 'Login failed',
        run: (client: AuthClient) => client.login('ada', 'password'),
      },
      {
        path: '/auth/verify-email',
        fallback: 'Failed to verify email',
        run: (client: AuthClient) => client.verifyEmail('verification-token'),
      },
      {
        path: '/auth/mfa/challenge/verify',
        fallback: 'Failed to verify MFA challenge',
        run: (client: AuthClient) => client.verifyMfaChallenge({
          challengeToken: 'challenge-token',
          code: '123456',
        }),
      },
      {
        path: '/auth/invitations/accept',
        fallback: 'Failed to accept invitation',
        run: (client: AuthClient) => client.acceptTenantInvitation({
          token: 'invitation-token',
        }),
      },
    ] as const;

    for (const scenario of scenarios) {
      mockFetch((url) => url.endsWith(scenario.path)
        ? Promise.reject(new Error('network unavailable'))
        : Response.json({ ok: true }));
      const client = new AuthClient('http://zero.test');

      await expect(scenario.run(client)).rejects.toThrow('network unavailable');
      expect(client.isLoading).toBe(false);
      expect(client.error).toBe(scenario.fallback);
      expect(client.isAuthenticated).toBe(false);
      client.dispose();
    }
  });

  it('fails closed and leaves loading state after a malformed successful login response', async () => {
    mockFetch(() => Response.json({
      user: authUser(),
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      unexpectedAuthority: 'platform-admin',
    }));

    const client = new AuthClient('http://zero.test');
    await expect(client.login('ada', 'password')).rejects.toThrow(
      'invalid authentication completion response',
    );

    expect(client.isAuthenticated).toBe(false);
    expect(client.isLoading).toBe(false);
    expect(client.error).toBe('Invalid authentication response');
    expect(client.accessToken).toBeNull();
  });

  it('does not let an older login completion overwrite a newer authentication scope', async () => {
    let resolveOlderLogin!: (response: Response) => void;
    const olderLoginResponse = new Promise<Response>((resolve) => {
      resolveOlderLogin = resolve;
    });
    let olderSignal: AbortSignal | null = null;
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url, init) => {
      if (!url.endsWith('/auth/login')) return Response.json({ ok: true });
      const body = JSON.parse(String(init?.body)) as { username: string };
      if (body.username === 'older') {
        olderSignal = init?.signal ?? null;
        return olderLoginResponse;
      }
      return Response.json({
        user: { ...authUser(), userId: 'u_newer', username: 'newer' },
        accessToken: 'access-newer',
        refreshToken: 'refresh-newer',
        activeTenant: tenantSummary('ten_newer', 'owner'),
      });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    const olderLogin = client.login('older', 'password');
    const observedOlderLogin = olderLogin.catch((error: unknown) => error);
    await Promise.resolve();

    await client.login('newer', 'password');
    expect((olderSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(client.user?.userId).toBe('u_newer');
    expect(client.accessToken).toBe('access-newer');

    resolveOlderLogin(Response.json({
      user: { ...authUser(), userId: 'u_older', username: 'older' },
      accessToken: 'access-older',
      refreshToken: 'refresh-older',
      activeTenant: tenantSummary('ten_older', 'owner'),
    }));
    const rejection = await observedOlderLogin;

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
    expect(client.user?.userId).toBe('u_newer');
    expect(client.accessToken).toBe('access-newer');
    expect(client.activeTenant?.tenantId).toBe('ten_newer');
  });

  it('does not let an older transport failure clobber replacement auth state', async () => {
    let rejectOlderLogin!: (cause: unknown) => void;
    const olderLoginResponse = new Promise<Response>((_resolve, reject) => {
      rejectOlderLogin = reject;
    });
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url, init) => {
      if (!url.endsWith('/auth/login')) return Response.json({ ok: true });
      const body = JSON.parse(String(init?.body)) as { username: string };
      if (body.username === 'older') return olderLoginResponse;
      return Response.json({
        user: { ...authUser(), userId: 'u_newer', username: 'newer' },
        accessToken: 'access-newer',
        refreshToken: 'refresh-newer',
        activeTenant: tenantSummary('ten_newer', 'owner'),
      });
    });
    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });

    const olderLogin = client.login('older', 'password');
    const observedOlderLogin = olderLogin.catch((cause: unknown) => cause);
    await Promise.resolve();
    await client.login('newer', 'password');
    rejectOlderLogin(new Error('late network failure'));

    const rejection = await observedOlderLogin;
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
    expect(client.user?.userId).toBe('u_newer');
    expect(client.activeTenant?.tenantId).toBe('ten_newer');
    expect(client.error).toBeNull();
    expect(client.isLoading).toBe(false);
  });

  it('keeps tenant selection unauthenticated until the one-time exchange completes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          tenantSelectionRequired: true,
          tenantSelection: {
            continuation: 'identity-only-continuation',
            expiresAt: Date.now() + 60_000,
            tenants: [tenantSummary('ten_a', 'owner')],
          },
        });
      }
      if (url.endsWith('/auth/tenants/select')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-selected',
          refreshToken: 'refresh-selected',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    const loginResult = await client.login('ada', 'password');
    expect(isAuthTenantSelectionRequiredResult(loginResult)).toBe(true);
    expect(client.isAuthenticated).toBe(false);
    expect(client.isLoading).toBe(false);
    expect(client.accessToken).toBeNull();

    const selected = await client.selectTenant('identity-only-continuation', 'ten_a');
    expect(selected.activeTenant).toEqual(tenantSummary('ten_a', 'owner'));
    expect(client.activeTenant).toEqual(tenantSummary('ten_a', 'owner'));
    expect(client.accessToken).toBe('access-selected');
    expect(lifecycle.events).toEqual([
      'begin', 'complete',
    ]);
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      continuation: 'identity-only-continuation',
      tenantId: 'ten_a',
    });
  });

  it('keeps the tenant-selection form mounted until its response is parsed', async () => {
    const pendingSelection = deferred<Response>();
    let selectionRequests = 0;
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          tenantSelectionRequired: true,
          tenantSelection: {
            continuation: 'selection-proof',
            expiresAt: Date.now() + 60_000,
            tenants: [tenantSummary('ten_a', 'owner')],
          },
        });
      }
      if (url.endsWith('/auth/tenants/select')) {
        selectionRequests += 1;
        return pendingSelection.promise;
      }
      return Response.json({ ok: true });
    });
    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');

    const selection = client.selectTenant('selection-proof', 'ten_a');
    await waitForCondition(() => selectionRequests === 1);
    expect(lifecycle.events).toEqual([]);
    expect(client.sessionTransition.phase).toBe('idle');
    expect(client.authenticationContinuation).toMatchObject({
      tenantSelectionRequired: true,
    });

    pendingSelection.resolve(Response.json({
      user: authUser(),
      accessToken: 'access-selected',
      refreshToken: 'refresh-selected',
      activeTenant: tenantSummary('ten_a', 'owner'),
    }));
    await selection;

    expect(lifecycle.events).toEqual(['begin', 'complete']);
    expect(client.authenticationContinuation).toBeNull();
    expect(client.activeTenant?.tenantId).toBe('ten_a');
  });

  it('creates a tenant with onboarding proof or the current refresh family', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const lifecycle = createTestScopeLifecycle();
    let creations = 0;
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          tenantOnboardingRequired: true,
          onboarding: {
            reason: 'no_active_tenant_membership',
            continuation: 'onboarding-proof',
            expiresAt: Date.now() + 60_000,
            tenantCreation: {
              allowed: true,
              continuation: 'onboarding-proof',
              expiresAt: Date.now() + 60_000,
            },
          },
        });
      }
      if (url.endsWith('/auth/tenants/create')) {
        creations += 1;
        return Response.json({
          user: authUser(),
          accessToken: `access-created-${creations}`,
          refreshToken: `refresh-created-${creations}`,
          activeTenant: tenantSummary(`ten_${creations}`, 'owner'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    expect(client.isAuthenticated).toBe(false);

    await client.createTenant({
      name: 'First Workspace',
      continuation: 'onboarding-proof',
    });
    await client.createTenant({ name: 'Second Workspace', slug: 'second' });

    const createBodies = requests
      .filter(({ url }) => url.endsWith('/auth/tenants/create'))
      .map(({ init }) => JSON.parse(String(init?.body)));
    expect(createBodies).toEqual([
      { name: 'First Workspace', continuation: 'onboarding-proof' },
      {
        name: 'Second Workspace',
        slug: 'second',
        refreshToken: 'refresh-created-1',
      },
    ]);
    expect(client.activeTenant).toEqual(tenantSummary('ten_2', 'owner'));
    expect(lifecycle.events).toEqual([
      'begin', 'complete',
      'begin', 'complete',
    ]);
  });

  it('uses refresh-family proof, deduplicates switches, and runs the scope barrier', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-before-switch',
          refreshToken: 'refresh-before-switch',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      if (url.endsWith('/auth/tenants/list')) {
        return Response.json({
          activeTenantId: 'ten_a',
          tenants: [
            tenantSummary('ten_a', 'owner'),
            tenantSummary('ten_b', 'member'),
          ],
        });
      }
      if (url.endsWith('/auth/tenants/switch')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-after-switch',
          refreshToken: 'refresh-after-switch',
          activeTenant: tenantSummary('ten_b', 'member'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    const listed = await client.listTenants();
    expect(listed.activeTenantId).toBe('ten_a');

    const [first, second] = await Promise.all([
      client.switchTenant('ten_b'),
      client.switchTenant('ten_b'),
    ]);
    expect(first).toEqual(second);
    expect(client.accessToken).toBe('access-after-switch');
    expect(client.activeTenant).toEqual(tenantSummary('ten_b', 'member'));
    expect(lifecycle.events).toEqual([
      'begin', 'complete',
      'begin', 'complete',
    ]);
    expect(requests.filter(({ url }) => url.endsWith('/auth/tenants/switch')))
      .toHaveLength(1);
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      refreshToken: 'refresh-before-switch',
    });
    expect(JSON.parse(String(requests[2]!.init?.body))).toEqual({
      refreshToken: 'refresh-before-switch',
      tenantId: 'ten_b',
    });
  });

  it('deduplicates only identical tenant intents and rejects different concurrent intent', async () => {
    const pendingCreate = deferred<Response>();
    const pendingSwitch = deferred<Response>();
    let createRequests = 0;
    let switchRequests = 0;
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-a',
          refreshToken: 'refresh-a',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      if (url.endsWith('/auth/tenants/create')) {
        createRequests += 1;
        return pendingCreate.promise;
      }
      if (url.endsWith('/auth/tenants/switch')) {
        switchRequests += 1;
        return pendingSwitch.promise;
      }
      return Response.json({ ok: true });
    });
    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    lifecycle.events.length = 0;

    const firstCreate = client.createTenant({ name: 'Northstar', slug: 'northstar' });
    await waitForCondition(() => createRequests === 1);
    const duplicateCreate = client.createTenant({ name: 'Northstar', slug: 'northstar' });
    await expect(client.createTenant({ name: 'Aurora', slug: 'aurora' }))
      .rejects.toMatchObject({
        status: 409,
        code: 'AUTH_TENANT_CREATE_IN_PROGRESS',
        message: 'Another tenant scope change is already in progress; creation was not started.',
      });
    await expect(client.switchTenant('ten_b')).rejects.toMatchObject({
      status: 409,
      code: 'AUTH_TENANT_SWITCH_IN_PROGRESS',
      message: 'Another tenant scope change is already in progress; switch was not started.',
    });
    expect(lifecycle.events).toEqual([]);
    pendingCreate.resolve(Response.json({
      user: authUser(),
      accessToken: 'access-northstar',
      refreshToken: 'refresh-northstar',
      activeTenant: tenantSummary('ten_northstar', 'owner'),
    }));
    const created = await Promise.all([firstCreate, duplicateCreate]);
    expect(created.map((result) => result.activeTenant?.tenantId)).toEqual([
      'ten_northstar',
      'ten_northstar',
    ]);
    expect(createRequests).toBe(1);
    expect(lifecycle.events).toEqual(['begin', 'complete']);
    lifecycle.events.length = 0;

    const firstSwitch = client.switchTenant('ten_b');
    await waitForCondition(() => switchRequests === 1);
    const duplicateSwitch = client.switchTenant('ten_b');
    await expect(client.switchTenant('ten_c')).rejects.toMatchObject({
      status: 409,
      code: 'AUTH_TENANT_SWITCH_IN_PROGRESS',
      message: 'Another tenant scope change is already in progress; switch was not started.',
    });
    expect(lifecycle.events).toEqual([]);
    pendingSwitch.resolve(Response.json({
      user: authUser(),
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      activeTenant: tenantSummary('ten_b', 'member'),
    }));
    const switched = await Promise.all([firstSwitch, duplicateSwitch]);
    expect(switched.map((result) => result.activeTenant?.tenantId)).toEqual([
      'ten_b',
      'ten_b',
    ]);
    expect(switchRequests).toBe(1);
    expect(lifecycle.events).toEqual(['begin', 'complete']);
  });

  it('deduplicates tenant selection and conflicts a different scope intent', async () => {
    const pendingSelection = deferred<Response>();
    let selectionRequests = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/tenants/select')) {
        selectionRequests += 1;
        return pendingSelection.promise;
      }
      return Response.json({ ok: true });
    });
    const client = new AuthClient('http://zero.test');

    const first = client.selectTenant('selection-proof', 'ten_a');
    await waitForCondition(() => selectionRequests === 1);
    const duplicate = client.selectTenant('selection-proof', 'ten_a');
    await expect(client.selectTenant('selection-proof', 'ten_b'))
      .rejects.toMatchObject({
        status: 409,
        code: 'AUTH_TENANT_SELECT_IN_PROGRESS',
        message: 'Another tenant scope change is already in progress; selection was not started.',
      });
    await expect(client.createTenant({
      name: 'Northstar',
      continuation: 'creation-proof',
    })).rejects.toMatchObject({
      status: 409,
      code: 'AUTH_TENANT_CREATE_IN_PROGRESS',
    });
    expect(selectionRequests).toBe(1);

    pendingSelection.resolve(Response.json({
      user: authUser(),
      accessToken: 'access-selected',
      refreshToken: 'refresh-selected',
      activeTenant: tenantSummary('ten_a', 'owner'),
    }));
    const results = await Promise.all([first, duplicate]);
    expect(results.map((result) => result.activeTenant?.tenantId)).toEqual([
      'ten_a',
      'ten_a',
    ]);
  });

  it('serializes tenant listing before a refresh-proof tenant switch', async () => {
    const pendingList = deferred<Response>();
    let listRequests = 0;
    let switchRequests = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-tenant-a',
          refreshToken: 'refresh-tenant-a',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      if (url.endsWith('/auth/tenants/list')) {
        listRequests += 1;
        return pendingList.promise;
      }
      if (url.endsWith('/auth/tenants/switch')) {
        switchRequests += 1;
        return Response.json({
          user: authUser(),
          accessToken: 'access-tenant-b',
          refreshToken: 'refresh-tenant-b',
          activeTenant: tenantSummary('ten_b', 'member'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    const listed = client.listTenants();
    const listStarted = await waitForCondition(() => listRequests === 1);

    const switched = client.switchTenant('ten_b');
    await Promise.resolve();
    const switchRequestsBeforeListCompleted = switchRequests;
    pendingList.resolve(Response.json({
      activeTenantId: 'ten_a',
      tenants: [tenantSummary('ten_a', 'owner')],
    }));

    expect(listStarted).toBe(true);
    expect(switchRequestsBeforeListCompleted).toBe(0);
    expect((await listed).activeTenantId).toBe('ten_a');
    await switched;
    expect(switchRequests).toBe(1);
    expect(client.activeTenant?.tenantId).toBe('ten_b');
  });

  it('does not dispatch a tenant list retained across a completed switch', async () => {
    const pendingSwitch = deferred<Response>();
    let listRequests = 0;
    let switchRequests = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-tenant-a',
          refreshToken: 'refresh-tenant-a',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      if (url.endsWith('/auth/tenants/switch')) {
        switchRequests += 1;
        return pendingSwitch.promise;
      }
      if (url.endsWith('/auth/tenants/list')) {
        listRequests += 1;
        return Response.json({ activeTenantId: 'ten_b', tenants: [] });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    const switched = client.switchTenant('ten_b');
    const switchStarted = await waitForCondition(() => switchRequests === 1);

    const retainedList = client.listTenants();
    const observedList = retainedList.catch((error: unknown) => error);
    await Promise.resolve();
    const listRequestsBeforeSwitchCompleted = listRequests;

    pendingSwitch.resolve(Response.json({
      user: authUser(),
      accessToken: 'access-tenant-b',
      refreshToken: 'refresh-tenant-b',
      activeTenant: tenantSummary('ten_b', 'member'),
    }));
    await switched;

    expect(switchStarted).toBe(true);
    expect(listRequestsBeforeSwitchCompleted).toBe(0);
    const rejection = await observedList;
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
    expect(listRequests).toBe(0);
    expect(client.activeTenant?.tenantId).toBe('ten_b');
  });

  it('rejects an HTTP response that completes after its authorization scope changed', async () => {
    let resolveProtected!: (response: Response) => void;
    const protectedResponse = new Promise<Response>((resolve) => {
      resolveProtected = resolve;
    });
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-before-switch',
          refreshToken: 'refresh-before-switch',
        });
      }
      if (url.endsWith('/api/protected')) return protectedResponse;
      if (url.endsWith('/auth/tenants/switch')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-after-switch',
          refreshToken: 'refresh-after-switch',
          activeTenant: tenantSummary('ten_b', 'member'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    const staleRequest = client.fetchWithAuth('http://zero.test/api/protected');
    await Promise.resolve();
    await client.switchTenant('ten_b');
    resolveProtected(Response.json({ secret: 'old-tenant-data' }));

    await expect(staleRequest).rejects.toThrow(
      'Discarded a response from a previous authorization scope',
    );
  });

  it('cancels a stale fetch and never retries its late 401 with the replacement token', async () => {
    let resolveProtected!: (response: Response) => void;
    const protectedResponse = new Promise<Response>((resolve) => {
      resolveProtected = resolve;
    });
    const protectedAttempts: Array<{ authorization: string | null; signal: AbortSignal | null }> = [];
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url, init) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-before-switch',
          refreshToken: 'refresh-before-switch',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      if (url.endsWith('/api/protected')) {
        protectedAttempts.push({
          authorization: new Headers(init?.headers).get('authorization'),
          signal: init?.signal ?? null,
        });
        return protectedResponse;
      }
      if (url.endsWith('/auth/tenants/switch')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-after-switch',
          refreshToken: 'refresh-after-switch',
          activeTenant: tenantSummary('ten_b', 'member'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    const staleRequest = client.fetchWithAuth('http://zero.test/api/protected');
    const observedRequest = staleRequest.catch((error: unknown) => error);
    await Promise.resolve();

    await client.switchTenant('ten_b');
    expect(protectedAttempts[0]?.signal?.aborted).toBe(true);
    resolveProtected(new Response(null, { status: 401 }));

    const rejection = await observedRequest;
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
    expect(protectedAttempts).toHaveLength(1);
    expect(protectedAttempts[0]?.authorization).toBe('Bearer access-before-switch');
  });

  it('cancels optional-auth fetches and rejects their late completion after a scope change', async () => {
    let resolveOptional!: (response: Response) => void;
    const optionalResponse = new Promise<Response>((resolve) => {
      resolveOptional = resolve;
    });
    let optionalSignal: AbortSignal | null = null;
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url, init) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-before-switch',
          refreshToken: 'refresh-before-switch',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      if (url.endsWith('/api/optional')) {
        optionalSignal = init?.signal ?? null;
        return optionalResponse;
      }
      if (url.endsWith('/auth/tenants/switch')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-after-switch',
          refreshToken: 'refresh-after-switch',
          activeTenant: tenantSummary('ten_b', 'member'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    const staleRequest = client.fetchWithOptionalAuth('http://zero.test/api/optional');
    const observedRequest = staleRequest.catch((error: unknown) => error);
    await Promise.resolve();

    await client.switchTenant('ten_b');
    expect((optionalSignal as AbortSignal | null)?.aborted).toBe(true);
    resolveOptional(Response.json({ secret: 'scope-a' }));

    const rejection = await observedRequest;
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
  });

  it('rejects response body bytes that complete after the authorization scope changed', async () => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-before-switch',
          refreshToken: 'refresh-before-switch',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      if (url.endsWith('/api/protected')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            bodyController = controller;
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      if (url.endsWith('/auth/tenants/switch')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-after-switch',
          refreshToken: 'refresh-after-switch',
          activeTenant: tenantSummary('ten_b', 'member'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    const response = await client.fetchWithAuth('http://zero.test/api/protected');
    const staleBody = response.json();
    await Promise.resolve();

    await client.switchTenant('ten_b');
    bodyController.enqueue(encoder.encode(JSON.stringify({ secret: 'old-tenant-data' })));
    bodyController.close();

    await expect(staleBody).rejects.toThrow(
      'Discarded a response from a previous authorization scope',
    );
  });

  it('cancels a registered non-fetch transport when a scope transition begins', async () => {
    const lifecycle = createTestScopeLifecycle();
    let transportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      transportStarted = resolve;
    });
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-before-switch',
          refreshToken: 'refresh-before-switch',
          activeTenant: tenantSummary('ten_a', 'owner'),
        });
      }
      if (url.endsWith('/auth/tenants/switch')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-after-switch',
          refreshToken: 'refresh-after-switch',
          activeTenant: tenantSummary('ten_b', 'member'),
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    const request = client.requestWithAuthTransport(async (_token, _assert, signal) => {
      transportStarted();
      return new Promise<{ status: number }>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    await Promise.race([
      started,
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('transport did not start')),
        250,
      )),
    ]);
    let rejection: unknown;
    const observedRequest = request.then(
      () => undefined,
      (error) => {
        rejection = error;
      },
    );

    await Promise.race([
      client.switchTenant('ten_b'),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('tenant switch did not finish')),
        250,
      )),
    ]);
    await observedRequest;
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
  });

  it('carries an optional native continuation on password recovery', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    });

    const continuation = `/auth/oauth/authorize?request_id=${'r'.repeat(43)}`;
    const client = new AuthClient('http://zero.test');
    await client.forgotPassword('ada@example.com', continuation);

    expect(requests[0]!.url).toBe('http://zero.test/auth/forgot-password');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      email: 'ada@example.com',
      nativeContinuation: continuation,
    });
  });

  it('carries an optional native continuation on verification resend', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    });

    const continuation = `/auth/oauth/authorize?request_id=${'r'.repeat(43)}`;
    const client = new AuthClient('http://zero.test');
    await client.resendVerificationEmail('ada@example.com', continuation);

    expect(requests[0]!.url).toBe('http://zero.test/auth/resend-verification');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      email: 'ada@example.com',
      nativeContinuation: continuation,
    });
  });

  it('does not persist a session when registration requires email verification', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/register')) {
        return Response.json({
          user: {
            ...authUser(),
            emailVerifiedAt: null,
            emailVerificationRequired: true,
            mfaRequired: false,
          },
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.register({
      username: 'ada',
      email: 'ada@example.com',
      password: 'password123',
    });

    expect(isAuthEmailVerificationRequiredResult(result)).toBe(true);
    if (!isAuthEmailVerificationRequiredResult(result)) {
      throw new Error('Expected an email-verification continuation result.');
    }
    const pendingVerification: AuthEmailVerificationRequiredResult = result;
    expect(pendingVerification.user.emailVerifiedAt).toBeNull();
    expect(result.user.emailVerificationRequired).toBe(true);
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });

  it('carries the operator setup secret only when the caller supplies it', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({
        user: authUser(),
        accessToken: 'bootstrap-access',
        refreshToken: 'bootstrap-refresh',
        tenant: {
          tenantId: 'ten_acme',
          kind: 'administration',
          membershipId: 'tmem_owner',
          slug: 'acme-health',
          name: 'Acme Health',
          role: 'owner',
        },
      });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.register({
      username: 'operator',
      email: 'operator@example.com',
      password: 'password123',
      bootstrapSecret: 'operator-bootstrap-secret-with-32-plus-characters',
      organizationName: 'Acme Health',
    });

    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      username: 'operator',
      email: 'operator@example.com',
      password: 'password123',
      bootstrapSecret: 'operator-bootstrap-secret-with-32-plus-characters',
      organizationName: 'Acme Health',
    });
    expect(result.tenant).toEqual({
      tenantId: 'ten_acme',
      kind: 'administration',
      membershipId: 'tmem_owner',
      slug: 'acme-health',
      name: 'Acme Health',
      role: 'owner',
    });
  });

  it('persists a session after email verification succeeds', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/verify-email')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-verified',
          refreshToken: 'refresh-verified',
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.verifyEmail('verification-token');

    expect(requests[0]!.url).toBe('http://zero.test/auth/verify-email');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      token: 'verification-token',
    });
    expect(result.user.emailVerificationRequired).toBe(false);
    expect(client.isAuthenticated).toBe(true);
    expect(client.accessToken).toBe('access-verified');
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-verified');
    }
  });

  it('does not persist a session while MFA setup is required', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: { ...authUser(), mfaRequired: true },
          mfaSetupRequired: true,
          mfaSetupToken: 'setup-token',
          mfa: {
            methods: ['totp', 'email'],
            allowUserChoice: true,
          },
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.login('ada', 'password');

    expect('mfaSetupRequired' in result && result.mfaSetupRequired).toBe(true);
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });

  it('carries the originating session when profile MFA setup is verified', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'profile-session-access',
          refreshToken: 'profile-session-refresh',
        });
      }
      if (url.endsWith('/auth/mfa/setup/verify')) {
        return Response.json({
          ok: true,
          method: mfaMethod(),
          methods: [mfaMethod()],
        });
      }
      return Response.json({ error: 'Unexpected request' }, { status: 500 });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    const result = await client.verifyMfaSetup({
      verificationToken: 'profile-verification-token',
      code: '123456',
    });

    expect(requests[1]!.url).toBe('http://zero.test/auth/mfa/setup/verify');
    expect(new Headers(requests[1]!.init?.headers).get('Authorization'))
      .toBe('Bearer profile-session-access');
    expect(result).toMatchObject({ ok: true, method: { methodId: 'mfa-1' } });
    expect(client.accessToken).toBe('profile-session-access');
  });

  it('persists a session after MFA challenge verification succeeds', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/mfa/challenge/verify')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-mfa',
          refreshToken: 'refresh-mfa',
          method: mfaMethod(),
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    const result = await client.verifyMfaChallenge({
      challengeToken: 'challenge-token',
      code: '123456',
    });

    expect(requests[0]!.url).toBe('http://zero.test/auth/mfa/challenge/verify');
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      challengeToken: 'challenge-token',
      code: '123456',
    });
    expect('accessToken' in result && result.accessToken).toBe('access-mfa');
    expect(client.isAuthenticated).toBe(true);
    expect(client.accessToken).toBe('access-mfa');
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-mfa');
    }
  });

  it('refreshes an expired access token and retries authenticated requests', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });

      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
        });
      }

      if (url.endsWith('/api/protected') && requests.filter((r) => r.url.endsWith('/api/protected')).length === 1) {
        return new Response(JSON.stringify({ error: 'Expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/auth/refresh')) {
        return Response.json({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          activeTenant: tenantSummary('ten_refreshed', 'member'),
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    const response = await client.fetchWithAuth('http://zero.test/api/protected');

    expect(response.ok).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      'http://zero.test/auth/login',
      'http://zero.test/api/protected',
      'http://zero.test/auth/refresh',
      'http://zero.test/api/protected',
    ]);
    expect(new Headers(requests[1]!.init?.headers).get('authorization')).toBe(
      'Bearer access-1',
    );
    expect(new Headers(requests[3]!.init?.headers).get('authorization')).toBe(
      'Bearer access-2',
    );
    expect(client.isAuthenticated).toBe(true);
    expect(client.activeTenant).toEqual(tenantSummary('ten_refreshed', 'member'));
  });

  it('refuses to send required or optional browser credentials to another origin', async () => {
    const requests: string[] = [];
    mockFetch((url) => {
      requests.push(url);
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-private',
          refreshToken: 'refresh-private',
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('https://zero.test/platform');
    await client.login('ada', 'password');

    await expect(
      client.fetchWithAuth('https://attacker.example/collect'),
    ).rejects.toMatchObject({
      code: 'AUTH_REQUEST_ORIGIN_MISMATCH',
      status: 0,
    });
    await expect(
      client.fetchWithOptionalAuth('https://attacker.example/collect'),
    ).rejects.toMatchObject({
      code: 'AUTH_REQUEST_ORIGIN_MISMATCH',
      status: 0,
    });

    expect(requests).toEqual(['https://zero.test/platform/auth/login']);
  });

  it('resolves relative authenticated requests against the configured base path', async () => {
    const requests: string[] = [];
    mockFetch((url) => {
      requests.push(url);
      return Response.json({ ok: true });
    });

    const client = new AuthClient('https://zero.test/platform');
    await client.fetchWithOptionalAuth('api/relative');
    await client.fetchWithOptionalAuth('/api/root');
    await client.fetchWithOptionalAuth('https://zero.test/api/absolute');

    expect(requests).toEqual([
      'https://zero.test/platform/api/relative',
      'https://zero.test/api/root',
      'https://zero.test/api/absolute',
    ]);
  });

  it('keeps the lower session fetch boundary origin-bound', async () => {
    let requests = 0;
    mockFetch(() => {
      requests += 1;
      return Response.json({ ok: true });
    });
    const session = new AuthSessionController('https://zero.test/platform');

    try {
      await expect(
        session.fetchWithAuth('https://attacker.example/collect'),
      ).rejects.toMatchObject({ code: 'AUTH_REQUEST_ORIGIN_MISMATCH' });
      await expect(
        session.fetchWithOptionalAuth('https://attacker.example/collect'),
      ).rejects.toMatchObject({ code: 'AUTH_REQUEST_ORIGIN_MISMATCH' });
      expect(requests).toBe(0);
    } finally {
      session.dispose();
    }
  });

  it('serializes persisted refresh-token rotation across concurrent clients', async () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'refresh-0');
    const rotatedTokens: string[] = [];

    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        const token = JSON.parse(String(init?.body)).refreshToken as string;
        rotatedTokens.push(token);
        const sequence = rotatedTokens.length;
        return Response.json({
          accessToken: `access-${sequence}`,
          refreshToken: `refresh-${sequence}`,
        });
      }

      if (url.endsWith('/auth/me')) return Response.json(authUser());
      return Response.json({ ok: true });
    });

    const first = new AuthClient('http://zero.test');
    const second = new AuthClient('http://zero.test/');

    await Promise.all([first.refresh(), second.refresh()]);
    await Promise.all([
      waitForAuthenticated(first),
      waitForAuthenticated(second),
    ]);

    expect(rotatedTokens).toEqual(['refresh-0', 'refresh-1']);
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-2');
    expect(first.isAuthenticated).toBe(true);
    expect(second.isAuthenticated).toBe(true);
  });

  it('replaces an existing bearer header case-insensitively', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-current',
          refreshToken: 'refresh-current',
        });
      }
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    await client.fetchWithAuth('http://zero.test/api/protected', {
      headers: new Headers({
        authorization: 'Bearer stale',
        'x-request-id': 'request-1',
      }),
    });

    const headers = new Headers(requests[1]!.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer access-current');
    expect(headers.get('x-request-id')).toBe('request-1');
  });

  it('clears auth state when refresh is rejected', async () => {
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
        });
      }

      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ error: 'Invalid refresh token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    lifecycle.events.length = 0;

    const response = await client.fetchWithAuth('http://zero.test/api/protected');

    expect(response.status).toBe(401);
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    expect(lifecycle.events).toEqual(['begin', 'complete']);
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });

  it('runs explicit revision-fenced expiry through the scope purge barrier', async () => {
    const lifecycle = createTestScopeLifecycle();
    mockFetch((url) => url.endsWith('/auth/login')
      ? Response.json({
          user: authUser(),
          accessToken: 'access-expire',
          refreshToken: 'refresh-expire',
          activeTenant: tenantSummary('ten_a', 'owner'),
        })
      : Response.json({ ok: true }));
    const client = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });
    await client.login('ada', 'password');
    lifecycle.events.length = 0;

    client.expireSession();
    await waitForCondition(() => !client.isAuthenticated);

    expect(client.accessToken).toBeNull();
    expect(lifecycle.events).toEqual(['begin', 'complete']);
  });

  it('notifies the server on logout even without a local refresh token', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.logout();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('http://zero.test/auth/logout');
    expect(requests[0]!.init?.method).toBe('POST');
  });

  it('includes the current refresh token when notifying the server on logout', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-logout',
          refreshToken: 'refresh-logout',
        });
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');
    await client.logout();

    expect(requests.map((request) => request.url)).toEqual([
      'http://zero.test/auth/login',
      'http://zero.test/auth/logout',
    ]);
    expect(requests[1]!.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      refreshToken: 'refresh-logout',
    });
  });

  it('waits for the logout response before clearing auth state and completing', async () => {
    let resolveLogout!: (response: Response) => void;
    const logoutResponse = new Promise<Response>((resolve) => {
      resolveLogout = resolve;
    });

    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-pending-logout',
          refreshToken: 'refresh-pending-logout',
        });
      }

      if (url.endsWith('/auth/logout')) return logoutResponse;
      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');

    let completed = false;
    const logout = client.logout().then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(client.isAuthenticated).toBe(true);
    expect(client.accessToken).toBe('access-pending-logout');
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-pending-logout');
    }

    resolveLogout(Response.json({ ok: true }));
    await logout;

    expect(completed).toBe(true);
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });

  it('clears local auth state when the logout request fails', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          accessToken: 'access-failed-logout',
          refreshToken: 'refresh-failed-logout',
        });
      }

      if (url.endsWith('/auth/logout')) {
        return Promise.reject(new Error('Network unavailable'));
      }

      return Response.json({ ok: true });
    });

    const client = new AuthClient('http://zero.test');
    await client.login('ada', 'password');

    await expect(client.logout()).resolves.toBeUndefined();

    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
    if (typeof localStorage !== 'undefined') {
      expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull();
    }
  });
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function waitForCondition(predicate: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return predicate();
}

function applicationAccessUser(userId: string) {
  return {
    identity: {
      userId,
      username: 'ada',
      email: 'ada@example.com',
      firstName: null,
      lastName: null,
    },
    status: 'active',
    roles: ['reader'],
    roleRevision: 'application:application:2',
    createdAt: 1,
    updatedAt: null,
  };
}

async function waitForAuthenticated(client: AuthClient): Promise<void> {
  if (client.isAuthenticated) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = client.subscribe(() => {
      if (!client.isAuthenticated) return;
      unsubscribe();
      resolve();
    });
  });
}

function authUser() {
  return {
    userId: 'u_1',
    username: 'ada',
    email: 'ada@example.com',
    firstName: null,
    lastName: null,
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: 1,
    emailVerificationRequired: false,
    mfaRequired: false,
    properties: {},
    createdAt: 1,
    updatedAt: null,
  };
}

function mfaMethod() {
  return {
    methodId: 'mfa-1',
    type: 'totp',
    label: 'Authenticator',
    status: 'active',
    isPrimary: true,
    createdAt: 1,
    verifiedAt: 1,
    lastUsedAt: null,
  };
}

function tenantSummary(tenantId: string, role: string) {
  return {
    tenantId,
    kind: 'organization' as const,
    slug: tenantId.replace('ten_', ''),
    name: `Tenant ${tenantId}`,
    role,
  };
}

function createTestScopeLifecycle(): {
  api: AuthAuthorizationScopeLifecycle;
  events: string[];
} {
  let epoch = 0;
  let transition = false;
  const events: string[] = [];
  const requestCancellations = new Map<number, Set<() => void>>();
  return {
    events,
    api: {
      beginTransition() {
        if (transition) throw new Error('transition already active');
        transition = true;
        epoch += 1;
        for (const cancellations of requestCancellations.values()) {
          for (const cancel of cancellations) cancel();
        }
        requestCancellations.clear();
        events.push('begin');
      },
      completeTransition() {
        transition = false;
        events.push('complete');
      },
      abortTransition() {
        transition = false;
        events.push('abort');
      },
      beginRequest() {
        if (transition) throw new Error('scope transition active');
        return epoch;
      },
      assertRequestCurrent(requestEpoch) {
        if (transition || requestEpoch !== epoch) {
          throw new Error(
            '[client] Discarded a response from a previous authorization scope.',
          );
        }
      },
      registerRequestCancellation(requestEpoch, cancel) {
        if (transition || requestEpoch !== epoch) {
          throw new Error('cannot register a stale request');
        }
        let cancellations = requestCancellations.get(requestEpoch);
        if (!cancellations) {
          cancellations = new Set();
          requestCancellations.set(requestEpoch, cancellations);
        }
        cancellations.add(cancel);
        return () => {
          cancellations?.delete(cancel);
          if (cancellations?.size === 0) requestCancellations.delete(requestEpoch);
        };
      },
    },
  };
}
