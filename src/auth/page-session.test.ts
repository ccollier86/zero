/**
 * page-session.test.ts
 *
 * Verifies the page-only credential and cookie helpers independently from the
 * router. Router/API transport boundaries are covered by router integration
 * tests; this file owns token binding, live-user checks, and cookie mechanics.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import {
  PAGE_SESSION_COOKIE_NAME,
  clearPageSessionCookie,
  hasPageSessionCredential,
  readPageSessionCookie,
  revokeAndClearPageSessionCookie,
  rejectedPageSessionCookieHeader,
  resolvePageSessionAuth,
  setPageSessionCookie,
} from './page-session';
import { TokenService } from './token-service';
import type { UserRecord } from './types';
import { UserStore } from './user-store';

let db: ReactiveDB;
let store: UserStore;
let tokenService: TokenService;
let userSequence = 0;

beforeEach(async () => {
  db = createReactiveDB({ mode: 'memory' });
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  store = new UserStore(db);
  tokenService = await TokenService.create({ db });
  tokenService.setUserStore(store);
});

afterEach(() => {
  db.dispose();
});

describe('TokenService page sessions', () => {
  test('issues a page JWT bound to a live refresh session and resolves current identity', async () => {
    const user = await createUser({ role: 'user' });
    const pair = await tokenService.issueTokenPair(user);

    const pageSession = await tokenService.issuePageSessionToken(pair.refreshToken);

    expect(pageSession).not.toBeNull();
    expect(pageSession!.token.split('.')).toHaveLength(3);
    expect(pageSession!.expiresAt).toBeGreaterThan(Date.now());
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toMatchObject({
      userId: user.userId,
      email: user.email,
      role: 'user',
      sessionKind: 'web',
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    });
  });

  test('keeps access JWTs and page JWTs domain-separated', async () => {
    const user = await createUser();
    const pair = await tokenService.issueTokenPair(user);
    const pageSession = await tokenService.issuePageSessionToken(pair.refreshToken);
    expect(pageSession).not.toBeNull();

    await expect(tokenService.resolvePageSessionToken(pair.accessToken)).resolves.toBeNull();
    await expect(tokenService.verifyAccessToken(pageSession!.token)).resolves.toBeNull();
    await expect(tokenService.resolveAuthContext(pageSession!.token)).resolves.toBeNull();
  });

  test('rejects a page JWT after its backing refresh token is revoked', async () => {
    const user = await createUser();
    const pair = await tokenService.issueTokenPair(user);
    const pageSession = await tokenService.issuePageSessionToken(pair.refreshToken);
    expect(pageSession).not.toBeNull();

    expect(tokenService.revokeRefreshTokenByRaw(pair.refreshToken)).toBe(true);
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toBeNull();
  });

  test('retains the parent-bound page JWT on refresh rotation and accepts its renewed view', async () => {
    const user = await createUser();
    const original = await tokenService.issueTokenPair(user);
    const originalPageSession = await tokenService.issuePageSessionToken(original.refreshToken);
    expect(originalPageSession).not.toBeNull();

    const rotated = await tokenService.rotateRefreshToken(original.refreshToken);
    expect(rotated).not.toBeNull();
    await expect(
      tokenService.resolvePageSessionToken(originalPageSession!.token)
    ).resolves.toMatchObject({ userId: user.userId });

    const rotatedPageSession = await tokenService.issuePageSessionToken(rotated!.refreshToken);
    expect(rotatedPageSession).not.toBeNull();
    await expect(
      tokenService.resolvePageSessionToken(rotatedPageSession!.token)
    ).resolves.toMatchObject({ userId: user.userId });
  });

  test('rejects a page JWT when its durable parent session expires', async () => {
    const user = await createUser();
    const pair = await tokenService.issueTokenPair(user);
    const pageSession = await tokenService.issuePageSessionToken(pair.refreshToken);
    expect(pageSession).not.toBeNull();

    const context = await tokenService.resolveAuthContext(pair.accessToken);
    expect(context?.sessionId).toBeString();
    db.prepare('UPDATE _auth_sessions SET expires_at = ? WHERE session_id = ?')
      .run(Date.now() - 1_000, context!.sessionId!);

    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toBeNull();
  });

  test('uses live user role and eligibility rather than stale page-token claims', async () => {
    const user = await createUser({ role: 'user' });
    const pair = await tokenService.issueTokenPair(user);
    const pageSession = await tokenService.issuePageSessionToken(pair.refreshToken);
    expect(pageSession).not.toBeNull();

    store.updateUser(user.userId, {
      email: 'current-role@example.test',
      role: 'admin',
    });
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toMatchObject({
      userId: user.userId,
      email: 'current-role@example.test',
      role: 'admin',
    });

    store.updateUser(user.userId, { passwordChangeRequired: true });
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toBeNull();
    store.updateUser(user.userId, { passwordChangeRequired: false });
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toMatchObject({
      role: 'admin',
    });

    store.updateUser(user.userId, {
      emailVerificationRequired: true,
      emailVerifiedAt: null,
    });
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toBeNull();
    store.markEmailVerified(user.userId);
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toMatchObject({
      role: 'admin',
    });

    store.updateUser(user.userId, { status: 'suspended' });
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toBeNull();
    store.updateUser(user.userId, { status: 'active' });
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toMatchObject({
      role: 'admin',
    });

    store.deleteUser(user.userId);
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toBeNull();
  });
});

describe('page-session cookie helpers', () => {
  test('writes a host-only HttpOnly SameSite cookie with refresh-session lifetime', async () => {
    const user = await createUser();
    const pair = await tokenService.issueTokenPair(user);
    const set = responseSet();
    const request = new Request('http://zero.test/login', { method: 'POST' });

    await setPageSessionCookie(set, request, tokenService, pair.refreshToken);

    const header = String(set.headers['set-cookie']);
    expect(header).toStartWith(`${tokenService.pageSessionCookieName}=`);
    expect(header).toContain('Path=/');
    expect(header).toMatch(/Max-Age=\d+/);
    expect(header).toContain('Expires=');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('Domain=');
    expect(header).not.toContain('Secure');

    const cookieRequest = new Request('http://zero.test/app', {
      headers: { Cookie: cookiePair(header) },
    });
    expect(readPageSessionCookie(cookieRequest, tokenService)).toBeString();
    await expect(resolvePageSessionAuth(cookieRequest, tokenService)).resolves.toMatchObject({
      userId: user.userId,
    });
  });

  test('marks HTTPS and forwarded-HTTPS cookies Secure and clears with matching attributes', async () => {
    const user = await createUser();
    const firstPair = await tokenService.issueTokenPair(user);
    const httpsSet = responseSet();
    await setPageSessionCookie(
      httpsSet,
      new Request('https://zero.test/login', { method: 'POST' }),
      tokenService,
      firstPair.refreshToken
    );
    expect(String(httpsSet.headers['set-cookie'])).toContain('Secure');

    const secondPair = await tokenService.issueTokenPair(user);
    const forwardedSet = responseSet();
    await setPageSessionCookie(
      forwardedSet,
      new Request('http://zero.test/login', {
        method: 'POST',
        headers: { 'X-Forwarded-Proto': 'https' },
      }),
      tokenService,
      secondPair.refreshToken
    );
    expect(String(forwardedSet.headers['set-cookie'])).toContain('Secure');

    const clearSet = responseSet();
    clearPageSessionCookie(clearSet, new Request('https://zero.test/logout'), tokenService);
    const clearHeader = String(clearSet.headers['set-cookie']);
    expect(clearHeader).toContain(`${tokenService.pageSessionCookieName}=`);
    expect(clearHeader).toContain('Path=/');
    expect(clearHeader).toContain('Max-Age=0');
    expect(clearHeader).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(clearHeader).toContain('HttpOnly');
    expect(clearHeader).toContain('SameSite=Lax');
    expect(clearHeader).toContain('Secure');
  });

  test('appends the page session without overwriting another response cookie', async () => {
    const user = await createUser();
    const pair = await tokenService.issueTokenPair(user);
    const set = {
      headers: {
        'set-cookie': 'app_preference=compact; Path=/; SameSite=Lax',
      },
    };

    await setPageSessionCookie(
      set,
      new Request('https://zero.test/login', { method: 'POST' }),
      tokenService,
      pair.refreshToken
    );

    expect(set.headers['set-cookie']).toBeArrayOfSize(2);
    expect(set.headers['set-cookie'][0]).toStartWith('app_preference=compact');
    expect(set.headers['set-cookie'][1]).toStartWith(
      `${tokenService.pageSessionCookieName}=`
    );
  });

  test('resolves cookies only for GET or HEAD and suppresses fallback for explicit Authorization', async () => {
    const user = await createUser();
    const pair = await tokenService.issueTokenPair(user);
    const pageSession = await tokenService.issuePageSessionToken(pair.refreshToken);
    expect(pageSession).not.toBeNull();
    const cookie = `${tokenService.pageSessionCookieName}=${encodeURIComponent(pageSession!.token)}`;

    for (const method of ['GET', 'HEAD']) {
      const request = new Request('http://zero.test/app', {
        method,
        headers: { Cookie: cookie },
      });
      await expect(resolvePageSessionAuth(request, tokenService)).resolves.toMatchObject({
        userId: user.userId,
      });
    }

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const request = new Request('http://zero.test/app', {
        method,
        headers: { Cookie: cookie },
      });
      await expect(resolvePageSessionAuth(request, tokenService)).resolves.toBeNull();
    }

    const explicitInvalidAuthorization = new Request('http://zero.test/app', {
      headers: {
        Authorization: 'Bearer invalid',
        Cookie: cookie,
      },
    });
    await expect(
      resolvePageSessionAuth(explicitInvalidAuthorization, tokenService)
    ).resolves.toBeNull();

    const explicitValidAuthorization = new Request('http://zero.test/app', {
      headers: {
        Authorization: `Bearer ${pair.accessToken}`,
        Cookie: cookie,
      },
    });
    await expect(
      resolvePageSessionAuth(explicitValidAuthorization, tokenService)
    ).resolves.toBeNull();

    const malformed = new Request('http://zero.test/app', {
      headers: { Cookie: `${tokenService.pageSessionCookieName}=%ZZ` },
    });
    await expect(resolvePageSessionAuth(malformed, tokenService)).resolves.toBeNull();
    expect(rejectedPageSessionCookieHeader(malformed, tokenService)).toBeNull();
    expect(hasPageSessionCredential(malformed, tokenService)).toBe(true);
  });

  test('uses one persisted application namespace across TokenService recreation and continuations', async () => {
    const namespace = tokenService.pageSessionCookieName;
    expect(namespace).toMatch(/^__zero_page_session_[a-f0-9]{32}$/);
    const recreated = await TokenService.create({ db }); recreated.setUserStore(store);
    expect(recreated.pageSessionCookieName).toBe(namespace);
    const id = (db.prepare("SELECT value FROM _auth_config WHERE key = 'auth.application.id'").get() as { value: string }).value;
    expect(namespace).toBe(`${PAGE_SESSION_COOKIE_NAME}_${hashToken(id).slice(0, 32)}`);
    expect(namespace).not.toContain(id);
  });

  test('accepts verified legacy credentials only when canonical is absent; present empty or invalid canonical never falls back', async () => {
    const user = await createUser(); const pair = await tokenService.issueTokenPair(user);
    const page = (await tokenService.issuePageSessionToken(pair.refreshToken))!;
    const legacy = `${PAGE_SESSION_COOKIE_NAME}=${encodeURIComponent(page.token)}`;
    await expect(resolvePageSessionAuth(new Request('https://zero.test/app', { headers: { Cookie: legacy } }), tokenService))
      .resolves.toMatchObject({ userId: user.userId });
    for (const invalid of ['', 'invalid', '%ZZ']) {
      const request = new Request('https://zero.test/app', { headers: { Cookie: `${legacy}; ${tokenService.pageSessionCookieName}=${invalid}` } });
      await expect(resolvePageSessionAuth(request, tokenService)).resolves.toBeNull();
      expect(rejectedPageSessionCookieHeader(request, tokenService)).toBeNull();
      expect(hasPageSessionCredential(request, tokenService)).toBe(true);
    }
    const bareCanonical = new Request('https://zero.test/app', { headers: { Cookie: `${legacy}; ${tokenService.pageSessionCookieName}` } });
    await expect(resolvePageSessionAuth(bareCanonical, tokenService)).resolves.toBeNull();
    expect(rejectedPageSessionCookieHeader(bareCanonical, tokenService)).toBeNull();
    expect(hasPageSessionCredential(bareCanonical, tokenService)).toBe(true);
    const request = new Request('https://zero.test/app', { headers: { Cookie: `${PAGE_SESSION_COOKIE_NAME}=foreign` } });
    expect(rejectedPageSessionCookieHeader(request, tokenService)).toBeNull();
  });

  test('migrates a validated legacy session to the canonical cookie and retires its exact old proof', async () => {
    const user = await createUser(); const previous = await tokenService.issueTokenPair(user);
    const page = (await tokenService.issuePageSessionToken(previous.refreshToken))!;
    const next = await tokenService.issueTokenPair(user); const set = responseSet();
    await setPageSessionCookie(set, new Request('https://zero.test/login', { method: 'POST', headers: {
      Cookie: `${PAGE_SESSION_COOKIE_NAME}=${encodeURIComponent(page.token)}`,
    } }), tokenService, next.refreshToken);
    const headers = set.headers['set-cookie'] as unknown as string[];
    expect(headers).toHaveLength(2);
    expect(headers[0]).toStartWith(`${PAGE_SESSION_COOKIE_NAME}=`); expect(headers[0]).toContain('Max-Age=0');
    expect(headers[1]).toStartWith(`${tokenService.pageSessionCookieName}=`); expect(headers[1]).not.toContain('Max-Age=0');
    await expect(tokenService.resolvePageSessionToken(page.token)).resolves.toBeNull();
    await expect(resolvePageSessionAuth(new Request('https://zero.test/app', { headers: { Cookie: cookiePair(headers[1]!) } }), tokenService))
      .resolves.toMatchObject({ userId: user.userId });
  });

  test('foreign legacy and other app canonical cookies survive replacement, rejection and logout', async () => {
    const foreignDB = createReactiveDB({ mode: 'memory' }); defineAuthTables(foreignDB);
    try {
      const foreignStore = new UserStore(foreignDB); const foreign = await TokenService.create({ db: foreignDB }); foreign.setUserStore(foreignStore);
      const other = await foreignStore.createUser({ username: 'other-app', email: 'other-app@example.test', password: 'password123' });
      const otherPair = await foreign.issueTokenPair(other); const otherPage = (await foreign.issuePageSessionToken(otherPair.refreshToken))!;
      expect(foreign.pageSessionCookieName).not.toBe(tokenService.pageSessionCookieName);
      const foreignCookies = `${PAGE_SESSION_COOKIE_NAME}=${encodeURIComponent(otherPage.token)}; ${foreign.pageSessionCookieName}=${encodeURIComponent(otherPage.token)}`;
      const request = new Request('https://zero.test/app', { headers: { Cookie: foreignCookies } });
      await expect(resolvePageSessionAuth(request, tokenService)).resolves.toBeNull();
      expect(rejectedPageSessionCookieHeader(request, tokenService)).toBeNull();
      const local = await createUser(); const pair = await tokenService.issueTokenPair(local); const set = responseSet();
      await setPageSessionCookie(set, request, tokenService, pair.refreshToken);
      expect(String(set.headers['set-cookie'])).toStartWith(`${tokenService.pageSessionCookieName}=`);
      const logout = responseSet(); await revokeAndClearPageSessionCookie(logout, request, tokenService);
      expect(String(logout.headers['set-cookie'])).toStartWith(`${tokenService.pageSessionCookieName}=`);
      expect(String(logout.headers['set-cookie'])).not.toContain(`${PAGE_SESSION_COOKIE_NAME}=`);
      expect(String(logout.headers['set-cookie'])).not.toContain(`${foreign.pageSessionCookieName}=`);
      await expect(foreign.resolvePageSessionToken(otherPage.token)).resolves.toMatchObject({ userId: other.userId });
    } finally { foreignDB.dispose(); }
  });
});

async function createUser(
  overrides: Partial<Pick<UserRecord, 'role' | 'status' | 'passwordChangeRequired'>> = {}
): Promise<UserRecord> {
  userSequence += 1;
  return store.createUser({
    username: `page-session-user-${userSequence}`,
    email: `page-session-user-${userSequence}@example.test`,
    password: 'password123',
    role: overrides.role,
    status: overrides.status,
    passwordChangeRequired: overrides.passwordChangeRequired,
  });
}

function responseSet(): { headers: Record<string, string | number> } {
  return { headers: {} };
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';', 1)[0] ?? '';
}

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}
