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
  readPageSessionCookie,
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
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toEqual({
      userId: user.userId,
      email: user.email,
      role: 'user',
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

  test('invalidates the old page JWT on refresh rotation and accepts one bound to the new session', async () => {
    const user = await createUser();
    const original = await tokenService.issueTokenPair(user);
    const originalPageSession = await tokenService.issuePageSessionToken(original.refreshToken);
    expect(originalPageSession).not.toBeNull();

    const rotated = await tokenService.rotateRefreshToken(original.refreshToken);
    expect(rotated).not.toBeNull();
    await expect(
      tokenService.resolvePageSessionToken(originalPageSession!.token)
    ).resolves.toBeNull();

    const rotatedPageSession = await tokenService.issuePageSessionToken(rotated!.refreshToken);
    expect(rotatedPageSession).not.toBeNull();
    await expect(
      tokenService.resolvePageSessionToken(rotatedPageSession!.token)
    ).resolves.toMatchObject({ userId: user.userId });
  });

  test('rejects a page JWT when its backing refresh session expires', async () => {
    const user = await createUser();
    const pair = await tokenService.issueTokenPair(user);
    const pageSession = await tokenService.issuePageSessionToken(pair.refreshToken);
    expect(pageSession).not.toBeNull();

    const record = store.getRefreshTokenByHash(hashToken(pair.refreshToken));
    expect(record).not.toBeNull();
    db.prepare('UPDATE _refresh_tokens SET expires_at = ? WHERE token_id = ?')
      .run(Date.now() - 1_000, record!.tokenId);

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
    await expect(tokenService.resolvePageSessionToken(pageSession!.token)).resolves.toEqual({
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
    expect(header).toStartWith(`${PAGE_SESSION_COOKIE_NAME}=`);
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
    expect(readPageSessionCookie(cookieRequest)).toBeString();
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
    clearPageSessionCookie(clearSet, new Request('https://zero.test/logout'));
    const clearHeader = String(clearSet.headers['set-cookie']);
    expect(clearHeader).toContain(`${PAGE_SESSION_COOKIE_NAME}=`);
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
      `${PAGE_SESSION_COOKIE_NAME}=`
    );
  });

  test('resolves cookies only for GET or HEAD and suppresses fallback for explicit Authorization', async () => {
    const user = await createUser();
    const pair = await tokenService.issueTokenPair(user);
    const pageSession = await tokenService.issuePageSessionToken(pair.refreshToken);
    expect(pageSession).not.toBeNull();
    const cookie = `${PAGE_SESSION_COOKIE_NAME}=${encodeURIComponent(pageSession!.token)}`;

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
      headers: { Cookie: `${PAGE_SESSION_COOKIE_NAME}=%ZZ` },
    });
    await expect(resolvePageSessionAuth(malformed, tokenService)).resolves.toBeNull();
    expect(rejectedPageSessionCookieHeader(malformed)).toContain('Max-Age=0');
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
