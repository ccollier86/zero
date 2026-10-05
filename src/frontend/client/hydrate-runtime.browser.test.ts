/** Exercises real hydration routing with no app server, provider or live data. */

import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined;
let browser: Browser | undefined;
let bundle = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const clientEntry = JSON.stringify(decodeURIComponent(new URL(import.meta.resolve('react-dom/client')).pathname));
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/hydrate-runtime.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{
      name: 'synthetic-root-ownership',
      setup(build) {
        build.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: 'client', namespace: 'hydration-test' }));
        build.onLoad({ filter: /.*/, namespace: 'hydration-test' }, () => ({ loader: 'js', resolveDir: process.cwd(), contents: `
          import {createRoot as actualCreate, hydrateRoot as actualHydrate} from ${clientEntry};
          function own(root){ window.__hydrationTestUnmount=()=>root.unmount(); return root; }
          export function createRoot(...args){return own(actualCreate(...args));}
          export function hydrateRoot(...args){return own(actualHydrate(...args));}
        ` }));
      },
    }],
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  bundle = await result.outputs[0]!.text();
}, 60_000);

afterAll(() => lease?.release());

async function mount(): Promise<Page> {
  if (!browser) throw new Error('Browser unavailable.');
  const page = await browser.newPage();
  await page.route('http://zero.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('http://zero.test/');
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-page="home"]').waitFor();
  return page;
}

async function push(page: Page, pathname: string, loading: string): Promise<void> {
  await page.evaluate((path) => window.__hydrationHarness.push(path), pathname);
  await page.waitForFunction((name) => window.__hydrationHarness.loading.includes(name), loading);
}

describe('hydration route lifecycle', () => {
  browserTest('a delayed old module cannot replace a newer page, params or auth requirement', async () => {
    const page = await mount();
    try {
      await push(page, '/slow/old', 'slow');
      await push(page, '/fast/current', 'fast');
      await page.evaluate(() => window.__hydrationHarness.release('fast'));
      await page.locator('[data-page="fast"]').waitFor();
      await page.evaluate(() => window.__hydrationHarness.release('slow'));
      await page.waitForTimeout(30);
      expect(await page.locator('main').getAttribute('data-page')).toBe('fast');
      expect(await page.locator('main').getAttribute('data-params')).toBe('{"id":"current"}');
      expect(await page.locator('main').getAttribute('data-auth')).toBe('false');
      expect(new URL(page.url()).pathname).toBe('/fast/current');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('server-route fallback preserves the committed query and fragment', async () => {
    const page = await mount();
    try {
      const navigation = page.waitForEvent('load');
      await page.evaluate(() => window.__hydrationHarness.push('/server?view=activity#history'));
      await navigation;
      expect(page.url()).toBe('http://zero.test/server?view=activity#history');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('a superseded empty module cannot redirect the current route', async () => {
    const page = await mount();
    try {
      await push(page, '/empty?old=1', 'empty');
      await push(page, '/fast/current', 'fast');
      await page.evaluate(() => window.__hydrationHarness.release('fast'));
      await page.locator('[data-page="fast"]').waitFor();
      await page.evaluate(() => window.__hydrationHarness.release('empty'));
      await page.waitForTimeout(30);
      expect(page.url()).toBe('http://zero.test/fast/current');
      expect(await page.locator('[data-page="fast"]').count()).toBe(1);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('a module finishing after unmount cannot reactivate or redirect the application', async () => {
    const page = await mount();
    try {
      await push(page, '/empty?keep=1#still', 'empty');
      await page.evaluate(() => window.__hydrationTestUnmount());
      await page.evaluate(() => window.__hydrationHarness.release('empty'));
      await page.waitForTimeout(30);
      expect(page.url()).toBe('http://zero.test/empty?keep=1#still');
      expect(await page.locator('#root').textContent()).toBe('');
    } finally { await page.close(); }
  }, 30_000);
});
