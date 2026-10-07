/** Isolated Guardian cookie migration, native admission and persisted SYSTEM restart. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { emitPlatformCode } from '../observability/sink';
import { AuthSessionContinuationStore } from './auth-session-continuation-store';
import { contactFixture } from './auth-user-contact.test-fixture';
import { PAGE_SESSION_COOKIE_NAME, resolvePageSessionAuth } from './page-session';
import { resolveNativePagePost } from './oidc/native-authorize-helpers';

test('real refresh and logout retire only a legacy cookie validated before their own proof mutation', async () => {
  const f = contactFixture({ profile: {} });
  try {
    const signedIn = await f.register(); const tokens = f.getRuntime().getTokenService()!;
    const legacyPage = (await tokens.issuePageSessionToken(signedIn.refreshToken))!;
    const response = await f.app.handle(new Request('https://example.test/auth/refresh', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${PAGE_SESSION_COOKIE_NAME}=${legacyPage.token}` },
      body: JSON.stringify({ refreshToken: signedIn.refreshToken }) }));
    const result = await response.json() as { refreshToken: string };
    expect(response.status).toBe(200);
    const headers = response.headers.getSetCookie();
    expect(headers).toHaveLength(2);
    expect(headers.find(value => value.startsWith(`${PAGE_SESSION_COOKIE_NAME}=`))).toContain('Max-Age=0');
    const canonical = headers.find(value => value.startsWith(`${tokens.pageSessionCookieName}=`))!;
    expect(canonical).not.toContain('Max-Age=0'); expect(canonical).toContain('Secure');
    await expect(resolvePageSessionAuth(new Request('https://example.test/page', { headers: { Cookie: canonical.split(';')[0]! } }), tokens))
      .resolves.toMatchObject({ userId: signedIn.user.userId });
    const newPage = (await tokens.issuePageSessionToken(result.refreshToken))!;
    const logout = await f.app.handle(new Request('https://example.test/auth/logout', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${PAGE_SESSION_COOKIE_NAME}=${newPage.token}` },
      body: JSON.stringify({ refreshToken: result.refreshToken }) }));
    expect(logout.status).toBe(200);
    expect(logout.headers.getSetCookie()).toHaveLength(2);
    expect(logout.headers.getSetCookie().every(value => value.includes('Max-Age=0'))).toBe(true);
    expect(logout.headers.getSetCookie().some(value => value.startsWith(`${PAGE_SESSION_COOKIE_NAME}=`))).toBe(true);
    await expect(tokens.resolvePageSessionToken(newPage.token)).resolves.toBeNull();
  } finally { await f.close(); }
});

test('native consent POST shares canonical precedence and app-validated legacy fallback without authenticating foreign cookies', async () => {
  const a = contactFixture({ profile: {} }), b = contactFixture({ profile: {} });
  try {
    const signA = await a.register('native-cookie-a'), signB = await b.register('native-cookie-b');
    const tokensA = a.getRuntime().getTokenService()!, tokensB = b.getRuntime().getTokenService()!;
    const pageA = (await tokensA.issuePageSessionToken(signA.refreshToken))!, pageB = (await tokensB.issuePageSessionToken(signB.refreshToken))!;
    const config = { issuer: 'https://example.test/auth', audience: 'https://example.test', loginPath: '/login', registrationPath: '/register',
      emitCode: emitPlatformCode, getTokenService: () => tokensA, getService: () => null, getUserStore: () => a.getRuntime().getStore() };
    const post = (cookie: string) => new Request('https://example.test/oauth/authorize', { method: 'POST', headers: { Cookie: cookie } });
    await expect(resolveNativePagePost(post(`${tokensA.pageSessionCookieName}=${pageA.token}`), config)).resolves.toMatchObject({ userId: signA.user.userId });
    await expect(resolveNativePagePost(post(`${PAGE_SESSION_COOKIE_NAME}=${pageA.token}`), config)).resolves.toMatchObject({ userId: signA.user.userId });
    for (const invalid of ['', '%ZZ', 'invalid']) await expect(resolveNativePagePost(post(
      `${tokensA.pageSessionCookieName}=${invalid}; ${PAGE_SESSION_COOKIE_NAME}=${pageA.token}`), config)).resolves.toBeNull();
    await expect(resolveNativePagePost(post(`${PAGE_SESSION_COOKIE_NAME}=${pageB.token}; ${tokensB.pageSessionCookieName}=${pageB.token}`), config)).resolves.toBeNull();
    const logout = await a.app.handle(new Request('https://example.test/auth/logout', { method: 'POST', headers: {
      Cookie: `${PAGE_SESSION_COOKIE_NAME}=${pageB.token}; ${tokensB.pageSessionCookieName}=${pageB.token}`, 'Content-Type': 'application/json' }, body: '{}' }));
    expect(logout.headers.getSetCookie()).toHaveLength(1);
    expect(logout.headers.getSetCookie()[0]).toStartWith(`${tokensA.pageSessionCookieName}=`);
    await expect(tokensB.resolvePageSessionToken(pageB.token)).resolves.toMatchObject({ userId: signB.user.userId });
  } finally { await a.close(); await b.close(); }
});

test('a rebuilt Guardian runtime on the persisted SYSTEM database keeps the exact cookie namespace and valid page identity', async () => {
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'page-cookie-restart-')); const path = join(directory, 'system.sqlite');
  let db = createReactiveDB({ mode: 'file', path, observability: null }); let f = contactFixture({ db, profile: {} });
  try {
    const response = await f.request('POST', '/auth/register', { username: 'persisted-cookie', email: 'persisted-cookie@example.test', password: 'password123' });
    expect(response.status).toBe(200);
    const tokens = f.getRuntime().getTokenService()!, name = tokens.pageSessionCookieName;
    const cookie = response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))!.split(';')[0]!;
    const appId = new AuthSessionContinuationStore(db).applicationId;
    await f.close(); db.dispose();
    db = createReactiveDB({ mode: 'file', path, observability: null }); f = contactFixture({ db, profile: {} }); await f.getRuntime().start();
    const rebuilt = f.getRuntime().getTokenService()!;
    expect(rebuilt.pageSessionCookieName).toBe(name); expect(new AuthSessionContinuationStore(db).applicationId).toBe(appId);
    await expect(resolvePageSessionAuth(new Request('http://different-host.test/page', { headers: { Cookie: cookie,
      'X-Forwarded-Host': 'untrusted-other-app.test', 'X-Forwarded-Proto': 'https' } }), rebuilt)).resolves.toMatchObject({ userId: response.body.user.userId });
  } finally { await f.close(); db.dispose(); await rm(directory, { recursive: true, force: true }); }
}, 20_000);
