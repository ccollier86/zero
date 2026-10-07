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
      } else {
        await page.getByTestId('protected-loader').waitFor();
        expect(await page.evaluate(() => window.__sessionRecoveryHarness.snapshot())).toMatchObject({ userId: session.user.userId, hasRecoverableSession: true, isLoading: false });
        expect(refreshes).toBeGreaterThan(beforeRestartRefreshes); expect(logouts).toBe(0);
        expect((await context.cookies()).find(cookie => cookie.name === name)?.httpOnly).toBe(true);
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
