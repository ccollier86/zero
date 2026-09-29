import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { decodeJwt } from 'jose';
import { Elysia, type AnyElysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { resolveSyncAuthContext } from '../../sync/sync-auth';
import { createAuthMiddleware } from '../auth.middleware';
import type { AuthRuntime } from '../auth-runtime';
import { createAuthPlugin } from '../auth.plugin';
import { derivePkceS256Challenge } from '../native';
import { generateTotpCode } from '../mfa-totp';
import { PAGE_SESSION_COOKIE_NAME } from '../page-session';

const CLIENT_ID = 'com.example.native-tenant';
const OTHER_CLIENT_ID = 'com.example.other-native';
const REDIRECT_URI = `${CLIENT_ID}:/oauth/callback`;
const VERIFIER = 'v'.repeat(64);

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
  issuer: string;
}

interface JsonResult {
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

describe('tenant-bound native sessions', () => {
  test('binds consent and authorization codes to the displayed tenant authority', async () => {
    const harness = await start('multi');
    const setup = await tenantSessions(harness, 'consent');

    const pending = await beginAuthorization(harness, setup.cookieA);
    expect(pending.status).toBe(200);
    const requestId = hidden(await pending.text(), 'request_id');

    const swapped = await approve(harness, requestId, setup.cookieB);
    expect(swapped.status).toBe(302);
    expect(new URL(swapped.headers.get('location')!).searchParams.get('error'))
      .toBe('access_denied');

    const approved = await approve(harness, requestId, setup.cookieA);
    const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
    const membership = harness.runtime.getTenancyService()!
      .getMembership(setup.tenantA, setup.userId)!;
    harness.runtime.getTenancyService()!
      .bumpMembershipAuthorizationGeneration(membership.membershipId);
    const rejected = await exchangeCode(harness, code);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('invalid_grant');
  }, 60_000);

  test('lists and switches with refresh proof while invalidating old HTTP and Sync access', async () => {
    const harness = await start('multi');
    const setup = await tenantSessions(harness, 'switch');
    const first = await authorizeAndExchange(harness, setup.cookieA);
    const firstFamily = String(decodeJwt(first.body.access_token).sid);
    expect(first.body.active_tenant).toMatchObject({ tenantId: setup.tenantA });
    expect(await nativeContext(harness, first.body.access_token)).toMatchObject({
      userId: setup.userId,
      tenantId: setup.tenantA,
      sessionScopeKind: 'tenant',
    });

    const bearerOnly = await fetch(`${harness.issuer}/oauth/tenants`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${first.body.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ client_id: CLIENT_ID }),
    });
    expect(bearerOnly.status).toBe(401);
    expect((await bearerOnly.json() as any).error).toBe('invalid_client');

    const wrongApplication = await tenantForm(harness, '/oauth/tenants', {
      refresh_token: first.body.refresh_token,
      client_id: OTHER_CLIENT_ID,
    });
    expect(wrongApplication.status).toBe(400);
    expect(wrongApplication.body.error).toBe('invalid_grant');

    const listed = await tenantForm(harness, '/oauth/tenants', {
      refresh_token: first.body.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.activeTenantId).toBe(setup.tenantA);
    expect(listed.body.tenants).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: setup.tenantA, role: 'owner' }),
      expect.objectContaining({ tenantId: setup.tenantB, role: 'member' }),
    ]));

    const switched = await tenantForm(harness, '/oauth/tenants/switch', {
      refresh_token: first.body.refresh_token,
      client_id: CLIENT_ID,
      tenant_id: setup.tenantB,
    }, { 'x-request-id': 'native-tenant-switch-request' });
    expect(switched.status).toBe(200);
    expect(switched.body.active_tenant).toMatchObject({
      tenantId: setup.tenantB,
      role: 'member',
    });
    expect(String(decodeJwt(switched.body.access_token).sid)).not.toBe(firstFamily);
    expect(await nativeContext(harness, first.body.access_token)).toEqual({ anonymous: true });
    expect((await nativeSync(harness, first.body.access_token)).ok).toBe(false);
    expect(await nativeContext(harness, switched.body.access_token)).toMatchObject({
      tenantId: setup.tenantB,
      tenantRole: 'member',
    });
    expect(harness.runtime.getAuditService()!.listTenant(setup.tenantB, {
      action: 'session.tenant-switched',
    }).events).toContainEqual(expect.objectContaining({
      actorUserId: setup.userId,
      actorSessionId: firstFamily,
      actorSessionKind: 'native',
      actorClientId: CLIENT_ID,
      requestId: 'native-tenant-switch-request',
      targetId: String(decodeJwt(switched.body.access_token).sid),
    }));

    const replay = await tenantForm(harness, '/oauth/tenants/switch', {
      refresh_token: first.body.refresh_token,
      client_id: CLIENT_ID,
      tenant_id: setup.tenantB,
    });
    expect(replay.status).toBe(400);
    expect(await nativeContext(harness, switched.body.access_token)).toMatchObject({
      tenantId: setup.tenantB,
    });

    const input = {
      refresh_token: switched.body.refresh_token as string,
      client_id: CLIENT_ID,
      tenant_id: setup.tenantA,
    };
    const races = await Promise.all([
      tenantForm(harness, '/oauth/tenants/switch', input),
      tenantForm(harness, '/oauth/tenants/switch', input),
    ]);
    expect(races.map((result) => result.status).sort()).toEqual([200, 400]);
    const winner = races.find((result) => result.status === 200)!;
    expect(await nativeContext(harness, winner.body.access_token)).toMatchObject({
      tenantId: setup.tenantA,
    });

    const beforeSuspension = await tenantForm(harness, '/oauth/tenants/switch', {
      refresh_token: winner.body.refresh_token,
      client_id: CLIENT_ID,
      tenant_id: setup.tenantB,
    });
    expect(beforeSuspension.status).toBe(200);
    const membershipB = harness.runtime.getTenancyService()!
      .getMembership(setup.tenantB, setup.userId)!;
    harness.runtime.getTenancyService()!.suspendMembership(membershipB.membershipId);
    expect(await nativeContext(harness, beforeSuspension.body.access_token))
      .toEqual({ anonymous: true });
    expect((await nativeSync(harness, beforeSuspension.body.access_token)).ok).toBe(false);
    const suspendedRefresh = await oauthToken(harness, {
      grant_type: 'refresh_token',
      refresh_token: beforeSuspension.body.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(suspendedRefresh.status).toBe(400);
    expect(suspendedRefresh.body.error).toBe('invalid_grant');
  }, 60_000);

  test('keeps single-tenant native sessions application-scoped and tenant APIs additive', async () => {
    const harness = await start('single');
    const registered = await json(harness, '/auth/register', {
      username: 'single-native',
      email: 'single-native@example.test',
      password: 'password123',
    });
    const cookie = pageCookie(registered.headers);
    const native = await authorizeAndExchange(harness, cookie);
    expect(native.status).toBe(200);
    expect(native.body.active_tenant).toBeUndefined();
    expect(await nativeContext(harness, native.body.access_token)).toMatchObject({
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    });
    const listed = await tenantForm(harness, '/oauth/tenants', {
      refresh_token: native.body.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ activeTenantId: null, tenants: [] });
  }, 60_000);

  test('carries verified MFA assurance into native families and invalidates unassured families live', async () => {
    const harness = await start('multi', { mfaPolicy: 'admin-required' });

    const bootstrap = await json(harness, '/auth/register', {
      username: 'native-assurance-admin',
      email: 'native-assurance-admin@example.test',
      password: 'password123',
      organizationName: 'Native Administration',
    });
    expect(bootstrap.body.mfaSetupRequired).toBe(true);
    const bootstrapSetup = await json(harness, '/auth/mfa/setup', {
      setupToken: bootstrap.body.mfaSetupToken,
      method: 'totp',
    });
    const bootstrapVerified = await json(harness, '/auth/mfa/setup/verify', {
      verificationToken: bootstrapSetup.body.verificationToken,
      code: generateTotpCode({ secret: bootstrapSetup.body.totp.secret }),
    });
    expect(bootstrapVerified.body.activeTenant.kind).toBe('administration');

    const customer = await json(harness, '/auth/register', {
      username: 'native-assurance-customer',
      email: 'native-assurance-customer@example.test',
      password: 'password123',
      organizationName: 'Native Customer',
    });
    const unassuredNative = await authorizeAndExchange(
      harness,
      pageCookie(customer.headers),
    );
    expect(unassuredNative.status).toBe(200);
    expect(await nativeContext(harness, unassuredNative.body.access_token)).toMatchObject({
      userId: customer.body.user.userId,
      tenantKind: 'organization',
    });

    harness.runtime.getTenancyService()!.addMembership({
      tenantId: bootstrap.body.tenant.tenantId,
      userId: customer.body.user.userId,
      roleKey: 'administrator',
      createdBy: bootstrap.body.user.userId,
    });
    expect(await nativeContext(harness, unassuredNative.body.access_token))
      .toEqual({ anonymous: true });
    const rejectedRefresh = await oauthToken(harness, {
      grant_type: 'refresh_token',
      refresh_token: unassuredNative.body.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(rejectedRefresh.status).toBe(400);
    expect(rejectedRefresh.body.error).toBe('invalid_grant');

    const login = await json(harness, '/auth/login', {
      username: 'native-assurance-customer',
      password: 'password123',
    });
    expect(login.body.mfaSetupRequired).toBe(true);
    const setup = await json(harness, '/auth/mfa/setup', {
      setupToken: login.body.mfaSetupToken,
      method: 'totp',
    });
    const verified = await json(harness, '/auth/mfa/setup/verify', {
      verificationToken: setup.body.verificationToken,
      code: generateTotpCode({ secret: setup.body.totp.secret }),
    });
    expect(verified.body.tenantSelectionRequired).toBe(true);
    const selected = await json(harness, '/auth/tenants/select', {
      continuation: verified.body.tenantSelection.continuation,
      tenantId: bootstrap.body.tenant.tenantId,
    });
    const assuredNative = await authorizeAndExchange(
      harness,
      pageCookie(selected.headers),
    );
    expect(assuredNative.status).toBe(200);
    const assuredContext = await nativeContext(harness, assuredNative.body.access_token);
    expect(assuredContext).toMatchObject({
      userId: customer.body.user.userId,
      tenantKind: 'administration',
      mfaVerifiedAt: expect.any(Number),
    });
    const assuredFamily = String(decodeJwt(assuredNative.body.access_token).sid);
    expect(harness.db.prepare(`SELECT mfa_verified_at FROM _auth_native_sessions
      WHERE family_id = ? AND consumed_at IS NULL`).get(assuredFamily)).toEqual({
      mfa_verified_at: assuredContext.mfaVerifiedAt,
    });

    const rotated = await oauthToken(harness, {
      grant_type: 'refresh_token',
      refresh_token: assuredNative.body.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(rotated.status).toBe(200);
    expect(await nativeContext(harness, rotated.body.access_token)).toMatchObject({
      mfaVerifiedAt: assuredContext.mfaVerifiedAt,
    });
  }, 60_000);
});

async function start(
  mode: 'single' | 'multi',
  options: { mfaPolicy?: 'required' | 'admin-required' } = {},
): Promise<Harness> {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const issuer = `${url}/auth`;
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia()
    .use(createAuthPlugin({
      db,
      tenancy: mode,
      bootstrap: 'public',
      registration: { mode: 'public' },
      ...(options.mfaPolicy ? {
        mfa: {
          enabled: true,
          policy: options.mfaPolicy,
          methods: ['totp' as const],
          totp: {
            issuer: 'Native Tenant Tests',
            encryptionKey: 'native-tenant-test-encryption-key',
          },
        },
      } : {}),
      nativeIssuer: issuer,
      nativeAudience: url,
      nativeApps: { clients: [
        { clientId: CLIENT_ID, name: 'Tenant Native', redirectUris: [REDIRECT_URI] },
        {
          clientId: OTHER_CLIENT_ID,
          name: 'Other Native',
          redirectUris: [`${OTHER_CLIENT_ID}:/oauth/callback`],
        },
      ] },
      onRuntimeCreated(created) { runtime = created; },
    }))
    .use(createAuthMiddleware(() => runtime?.getTokenService() ?? null))
    .get('/api/native-context', ({ authContext }: any) => authContext ?? { anonymous: true });
  app.listen(port);
  const created = runtime as AuthRuntime | null;
  if (!created) throw new Error('Auth runtime was not created');
  const harness = { app, db, runtime: created, url, issuer };
  active.push(harness);
  const deadline = Date.now() + 2_000;
  while (!created.getTokenService() || !created.getStore()) {
    if (Date.now() > deadline) throw new Error('Auth runtime did not start');
    await Bun.sleep(5);
  }
  return harness;
}

async function tenantSessions(harness: Harness, prefix: string) {
  const owner = await json(harness, '/auth/register', {
    username: `${prefix}-owner`,
    email: `${prefix}-owner@example.test`,
    password: 'password123',
    organizationName: `${prefix} A`,
  });
  const other = await json(harness, '/auth/register', {
    username: `${prefix}-other`,
    email: `${prefix}-other@example.test`,
    password: 'password123',
    organizationName: `${prefix} B`,
  });
  const tenantA = owner.body.tenant.tenantId as string;
  const tenantB = other.body.tenant.tenantId as string;
  const userId = owner.body.user.userId as string;
  harness.runtime.getTenancyService()!.addMembership({
    tenantId: tenantB,
    userId,
    roleKey: 'member',
    createdBy: other.body.user.userId,
  });
  const cookieA = await selectedCookie(harness, `${prefix}-owner`, tenantA);
  const cookieB = await selectedCookie(harness, `${prefix}-owner`, tenantB);
  return { tenantA, tenantB, userId, cookieA, cookieB };
}

async function selectedCookie(harness: Harness, username: string, tenantId: string) {
  const login = await json(harness, '/auth/login', {
    username,
    password: 'password123',
  });
  expect(login.body.tenantSelectionRequired).toBe(true);
  const selected = await json(harness, '/auth/tenants/select', {
    continuation: login.body.tenantSelection.continuation,
    tenantId,
  });
  expect(selected.status).toBe(200);
  return pageCookie(selected.headers);
}

async function beginAuthorization(harness: Harness, cookie: string) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email',
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    code_challenge: await derivePkceS256Challenge(VERIFIER),
    code_challenge_method: 'S256',
  });
  return fetch(`${harness.issuer}/oauth/authorize?${query}`, {
    redirect: 'manual',
    headers: { Cookie: cookieHeader(cookie) },
  });
}

function approve(harness: Harness, requestId: string, cookie: string) {
  return fetch(`${harness.issuer}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: cookieHeader(cookie),
      Origin: harness.url,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ request_id: requestId, decision: 'approve' }),
  });
}

async function authorizeAndExchange(harness: Harness, cookie: string) {
  const pending = await beginAuthorization(harness, cookie);
  const requestId = hidden(await pending.text(), 'request_id');
  const approved = await approve(harness, requestId, cookie);
  const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
  return exchangeCode(harness, code);
}

function exchangeCode(harness: Harness, code: string) {
  return oauthToken(harness, {
    grant_type: 'authorization_code',
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
}

async function oauthToken(harness: Harness, fields: Record<string, string>) {
  return tenantForm(harness, '/oauth/token', fields);
}

async function tenantForm(
  harness: Harness,
  path: string,
  fields: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<JsonResult> {
  const response = await fetch(`${harness.issuer}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    },
    body: new URLSearchParams(fields),
  });
  return { status: response.status, body: await response.json() as any, headers: response.headers };
}

async function json(
  harness: Harness,
  path: string,
  body: Record<string, unknown>,
): Promise<JsonResult> {
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any, headers: response.headers };
}

function nativeContext(harness: Harness, accessToken: string): Promise<any> {
  return fetch(`${harness.url}/api/native-context`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((response) => response.json());
}

function nativeSync(harness: Harness, accessToken: string) {
  return resolveSyncAuthContext(accessToken, {
    required: true,
    getTokenVerifier: () => harness.runtime.getTokenService(),
  });
}

function pageCookie(headers: Headers): string {
  const match = (headers.get('set-cookie') ?? '').match(
    new RegExp(`${PAGE_SESSION_COOKIE_NAME}=([^;]*)`),
  );
  if (!match) throw new Error('Expected page-session cookie');
  return decodeURIComponent(match[1]!);
}

function cookieHeader(token: string) {
  return `${PAGE_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function hidden(html: string, name: string): string {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1]!;
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No port'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
