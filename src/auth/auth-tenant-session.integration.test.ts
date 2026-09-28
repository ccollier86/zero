import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { AuthSessionContinuationStore } from './auth-session-continuation-store';
import { createAuthPlugin } from './auth.plugin';
import { generateTotpCode } from './mfa-totp';
import { PAGE_SESSION_COOKIE_NAME } from './page-session';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
}

interface JsonResponse {
  status: number;
  body: Record<string, any>;
  headers: Headers;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

async function start(options: { mfa?: boolean } = {}): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy: 'multi',
    bootstrap: 'public',
    registration: { mode: 'public' },
    ...(options.mfa ? {
      mfa: {
        enabled: true,
        policy: 'required' as const,
        methods: ['totp' as const],
        totp: {
          issuer: 'Tenant Session Tests',
          encryptionKey: 'tenant-session-test-encryption-key',
        },
      },
    } : {}),
    onRuntimeCreated(created) {
      runtime = created;
    },
  }));
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const harness = {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  const deadline = Date.now() + 2_000;
  while (!createdRuntime.getStore() || !createdRuntime.getTokenService()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for auth runtime startup');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return harness;
}

async function post(
  harness: Harness,
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<JsonResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
    headers: response.headers,
  };
}

function register(harness: Harness, key: string) {
  return post(harness, '/auth/register', {
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
    organizationName: `${key} organization`,
  });
}

function login(harness: Harness, key: string, cookie?: string) {
  return post(harness, '/auth/login', {
    username: key,
    password: 'password123',
  }, cookie);
}

function activeSessionCount(db: ReactiveDB): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count FROM _auth_sessions WHERE status = 'active'
  `).get() as { count: number }).count;
}

function pageToken(headers: Headers): string {
  const setCookie = headers.get('set-cookie') ?? '';
  const match = setCookie.match(new RegExp(`${PAGE_SESSION_COOKIE_NAME}=([^;]*)`));
  if (!match) throw new Error('Expected a page-session cookie');
  return decodeURIComponent(match[1]!);
}

function cookie(token: string): string {
  return `${PAGE_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

describe('multi-tenant browser session completion', () => {
  test('returns onboarding for zero memberships, auto-binds one, and selects among many', async () => {
    const harness = await start();
    const store = harness.runtime.getStore()!;
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;

    const installation = await register(harness, 'installation-owner');
    expect(installation.status).toBe(200);
    await store.createUser({
      username: 'no-tenant',
      email: 'no-tenant@example.test',
      password: 'password123',
    });
    const beforeZero = activeSessionCount(harness.db);
    const zero = await login(harness, 'no-tenant');
    expect(zero.status).toBe(200);
    expect(zero.body).toMatchObject({
      tenantOnboardingRequired: true,
      onboarding: { reason: 'no_active_tenant_membership' },
    });
    expect(zero.body.accessToken).toBeUndefined();
    expect(zero.body.refreshToken).toBeUndefined();
    expect(activeSessionCount(harness.db)).toBe(beforeZero);

    const owner = await register(harness, 'selection-owner');
    expect(owner.status).toBe(200);
    const one = await login(harness, 'selection-owner');
    expect(one.status).toBe(200);
    expect(one.body.activeTenant.tenantId).toBe(owner.body.tenant.tenantId);
    await expect(tokens.resolveAuthContext(one.body.accessToken)).resolves.toMatchObject({
      tenantId: owner.body.tenant.tenantId,
      membershipId: owner.body.tenant.membershipId,
    });

    const other = await register(harness, 'selection-other');
    tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });

    const beforeMany = activeSessionCount(harness.db);
    const many = await login(harness, 'selection-owner');
    expect(many.status).toBe(200);
    expect(many.body.tenantSelectionRequired).toBe(true);
    expect(many.body.tenantSelection.tenants).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: owner.body.tenant.tenantId, role: 'owner' }),
      expect.objectContaining({ tenantId: other.body.tenant.tenantId, role: 'member' }),
    ]));
    expect(many.body.accessToken).toBeUndefined();
    expect(many.body.refreshToken).toBeUndefined();
    expect(activeSessionCount(harness.db)).toBe(beforeMany);

    const raw = many.body.tenantSelection.continuation as string;
    const persisted = harness.db.prepare(`
      SELECT token_hash, purpose, user_id, application_id
      FROM _auth_session_continuations
      WHERE purpose = 'tenant_selection'
    `).get() as Record<string, unknown>;
    expect(persisted).toMatchObject({
      purpose: 'tenant_selection',
      user_id: owner.body.user.userId,
    });
    expect(persisted.token_hash).not.toBe(raw);
    expect(String(persisted.token_hash)).not.toContain(raw);
    expect(new AuthSessionContinuationStore(harness.db, {
      applicationId: 'app_wrong',
    }).inspect(raw, 'tenant_selection')).toBeNull();
    expect(harness.runtime.getAuthTenantSessionService()!.continuations
      .inspect(raw, 'not_tenant_selection' as 'tenant_selection')).toBeNull();

    const selected = await post(harness, '/auth/tenants/select', {
      continuation: raw,
      tenantId: other.body.tenant.tenantId,
    });
    expect(selected.status).toBe(200);
    expect(selected.body.activeTenant).toMatchObject({
      tenantId: other.body.tenant.tenantId,
      role: 'member',
    });
    expect(pageToken(selected.headers)).toBeString();
    await expect(tokens.resolveAuthContext(selected.body.accessToken)).resolves.toMatchObject({
      userId: owner.body.user.userId,
      tenantId: other.body.tenant.tenantId,
    });

    const replay = await post(harness, '/auth/tenants/select', {
      continuation: raw,
      tenantId: owner.body.tenant.tenantId,
    });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('TENANT_SELECTION_CONTINUATION_INVALID');
  }, 60_000);

  test('fails closed for wrong membership, expiry, suspension, replay, and concurrent use', async () => {
    const harness = await start();
    const tenancy = harness.runtime.getTenancyService()!;
    const owner = await register(harness, 'proof-owner');
    const other = await register(harness, 'proof-other');
    const outsider = await register(harness, 'proof-outsider');
    const membership = tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });

    const wrongUser = await login(harness, 'proof-owner');
    const wrongTarget = await post(harness, '/auth/tenants/select', {
      continuation: wrongUser.body.tenantSelection.continuation,
      tenantId: outsider.body.tenant.tenantId,
    });
    expect(wrongTarget.status).toBe(403);
    expect(wrongTarget.body.code).toBe('TENANT_SELECTION_INVALID');

    harness.db.prepare(`
      UPDATE _auth_session_continuations SET expires_at = ? WHERE token_hash = ?
    `).run(
      Date.now() - 1,
      hashToken(wrongUser.body.tenantSelection.continuation),
    );
    const expired = await post(harness, '/auth/tenants/select', {
      continuation: wrongUser.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    });
    expect(expired.status).toBe(401);

    const membershipProof = await login(harness, 'proof-owner');
    tenancy.suspendMembership(membership.membershipId);
    const suspendedMembership = await post(harness, '/auth/tenants/select', {
      continuation: membershipProof.body.tenantSelection.continuation,
      tenantId: other.body.tenant.tenantId,
    });
    expect(suspendedMembership.status).toBe(403);
    tenancy.reactivateMembership(membership.membershipId);

    const tenantProof = await login(harness, 'proof-owner');
    tenancy.suspendTenant(other.body.tenant.tenantId);
    const suspendedTenant = await post(harness, '/auth/tenants/select', {
      continuation: tenantProof.body.tenantSelection.continuation,
      tenantId: other.body.tenant.tenantId,
    });
    expect(suspendedTenant.status).toBe(403);
    const onlyLiveTenant = await login(harness, 'proof-owner');
    expect(onlyLiveTenant.status).toBe(200);
    expect(onlyLiveTenant.body.activeTenant.tenantId).toBe(owner.body.tenant.tenantId);
    tenancy.reactivateTenant(other.body.tenant.tenantId);

    const concurrentProof = await login(harness, 'proof-owner');
    const input = {
      continuation: concurrentProof.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    };
    const results = await Promise.all([
      post(harness, '/auth/tenants/select', input),
      post(harness, '/auth/tenants/select', input),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
  }, 60_000);

  test('lists with refresh-family proof and atomically replaces a tenant session', async () => {
    const harness = await start();
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;
    const owner = await register(harness, 'switch-owner');
    const other = await register(harness, 'switch-other');
    tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });
    const proof = await login(harness, 'switch-owner');
    const selected = await post(harness, '/auth/tenants/select', {
      continuation: proof.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    });
    const oldPage = pageToken(selected.headers);
    const oldAccess = selected.body.accessToken as string;
    const oldRefresh = selected.body.refreshToken as string;

    const deniedList = await post(harness, '/auth/tenants/list', {
      refreshToken: oldAccess,
    });
    expect(deniedList.status).toBe(401);
    const listed = await post(harness, '/auth/tenants/list', {
      refreshToken: oldRefresh,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.activeTenantId).toBe(owner.body.tenant.tenantId);
    expect(listed.body.tenants).toHaveLength(2);

    const switched = await post(harness, '/auth/tenants/switch', {
      refreshToken: oldRefresh,
      tenantId: other.body.tenant.tenantId,
    }, cookie(oldPage));
    expect(switched.status).toBe(200);
    expect(switched.body.activeTenant.tenantId).toBe(other.body.tenant.tenantId);
    const newPage = pageToken(switched.headers);
    expect(newPage).not.toBe(oldPage);
    await expect(tokens.resolveAuthContext(oldAccess)).resolves.toBeNull();
    await expect(tokens.resolvePageSessionToken(oldPage)).resolves.toBeNull();
    await expect(tokens.resolveAuthContext(switched.body.accessToken)).resolves.toMatchObject({
      tenantId: other.body.tenant.tenantId,
      sessionScopeId: other.body.tenant.tenantId,
    });
    await expect(tokens.resolvePageSessionToken(newPage)).resolves.toMatchObject({
      tenantId: other.body.tenant.tenantId,
    });

    const refreshed = await post(harness, '/auth/refresh', {
      refreshToken: switched.body.refreshToken,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.activeTenant).toMatchObject({
      tenantId: other.body.tenant.tenantId,
      role: 'member',
    });

    const replayedOldRefresh = await post(harness, '/auth/refresh', {
      refreshToken: oldRefresh,
    });
    expect(replayedOldRefresh.status).toBe(401);
    await expect(tokens.resolveAuthContext(switched.body.accessToken)).resolves.toBeNull();
    await expect(tokens.resolvePageSessionToken(newPage)).resolves.toBeNull();
  }, 60_000);

  test('does not accept a tenant-selection proof in another app runtime', async () => {
    const appA = await start();
    const appB = await start();
    const tenancyA = appA.runtime.getTenancyService()!;
    const owner = await register(appA, 'isolated-owner');
    const other = await register(appA, 'isolated-other');
    tenancyA.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });
    const proof = await login(appA, 'isolated-owner');

    const crossed = await post(appB, '/auth/tenants/select', {
      continuation: proof.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    });
    expect(crossed.status).toBe(401);
    expect(crossed.body.code).toBe('TENANT_SELECTION_CONTINUATION_INVALID');
    expect(activeSessionCount(appB.db)).toBe(0);
  }, 60_000);

  test('concurrent switch attempts cannot leave either replacement usable', async () => {
    const harness = await start();
    const tenancy = harness.runtime.getTenancyService()!;
    const tokens = harness.runtime.getTokenService()!;
    const owner = await register(harness, 'race-owner');
    const other = await register(harness, 'race-other');
    tenancy.addMembership({
      tenantId: other.body.tenant.tenantId,
      userId: owner.body.user.userId,
      roleKey: 'member',
      createdBy: other.body.user.userId,
    });
    const proof = await login(harness, 'race-owner');
    const selected = await post(harness, '/auth/tenants/select', {
      continuation: proof.body.tenantSelection.continuation,
      tenantId: owner.body.tenant.tenantId,
    });
    const input = {
      refreshToken: selected.body.refreshToken,
      tenantId: other.body.tenant.tenantId,
    };
    const results = await Promise.all([
      post(harness, '/auth/tenants/switch', input),
      post(harness, '/auth/tenants/switch', input),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    const winner = results.find((result) => result.status === 200)!;
    // The loser presented a consumed refresh credential, so the existing
    // replay policy invalidates the winner too. No concurrent caller keeps a
    // usable family after ambiguity.
    await expect(tokens.resolveAuthContext(winner.body.accessToken)).resolves.toBeNull();
    await expect(tokens.rotateRefreshToken(winner.body.refreshToken)).resolves.toBeNull();
  }, 60_000);

  test('MFA completion still requires tenant selection and emits no app session', async () => {
    const harness = await start({ mfa: true });
    const tenancy = harness.runtime.getTenancyService()!;
    const registered = await register(harness, 'mfa-tenant-owner');
    expect(registered.body.mfaSetupRequired).toBe(true);
    const setup = await post(harness, '/auth/mfa/setup', {
      setupToken: registered.body.mfaSetupToken,
      method: 'totp',
    });
    const verifiedSetup = await post(harness, '/auth/mfa/setup/verify', {
      verificationToken: setup.body.verificationToken,
      code: generateTotpCode({ secret: setup.body.totp.secret }),
    });
    expect(verifiedSetup.status).toBe(200);
    expect(verifiedSetup.body.activeTenant.tenantId).toBe(registered.body.tenant.tenantId);

    const otherUser = await harness.runtime.getStore()!.createUser({
      username: 'mfa-other-owner',
      email: 'mfa-other-owner@example.test',
      password: 'password123',
    });
    const other = tenancy.createTenant({
      slug: 'mfa-other',
      name: 'MFA Other',
      ownerUserId: otherUser.userId,
    });
    tenancy.addMembership({
      tenantId: other.tenant.tenantId,
      userId: registered.body.user.userId,
      roleKey: 'member',
      createdBy: otherUser.userId,
    });

    const loginResult = await login(harness, 'mfa-tenant-owner');
    expect(loginResult.body.mfaChallengeRequired).toBe(true);
    const before = activeSessionCount(harness.db);
    const verifiedChallenge = await post(harness, '/auth/mfa/challenge/verify', {
      challengeToken: loginResult.body.mfaChallenge.challengeToken,
      code: generateTotpCode({ secret: setup.body.totp.secret }),
    });
    expect(verifiedChallenge.status).toBe(200);
    expect(verifiedChallenge.body.tenantSelectionRequired).toBe(true);
    expect(verifiedChallenge.body.accessToken).toBeUndefined();
    expect(verifiedChallenge.body.refreshToken).toBeUndefined();
    expect(activeSessionCount(harness.db)).toBe(before);
  }, 60_000);
});

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}
