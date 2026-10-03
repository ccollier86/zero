/** Browser regression coverage for root authorization readiness transitions. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const TEST_TIMEOUT_MS = 60_000;

let browser: Browser | undefined;
let browserLease: PlaywrightTestBrowserLease | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;
let appBundlePath: string | undefined;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  browserLease = await acquirePlaywrightTestBrowser();
  browser = browserLease.browser;

  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'authorization-scope-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  const appEntrypoint = join(
    import.meta.dir,
    'test-fixtures/authorization-scope-app-provider.tsx',
  );
  appBundlePath = join(buildDir, 'app-bundle.js');
  const readinessPath = join(
    import.meta.dir,
    'authorization-scope-readiness.ts',
  );

  await writeFile(entrypoint, browserFixtureSource(readinessPath));
  const result = await Bun.build({
    entrypoints: [entrypoint],
    root: process.cwd(),
    outdir: buildDir,
    naming: 'bundle.js',
    target: 'browser',
    format: 'iife',
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join('\n'));
  }
  await buildAppProviderFixture(appEntrypoint, appBundlePath);
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  try {
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  } finally {
    browserLease?.release();
  }
}, TEST_TIMEOUT_MS);

describe('authorization scope browser readiness', () => {
  browserTest('keeps the real AppProvider login route mounted after an anonymous Sync reset', async () => {
    const page = await openAppProviderHarness();
    try {
      const login = page.getByRole('form', { name: 'Sign in' });
      const transition = page.locator('[data-zero-auth-transition]');

      expect(page.url()).toBe('http://zero.test/login?redirect=%2F');
      expect(await login.count()).toBe(1);
      expect(await transition.count()).toBe(0);
      expect(await page.evaluate(() => (
        window.__appProviderAuthorizationHarness.snapshot()
      ))).toEqual({
        authorizationStatus: 'unauthenticated',
        dataRevision: 0,
        isAuthenticated: false,
        isRestoring: false,
      });

      await page.evaluate(() => window.__appProviderAuthorizationHarness.resetSync());
      await page.waitForFunction(() => (
        window.__appProviderAuthorizationHarness.snapshot().dataRevision === 1
      ));

      expect(await page.evaluate(() => (
        window.__appProviderAuthorizationHarness.snapshot()
      ))).toEqual({
        authorizationStatus: 'unauthenticated',
        dataRevision: 1,
        isAuthenticated: false,
        isRestoring: false,
      });
      expect(await login.count()).toBe(1);
      expect(await transition.count()).toBe(0);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT_MS);

  browserTest('renders fresh anonymous bootstrap after a reset while masking authenticated replacement data', async () => {
    const page = await openHarness();
    try {
      const root = page.locator('#authorization-root');
      const publicForm = page.getByRole('form', { name: 'Bootstrap administrator' });
      const transition = page.locator('[data-zero-auth-transition]');

      expect(await root.getAttribute('data-ready')).toBe('true');
      expect(await root.getAttribute('data-revision')).toBe('1');
      expect(await publicForm.count()).toBe(1);
      expect(await transition.count()).toBe(0);

      await page.evaluate(() => window.__authorizationScopeHarness.setRestoring(true));
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'false',
      );
      expect(await transition.count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.setRestoring(false));
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'true',
      );
      expect(await publicForm.count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.beginAnonymousLogin());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'true',
      );
      expect(await publicForm.count()).toBe(1);
      expect(await transition.count()).toBe(0);

      await page.evaluate(() => window.__authorizationScopeHarness.settleAnonymous());
      await page.evaluate(() => window.__authorizationScopeHarness.authenticateLoading());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'false',
      );
      expect(await publicForm.count()).toBe(0);
      expect(await transition.count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.authorizationReady());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'true',
      );
      expect(await page.getByText('Protected application').count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.authorizationRefreshing());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-status') === 'refreshing',
      );
      expect(await root.getAttribute('data-ready')).toBe('true');
      expect(await page.getByText('Protected application').count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.authorizationError());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'false',
      );
      expect(await page.getByText('Protected application').count()).toBe(0);

      await page.evaluate(() => window.__authorizationScopeHarness.authorizationReady());
      await page.evaluate(() =>
        window.__authorizationScopeHarness.setPhase('recovery-required'),
      );
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-phase') ===
          'recovery-required',
      );
      expect(await root.getAttribute('data-ready')).toBe('true');
      expect(await page.getByText('Protected application').count()).toBe(1);
      await page.evaluate(() => window.__authorizationScopeHarness.setPhase('idle'));
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-phase') === 'idle',
      );

      await page.evaluate(() => window.__authorizationScopeHarness.beginLogout());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'false',
      );
      expect(await transition.count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.setPhase('committed'));
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-phase') === 'committed',
      );
      expect(await root.getAttribute('data-ready')).toBe('false');
      await page.evaluate(() => window.__authorizationScopeHarness.setPhase('reconciling'));
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-phase') === 'reconciling',
      );
      expect(await root.getAttribute('data-ready')).toBe('false');

      await page.evaluate(() => window.__authorizationScopeHarness.finishRevokedLogout());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'true',
      );
      expect(await publicForm.count()).toBe(1);
      expect(await root.getAttribute('data-revision')).toBe('2');
      await page.evaluate(() => window.__authorizationScopeHarness.setPhase('idle'));
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-phase') === 'idle',
      );
      expect(await root.getAttribute('data-ready')).toBe('true');
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT_MS);

  browserTest('keeps initial hint failures usable but masks authenticated revocation immediately', async () => {
    const page = await openHarness();
    try {
      const root = page.locator('#authorization-root');
      const publicForm = page.getByRole('form', { name: 'Bootstrap administrator' });
      const protectedApp = page.getByText('Protected application');
      const transition = page.locator('[data-zero-auth-transition]');

      await page.evaluate(() => (
        window.__authorizationScopeHarness.authenticateInitialLoading()
      ));
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-revision') === '0',
      );
      expect(await root.getAttribute('data-ready')).toBe('true');
      expect(await protectedApp.count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.authorizationError());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-status') === 'error',
      );
      expect(await root.getAttribute('data-ready')).toBe('true');
      expect(await protectedApp.count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.authorizationRevoked());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'false',
      );
      expect(await protectedApp.count()).toBe(0);
      expect(await transition.count()).toBe(1);

      await page.evaluate(() => window.__authorizationScopeHarness.clearRevokedSession());
      await page.waitForFunction(() =>
        document.querySelector('#authorization-root')?.getAttribute('data-ready') === 'true',
      );
      expect(await publicForm.count()).toBe(1);
      expect(await transition.count()).toBe(0);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT_MS);
});

async function openHarness(): Promise<Page> {
  if (!browser || !bundlePath) {
    throw new Error('Authorization-scope browser harness was not initialized.');
  }

  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() =>
    typeof window.__authorizationScopeHarness === 'object',
  );
  return page;
}

async function buildAppProviderFixture(
  entrypoint: string,
  output: string,
): Promise<void> {
  const build = Bun.spawn([
    process.execPath,
    'build',
    entrypoint,
    '--target=browser',
    '--format=iife',
    '--outfile',
    output,
  ], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Unable to build AppProvider browser fixture (${exitCode}).\n${stderr || stdout}`,
    );
  }
}

async function openAppProviderHarness(): Promise<Page> {
  if (!browser || !appBundlePath) {
    throw new Error('AppProvider authorization harness was not initialized.');
  }

  const page = await browser.newPage();
  await page.route('http://zero.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<div id="root"></div>',
    });
  });
  await page.goto('http://zero.test/login?redirect=%2F');
  await page.addScriptTag({ path: appBundlePath });
  await page.waitForFunction(() => (
    typeof window.__appProviderAuthorizationHarness === 'object'
      && document.querySelector('form[aria-label="Sign in"]') !== null
  ));
  return page;
}

function browserFixtureSource(readinessPath: string): string {
  return `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import {
      isAuthorizationDataReady,
      isAuthorizationScopeReady,
    } from ${JSON.stringify(readinessPath)};

    const listeners = new Set();
    const state = {
      authorizationStatus: 'unauthenticated',
      dataRevision: 1,
      isAuthenticated: false,
      isRestoring: false,
      phase: 'idle',
      transitionRevision: 0,
    };
    const notify = () => listeners.forEach((listener) => listener());
    const subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const snapshot = () => JSON.stringify(state);

    function Harness() {
      const current = JSON.parse(
        React.useSyncExternalStore(subscribe, snapshot, snapshot),
      );
      const transition = {
        phase: current.phase,
        operation: current.phase === 'idle' ? null : 'logout',
        revision: current.transitionRevision,
        recoverable: false,
        error: null,
      };
      const ready = isAuthorizationScopeReady(
        transition,
        current.isRestoring,
      ) && isAuthorizationDataReady(
        current.dataRevision,
        current.authorizationStatus,
        current.isAuthenticated,
      );
      return (
        <div
          id="authorization-root"
          data-ready={String(ready)}
          data-revision={String(current.dataRevision)}
          data-status={current.authorizationStatus}
          data-phase={current.phase}
        >
          {ready ? (
            current.isAuthenticated ? (
              <main>Protected application</main>
            ) : (
              <form aria-label="Bootstrap administrator">
                <label>Username<input name="username" /></label>
              </form>
            )
          ) : (
            <main data-zero-auth-transition="true">Restoring your secure session…</main>
          )}
        </div>
      );
    }

    window.__authorizationScopeHarness = {
      setRestoring(value) {
        state.isRestoring = value;
        notify();
      },
      setPhase(phase) {
        state.phase = phase;
        state.transitionRevision += 1;
        notify();
      },
      beginAnonymousLogin() {
        state.authorizationStatus = 'loading';
        notify();
      },
      settleAnonymous() {
        state.authorizationStatus = 'unauthenticated';
        notify();
      },
      authenticateLoading() {
        Object.assign(state, {
          authorizationStatus: 'loading',
          dataRevision: 2,
          isAuthenticated: true,
        });
        notify();
      },
      authenticateInitialLoading() {
        Object.assign(state, {
          authorizationStatus: 'loading',
          dataRevision: 0,
          isAuthenticated: true,
          phase: 'idle',
        });
        notify();
      },
      authorizationReady() {
        state.authorizationStatus = 'ready';
        notify();
      },
      authorizationRefreshing() {
        state.authorizationStatus = 'refreshing';
        notify();
      },
      authorizationError() {
        state.authorizationStatus = 'error';
        notify();
      },
      authorizationRevoked() {
        state.authorizationStatus = 'revoked';
        notify();
      },
      clearRevokedSession() {
        state.isAuthenticated = false;
        notify();
      },
      beginLogout() {
        state.phase = 'preparing';
        state.transitionRevision += 1;
        notify();
      },
      finishRevokedLogout() {
        Object.assign(state, {
          authorizationStatus: 'revoked',
          dataRevision: 2,
          isAuthenticated: false,
          phase: 'recovery-required',
          transitionRevision: state.transitionRevision + 1,
        });
        notify();
      },
    };

    createRoot(document.getElementById('root')).render(<Harness />);
  `;
}

declare global {
  interface Window {
    __appProviderAuthorizationHarness: {
      resetSync(): void;
      snapshot(): {
        authorizationStatus: string;
        dataRevision: number;
        isAuthenticated: boolean;
        isRestoring: boolean;
      };
    };
    __authorizationScopeHarness: {
      setRestoring(value: boolean): void;
      setPhase(
        phase: 'idle' | 'preparing' | 'committed' | 'reconciling' | 'recovery-required',
      ): void;
      beginAnonymousLogin(): void;
      settleAnonymous(): void;
      authenticateLoading(): void;
      authenticateInitialLoading(): void;
      authorizationReady(): void;
      authorizationRefreshing(): void;
      authorizationError(): void;
      authorizationRevoked(): void;
      clearRevokedSession(): void;
      beginLogout(): void;
      finishRevokedLogout(): void;
    };
  }
}
