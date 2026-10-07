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
  browserTest('matching persisted hard refresh never commits a recovery alert', async () => {
    const harness = await openHarness();
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      const documents = harness.state.documents;
      await harness.page.reload();
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      expect(harness.state.documents).toBe(documents + 1);
      expect(await recoveryPaintCount(harness.page)).toBe(0);
      await expectNoStalePaints(harness.page);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  browserTest('post-purge loading masks old data without credentials, alerts or route reloads', async () => {
    const harness = await openHarness();
    let release!: () => void;
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      harness.state.holdAuthorization = new Promise<void>((resolve) => { release = resolve; });
      const before = { documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts };
      await harness.page.evaluate(() => window.__sessionRecoveryHarness.invalidateAuthorizationData());
      await harness.page.locator('[data-zero-auth-transition]').waitFor();
      await harness.page.waitForTimeout(150);
      expect(await harness.page.getByTestId('protected-loader').count()).toBe(0);
      expect(await recoveryPaintCount(harness.page)).toBe(0);
      expect({ documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts }).toEqual(before);
      release(); harness.state.holdAuthorization = null;
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      expect(harness.state.documents).toBe(before.documents);
      await expectNoStalePaints(harness.page);
    } finally { release?.(); await harness.close(); }
  }, TEST_TIMEOUT_MS);

  browserTest('post-purge access failure retries only authorization and hides private error text', async () => {
    const harness = await openHarness();
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      const before = { documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts };
      harness.state.unavailableEndpoint = 'authorization';
      await harness.page.evaluate(() => window.__sessionRecoveryHarness.invalidateAuthorizationData());
      await harness.page.getByRole('button', { name: 'Retry access', exact: true }).waitFor();
      expect(await harness.page.getByTestId('protected-loader').count()).toBe(0);
      expect(await harness.page.content()).not.toContain('PRIVATE_RECOVERY_DETAIL');
      expect(await recoveryPaintCount(harness.page)).toBe(0);
      harness.state.unavailableEndpoint = null;
      const authorizationReads = harness.state.authorizationReads;
      await harness.page.getByRole('button', { name: 'Retry access', exact: true }).click();
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      expect(harness.state.authorizationReads).toBeGreaterThan(authorizationReads);
      expect({ documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts }).toEqual(before);
      await expectNoStalePaints(harness.page);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  browserTest('same-identity authority revision change reloads stale loader without credential repair', async () => {
    const harness = await openHarness();
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      const refreshes = harness.state.refreshes, documents = harness.state.documents;
      harness.state.revision = 'revision-2';
      await harness.page.evaluate(() => window.__sessionRecoveryHarness.refreshAuthorization());
      await expectProtected(harness.page, 'user-a', 'application', 'revision-2');
      // The new document performs its normal constructor restore once. No
      // pre-reload recoverSession rotation is needed for stale loader data.
      expect(harness.state.refreshes).toBe(refreshes + 1);
      expect(harness.state.documents).toBe(documents + 1);
      expect(harness.state.logouts).toBe(0);
      expect(await recoveryPaintCount(harness.page)).toBe(0);
      await expectNoStalePaints(harness.page);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  browserTest('a stalled access-retry response body times out and permits another access-only retry', async () => {
    const harness = await openHarness();
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      harness.state.unavailableEndpoint = 'authorization';
      await harness.page.evaluate(() => window.__sessionRecoveryHarness.invalidateAuthorizationData());
      const retry = harness.page.getByRole('button', { name: 'Retry access', exact: true });
      await retry.waitFor();
      const before = { documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts };
      harness.state.unavailableEndpoint = null; harness.state.stallAuthorizationBody = true;
      await retry.click();
      await harness.page.getByRole('button', { name: 'Checking access…', exact: true }).waitFor();
      await retry.waitFor({ timeout: 20_000 });
      expect(await retry.isEnabled()).toBe(true);
      expect(await harness.page.getByTestId('protected-loader').count()).toBe(0);
      expect(await recoveryPaintCount(harness.page)).toBe(0);
      expect({ documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts }).toEqual(before);
      harness.state.stallAuthorizationBody = false;
      await retry.click();
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  browserTest('a stalled automatic post-purge hint read reaches safe access-only retry', async () => {
    const harness = await openHarness();
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      const before = { documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts };
      harness.state.stallAuthorizationBody = true;
      await harness.page.evaluate(() => window.__sessionRecoveryHarness.invalidateAuthorizationData());
      await harness.page.locator('[data-zero-auth-transition]').waitFor();
      const retry = harness.page.getByRole('button', { name: 'Retry access', exact: true });
      await retry.waitFor({ timeout: 20_000 });
      expect(await retry.isEnabled()).toBe(true);
      expect(await harness.page.getByTestId('protected-loader').count()).toBe(0);
      expect(await recoveryPaintCount(harness.page)).toBe(0);
      expect({ documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts }).toEqual(before);
      harness.state.stallAuthorizationBody = false;
      await retry.click();
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

  browserTest('revoked access whose cleanup lock timed out remains masked and can retry exact-owned cleanup', async () => {
    const harness = await openHarness();
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      const before = { documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts };
      await harness.page.evaluate(async (lockName) => {
        await new Promise<void>((admitted) => {
          void navigator.locks.request(lockName, async () => {
            const held = new Promise<void>((resolve) => {
              (window as Window & { __releaseCleanupTestLock?: () => void }).__releaseCleanupTestLock = resolve;
            });
            admitted(); await held;
          });
        });
      }, getBrowserAuthStorageKeys(harness.page.url()).lockName);
      harness.state.rejectedEndpoint = 'authorization';
      // 403 is definitive authority denial. A 401 first enters the SDK's
      // ordinary bearer-refresh path and would test a different queued lock.
      harness.state.rejectStatus = 403;
      await harness.page.evaluate(() => window.__sessionRecoveryHarness.refreshAuthorization());
      const retry = harness.page.getByRole('button', { name: 'Retry access', exact: true });
      await retry.waitFor();
      // The exact-owned cleanup cannot bypass another tab's credential lock.
      // Let bounded admission retire before releasing that lock.
      await harness.page.waitForTimeout(15_200);
      expect(await retry.isEnabled()).toBe(true);
      expect(await snapshot(harness.page)).toMatchObject({ userId: 'user-a', hasRecoverableSession: true, authorizationStatus: 'revoked' });
      expect(await harness.page.getByTestId('protected-loader').count()).toBe(0);
      expect(await harness.page.content()).not.toContain('Your session is still signed in');
      expect(await recoveryPaintCount(harness.page)).toBe(0);
      expect({ documents: harness.state.documents, refreshes: harness.state.refreshes, logouts: harness.state.logouts }).toEqual(before);
      await harness.page.evaluate(() => {
        (window as Window & { __releaseCleanupTestLock?: () => void }).__releaseCleanupTestLock?.();
      });
      await retry.click();
      await harness.page.getByRole('form', { name: 'Sign in', exact: true }).waitFor();
      expect(harness.state.refreshes).toBe(before.refreshes);
      expect(harness.state.logouts).toBe(before.logouts + 1);
      expect(await snapshot(harness.page)).toMatchObject({ userId: null, hasRecoverableSession: false });
      expect((await harness.context.cookies()).some(cookie => cookie.name === COOKIE)).toBe(false);
    } finally {
      await harness.page.evaluate(() => {
        (window as Window & { __releaseCleanupTestLock?: () => void }).__releaseCleanupTestLock?.();
      }).catch(() => {});
      await harness.close();
    }
  }, TEST_TIMEOUT_MS);

  for (const retire of ['unmount', 'replacement'] as const) {
    browserTest(`pending access retry is cancelled on ${retire} without publishing into the retired scope`, async () => {
      const harness = await openHarness();
      let release!: () => void;
      const cancelled: string[] = [];
      harness.page.on('requestfailed', request => {
        if (request.url().endsWith('/auth/authorization')) cancelled.push(request.failure()?.errorText ?? 'cancelled');
      });
      try {
        await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
        harness.state.unavailableEndpoint = 'authorization';
        await harness.page.evaluate(() => window.__sessionRecoveryHarness.invalidateAuthorizationData());
        await harness.page.getByRole('button', { name: 'Retry access', exact: true }).waitFor();
        harness.state.unavailableEndpoint = null;
        harness.state.holdAuthorization = new Promise<void>((resolve) => { release = resolve; });
        await harness.page.getByRole('button', { name: 'Retry access', exact: true }).click();
        await harness.page.getByRole('button', { name: 'Checking access…', exact: true }).waitFor();
        const pending = retire === 'unmount'
          ? harness.page.evaluate(() => window.__sessionRecoveryHarness.unmountProvider())
          : harness.page.evaluate(() => window.__sessionRecoveryHarness.login('user-b'));
        await harness.page.waitForTimeout(100);
        expect(cancelled.length).toBeGreaterThan(0);
        release(); harness.state.holdAuthorization = null;
        await pending;
        if (retire === 'replacement') {
          await expectProtected(harness.page, 'user-b', 'application', 'revision-1');
          await expectNoStalePaints(harness.page);
        } else expect(await harness.page.locator('[data-zero-authorization-recovery]').count()).toBe(0);
      } finally { release?.(); await harness.close(); }
    }, TEST_TIMEOUT_MS);
  }

  browserTest('same-key AuthClient replacement retires the previous access retry without resetting the new one', async () => {
    const harness = await openHarness();
    try {
      await expectProtected(harness.page, 'user-a', 'application', 'revision-1');
      await harness.page.evaluate(() => window.__sessionRecoveryHarness.hintRetryClientProbe('mount'));
      const retry = harness.page.getByRole('button', { name: 'Retry access', exact: true });
      await retry.click();
      await harness.page.getByRole('button', { name: 'Checking access…', exact: true }).waitFor();
      await harness.page.evaluate(() => window.__sessionRecoveryHarness.hintRetryClientProbe('replace'));
      await retry.waitFor();
      expect(await retry.isEnabled()).toBe(true);
      await retry.click();
      const checking = harness.page.getByRole('button', { name: 'Checking access…', exact: true });
      await checking.waitFor();
      expect(await harness.page.evaluate(() => window.__sessionRecoveryHarness.hintRetryClientProbe('finish-old')))
        .toEqual({ calls: 2, aborted: 1 });
      await harness.page.waitForTimeout(100);
      expect(await checking.isDisabled()).toBe(true);
      expect(await recoveryPaintCount(harness.page)).toBe(0);
    } finally { await harness.close(); }
  }, TEST_TIMEOUT_MS);

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
      expect(await recoveryPaintCount(harness.page)).toBe(0);
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
        const retry = harness.page.getByRole('button', {
          name: endpoint === 'authorization' ? 'Retry access' : 'Retry session', exact: true,
        });
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
  holdAuthorization: Promise<void> | null;
  authorizationReads: number;
  stallAuthorizationBody: boolean;
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
    credential: 'synthetic-refresh-0', holdAuthorization: null, authorizationReads: 0, stallAuthorizationBody: false, ...options,
  };
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 60,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/auth/authorization') {
        state.authorizationReads++;
        if (state.holdAuthorization) await state.holdAuthorization;
      }
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
      if (path === '/auth/authorization') {
        if (state.stallAuthorizationBody) return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode('{"version":')); },
        }), { headers: { 'Content-Type': 'application/json' } });
        return Response.json(authorization(state));
      }
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

async function recoveryPaintCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__sessionRecoveryHarness.recoveryPaintCount());
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
