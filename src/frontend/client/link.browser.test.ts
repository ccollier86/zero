/** Verifies Link prefetch policy and native-anchor admission in an isolated browser. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

declare global {
  interface Window {
    __linkHarness: {
      configure(options: Record<string, unknown>): void;
      prefetches: string[];
      clicks: number;
      observedDefaultPrevented: boolean | null;
    };
  }
}

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined;
let browser: Browser | undefined;
let bundle = '';

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const link = JSON.stringify(`${import.meta.dir}/link.tsx`);
  const router = JSON.stringify(`${import.meta.dir}/router-context.tsx`);
  const registry = JSON.stringify(`${import.meta.dir}/client-router.ts`);
  const contents = `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Link} from ${link};
    import {RouterProvider} from ${router};
    import {registerRoute} from ${registry};
    window.__linkHarness={prefetches:[], clicks:0, observedDefaultPrevented:null};
    for (const path of ['/one','/two']) registerRoute(path, async () => {
      window.__linkHarness.prefetches.push(path);
      return {default:()=>null};
    });
    document.addEventListener('click', event => {
      window.__linkHarness.observedDefaultPrevented=event.defaultPrevented;
      event.preventDefault(); // Keep native-link assertions on this synthetic page.
    });
    function Harness() {
      const [options,setOptions]=useState({href:'/one',prefetch:'none'});
      window.__linkHarness.configure=next=>setOptions(next);
      const {preventClick,...props}=options;
      return <RouterProvider><Link {...props} onClick={event=>{
        window.__linkHarness.clicks++;
        if(preventClick)event.preventDefault();
      }}>Test link</Link></RouterProvider>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `;
  const result = await Bun.build({
    entrypoints: ['link-test:fixture'], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{
      name: 'in-memory-link-fixture',
      setup(build) {
        build.onResolve({ filter: /^link-test:/ }, () => ({ path: 'fixture', namespace: 'link-test' }));
        build.onLoad({ filter: /.*/, namespace: 'link-test' }, () => ({ contents, loader: 'tsx', resolveDir: process.cwd() }));
      },
    }],
  });
  if (!result.success) throw new Error(result.logs.map((entry) => entry.message).join('\n'));
  bundle = await result.outputs[0]!.text();
}, 60_000);

afterAll(() => lease?.release());

async function openHarness(): Promise<Page> {
  if (!browser) throw new Error('Browser unavailable');
  const page = await browser.newPage();
  await page.route('http://zero.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('http://zero.test/initial');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('link', { name: 'Test link' }).waitFor();
  return page;
}

async function configure(page: Page, options: Record<string, unknown>): Promise<void> {
  await page.evaluate((value) => window.__linkHarness.configure(value), options);
  await page.waitForFunction((href) => document.querySelector('a')?.getAttribute('href') === href, options.href);
}

async function click(page: Page, options: Record<string, unknown> = {}): Promise<boolean | null> {
  return page.evaluate((eventOptions) => {
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...eventOptions }));
    return window.__linkHarness.observedDefaultPrevented;
  }, options);
}

describe('Link navigation and prefetch contracts', () => {
  browserTest('runs render prefetch once for the mounted local destination', async () => {
    const page = await openHarness();
    try {
      await configure(page, { href: '/one', prefetch: 'render' });
      await page.waitForFunction(() => window.__linkHarness.prefetches.length > 0, undefined, { timeout: 1_000 });
      expect(await page.evaluate(() => window.__linkHarness.prefetches)).toEqual(['/one']);
      await configure(page, { href: '/one', prefetch: 'render', title: 'Same destination' });
      expect(await page.evaluate(() => window.__linkHarness.prefetches)).toEqual(['/one']);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('prefetches each changed intent destination including query/hash links', async () => {
    const page = await openHarness();
    try {
      await configure(page, { href: '/one?tab=details#body', prefetch: 'intent' });
      await page.getByRole('link').hover();
      await page.waitForFunction(() => window.__linkHarness.prefetches.length > 0, undefined, { timeout: 1_000 });
      expect(await page.evaluate(() => window.__linkHarness.prefetches)).toEqual(['/one']);
      await configure(page, { href: '/two', prefetch: 'intent' });
      await page.getByRole('link').dispatchEvent('mouseover');
      await page.waitForFunction(() => window.__linkHarness.prefetches.length === 2, undefined, { timeout: 1_000 });
      expect(await page.evaluate(() => window.__linkHarness.prefetches)).toEqual(['/one', '/two']);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('preserves native download navigation', async () => {
    const page = await openHarness();
    try {
      await configure(page, { href: '/one', download: 'report.txt' });
      expect(await click(page)).toBe(false);
      expect(new URL(page.url()).pathname).toBe('/initial');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('preserves protocol-relative external and non-HTTP navigation without history errors', async () => {
    const page = await openHarness();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      for (const href of ['//other.example.test/one', 'mailto:test@example.test', 'tel:+15550000000', 'ftp://other.example.test/report']) {
        await configure(page, { href, prefetch: 'render' });
        expect(await click(page)).toBe(false);
      }
      expect(new URL(page.url()).pathname).toBe('/initial');
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => window.__linkHarness.prefetches)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('keeps modified, non-left, target and prevented clicks native', async () => {
    const page = await openHarness();
    try {
      for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        expect(await click(page, options)).toBe(false);
      }
      await configure(page, { href: '/one', target: '_blank' });
      expect(await click(page)).toBe(false);
      await configure(page, { href: '/one', preventClick: true });
      expect(await click(page)).toBe(true);
      expect(new URL(page.url()).pathname).toBe('/initial');
      expect(await page.evaluate(() => window.__linkHarness.clicks)).toBe(7);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('pushes or replaces valid local routes including same-origin absolute URLs', async () => {
    const page = await openHarness();
    try {
      await configure(page, { href: '/one?tab=details', replace: false });
      expect(await click(page)).toBe(true);
      expect(new URL(page.url()).pathname).toBe('/one');
      const length = await page.evaluate(() => window.history.length);
      await configure(page, { href: 'http://zero.test/two', replace: true });
      expect(await click(page)).toBe(true);
      expect(new URL(page.url()).pathname).toBe('/two');
      expect(await page.evaluate(() => window.history.length)).toBe(length);
    } finally { await page.close(); }
  }, 30_000);
});
