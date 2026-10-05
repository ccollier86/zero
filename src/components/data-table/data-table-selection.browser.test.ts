/** Actual page projections; in-memory bundle, no app/provider/backend operations. */

import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
  const result = await Bun.build({ entrypoints: [`${import.meta.dir}/data-table-selection.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  bundle = await result.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

async function mount(): Promise<Page> {
  if (!browser) throw new Error('Browser unavailable.');
  const page = await browser.newPage(); await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.getByText('First page row', { exact: true }).waitFor();
  return page;
}

describe('DataTable explicit page selection', () => {
  browserTest('toolbar, bulk action, callback and count do not target a prior controlled page', async () => {
    const page = await mount();
    try {
      await page.waitForFunction(() => window.__tablePageSelection.selection()[0] === 'a');
      expect(await page.locator('[data-page-selection="toolbar"]').textContent()).toBe('a');
      expect(await page.getByRole('button', { name: 'Run selected action', exact: true }).count()).toBe(1);
      await page.evaluate(() => window.__tablePageSelection.nextPage());
      await page.getByText('Second page row', { exact: true }).waitFor();
      expect(await page.locator('[data-page-selection="toolbar"]').textContent()).toBe('');
      expect(await page.getByRole('button', { name: 'Run selected action', exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => window.__tablePageSelection.selection())).toEqual([]);
      expect(await page.getByText('(1 selected)', { exact: false }).count()).toBe(0);
    } finally { await page.close(); }
  }, 30_000);
});
