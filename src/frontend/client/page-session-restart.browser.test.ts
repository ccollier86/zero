/** Real persisted Guardian restart with browser proof and actual AppProvider recovery. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createReactiveDB } from '../../sync/reactive-db';
import { contactFixture } from '../../auth/auth-user-contact.test-fixture';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { rejectedPageSessionCookieHeader, resolvePageSessionAuth } from '../../auth/page-session';
import { createRouteAuthorizationBoundary } from '../router/authorization-route-boundary';
import { getBrowserAuthStorageKeys } from './auth-browser-coordination';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import type { SessionRecoveryHarness } from './test-fixtures/session-recovery-app-provider';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
let lease: PlaywrightTestBrowserLease | undefined, buildDirectory: string | undefined, bundle = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); await mkdir(scratch, { recursive: true });
  buildDirectory = await mkdtemp(join(scratch, 'persisted-session-restart-build-'));
  const output = join(buildDirectory, 'fixture.js');
  const build = Bun.spawn([process.execPath, 'build', join(import.meta.dir, 'test-fixtures/session-recovery-app-provider.tsx'),
    '--target=browser', '--format=iife', '--outfile', output], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
  if (code !== 0) throw new Error(`Persisted restart fixture build failed (${code}): ${stderr || stdout}`);
  bundle = await Bun.file(output).text();
}, 30_000);

afterAll(async () => {
  try { if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true }); }
  finally { lease?.release(); }
});

for (const invalidated of [false, true]) browserTest(
  `same persisted SYSTEM restart ${invalidated ? 'definitively invalidates the family and reaches usable login' : 'retains the browser session and reconciles without a recovery loop'}`,
  async () => {
    if (!lease || !bundle) throw new Error('Persisted restart browser fixture is unavailable.');
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(join(scratch, 'persisted-session-restart-')), path = join(directory, 'system.sqlite');
    let db = createReactiveDB({ mode: 'file', path, observability: null });
    let fixture: ReturnType<typeof contactFixture> | null = contactFixture({ db, profile: {} });
    await fixture.getRuntime().start();
    let documents = 0, refreshes = 0, logouts = 0;
    const serve = (port: number) => Bun.serve({ hostname: '127.0.0.1', port, async fetch(request) {
      const route = new URL(request.url).pathname;
      if (route === '/fixture.js') return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } });
      if (route.startsWith('/auth/')) {
        if (route === '/auth/refresh') refreshes++; if (route === '/auth/logout') logouts++;
        return fixture!.app.handle(request);
      }
      if (route !== '/' && route !== '/login') return new Response('Not found', { status: 404 });
      documents++;
      const runtime = fixture!.getRuntime(), tokens = runtime.getTokenService()!;
      const auth = await resolvePageSessionAuth(request, tokens);
      const access = createRequestAuthorizationAccess({ authContext: auth, kernel: runtime.getAuthorizationKernel(),
        propertyStore: runtime.getStore(), roleAssignments: runtime.getAuthorizationRoleService() });
      const boundary = createRouteAuthorizationBoundary(auth, access), clear = auth ? null : rejectedPageSessionCookieHeader(request, tokens);
      if (!auth && route === '/') return new Response(null, { status: 302, headers: { Location: '/login', ...(clear ? { 'Set-Cookie': clear } : {}) } });
      return new Response(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
        <script>window.__ROUTE_DATA__=${JSON.stringify({ authorizationBoundary: boundary })};window.__sessionRecoveryLoader=${JSON.stringify(boundary)};</script>
        <script src="/fixture.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private, no-store', ...(clear ? { 'Set-Cookie': clear } : {}) } });
    } });
    let server = serve(0); const port = server.port!, origin = server.url.origin;
    const context = await lease.browser.newContext(), page = await context.newPage(), pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message)); page.setDefaultTimeout(7000);
    try {
      await page.goto(`${origin}/login`);
      const registration = await page.evaluate(async () => {
        const response = await fetch('/auth/register', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'persisted-browser-owner', email: 'persisted-browser-owner@example.test', password: 'password123' }) });
        return { status: response.status, session: await response.json() };
      });
      expect(registration.status).toBe(200);
      const session = registration.session, name = fixture.getRuntime().getTokenService()!.pageSessionCookieName;
      await page.evaluate(({ credentialKey, refreshToken }) => {
        localStorage.setItem(credentialKey,
          JSON.stringify({ version: 1, revision: 1, refreshToken, scopeId: 'synthetic-persisted-family', updatedAt: Date.now() }));
      }, { credentialKey: getBrowserAuthStorageKeys(origin).credential, refreshToken: session.refreshToken });
      await page.goto(origin); await page.getByTestId('protected-loader').waitFor();
      expect(await page.evaluate(() => (window.__sessionRecoveryHarness as SessionRecoveryHarness).snapshot())).toMatchObject({ userId: session.user.userId, hasRecoverableSession: true });
      expect(await page.evaluate(() => window.__sessionRecoveryHarness.recoveryPaintCount())).toBe(0);
      const beforeRestartDocuments = documents, beforeRestartRefreshes = refreshes;
      await server.stop(true); await fixture.close(); fixture = null; db.dispose();
      db = createReactiveDB({ mode: 'file', path, observability: null }); fixture = contactFixture({ db, profile: {} }); await fixture.getRuntime().start();
      expect(fixture.getRuntime().getTokenService()!.pageSessionCookieName).toBe(name);
      if (invalidated) fixture.getRuntime().getStore()!.revokeAllUserTokens(session.user.userId);
      server = serve(port); await page.reload();
      if (invalidated) {
        await page.getByRole('form', { name: 'Sign in', exact: true }).waitFor();
        expect(new URL(page.url()).pathname).toBe('/login');
        expect(await page.evaluate(() => window.__sessionRecoveryHarness.snapshot())).toMatchObject({ userId: null, hasRecoverableSession: false, isLoading: false });
        expect((await context.cookies()).some(cookie => cookie.name === name)).toBe(false);
        expect(await page.evaluate(() => window.__sessionRecoveryHarness.recoveryPaintCount())).toBe(0);
      } else {
        await page.getByTestId('protected-loader').waitFor();
        expect(await page.evaluate(() => window.__sessionRecoveryHarness.snapshot())).toMatchObject({ userId: session.user.userId, hasRecoverableSession: true, isLoading: false });
        expect(refreshes).toBeGreaterThan(beforeRestartRefreshes); expect(logouts).toBe(0);
        expect((await context.cookies()).find(cookie => cookie.name === name)?.httpOnly).toBe(true);
        expect(documents - beforeRestartDocuments).toBe(1);
        expect(await page.evaluate(() => window.__sessionRecoveryHarness.recoveryPaintCount())).toBe(0);
      }
      expect(documents - beforeRestartDocuments).toBeLessThanOrEqual(3);
      const settledDocuments = documents, settledRefreshes = refreshes; await page.waitForTimeout(350);
      expect(documents).toBe(settledDocuments); expect(refreshes).toBe(settledRefreshes);
      expect(await page.getByRole('button', { name: 'Retry session', exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => window.__sessionRecoveryHarness.paints().filter(paint => paint.loader.userId !== paint.browserUser
        || paint.loader.platformRole !== paint.browserRole || paint.loader.scopeId !== (paint.browserTenant ?? 'application')
        || (paint.browserRevision !== null && paint.loader.scopeRevision !== paint.browserRevision)))).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close(); await server.stop(true); if (fixture) await fixture.close(); db.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 40_000,
);

for (const replacement of [false, true]) browserTest(
  `late document after ${replacement ? 'a new sign-in family' : 'ordinary refresh'} cannot erase the newer browser cookie`,
  async () => {
    if (!lease) throw new Error('Cookie ordering browser fixture is unavailable.');
    const fixture = contactFixture({ profile: {} }); await fixture.getRuntime().start();
    let entered!: () => void, release!: () => void;
    const captured = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let documentCookieHeader: string | null | undefined;
    const tokens = fixture.getRuntime().getTokenService()!;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/auth/')) return fixture.app.handle(request);
      if (path === '/probe') return new Response('<!doctype html><html><body>Cookie ordering fixture</body></html>', {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private, no-store' },
      });
      if (path === '/held-document') { entered(); await gate; }
      const auth = await resolvePageSessionAuth(request, tokens);
      const clear = auth ? null : rejectedPageSessionCookieHeader(request, tokens);
      if (path === '/held-document') documentCookieHeader = clear;
      return Response.json({ authenticated: auth !== null }, {
        status: auth ? 200 : 401,
        headers: { 'Cache-Control': 'private, no-store', ...(clear ? { 'Set-Cookie': clear } : {}) },
      });
    } });
    const context = await lease.browser.newContext(), page = await context.newPage();
    try {
      await page.goto(`${server.url.origin}/probe`);
      const signed = await page.evaluate(async () => {
        const response = await fetch('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'response-order-owner', email: 'response-order-owner@example.test', password: 'password123' }) });
        return { status: response.status, session: await response.json() };
      });
      expect(signed.status).toBe(200);
      const late = page.evaluate(async () => {
        const response = await fetch('/held-document'); return { status: response.status, body: await response.json() };
      });
      await captured;
      const next = await page.evaluate(async ({ replacement, refreshToken }) => {
        const response = await fetch(replacement ? '/auth/login' : '/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(replacement ? { username: 'response-order-owner', password: 'password123' } : { refreshToken }),
        });
        return { status: response.status, session: await response.json() };
      }, { replacement, refreshToken: signed.session.refreshToken });
      expect(next.status).toBe(200);
      const newerCookie = (await context.cookies()).find(cookie => cookie.name === tokens.pageSessionCookieName)!;
      expect(newerCookie?.httpOnly).toBe(true);
      release();
      expect(await late).toEqual({ status: replacement ? 401 : 200, body: { authenticated: !replacement } });
      expect(documentCookieHeader).toBeNull();
      expect((await context.cookies()).find(cookie => cookie.name === tokens.pageSessionCookieName)?.value).toBe(newerCookie.value);
      expect(await page.evaluate(async () => (await fetch('/accepted-document')).status)).toBe(200);
      expect(await page.evaluate(async refreshToken => (await fetch('/auth/logout', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) })).status,
      next.session.refreshToken)).toBe(200);
      expect((await context.cookies()).some(cookie => cookie.name === tokens.pageSessionCookieName)).toBe(false);
    } finally { release(); await context.close(); await server.stop(true); await fixture.close(); }
  }, 20_000,
);

browserTest('two SDK tabs serialize sign-in HTTP behind an older held logout response', async () => {
  if (!lease || !bundle) throw new Error('SDK cookie-writer ordering fixture is unavailable.');
  const fixture = contactFixture({ profile: {} }); await fixture.getRuntime().start();
  const registration = await fixture.app.handle(new Request('http://fixture.test/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sdk-writer-owner', email: 'sdk-writer-owner@example.test', password: 'password123' }),
  }));
  expect(registration.status).toBe(200);
  const registered = await registration.json();
  const tokens = fixture.getRuntime().getTokenService()!;
  let enterLogout!: () => void, releaseLogout!: () => void;
  const logoutEntered = new Promise<void>(resolve => { enterLogout = resolve; });
  const logoutGate = new Promise<void>(resolve => { releaseLogout = resolve; });
  let loginRequests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } });
    if (path.startsWith('/auth/')) {
      if (path === '/auth/login') loginRequests++;
      const response = await fixture.app.handle(request);
      // Guardian has already revoked the old parent and prepared its deletion
      // cookie. Hold delivery, not the endpoint's work, to exercise HTTP order.
      if (path === '/auth/logout') { enterLogout(); await logoutGate; }
      return response;
    }
    const auth = await resolvePageSessionAuth(request, tokens);
    const runtime = fixture.getRuntime();
    const access = createRequestAuthorizationAccess({ authContext: auth, kernel: runtime.getAuthorizationKernel(),
      propertyStore: runtime.getStore(), roleAssignments: runtime.getAuthorizationRoleService() });
    const boundary = createRouteAuthorizationBoundary(auth, access);
    return new Response(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
      <script>window.__ROUTE_DATA__=${JSON.stringify({ authorizationBoundary: boundary })};window.__sessionRecoveryLoader=${JSON.stringify(boundary)};</script>
      <script src="/fixture.js"></script></body></html>`, {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private, no-store' },
    });
  } });
  const context = await lease.browser.newContext(), oldTab = await context.newPage(), newTab = await context.newPage();
  oldTab.setDefaultTimeout(7000); newTab.setDefaultTimeout(7000);
  let logoutResult: Promise<{ accepted: boolean }> | undefined;
  let loginResult: Promise<{ accepted: boolean }> | undefined;
  try {
    await oldTab.goto(`${server.url.origin}/login`);
    await oldTab.waitForFunction(() => window.__sessionRecoveryHarness
      && !window.__sessionRecoveryHarness.snapshot().isRestoring);
    // The regression concerns the public SDK's cookie critical section, not
    // route reloads. Leave its real client alive but retire fixture rendering.
    await oldTab.evaluate(() => window.__sessionRecoveryHarness.unmountProvider());
    await oldTab.evaluate(() => window.__sessionRecoveryHarness.login('sdk-writer-owner', 'password123'));
    expect(await oldTab.evaluate(() => window.__sessionRecoveryHarness.snapshot())).toMatchObject({
      userId: registered.user.userId, hasRecoverableSession: true,
    });
    await newTab.goto(`${server.url.origin}/login`);
    await newTab.waitForFunction(() => window.__sessionRecoveryHarness
      && !window.__sessionRecoveryHarness.snapshot().isRestoring
      && !window.__sessionRecoveryHarness.snapshot().isLoading
      && window.__sessionRecoveryHarness.snapshot().userId !== null);
    await newTab.evaluate(() => window.__sessionRecoveryHarness.unmountProvider());
    const oldCookie = (await context.cookies()).find(cookie => cookie.name === tokens.pageSessionCookieName)!;
    expect(loginRequests).toBe(1);
    logoutResult = oldTab.evaluate(async () => {
      try { await window.__sessionRecoveryHarness.logout(); return { accepted: true }; }
      catch { return { accepted: false }; }
    });
    await logoutEntered;
    const loginDelivered = new Promise<void>(resolve => {
      newTab.on('response', response => {
        if (new URL(response.url()).pathname === '/auth/login') {
          void response.finished().then(() => resolve());
        }
      });
    });
    loginResult = newTab.evaluate(async () => {
      try { await window.__sessionRecoveryHarness.login('sdk-writer-owner', 'password123'); return { accepted: true }; }
      catch { return { accepted: false }; }
    });
    // In either implementation, the second tab queues a credential operation:
    // before the fix this happens only AFTER its sign-in response sets a cookie.
    // A pending Web Lock makes the observation deterministic without fake HTTP.
    await newTab.waitForFunction(async lockName => {
      const locks = await navigator.locks.query();
      return locks.pending?.some(lock => lock.name === lockName);
    }, getBrowserAuthStorageKeys(server.url.origin).lockName);
    if (loginRequests > 1) await loginDelivered;
    const beforeRelease = {
      loginRequests,
      cookieUnchanged: (await context.cookies()).find(cookie => cookie.name === tokens.pageSessionCookieName)?.value === oldCookie.value,
    };
    releaseLogout();
    const completed = { logout: await logoutResult, login: await loginResult };
    const currentCookie = (await context.cookies()).find(cookie => cookie.name === tokens.pageSessionCookieName);
    const admitted = currentCookie ? await resolvePageSessionAuth(new Request(`${server.url.origin}/accepted-document`, {
      headers: { Cookie: `${tokens.pageSessionCookieName}=${encodeURIComponent(currentCookie.value)}` },
    }), tokens) : null;
    const browser = await newTab.evaluate(() => window.__sessionRecoveryHarness.snapshot());
    // No sign-in cookie may be minted ahead of the still-owned old deletion.
    // The queued intent belongs to the old family, so the logout tombstone
    // must reject it before HTTP rather than accepting stale authentication.
    expect({ beforeRelease, completed, cookiePresent: currentCookie !== undefined,
      serverAdmitted: admitted?.userId === registered.user.userId, browserAuthenticated: browser.userId === registered.user.userId }).toEqual({
      beforeRelease: { loginRequests: 1, cookieUnchanged: true },
      completed: { logout: { accepted: true }, login: { accepted: false } },
      cookiePresent: false, serverAdmitted: false, browserAuthenticated: false,
    });
    expect(loginRequests).toBe(1);
    await newTab.waitForFunction(() => !window.__sessionRecoveryHarness.snapshot().isLoading
      && window.__sessionRecoveryHarness.snapshot().userId === null);
    // A fresh explicit intent starts from the now-anonymous durable scope and
    // must work normally: serialization is not a permanent login prohibition.
    await newTab.evaluate(() => window.__sessionRecoveryHarness.login('sdk-writer-owner', 'password123'));
    const retryCookie = (await context.cookies()).find(cookie => cookie.name === tokens.pageSessionCookieName)!;
    const retryAuth = await resolvePageSessionAuth(new Request(`${server.url.origin}/accepted-document`, {
      headers: { Cookie: `${tokens.pageSessionCookieName}=${encodeURIComponent(retryCookie.value)}` },
    }), tokens);
    expect(loginRequests).toBe(2);
    expect(retryAuth?.userId).toBe(registered.user.userId);
    expect(await newTab.evaluate(() => window.__sessionRecoveryHarness.snapshot())).toMatchObject({
      userId: registered.user.userId, hasRecoverableSession: true, isLoading: false,
    });
  } finally {
    releaseLogout();
    await Promise.allSettled([logoutResult, loginResult]);
    await context.close(); await server.stop(true); await fixture.close();
  }
}, 30_000);

browserTest('two SDK tabs cannot issue competing sign-in cookies before the first family commits', async () => {
  if (!lease || !bundle) throw new Error('Concurrent SDK sign-in fixture is unavailable.');
  const fixture = contactFixture({ profile: {} }); await fixture.getRuntime().start();
  const users: { userId: string }[] = [];
  for (const suffix of ['a', 'b']) {
    const response = await fixture.app.handle(new Request('http://fixture.test/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `parallel-writer-${suffix}`, email: `parallel-writer-${suffix}@example.test`, password: 'password123' }),
    }));
    expect(response.status).toBe(200); users.push((await response.json()).user);
  }
  const tokens = fixture.getRuntime().getTokenService()!;
  let enterFirstLogin!: () => void, releaseFirstLogin!: () => void;
  const firstLoginEntered = new Promise<void>(resolve => { enterFirstLogin = resolve; });
  const firstLoginGate = new Promise<void>(resolve => { releaseFirstLogin = resolve; });
  let loginRequests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } });
    if (path.startsWith('/auth/')) {
      if (path === '/auth/login') loginRequests++;
      const response = await fixture.app.handle(request);
      if (path === '/auth/login' && loginRequests === 1) { enterFirstLogin(); await firstLoginGate; }
      return response;
    }
    const auth = await resolvePageSessionAuth(request, tokens), runtime = fixture.getRuntime();
    const access = createRequestAuthorizationAccess({ authContext: auth, kernel: runtime.getAuthorizationKernel(),
      propertyStore: runtime.getStore(), roleAssignments: runtime.getAuthorizationRoleService() });
    const boundary = createRouteAuthorizationBoundary(auth, access);
    return new Response(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
      <script>window.__ROUTE_DATA__=${JSON.stringify({ authorizationBoundary: boundary })};window.__sessionRecoveryLoader=${JSON.stringify(boundary)};</script>
      <script src="/fixture.js"></script></body></html>`, {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private, no-store' },
    });
  } });
  const context = await lease.browser.newContext(), firstTab = await context.newPage(), secondTab = await context.newPage();
  firstTab.setDefaultTimeout(7000); secondTab.setDefaultTimeout(7000);
  let firstResult: Promise<{ accepted: boolean }> | undefined;
  let secondResult: Promise<{ accepted: boolean }> | undefined;
  try {
    for (const page of [firstTab, secondTab]) {
      await page.goto(`${server.url.origin}/login`);
      await page.waitForFunction(() => window.__sessionRecoveryHarness
        && !window.__sessionRecoveryHarness.snapshot().isRestoring);
      await page.evaluate(() => window.__sessionRecoveryHarness.unmountProvider());
    }
    firstResult = firstTab.evaluate(async () => {
      try { await window.__sessionRecoveryHarness.login('parallel-writer-a', 'password123'); return { accepted: true }; }
      catch { return { accepted: false }; }
    });
    await firstLoginEntered;
    secondResult = secondTab.evaluate(async () => {
      try { await window.__sessionRecoveryHarness.login('parallel-writer-b', 'password123'); return { accepted: true }; }
      catch { return { accepted: false }; }
    });
    await secondTab.waitForFunction(async lockName => (await navigator.locks.query()).pending?.some(lock => lock.name === lockName),
      getBrowserAuthStorageKeys(server.url.origin).lockName);
    expect(loginRequests).toBe(1);
    expect((await context.cookies()).some(cookie => cookie.name === tokens.pageSessionCookieName)).toBe(false);
    releaseFirstLogin();
    expect(await firstResult).toEqual({ accepted: true });
    expect(await secondResult).toEqual({ accepted: false });
    expect(loginRequests).toBe(1);
    await secondTab.waitForFunction(userId => window.__sessionRecoveryHarness.snapshot().userId === userId
      && !window.__sessionRecoveryHarness.snapshot().isLoading, users[0]!.userId);
    const acceptedCookie = (await context.cookies()).find(cookie => cookie.name === tokens.pageSessionCookieName)!;
    expect((await resolvePageSessionAuth(new Request(`${server.url.origin}/accepted-document`, {
      headers: { Cookie: `${tokens.pageSessionCookieName}=${encodeURIComponent(acceptedCookie.value)}` },
    }), tokens))?.userId).toBe(users[0]!.userId);
    // A new explicit account-B attempt is allowed after the first family has
    // settled; both tabs and SSR must then converge on that replacement.
    await secondTab.evaluate(() => window.__sessionRecoveryHarness.login('parallel-writer-b', 'password123'));
    await firstTab.waitForFunction(userId => window.__sessionRecoveryHarness.snapshot().userId === userId
      && !window.__sessionRecoveryHarness.snapshot().isRestoring, users[1]!.userId);
    const replacementCookie = (await context.cookies()).find(cookie => cookie.name === tokens.pageSessionCookieName)!;
    expect((await resolvePageSessionAuth(new Request(`${server.url.origin}/accepted-document`, {
      headers: { Cookie: `${tokens.pageSessionCookieName}=${encodeURIComponent(replacementCookie.value)}` },
    }), tokens))?.userId).toBe(users[1]!.userId);
    expect(loginRequests).toBe(2);
  } finally {
    releaseFirstLogin(); await Promise.allSettled([firstResult, secondResult]);
    await context.close(); await server.stop(true); await fixture.close();
  }
}, 30_000);
