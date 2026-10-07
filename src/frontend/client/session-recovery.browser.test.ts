/** Synthetic HTTP/cookie regressions for real AppProvider session recovery. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';
import { getBrowserAuthStorageKeys } from './auth-browser-coordination';
import type { AuthUser, AuthTenantSummary } from './auth-types';
import type { RouteAuthorizationBoundary } from '../router/authorization-route-boundary';
import type { SessionRecoveryPaint } from './test-fixtures/session-recovery-app-provider';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const TEST_TIMEOUT_MS = 60_000;
const COOKIE = 'zero_test_page_session';
let browser: Browser | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let buildDir: string | undefined;
let bundle = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const scratchRoot = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'session-recovery-browser-'));
  const output = join(buildDir, 'fixture.js');
  const build = Bun.spawn([
    process.execPath, 'build',
    join(import.meta.dir, 'test-fixtures/session-recovery-app-provider.tsx'),
    '--target=browser', '--format=iife', '--outfile', output,
  ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Session fixture build failed (${code}): ${stderr || stdout}`);
  bundle = await Bun.file(output).text();
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  try {
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  } finally {
    lease?.release();
  }
}, TEST_TIMEOUT_MS);

describe('hydrated session recovery with real HTTP and page cookies', () => {
  browserTest('refresh reinstalls the HttpOnly page cookie before reloading loader data', async () => {
    const harness = await openHarness({ cookie: null });
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      expect(harness.state.documents).toBe(2);
      expect(harness.state.refreshesAtDocument[1]).toBeGreaterThanOrEqual(2);
      expect(harness.state.refreshes).toBeGreaterThanOrEqual(2);
      expect(harness.state.refreshes).toBeLessThanOrEqual(4);
      expect(harness.state.logouts).toBe(0);
      const cookie = (await harness.context.cookies()).find((entry) => entry.name === COOKIE);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.value).toBe('user-a');
      await expectNoStalePaints(harness.page);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  browserTest('a definitively rejected old credential clears the page session and reaches login', async () => {
    const harness = await openHarness({ rejectRefresh: true });
    try {
      await harness.page.getByRole('form', { name: 'Sign in' }).waitFor();
      expect(new URL(harness.page.url()).pathname).toBe('/login');
      expect(harness.state.logouts).toBe(1);
      expect(harness.state.documents).toBeLessThanOrEqual(2);
      expect(await snapshot(harness.page)).toMatchObject({ userId: null, hasRecoverableSession: false });
      expect((await harness.context.cookies()).some((entry) => entry.name === COOKIE)).toBe(false);
      expect(await paints(harness.page)).toEqual([]);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  for (const failure of ['server', 'network'] as const) {
    browserTest(`${failure} refresh failure retains proof and explicit Retry performs recovery`, async () => {
      const harness = await openHarness({
        refreshUnavailable: failure === 'server',
        ...(failure === 'network' ? { cookie: null } : {}),
      }, failure === 'network');
      try {
        const retry = harness.page.getByRole('button', { name: 'Retry session', exact: true });
        await retry.waitFor();
        expect(await retry.isEnabled()).toBe(true);
        expect(await snapshot(harness.page)).toMatchObject({ userId: null, hasRecoverableSession: true });
        expect(harness.state.logouts).toBe(0);
        expect(harness.state.documents).toBe(1);
        expect(await paints(harness.page)).toEqual([]);
        const failedRequests = harness.state.refreshes;
        if (failure === 'network') await harness.page.unroute('**/auth/refresh');
        harness.state.refreshUnavailable = false;
        await retry.click();
        await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
        expect(harness.state.refreshes).toBeGreaterThan(failedRequests);
        expect(harness.state.logouts).toBe(0);
        expect(await snapshot(harness.page)).toMatchObject({ userId: 'user-a', hasRecoverableSession: true });
        await expectNoStalePaints(harness.page);
      } finally { await harness.close(); }
    }, TEST_TIMEOUT_MS);
  }

  for (const endpoint of ['me', 'authorization'] as const) {
    browserTest(`transient ${endpoint} failure retains proof and never releases stale loader children`, async () => {
      const harness = await openHarness({ cookie: null, unavailableEndpoint: endpoint });
      try {
        const retry = harness.page.getByRole('button', { name: 'Retry session', exact: true });
        await retry.waitFor();
        expect(await retry.isEnabled()).toBe(true);
        expect((await snapshot(harness.page)).hasRecoverableSession).toBe(true);
        expect(harness.state.documents).toBe(1);
        expect(harness.state.logouts).toBe(0);
        expect(await paints(harness.page)).toEqual([]);
        expect(await harness.page.content()).not.toContain('PRIVATE_RECOVERY_DETAIL');
        harness.state.unavailableEndpoint = null;
        await retry.click();
        await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
        expect(harness.state.logouts).toBe(0);
        await expectNoStalePaints(harness.page);
      } finally { await harness.close(); }
    }, TEST_TIMEOUT_MS);
  }

  browserTest('a stalled refresh response body is bounded and leaves an explicit safe retry', async () => {
    const harness = await openHarness({ cookie: null, stallRefreshBody: true });
    try {
      const retry = harness.page.getByRole('button', { name: 'Retry session', exact: true });
      await retry.waitFor({ timeout: 40_000 });
      expect(await retry.isEnabled()).toBe(true);
      expect((await snapshot(harness.page)).hasRecoverableSession).toBe(true);
      expect(harness.state.refreshes).toBeLessThanOrEqual(2);
      expect(harness.state.documents).toBe(1);
      expect(harness.state.logouts).toBe(0);
      expect(await paints(harness.page)).toEqual([]);
      harness.state.stallRefreshBody = false;
      await retry.click();
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      expect(harness.state.logouts).toBe(0);
      await expectNoStalePaints(harness.page);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  for (const endpoint of ['me', 'authorization'] as const) {
    for (const status of [401, 403] as const) {
      browserTest(`${endpoint} ${status} after refresh clears its new page cookie once and reaches login`, async () => {
        const harness = await openHarness({
          cookie: null, rejectedEndpoint: endpoint, rejectStatus: status,
        });
        try {
          await harness.page.getByRole('form', { name: 'Sign in' }).waitFor();
          expect(new URL(harness.page.url()).pathname).toBe('/login');
          expect(harness.state.refreshes).toBeGreaterThanOrEqual(1);
          expect(harness.state.logouts).toBe(1);
          expect(harness.state.documents).toBeLessThanOrEqual(2);
          expect((await harness.context.cookies()).some((entry) => entry.name === COOKIE)).toBe(false);
          expect(await snapshot(harness.page)).toMatchObject({ userId: null, hasRecoverableSession: false });
          expect(await paints(harness.page)).toEqual([]);
        } finally { await harness.close(); }
      }, TEST_TIMEOUT_MS);
    }
  }

  browserTest('persistent disagreement has a bounded reload and Retry/Sign out perform their actual operations', async () => {
    const harness = await openHarness({ persistentMismatch: true, sessionUser: 'user-b' });
    try {
      await harness.page.getByRole('button', { name: 'Retry session', exact: true }).waitFor();
      const documents = harness.state.documents;
      const refreshes = harness.state.refreshes;
      expect(documents).toBe(2);
      expect(refreshes).toBeLessThanOrEqual(4);
      await harness.page.waitForTimeout(350);
      expect(harness.state.documents).toBe(documents);
      expect(harness.state.refreshes).toBe(refreshes);
      expect(await paints(harness.page)).toEqual([]);

      await Promise.all([
        harness.page.waitForResponse('**/auth/refresh'),
        harness.page.getByRole('button', { name: 'Retry session', exact: true }).click(),
      ]);
      await harness.page.waitForFunction(() => Boolean(document.querySelector('[data-zero-auth-recovery]')));
      await harness.page.waitForFunction(() => Boolean(document.querySelector('button')?.textContent?.includes('Retry')));
      expect(harness.state.refreshes).toBeGreaterThan(refreshes);
      expect(harness.state.documents).toBeLessThanOrEqual(documents + 1);
      expect(harness.state.logouts).toBe(0);

      await harness.page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await harness.page.getByRole('form', { name: 'Sign in' }).waitFor();
      expect(harness.state.logouts).toBe(1);
      expect(await snapshot(harness.page)).toMatchObject({ userId: null, hasRecoverableSession: false });
      expect(await paints(harness.page)).toEqual([]);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  for (const replacement of ['user', 'tenant', 'role'] as const) {
    browserTest(`valid ${replacement} replacement never renders the previous loader in its new scope`, async () => {
      const harness = await openHarness({ tenant: replacement === 'tenant' ? 'tenant-a' : null });
      try {
        await expectProtected(harness.page, 'user-a', replacement === 'tenant' ? 'tenant-a' : 'application', 'revision-1');
        if (replacement === 'user') {
          await harness.page.evaluate(() => window.__sessionRecoveryHarness.login('user-b'));
        } else if (replacement === 'tenant') {
          await harness.page.evaluate(() => window.__sessionRecoveryHarness.switchTenant('tenant-b'));
        } else {
          harness.state.revision = 'revision-2';
          harness.state.scopeRoles = ['manager'];
          await harness.page.evaluate(() => window.__sessionRecoveryHarness.refreshAuthorization());
        }
        await expectProtected(
          harness.page,
          replacement === 'user' ? 'user-b' : 'user-a',
          replacement === 'tenant' ? 'tenant-b' : 'application',
          replacement === 'role' ? 'revision-2' : 'revision-1',
        );
        expect(harness.state.logouts).toBe(0);
        await expectNoStalePaints(harness.page);
      } finally { await harness.close(); }
    }, TEST_TIMEOUT_MS);
  }
  browserTest('a failed persisted-family replacement masks old loader data and offers Retry instead of permanent Restoring', async () => {
    const harness = await openHarness();
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      const documentsBeforeReplacement = harness.state.documents;
      harness.state.sessionUser = 'user-b'; harness.state.credential = 'synthetic-replacement-b'; harness.state.refreshUnavailable = true;
      await harness.page.evaluate(({ keys, credential }) => {
        const previous = JSON.parse(window.localStorage.getItem(keys.credential)!);
        const revision = previous.revision + 1;
        window.localStorage.setItem(keys.credential, JSON.stringify({ version: 1, revision,
          refreshToken: credential, scopeId: 'synthetic-family-b', updatedAt: Date.now() }));
        // A same-origin peer's sanitized scope receipt is the actual supported
        // replacement trigger; reconcileSession only retries an existing barrier.
        window.dispatchEvent(new StorageEvent('storage', { key: keys.signal,
          newValue: JSON.stringify({ version: 1, namespace: keys.namespace, sourceId: 'synthetic-other-tab',
            revision, scopeId: 'synthetic-family-b', kind: 'scope' }) }));
      }, { keys: getBrowserAuthStorageKeys(harness.page.url()), credential: harness.state.credential });
      const retry = harness.page.getByRole('button', { name: 'Retry session', exact: true }); await retry.waitFor({ timeout: 5000 });
      expect(await retry.isEnabled()).toBe(true);
      expect(await snapshot(harness.page)).toMatchObject({ userId: null, tenantId: null, hasRecoverableSession: true, isLoading: false });
      expect(await harness.page.getByTestId('protected-loader').count()).toBe(0);
      expect(harness.state.logouts).toBe(0); expect(harness.state.documents).toBe(documentsBeforeReplacement);
      const failedRefreshes = harness.state.refreshes; harness.state.refreshUnavailable = false; await retry.click();
      await expectProtected(harness.page, 'user-b', 'application', 'revision-1');
      expect(harness.state.refreshes).toBeGreaterThan(failedRefreshes); expect(harness.state.logouts).toBe(0);
      await expectNoStalePaints(harness.page);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);
});

interface AuthorityState {
  sessionUser: string;
  role: string;
  scopeRoles: string[];
  tenant: string | null;
  revision: string;
  rejectRefresh: boolean;
  refreshUnavailable: boolean;
  stallRefreshBody: boolean;
  unavailableEndpoint: 'me' | 'authorization' | null;
  rejectedEndpoint: 'me' | 'authorization' | null;
  rejectStatus: 401 | 403;
  persistentMismatch: boolean;
  documents: number;
  refreshes: number;
  logouts: number;
  refreshesAtDocument: number[];
  credential: string;
}

async function openHarness(options: Partial<AuthorityState> & { cookie?: string | null } = {}, abortRefresh = false) {
  if (!browser || !bundle) throw new Error('Session-recovery browser harness is unavailable.');
  const state: AuthorityState = {
    sessionUser: 'user-a', role: 'user', scopeRoles: ['member'], tenant: null, revision: 'revision-1',
    rejectRefresh: false, refreshUnavailable: false, stallRefreshBody: false,
    unavailableEndpoint: null,
    rejectedEndpoint: null, rejectStatus: 401,
    persistentMismatch: false,
    documents: 0, refreshes: 0, logouts: 0, refreshesAtDocument: [],
    credential: 'synthetic-refresh-0', ...options,
  };
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 60,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/fixture.js') return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } });
      if (path === '/auth/refresh') {
        state.refreshes += 1;
        const body = await request.json() as { refreshToken?: string };
        if (state.refreshUnavailable) return Response.json({ error: 'Temporarily unavailable', code: 'AUTH_NOT_READY' }, { status: 503 });
        if (state.rejectRefresh || body.refreshToken !== state.credential) {
          return Response.json({ error: 'Invalid refresh', code: 'UNAUTHORIZED' }, { status: 401 });
        }
        if (state.stallRefreshBody) {
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"accessToken":'));
            },
          }), { headers: { 'Content-Type': 'application/json' } });
        }
        state.credential = `synthetic-refresh-${state.refreshes}`;
        return sessionResponse(state, false);
      }
      if (path === `/auth/${state.unavailableEndpoint}`) {
        return Response.json({ error: 'PRIVATE_RECOVERY_DETAIL', code: 'AUTH_NOT_READY' }, { status: 503 });
      }
      if (path === `/auth/${state.rejectedEndpoint}`) {
        return Response.json({ error: 'Rejected session', code: 'UNAUTHORIZED' }, { status: state.rejectStatus });
      }
      if ((path === '/auth/me' || path === '/auth/authorization')
        && !request.headers.get('Authorization')?.startsWith('Bearer header.')) {
        return Response.json({ error: 'Missing bearer', code: 'UNAUTHORIZED' }, { status: 401 });
      }
      if (path === '/auth/me') return Response.json(user(state));
      if (path === '/auth/authorization') return Response.json(authorization(state));
      if (path === '/auth/logout') {
        state.logouts += 1;
        return Response.json({ success: true }, { headers: { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
      }
      if (path === '/auth/login') {
        const body = await request.json() as { username: string };
        state.sessionUser = body.username;
        state.credential = `synthetic-login-${state.refreshes}`;
        return sessionResponse(state, true);
      }
      if (path === '/auth/tenants/switch') {
        const body = await request.json() as { tenantId: string; refreshToken: string };
        if (body.refreshToken !== state.credential) {
          return Response.json({ error: 'Invalid refresh', code: 'UNAUTHORIZED' }, { status: 401 });
        }
        state.tenant = body.tenantId;
        state.credential = `synthetic-tenant-${state.refreshes}`;
        return sessionResponse(state, true);
      }
      if (path !== '/' && path !== '/login') return new Response('Not found', { status: 404 });
      state.documents += 1;
      state.refreshesAtDocument.push(state.refreshes);
      const cookieUser = cookieValue(request.headers.get('cookie'), COOKIE);
      const loader = boundary(state, state.persistentMismatch && cookieUser ? 'user-a' : cookieUser);
      return new Response(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
        <script>window.__ROUTE_DATA__=${JSON.stringify({ authorizationBoundary: loader })};window.__sessionRecoveryLoader=${JSON.stringify(loader)};</script>
        <script src="/fixture.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } });
    },
  });
  const origin = server.url.origin;
  const context = await browser.newContext();
  const cookie = options.cookie === undefined ? 'user-a' : options.cookie;
  if (cookie) await context.addCookies([{ name: COOKIE, value: cookie, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(({ key, credential, origin }) => {
    if (window.location.origin !== origin) return;
    if (window.localStorage.getItem(key) === null) {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, revision: 1, refreshToken: credential, scopeId: 'synthetic-family', updatedAt: Date.now() }));
    }
  }, { key: getBrowserAuthStorageKeys(origin).credential, credential: state.credential, origin });
  const page = await context.newPage();
  if (abortRefresh) await page.route('**/auth/refresh', (route) => route.abort('failed'));
  await page.goto(origin);
  return {
    page, context, state,
    async close() {
      try { await context.close(); } finally { await server.stop(true); }
    },
  };
}

function sessionResponse(state: AuthorityState, includeUser: boolean): Response {
  return Response.json({
    accessToken: `header.${btoa(JSON.stringify({ sub: state.sessionUser, sid: state.tenant ?? 'application', tenantId: state.tenant, role: state.role, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`,
    refreshToken: state.credential,
    ...(state.tenant ? { activeTenant: tenant(state.tenant) } : {}),
    ...(includeUser ? { user: user(state) } : {}),
  }, { headers: { 'Set-Cookie': `${COOKIE}=${state.sessionUser}; Path=/; HttpOnly; SameSite=Lax` } });
}

function user(state: AuthorityState): AuthUser {
  return { userId: state.sessionUser, username: state.sessionUser, email: `${state.sessionUser}@example.test`, firstName: null, lastName: null, role: state.role, status: 'active', passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false, mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null };
}

function tenant(id: string): AuthTenantSummary {
  return { tenantId: id, kind: 'organization', slug: id, name: id, role: 'member' };
}

function boundary(state: AuthorityState, userId: string | null): RouteAuthorizationBoundary {
  return { userId, platformRole: userId ? (userId === state.sessionUser ? state.role : 'user') : null, scopeKind: userId ? state.tenant ? 'tenant' : 'application' : null, scopeId: userId ? state.tenant ?? 'application' : null, scopeRevision: userId ? state.revision : null };
}

function authorization(state: AuthorityState) {
  return { version: 1, identity: { userId: state.sessionUser, platformRole: state.role }, profile: { tenancy: state.tenant ? 'multi' : 'single', authorization: 'advanced' }, scope: { kind: state.tenant ? 'tenant' : 'application', scopeId: state.tenant ?? 'application', roles: state.scopeRoles, permissions: [], allPermissions: false, revision: state.revision, ...(state.tenant ? { tenantId: state.tenant, membershipId: `membership-${state.tenant}` } : {}) }, revision: state.revision };
}

function cookieValue(header: string | null, name: string): string | null {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

async function expectProtected(page: Page, userId: string, scopeId: string, revision: string) {
  await page.getByTestId('protected-loader').filter({ hasText: `Loader ${userId}/${scopeId}/${revision}` }).waitFor();
}

async function snapshot(page: Page) {
  return page.evaluate(() => window.__sessionRecoveryHarness.snapshot());
}

async function paints(page: Page): Promise<SessionRecoveryPaint[]> {
  return page.evaluate(() => window.__sessionRecoveryHarness.paints());
}

async function expectNoStalePaints(page: Page) {
  const records = await paints(page);
  expect(records.length).toBeGreaterThan(0);
  expect(records.filter((record) => (
    record.loader.userId !== record.browserUser
    || record.loader.platformRole !== record.browserRole
    || record.loader.scopeId !== (record.browserTenant ?? 'application')
    || (record.browserRevision !== null && record.loader.scopeRevision !== record.browserRevision)
  ))).toEqual([]);
}
