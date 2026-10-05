/** In-memory, synthetic browser checks; no app/provider/network/live data. */

import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/data-table-notification.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
  bundle = await result.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

async function mount(): Promise<Page> {
  if (!browser) throw new Error('Browser unavailable.');
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'before-edit', exact: true }).waitFor();
  return page;
}

async function edit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'before-edit', exact: true }).click();
  const input = page.locator('[data-slot="editable-cell-editor"] input');
  await input.fill('after-edit');
  await input.press('Enter');
}

describe('DataTable accepted notification boundary', () => {
  browserTest('a failing legacy notification cannot classify or repeat an accepted source update', async () => {
    const page = await mount();
    try {
      await edit(page);
      await page.waitForFunction(() => window.__tableNotificationHarness.counts().writes === 1);
      expect(await page.locator('[data-slot="editable-cell-editor"] input').isDisabled()).toBe(true);
      expect(await page.evaluate(() => window.__tableNotificationHarness.counts().notifications)).toBe(0);
      await page.evaluate(() => window.__tableNotificationHarness.accept());
      await page.waitForFunction(() => window.__tableNotificationHarness.counts().notifications === 1);
      expect(await page.locator('[data-save-state="error"]').count()).toBe(0);
      await page.getByRole('button', { name: 'after-edit', exact: true }).waitFor();
      expect(await page.evaluate(() => window.__tableNotificationHarness.counts())).toEqual({ writes: 1, notifications: 1 });
      const events = await page.evaluate(() => window.__tableNotificationHarness.events());
      expect(events).toHaveLength(1);
      expect(events[0]?.code).toBe('frontend.mutation.failed');
      expect(events[0]?.metadata).toEqual({ surface: 'data-table', stage: 'accepted-callback' });
      expect(JSON.stringify(events)).not.toContain('private legacy callback contents');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('legacy onCellEdit remains the authoritative array writer when no source action exists', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__tableNotificationHarness.mode('array'));
      await edit(page);
      await page.locator('[data-save-state="error"]').waitFor();
      expect(await page.evaluate(() => window.__tableNotificationHarness.counts())).toEqual({ writes: 0, notifications: 1 });
      expect(await page.locator('[data-slot="editable-cell-editor"] input').isVisible()).toBe(true);
      expect(await page.locator('body').textContent()).not.toContain('private legacy callback contents');
      expect(await page.getByText('The change could not be saved. Try again.', { exact: true }).isVisible()).toBe(true);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('an accepted async follow-up finishing after unmount cannot report into the retired table', async () => {
    const page = await mount();
    try {
      await page.evaluate(() => window.__tableNotificationHarness.mode('async-accepted'));
      await edit(page);
      await page.waitForFunction(() => window.__tableNotificationHarness.counts().writes === 1);
      await page.evaluate(() => window.__tableNotificationHarness.accept());
      await page.waitForFunction(() => window.__tableNotificationHarness.counts().notifications === 1);
      await page.evaluate(() => window.__tableNotificationHarness.unmount());
      await page.evaluate(() => window.__tableNotificationHarness.rejectNotification());
      await page.waitForTimeout(30);
      expect(await page.evaluate(() => window.__tableNotificationHarness.counts())).toEqual({ writes: 1, notifications: 1 });
      expect(await page.evaluate(() => window.__tableNotificationHarness.events())).toEqual([]);
      expect(await page.locator('#root').textContent()).toBe('');
    } finally { await page.close(); }
  }, 30_000);
});
