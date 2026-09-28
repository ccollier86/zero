import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { Elysia } from 'elysia';
import {
  configureEmail,
  MemoryEmailProvider,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from '../../email';
import { createReactiveDB } from '../../sync/reactive-db';
import { createAuthMiddleware } from '../auth.middleware';
import { createAuthPlugin, getAuthEmailOutbox, getTokenService } from '../auth.plugin';
import { getAuthStore, getNativeAuthorizationService } from '../auth-runtime';
import { derivePkceS256Challenge } from '../native';

const clientId = 'com.example.registration';
const redirectUri = 'com.example.registration:/oauth/callback';
const verifier = 'v'.repeat(64);

describe('native registration continuation', () => {
  test('survives verification email and returns the new user to consent', async () => {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const issuer = `${baseUrl}/auth`;
    const provider = new MemoryEmailProvider();
    configureEmail({ from: 'Zero <zero@example.test>', provider }, {
      name: 'Zero', publicUrl: baseUrl,
    });
    const db = createReactiveDB({ mode: 'memory' });
    const app = new Elysia()
      .use(createAuthPlugin({
        db, bootstrap: 'public', nativeIssuer: issuer, nativeAudience: baseUrl,
        account: { requireEmailVerification: true },
        accountEmails: { requestCooldown: '0s' },
        nativeApps: { clients: [{ clientId, name: 'Registration App', redirectUris: [redirectUri] }] },
      }))
      .use(createAuthMiddleware(getTokenService));
    app.listen(port);
    try {
      const owner = await post(baseUrl, '/auth/register', {
        username: 'owner', email: 'owner@example.test', password: 'password123',
      });
      const ownerCookie = owner.response.headers.get('set-cookie')!.split(';', 1)[0]!;
      const state = 's'.repeat(43);
      const nonce = 'n'.repeat(43);
      const query = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
        scope: 'openid profile email', state, nonce,
        code_challenge: await derivePkceS256Challenge(verifier),
        code_challenge_method: 'S256', prompt: 'create',
      });
      const started = await fetch(`${issuer}/oauth/authorize?${query}`, {
        redirect: 'manual', headers: { Cookie: ownerCookie },
      });
      const continuation = new URL(started.headers.get('location')!, baseUrl)
        .searchParams.get('redirect')!;
      const registered = await post(baseUrl, '/auth/register', {
        username: 'verified-native', email: 'verified-native@example.test',
        password: 'password123', nativeContinuation: continuation,
      });
      expect(registered.data.user.emailVerificationRequired).toBe(true);
      const actionUrl = firstUrl(provider.messages[0]!.message.text);
      expect(actionUrl.searchParams.get('redirect')).toBe(continuation);

      const wrongConsent = await fetch(`${baseUrl}${continuation}`, {
        redirect: 'manual', headers: { Cookie: ownerCookie },
      });
      expect(new URL(wrongConsent.headers.get('location')!).searchParams.get('error'))
        .toBe('access_denied');

      const resent = await post(baseUrl, '/auth/resend-verification', {
        email: 'verified-native@example.test', nativeContinuation: continuation,
      });
      expect(resent.response.status).toBe(200);
      expect(resent.data).toEqual({ ok: true });
      const resentActionUrl = firstUrl(provider.messages[1]!.message.text);
      expect(resentActionUrl.searchParams.get('redirect')).toBe(continuation);

      const unbound = await fetch(`${issuer}/oauth/authorize?${query}`, {
        redirect: 'manual', headers: { Cookie: ownerCookie },
      });
      const unboundContinuation = new URL(unbound.headers.get('location')!, baseUrl)
        .searchParams.get('redirect')!;
      const ignored = await post(baseUrl, '/auth/resend-verification', {
        email: 'verified-native@example.test', nativeContinuation: unboundContinuation,
      });
      expect(ignored.data).toEqual({ ok: true });
      expect(firstUrl(provider.messages[2]!.message.text).searchParams.get('redirect')).toBeNull();

      const verified = await post(baseUrl, '/auth/verify-email', {
        token: resentActionUrl.searchParams.get('token'),
      });
      const userCookie = verified.response.headers.get('set-cookie')!.split(';', 1)[0]!;
      const consent = await fetch(`${baseUrl}${continuation}`, {
        redirect: 'manual',
        headers: { Cookie: userCookie },
      });
      const html = await consent.text();
      expect(html).toContain('verified-native@example.test');
      const approved = await fetch(`${issuer}/oauth/authorize`, {
        method: 'POST', redirect: 'manual',
        headers: { Cookie: userCookie, Origin: baseUrl,
          'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ request_id: hidden(html), decision: 'approve' }),
      });
      const callback = new URL(approved.headers.get('location')!);
      const tokens = await form(issuer, '/oauth/token', {
        grant_type: 'authorization_code', code: callback.searchParams.get('code')!,
        client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier,
      });
      const me = await fetch(`${issuer}/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then((response) => response.json()) as any;
      expect(me.email).toBe('verified-native@example.test');
    } finally {
      await app.stop();
      db.dispose();
      configureEmail(false);
    }
  });

  test('releases a claimed request when verification delivery fails so retry can resume', async () => {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const issuer = `${baseUrl}/auth`;
    const provider = new FailOnceEmailProvider();
    configureEmail({ from: 'Zero <zero@example.test>', provider }, {
      name: 'Zero', publicUrl: baseUrl,
    });
    const db = createReactiveDB({ mode: 'memory' });
    const app = new Elysia().use(createAuthPlugin({
      db, bootstrap: 'public', nativeIssuer: issuer, nativeAudience: baseUrl,
      account: { requireEmailVerification: true },
      accountEmails: { requestCooldown: '0s' },
      nativeApps: { clients: [{ clientId, name: 'Registration App', redirectUris: [redirectUri] }] },
    })).use(createAuthMiddleware(getTokenService));
    app.listen(port);
    try {
      await post(baseUrl, '/auth/register', {
        username: 'delivery-owner', email: 'delivery-owner@example.test',
        password: 'password123',
      });
      const query = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
        scope: 'openid', state: 's'.repeat(43), nonce: 'n'.repeat(43),
        code_challenge: await derivePkceS256Challenge(verifier),
        code_challenge_method: 'S256', prompt: 'create',
      });
      const started = await fetch(`${issuer}/oauth/authorize?${query}`, { redirect: 'manual' });
      const continuation = new URL(started.headers.get('location')!, baseUrl)
        .searchParams.get('redirect')!;
      provider.failuresRemaining = 1;
      const registration = {
        username: 'delivery-retry', email: 'delivery-retry@example.test',
        password: 'password123', nativeContinuation: continuation,
      };
      expect((await post(baseUrl, '/auth/register', registration)).response.status).toBe(502);
      expect((db.prepare(`SELECT bound_user_id FROM _auth_native_requests`).get() as any))
        .toEqual({ bound_user_id: null });
      expect((db.prepare(`SELECT COUNT(*) AS count FROM users WHERE email = ?`)
        .get(registration.email) as any).count).toBe(0);

      expect((await post(baseUrl, '/auth/register', registration)).response.status).toBe(200);
      expect(firstUrl(provider.messages[0]!.text).searchParams.get('redirect'))
        .toBe(continuation);
      expect((db.prepare(`SELECT bound_user_id FROM _auth_native_requests`).get() as any)
        .bound_user_id).toBeString();
    } finally {
      await app.stop();
      db.dispose();
      configureEmail(false);
    }
  });

  test('rejects every unavailable supplied continuation without creating an account', async () => {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const issuer = `${baseUrl}/auth`;
    const db = createReactiveDB({ mode: 'memory' });
    const app = new Elysia().use(createAuthPlugin({
      db, bootstrap: 'public', nativeIssuer: issuer, nativeAudience: baseUrl,
      nativeApps: { clients: [{ clientId, name: 'Registration App', redirectUris: [redirectUri] }] },
    }));
    app.listen(port);
    try {
      const owner = await post(baseUrl, '/auth/register', {
        username: 'continuation-owner', email: 'continuation-owner@example.test',
        password: 'password123',
      });
      const expired = await beginNativeRegistration(baseUrl, issuer);
      db.prepare('UPDATE _auth_native_requests SET expires_at = 0').run();
      const claimed = await beginNativeRegistration(baseUrl, issuer);
      expect(getNativeAuthorizationService()!.claimContinuationForUser(
        claimed, owner.data.user.userId
      )).toBe(claimed);
      const unavailable = [
        'malformed',
        `/auth/oauth/authorize?request_id=${'x'.repeat(43)}`,
        expired,
        claimed,
      ];

      for (const [index, nativeContinuation] of unavailable.entries()) {
        const result = await post(baseUrl, '/auth/register', {
          username: `unavailable-${index}`,
          email: `unavailable-${index}@example.test`,
          password: 'password123', nativeContinuation,
        });
        expect(result.response.status).toBe(400);
        expect(result.data).toEqual({
          error: 'Native authorization continuation is invalid or unavailable',
          code: 'NATIVE_CONTINUATION_INVALID',
        });
      }
      expect(getAuthStore()!.countUsers()).toBe(1);
    } finally {
      await app.stop();
      db.dispose();
    }
  });

  test('claim race rolls back the bootstrap account and leaves the request retryable', async () => {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const issuer = `${baseUrl}/auth`;
    const db = createReactiveDB({ mode: 'memory' });
    const app = new Elysia().use(createAuthPlugin({
      db, bootstrap: 'public', nativeIssuer: issuer, nativeAudience: baseUrl,
      userProperties: {
        plan: { type: 'string', default: 'starter', editableBy: 'admin' },
      },
      nativeApps: { clients: [{ clientId, name: 'Registration App', redirectUris: [redirectUri] }] },
    }));
    app.listen(port);
    try {
      const continuation = await beginNativeRegistration(baseUrl, issuer);
      const service = getNativeAuthorizationService()!;
      const originalClaim = service.claimContinuationForUser.bind(service);
      service.claimContinuationForUser = () => null;
      const registration = {
        username: 'bootstrap-retry', email: 'bootstrap-retry@example.test',
        password: 'password123', nativeContinuation: continuation,
      };
      const failed = await post(baseUrl, '/auth/register', registration);
      service.claimContinuationForUser = originalClaim;

      expect(failed.response.status).toBe(400);
      expect(failed.data.code).toBe('NATIVE_CONTINUATION_INVALID');
      for (const table of ['users', '_credentials', 'user_properties', '_auth_registration_intents']) {
        expect((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count).toBe(0);
      }
      expect(service.validateAvailableContinuation(continuation)).toBe(continuation);

      const retried = await post(baseUrl, '/auth/register', registration);
      expect(retried.response.status).toBe(200);
      expect(retried.data.user.role).toBe('admin');
      expect(retried.data.user.properties.plan).toBe('starter');
      expect(getAuthStore()!.countUsers()).toBe(1);
    } finally {
      await app.stop();
      db.dispose();
    }
  });

  test('supplied continuation fails closed when native auth is unavailable', async () => {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const db = createReactiveDB({ mode: 'memory' });
    const app = new Elysia().use(createAuthPlugin({ db, bootstrap: 'public' }));
    app.listen(port);
    try {
      const result = await post(baseUrl, '/auth/register', {
        username: 'native-disabled', email: 'native-disabled@example.test',
        password: 'password123',
        nativeContinuation: `/auth/oauth/authorize?request_id=${'x'.repeat(43)}`,
      });
      expect(result.response.status).toBe(400);
      expect(result.data.code).toBe('NATIVE_CONTINUATION_INVALID');
      expect(getAuthStore()!.countUsers()).toBe(0);
    } finally {
      await app.stop();
      db.dispose();
    }
  });

  test('multi-tenant verification gates creation and preserves native consent through onboarding', async () => {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const issuer = `${baseUrl}/auth`;
    const provider = new MemoryEmailProvider();
    configureEmail({ from: 'Zero <zero@example.test>', provider }, {
      name: 'Zero', publicUrl: baseUrl,
    });
    const db = createReactiveDB({ mode: 'memory' });
    const app = new Elysia().use(createAuthPlugin({
      db,
      bootstrap: 'public',
      tenancy: 'multi',
      account: { requireEmailVerification: true },
      accountEmails: { requestCooldown: '0s' },
      nativeIssuer: issuer,
      nativeAudience: baseUrl,
      nativeApps: {
        clients: [{ clientId, name: 'Registration App', redirectUris: [redirectUri] }],
      },
    }));
    app.listen(port);
    try {
      const bootstrapped = await post(baseUrl, '/auth/register', {
        username: 'tenant-bootstrap',
        email: 'tenant-bootstrap@example.test',
        password: 'password123',
        organizationName: 'Bootstrap Workspace',
      });
      expect(bootstrapped.response.status).toBe(200);

      const nativeContinuation = await beginNativeRegistration(baseUrl, issuer);
      const registered = await post(baseUrl, '/auth/register', {
        username: 'tenant-native',
        email: 'tenant-native@example.test',
        password: 'password123',
        nativeContinuation,
      });
      expect(registered.response.status).toBe(200);
      expect(registered.data.user.emailVerificationRequired).toBe(true);
      expect(registered.data.tenantOnboardingRequired).toBeUndefined();
      expect(registered.data.onboarding).toBeUndefined();
      expect(registered.data.accessToken).toBeUndefined();
      expect(registered.data.refreshToken).toBeUndefined();
      expect((db.prepare(`
        SELECT COUNT(*) AS count FROM _auth_session_continuations
        WHERE user_id = ? AND purpose = 'tenant_onboarding'
      `).get(registered.data.user.userId) as { count: number }).count).toBe(0);

      const verificationMessage = provider.messages.find(({ message }) =>
        String(message.to).includes('tenant-native@example.test'));
      expect(verificationMessage).toBeDefined();
      const verificationUrl = firstUrl(verificationMessage!.message.text);
      expect(verificationUrl.searchParams.get('redirect')).toBe(nativeContinuation);
      const verified = await post(baseUrl, '/auth/verify-email', {
        token: verificationUrl.searchParams.get('token'),
      });
      expect(verified.response.status).toBe(200);
      expect(verified.data.tenantOnboardingRequired).toBe(true);
      expect(verified.data.accessToken).toBeUndefined();
      const onboardingContinuation =
        verified.data.onboarding.tenantCreation.continuation as string;
      expect(onboardingContinuation).toBeString();

      const created = await post(baseUrl, '/auth/tenants/create', {
        continuation: onboardingContinuation,
        name: 'Native User Workspace',
      });
      expect(created.response.status).toBe(200);
      const pageCookie = created.response.headers.get('set-cookie')!.split(';', 1)[0]!;
      const consent = await fetch(`${baseUrl}${nativeContinuation}`, {
        redirect: 'manual',
        headers: { Cookie: pageCookie },
      });
      expect(consent.status).toBe(200);
      const html = await consent.text();
      expect(html).toContain('tenant-native@example.test');
      expect(html).toContain('value="approve"');
    } finally {
      await app.stop();
      db.dispose();
      configureEmail(false);
    }
  }, 60_000);
});

class FailOnceEmailProvider implements EmailProvider {
  readonly name = 'fail-once';
  readonly messages: EmailMessage[] = [];
  failuresRemaining = 0;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.failuresRemaining-- > 0) throw new Error('delivery failed');
    this.messages.push(message);
    return { provider: this.name, accepted: [String(message.to)] };
  }
}

async function beginNativeRegistration(baseUrl: string, issuer: string): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    scope: 'openid', state: 's'.repeat(43), nonce: 'n'.repeat(43),
    code_challenge: await derivePkceS256Challenge(verifier),
    code_challenge_method: 'S256', prompt: 'create',
  });
  const response = await fetch(`${issuer}/oauth/authorize?${query}`, { redirect: 'manual' });
  return new URL(response.headers.get('location')!, baseUrl).searchParams.get('redirect')!;
}

async function post(base: string, path: string, body: object) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json() as any;
  if (path === '/auth/resend-verification') await getAuthEmailOutbox()?.processDue();
  return { response, data };
}

async function form(issuer: string, path: string, body: Record<string, string>) {
  const response = await fetch(`${issuer}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return response.json() as Promise<any>;
}

function firstUrl(text: string): URL {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) throw new Error('Verification URL missing');
  return new URL(match[0]);
}

function hidden(html: string): string {
  const match = html.match(/name="request_id" value="([^"]+)"/);
  if (!match) throw new Error('Request ID missing');
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
