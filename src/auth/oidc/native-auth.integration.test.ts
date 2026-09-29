import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { Elysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { resolveSyncAuthContext } from '../../sync/sync-auth';
import { createAuthMiddleware } from '../auth.middleware';
import { createAuthPlugin, getAuthStore, getTokenService } from '../auth.plugin';
import { getNativeAuthorizationService } from '../auth-runtime';
import { derivePkceS256Challenge } from '../native';

const CLIENT_ID = 'com.example.zeroapp';
const REDIRECT_URI = 'com.example.zeroapp:/oauth/callback';
const VERIFIER = 'v'.repeat(64);
const STATE = 's'.repeat(43);
const NONCE = 'n'.repeat(43);

let app: any;
let db: ReactiveDB;
let baseUrl: string;
let issuer: string;
let pageCookie: string;
let webRefreshToken: string;
let webAccessToken: string;

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  issuer = `${baseUrl}/auth`;
  db = createReactiveDB({ mode: 'memory' });
  app = new Elysia()
    .use(createAuthPlugin({
      db,
      bootstrap: 'public',
      nativeIssuer: issuer,
      nativeAudience: baseUrl,
      nativeApps: {
        clients: [{
          clientId: CLIENT_ID,
          name: 'Example Desktop',
          redirectUris: [REDIRECT_URI],
          scopes: ['openid', 'profile', 'email'],
        }],
      },
    }))
    .use(createAuthMiddleware(getTokenService))
    .get('/api/native-context', ({ authContext }: any) => authContext ?? { anonymous: true })
    .get('/api/native-protected', ({ requireAuth }: any) => requireAuth())
    .get('/api/native-admin', ({ requireAdmin }: any) => requireAdmin());
  app.listen(port);

  const registered = await json('/auth/register', {
    username: 'native-user', email: 'native@example.com', password: 'password123',
    firstName: 'Native', lastName: 'User',
  });
  expect(registered.response.status).toBe(200);
  pageCookie = registered.response.headers.get('set-cookie')!.split(';', 1)[0]!;
  webRefreshToken = registered.data.refreshToken;
  webAccessToken = registered.data.accessToken;
});

afterAll(async () => {
  await app.stop();
  db.dispose();
});

describe('native OpenID Connect provider', () => {
  test('publishes discovery and completes code + PKCE into normal Zero auth', async () => {
    const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`);
    const discovery = await discoveryResponse.json() as any;
    expect(discovery).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      prompt_values_supported: ['none', 'create'],
    });
    expect(discoveryResponse.headers.get('cache-control')).toBe('no-store');

    const authorization = await beginAuthorization({ cookie: pageCookie });
    expect(authorization.status).toBe(200);
    expect(authorization.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const requestId = hiddenValue(await authorization.text(), 'request_id');

    const approved = await fetch(`${issuer}/oauth/authorize`, {
      method: 'POST', redirect: 'manual',
      headers: {
        Cookie: pageCookie,
        Origin: baseUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ request_id: requestId, decision: 'approve' }),
    });
    expect(approved.status).toBe(302);
    const callback = new URL(approved.headers.get('location')!);
    expect(callback.searchParams.get('state')).toBe(STATE);
    expect(callback.searchParams.get('iss')).toBe(issuer);

    const exchange = await token({
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code')!,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    });
    expect(exchange.response.status).toBe(200);
    expect(exchange.response.headers.get('cache-control')).toBe('no-store');
    expect(exchange.data).toMatchObject({ token_type: 'Bearer', scope: 'openid profile email' });
    expect(decodeProtectedHeader(exchange.data.access_token).typ).toBe('at+jwt');
    expect(decodeJwt(exchange.data.access_token).sid).toBeString();

    const jwks = await fetch(`${issuer}/jwks`).then((response) => response.json());
    const verifiedId = await jwtVerify(exchange.data.id_token, createLocalJWKSet(jwks as any), {
      issuer, audience: CLIENT_ID,
    });
    expect(verifiedId.payload).toMatchObject({
      nonce: NONCE, email: 'native@example.com', preferred_username: 'native-user',
    });

    const context = await fetch(`${baseUrl}/api/native-context`, {
      headers: { Authorization: `Bearer ${exchange.data.access_token}` },
    }).then((response) => response.json()) as any;
    expect(context).toMatchObject({
      email: 'native@example.com', role: 'admin', clientId: CLIENT_ID,
      sessionKind: 'native', scope: ['openid', 'profile', 'email'],
      sessionId: decodeJwt(exchange.data.access_token).sid,
    });
    for (const path of ['/api/native-protected', '/api/native-admin']) {
      const protectedResponse = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${exchange.data.access_token}` },
      });
      expect(protectedResponse.status).toBe(200);
    }
    expect((await fetch(`${baseUrl}/api/native-protected`)).status).toBe(401);
    for (const method of ['GET', 'POST']) {
      const userInfo = await fetch(`${issuer}/oauth/userinfo`, {
        method,
        headers: { Authorization: `Bearer ${exchange.data.access_token}` },
      }).then((response) => response.json()) as any;
      expect(userInfo).toMatchObject({
        sub: registeredUserId(), email: 'native@example.com',
        preferred_username: 'native-user',
      });
    }
    const idTokenAsAccess = await fetch(`${baseUrl}/api/native-context`, {
      headers: { Authorization: `Bearer ${exchange.data.id_token}` },
    }).then((response) => response.json());
    expect(idTokenAsAccess).toEqual({ anonymous: true });

    const replayedCode = await token({
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code')!, client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI, code_verifier: VERIFIER,
    });
    expect(replayedCode.response.status).toBe(400);
    expect(replayedCode.data.error).toBe('invalid_grant');

    const rotated = await token({
      grant_type: 'refresh_token', refresh_token: exchange.data.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(rotated.response.status).toBe(200);
    const refreshedId = await jwtVerify(
      rotated.data.id_token, createLocalJWKSet(jwks as any),
      { issuer, audience: CLIENT_ID }
    );
    expect(refreshedId.payload).toMatchObject({
      email: 'native@example.com', preferred_username: 'native-user',
    });
    expect(refreshedId.payload.nonce).toBeUndefined();
    expect(decodeJwt(rotated.data.access_token).sid)
      .toBe(decodeJwt(exchange.data.access_token).sid);
    expect(await nativeContext(exchange.data.access_token)).toMatchObject({
      email: 'native@example.com', sessionKind: 'native',
    });

    const replay = await token({
      grant_type: 'refresh_token', refresh_token: exchange.data.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(replay.data.error).toBe('invalid_grant');
    const revokedFamily = await token({
      grant_type: 'refresh_token', refresh_token: rotated.data.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(revokedFamily.data.error).toBe('invalid_grant');
    for (const accessToken of [exchange.data.access_token, rotated.data.access_token]) {
      const revoked = await nativeContext(accessToken);
      expect(revoked).toEqual({ anonymous: true });
      const sync = await nativeSyncContext(accessToken);
      expect(sync.ok).toBe(false);
    }

    const webSessionStillWorks = await json('/auth/refresh', { refreshToken: webRefreshToken });
    expect(webSessionStillWorks.response.status).toBe(200);

    const unknownRevocation = await fetch(`${issuer}/oauth/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'unknown-token', client_id: CLIENT_ID }),
    });
    expect(unknownRevocation.status).toBe(200);
    expect(await unknownRevocation.text()).toBe('');
    const malformedRevocation = await fetch(`${issuer}/oauth/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID }),
    });
    expect(malformedRevocation.status).toBe(400);
    expect((await malformedRevocation.json() as any).error).toBe('invalid_request');
  });

  test('registration creates a new Zero user even with an existing browser session', async () => {
    const existing = await registerNativeUser('native-signup-existing');
    const response = await beginAuthorization({
      prompt: 'create', cookie: existing.cookie, loginHint: 'native-signup@example.com',
    });
    expect(response.status).toBe(302);
    const location = response.headers.get('location')!;
    expect(location).toStartWith('/register?');
    const registrationLocation = new URL(location, baseUrl);
    const redirect = registrationLocation.searchParams.get('redirect');
    expect(redirect).toStartWith('/auth/oauth/authorize?request_id=');
    expect(registrationLocation.searchParams.get('login_hint'))
      .toBe('native-signup@example.com');

    const existingSessionResume = await fetch(`${baseUrl}${redirect}`, {
      redirect: 'manual', headers: { Cookie: existing.cookie },
    });
    expect(existingSessionResume.status).toBe(302);
    expect(new URL(existingSessionResume.headers.get('location')!).searchParams.get('error'))
      .toBe('access_denied');

    const registered = await json('/auth/register', {
      username: 'native-signup', email: 'native-signup@example.com', password: 'password123',
      nativeContinuation: redirect,
    });
    expect(registered.response.status).toBe(200);
    const cookie = registered.response.headers.get('set-cookie')!.split(';', 1)[0]!;
    const resumed = await fetch(`${baseUrl}${redirect}`, { headers: { Cookie: cookie } });
    const resumedHtml = await resumed.text();
    expect(resumed.status).toBe(200);
    expect(resumedHtml).toContain('native-signup@example.com');

    const approved = await fetch(`${issuer}/oauth/authorize`, {
      method: 'POST', redirect: 'manual',
      headers: {
        Cookie: cookie, Origin: baseUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        request_id: hiddenValue(resumedHtml, 'request_id'), decision: 'approve',
      }),
    });
    const callback = new URL(approved.headers.get('location')!);
    const exchange = await token({
      grant_type: 'authorization_code', code: callback.searchParams.get('code')!,
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: VERIFIER,
    });
    const context = await fetch(`${baseUrl}/api/native-context`, {
      headers: { Authorization: `Bearer ${exchange.data.access_token}` },
    }).then((result) => result.json()) as any;
    expect(context).toMatchObject({
      email: 'native-signup@example.com', role: 'user', clientId: CLIENT_ID,
    });
  });

  test('binds displayed consent to one account across browser session changes', async () => {
    const displayed = await registerNativeUser('native-consent-displayed');
    const switched = await registerNativeUser('native-consent-switched');
    const authorization = await beginAuthorization({ cookie: displayed.cookie });
    const html = await authorization.text();
    expect(html).toContain('native-consent-displayed@example.com');
    const requestId = hiddenValue(html, 'request_id');

    const rejected = await submitAuthorization(requestId, switched.cookie, 'approve');
    expect(new URL(rejected.headers.get('location')!).searchParams.get('error'))
      .toBe('access_denied');

    const approved = await submitAuthorization(requestId, displayed.cookie, 'approve');
    const callback = new URL(approved.headers.get('location')!);
    expect(callback.searchParams.get('code')).toBeString();
  });

  test('openid-only access tokens omit identity while auth context hydrates it', async () => {
    const user = await registerNativeUser('native-openid-only');
    const code = await approvedCode(user.cookie, 'openid');
    const exchange = await token({
      grant_type: 'authorization_code', code,
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: VERIFIER,
    });
    expect(exchange.response.status).toBe(200);
    const payload = decodeJwt(exchange.data.access_token);
    expect(payload.scope).toBe('openid');
    expect(payload.email).toBeUndefined();
    expect(payload.role).toBeUndefined();
    const context = await fetch(`${baseUrl}/api/native-context`, {
      headers: { Authorization: `Bearer ${exchange.data.access_token}` },
    }).then((response) => response.json()) as any;
    expect(context).toMatchObject({ email: 'native-openid-only@example.com', role: 'user' });
  });

  test('generation bumps during signing reject code and refresh responses', async () => {
    const codeUser = await registerNativeUser('native-code-race');
    const code = await approvedCode(codeUser.cookie);
    const codeResponse = await withGenerationBump(codeUser.userId, () => token({
      grant_type: 'authorization_code', code,
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: VERIFIER,
    }));
    expect(codeResponse.response.status).toBe(400);
    expect(codeResponse.data.error).toBe('invalid_grant');

    const refreshUser = await registerNativeUser('native-refresh-race');
    const refreshCode = await approvedCode(refreshUser.cookie);
    const exchange = await token({
      grant_type: 'authorization_code', code: refreshCode,
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: VERIFIER,
    });
    expect(exchange.response.status).toBe(200);
    const refreshResponse = await withGenerationBump(refreshUser.userId, () => token({
      grant_type: 'refresh_token', refresh_token: exchange.data.refresh_token,
      client_id: CLIENT_ID,
    }));
    expect(refreshResponse.response.status).toBe(400);
    expect(refreshResponse.data.error).toBe('invalid_grant');
  });

  test('unregistered redirects fail locally and never receive an authorization response', async () => {
    const response = await beginAuthorization({
      redirectUri: 'com.attacker.app:/oauth/callback', cookie: pageCookie,
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  test('returns post-validation protocol errors to the registered callback', async () => {
    const response = await beginAuthorization({
      cookie: pageCookie,
      scope: 'openid api.read',
    });
    expect(response.status).toBe(302);
    const callback = new URL(response.headers.get('location')!);
    expect(callback.protocol + callback.pathname).toBe('com.example.zeroapp:/oauth/callback');
    expect(callback.searchParams.get('error')).toBe('invalid_scope');
    expect(callback.searchParams.get('state')).toBe(STATE);
    expect(callback.searchParams.get('iss')).toBe(issuer);

    const silent = await beginAuthorization({ cookie: pageCookie, prompt: 'none' });
    const silentCallback = new URL(silent.headers.get('location')!);
    expect(silent.status).toBe(302);
    expect(silentCallback.searchParams.get('error')).toBe('interaction_required');
    expect(silentCallback.searchParams.get('state')).toBe(STATE);
  });

  test('returns malformed consent as invalid_request without losing the safe callback', async () => {
    const user = await registerNativeUser('native-malformed-consent');
    const authorization = await beginAuthorization({ cookie: user.cookie });
    const requestId = hiddenValue(await authorization.text(), 'request_id');
    const body = new URLSearchParams({ request_id: requestId, decision: 'approve' });
    body.append('decision', 'deny');
    const response = await fetch(`${issuer}/oauth/authorize`, {
      method: 'POST', redirect: 'manual',
      headers: {
        Cookie: user.cookie, Origin: baseUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const callback = new URL(response.headers.get('location')!);
    expect(response.status).toBe(302);
    expect(callback.protocol + callback.pathname).toBe('com.example.zeroapp:/oauth/callback');
    expect(callback.searchParams.get('error')).toBe('invalid_request');
    expect(callback.searchParams.get('state')).toBe(STATE);
    expect(callback.searchParams.get('iss')).toBe(issuer);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('revalidates page authority inside native claim, approval, and denial commits', async () => {
    const service = getNativeAuthorizationService()!;

    const claimUser = await registerNativeUser('native-claim-generation-fence');
    const anonymousStart = await beginAuthorization();
    const loginLocation = new URL(anonymousStart.headers.get('location')!, baseUrl);
    const resume = loginLocation.searchParams.get('redirect')!;
    const claimRequestId = new URL(resume, baseUrl).searchParams.get('request_id')!;
    const originalClaim = service.claimContinuationForAuth.bind(service);
    service.claimContinuationForAuth = (value, auth) => withNativeAuthorityReset(
      claimUser.userId,
      () => originalClaim(value, auth),
    );
    let claimResponse: Response;
    try {
      claimResponse = await fetch(
        `${issuer}/oauth/authorize?request_id=${encodeURIComponent(claimRequestId)}`,
        { redirect: 'manual', headers: { Cookie: claimUser.cookie } },
      );
    } finally {
      service.claimContinuationForAuth = originalClaim;
    }
    expect(new URL(claimResponse!.headers.get('location')!).searchParams.get('error'))
      .toBe('access_denied');
    expect(service.getRequest(claimRequestId)).toMatchObject({
      boundUserId: null,
      consumedAt: null,
    });

    const approvalUser = await registerNativeUser('native-approval-generation-fence');
    const approvalPage = await beginAuthorization({ cookie: approvalUser.cookie });
    const approvalRequestId = hiddenValue(await approvalPage.text(), 'request_id');
    const codesBefore = nativeCodeCount();
    const originalApprove = service.approve.bind(service);
    service.approve = (requestId, auth) => withNativeAuthorityReset(
      approvalUser.userId,
      () => originalApprove(requestId, auth),
    );
    let approvalResponse: Response;
    try {
      approvalResponse = await submitAuthorization(
        approvalRequestId,
        approvalUser.cookie,
        'approve',
      );
    } finally {
      service.approve = originalApprove;
    }
    expect(new URL(approvalResponse!.headers.get('location')!).searchParams.get('error'))
      .toBe('access_denied');
    expect(nativeCodeCount()).toBe(codesBefore);
    expect(service.getRequest(approvalRequestId)).toMatchObject({
      boundUserId: approvalUser.userId,
      consumedAt: null,
    });

    const denialUser = await registerNativeUser('native-denial-generation-fence');
    const denialPage = await beginAuthorization({ cookie: denialUser.cookie });
    const denialRequestId = hiddenValue(await denialPage.text(), 'request_id');
    const originalDeny = service.deny.bind(service);
    service.deny = (requestId, auth) => withNativeAuthorityReset(
      denialUser.userId,
      () => originalDeny(requestId, auth),
    );
    let denialResponse: Response;
    try {
      denialResponse = await submitAuthorization(
        denialRequestId,
        denialUser.cookie,
        'deny',
      );
    } finally {
      service.deny = originalDeny;
    }
    expect(new URL(denialResponse!.headers.get('location')!).searchParams.get('error'))
      .toBe('invalid_request');
    expect(service.getRequest(denialRequestId)).toMatchObject({
      boundUserId: denialUser.userId,
      consumedAt: null,
    });
  });

  test('enforces public-client HTTP semantics across token and revocation errors', async () => {
    const acceptedMediaType = await fetch(`${issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'Application/X-Www-Form-Urlencoded; Charset=UTF-8' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: 'unknown', client_id: CLIENT_ID,
      }),
    });
    expect(acceptedMediaType.status).toBe(400);
    expect((await acceptedMediaType.json() as any).error).toBe('invalid_grant');

    const embeddedSecret = await fetch(`${issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: 'unknown', client_id: CLIENT_ID,
        client_secret: 'must-not-be-used',
      }),
    });
    expect(embeddedSecret.status).toBe(400);
    expect(embeddedSecret.headers.get('www-authenticate')).toBeNull();
    expect((await embeddedSecret.json() as any).error).toBe('invalid_client');

    for (const endpoint of ['token', 'revoke']) {
      const response = await fetch(`${issuer}/oauth/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic Zm9vOmJhcg==',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(endpoint === 'token' ? {
          grant_type: 'refresh_token', refresh_token: 'unknown', client_id: CLIENT_ID,
        } : { token: 'unknown', client_id: CLIENT_ID }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Basic realm="Zero native OAuth"');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect((await response.json() as any).error).toBe('invalid_client');
    }

    const invalidUserInfo = await fetch(`${issuer}/oauth/userinfo`);
    expect(invalidUserInfo.status).toBe(401);
    expect(invalidUserInfo.headers.get('cache-control')).toBe('no-store');
    expect(invalidUserInfo.headers.get('www-authenticate')).toContain('invalid_token');
  });

  test('current Zero account state revokes native API and refresh access', async () => {
    const registered = await json('/auth/register', {
      username: 'native-revoked', email: 'native-revoked@example.com', password: 'password123',
    });
    const cookie = registered.response.headers.get('set-cookie')!.split(';', 1)[0]!;
    const authorization = await beginAuthorization({ cookie });
    const requestId = hiddenValue(await authorization.text(), 'request_id');
    const approved = await fetch(`${issuer}/oauth/authorize`, {
      method: 'POST', redirect: 'manual',
      headers: {
        Cookie: cookie, Origin: baseUrl,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ request_id: requestId, decision: 'approve' }),
    });
    const callback = new URL(approved.headers.get('location')!);
    const exchanged = await token({
      grant_type: 'authorization_code', code: callback.searchParams.get('code')!,
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: VERIFIER,
    });

    const suspended = await json(
      `/auth/admin/users/${registered.data.user.userId}`,
      { status: 'suspended' },
      webAccessToken
    );
    expect(suspended.response.status).toBe(200);
    const api = await fetch(`${baseUrl}/api/native-context`, {
      headers: { Authorization: `Bearer ${exchanged.data.access_token}` },
    }).then((response) => response.json()) as any;
    expect(api).toEqual({ anonymous: true });
    const refresh = await token({
      grant_type: 'refresh_token', refresh_token: exchanged.data.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(refresh.data.error).toBe('invalid_grant');
  });

  test('revokes one native family immediately across HTTP and Sync', async () => {
    const user = await registerNativeUser('native-family-revoke');
    const first = await exchangeNative(user.cookie);
    const second = await exchangeNative(user.cookie);
    const firstFamily = String(decodeJwt(first.access_token).sid);
    const secondFamily = String(decodeJwt(second.access_token).sid);
    expect(firstFamily).not.toBe(secondFamily);
    expect((await nativeSyncContext(first.access_token)).ok).toBe(true);
    expect((await nativeSyncContext(second.access_token)).ok).toBe(true);

    const revoked = await fetch(`${issuer}/oauth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-correlation-id': 'native-revoke-correlation',
      },
      body: new URLSearchParams({ token: first.refresh_token, client_id: CLIENT_ID }),
    });
    expect(revoked.status).toBe(200);
    expect(db.prepare(`SELECT action, outcome, scope_kind, actor_user_id,
      actor_session_id, actor_session_kind, actor_client_id, correlation_id,
      target_type, target_id
      FROM _auth_audit_events
      WHERE action = 'session.revoked' AND target_id = ?`).get(firstFamily)).toMatchObject({
      action: 'session.revoked',
      outcome: 'succeeded',
      scope_kind: 'application',
      actor_user_id: user.userId,
      actor_session_id: firstFamily,
      actor_session_kind: 'native',
      actor_client_id: CLIENT_ID,
      correlation_id: 'native-revoke-correlation',
      target_type: 'native-session-family',
      target_id: firstFamily,
    });
    expect(await nativeContext(first.access_token)).toEqual({ anonymous: true });
    expect((await nativeSyncContext(first.access_token)).ok).toBe(false);
    expect(await nativeContext(second.access_token)).toMatchObject({
      email: 'native-family-revoke@example.com', sessionId: secondFamily,
    });
    expect((await nativeSyncContext(second.access_token)).ok).toBe(true);

    db.prepare('UPDATE _auth_native_sessions SET expires_at = ? WHERE family_id = ?')
      .run(Date.now() - 1, secondFamily);
    expect(await nativeContext(second.access_token)).toEqual({ anonymous: true });
    expect((await nativeSyncContext(second.access_token)).ok).toBe(false);
  });

  test('admin session revocation invalidates native and browser bearers immediately', async () => {
    const registered = await json('/auth/register', {
      username: 'native-admin-revoke', email: 'native-admin-revoke@example.com',
      password: 'password123',
    });
    const cookie = registered.response.headers.get('set-cookie')!.split(';', 1)[0]!;
    const native = await exchangeNative(cookie);
    expect(await nativeContext(native.access_token)).toMatchObject({
      email: 'native-admin-revoke@example.com',
    });

    const revoked = await fetch(
      `${baseUrl}/auth/admin/users/${registered.data.user.userId}/revoke-sessions`,
      { method: 'POST', headers: { Authorization: `Bearer ${webAccessToken}` } },
    );
    expect(revoked.status).toBe(200);
    expect(await nativeContext(native.access_token)).toEqual({ anonymous: true });
    expect(await nativeContext(registered.data.accessToken)).toEqual({ anonymous: true });
    expect((await nativeSyncContext(native.access_token)).ok).toBe(false);
  });
});

async function beginAuthorization(options: {
  cookie?: string; prompt?: string; redirectUri?: string; scope?: string; loginHint?: string;
} = {}): Promise<Response> {
  const challenge = await derivePkceS256Challenge(VERIFIER);
  const query = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID,
    redirect_uri: options.redirectUri ?? REDIRECT_URI,
    scope: options.scope ?? 'openid profile email', state: STATE, nonce: NONCE,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  if (options.prompt) query.set('prompt', options.prompt);
  if (options.loginHint) query.set('login_hint', options.loginHint);
  return fetch(`${issuer}/oauth/authorize?${query}`, {
    redirect: 'manual', headers: options.cookie ? { Cookie: options.cookie } : {},
  });
}

async function approvedCode(cookie: string, scope?: string): Promise<string> {
  const authorization = await beginAuthorization({ cookie, scope });
  const requestId = hiddenValue(await authorization.text(), 'request_id');
  const approved = await submitAuthorization(requestId, cookie, 'approve');
  return new URL(approved.headers.get('location')!).searchParams.get('code')!;
}

function submitAuthorization(
  requestId: string,
  cookie: string,
  decision: 'approve' | 'deny',
): Promise<Response> {
  return fetch(`${issuer}/oauth/authorize`, {
    method: 'POST', redirect: 'manual',
    headers: {
      Cookie: cookie, Origin: baseUrl,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ request_id: requestId, decision }),
  });
}

async function registerNativeUser(name: string) {
  const registered = await json('/auth/register', {
    username: name, email: `${name}@example.com`, password: 'password123',
  });
  return {
    userId: registered.data.user.userId as string,
    cookie: registered.response.headers.get('set-cookie')!.split(';', 1)[0]!,
  };
}

async function withGenerationBump<T>(userId: string, action: () => Promise<T>): Promise<T> {
  const tokens = getTokenService()!;
  const store = getAuthStore()!;
  const original = tokens.signNativeAccessToken.bind(tokens);
  tokens.signNativeAccessToken = async (...args: Parameters<typeof original>) => {
    store.revokeAllUserTokens(userId);
    return original(...args);
  };
  try {
    return await action();
  } finally {
    tokens.signNativeAccessToken = original;
  }
}

function withNativeAuthorityReset<T>(userId: string, action: () => T): T {
  const tokens = getTokenService()!;
  const store = getAuthStore()!;
  const original = tokens.resolveAuthContextAuthority.bind(tokens);
  let resolutions = 0;
  tokens.resolveAuthContextAuthority = (reference) => {
    resolutions += 1;
    if (resolutions === 2) store.revokeAllUserTokens(userId);
    return original(reference);
  };
  try {
    const result = action();
    expect(resolutions).toBe(2);
    return result;
  } finally {
    tokens.resolveAuthContextAuthority = original;
  }
}

function nativeCodeCount(): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM _auth_native_codes').get() as {
    count: number;
  }).count;
}

async function token(fields: Record<string, string>) {
  const response = await fetch(`${issuer}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  return { response, data: await response.json() as any };
}

async function exchangeNative(cookie: string) {
  const code = await approvedCode(cookie);
  const exchanged = await token({
    grant_type: 'authorization_code', code, client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI, code_verifier: VERIFIER,
  });
  expect(exchanged.response.status).toBe(200);
  return exchanged.data;
}

function nativeContext(accessToken: string): Promise<any> {
  return fetch(`${baseUrl}/api/native-context`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((response) => response.json());
}

function nativeSyncContext(accessToken: string) {
  return resolveSyncAuthContext(accessToken, {
    required: true, getTokenVerifier: () => getTokenService(),
  });
}

async function json(path: string, body: object, accessToken?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: path.startsWith('/auth/admin/') ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() as any };
}

function hiddenValue(html: string, name: string): string {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  if (!match) throw new Error(`Missing hidden field ${name}`);
  return match[1]!;
}

function registeredUserId(): string {
  const row = db.prepare("SELECT user_id FROM users WHERE email = 'native@example.com'").get();
  return (row as { user_id: string }).user_id;
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test port'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
