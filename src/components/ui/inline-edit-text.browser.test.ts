/** Actual editor input lifecycle with synthetic deferred operations only. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import {
  acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

interface Fixture {
  snapshot(): { commits: string[]; navigated: number; reloaded: number };
  resolve(): void; reject(): void; failNavigation(): void; disable(): void; unmount(): void;
}
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, bundle = '';
let lease: PlaywrightTestBrowserLease | undefined;
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/inline-edit-text.browser-fixture.tsx`], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());
async function open(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  const trigger = page.getByRole('button', { name: 'Edit Name, current value Original', exact: true });
  await trigger.waitFor(); await trigger.click();
  await page.getByRole('textbox', { name: 'Edit Name', exact: true }).fill('Changed');
  return page;
}
async function settleFrame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
browserTest('same-tick commit events admit one external operation', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Edit Name', exact: true }).evaluate(element => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot().commits))
      .toEqual(['Changed']);
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.resolve());
  } finally { await page.close(); }
}, 30_000);

browserTest('a disabled editor cannot admit a queued blur save', async () => {
  const page = await open();
  try {
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.disable());
    await page.locator('input:disabled').waitFor();
    await page.getByRole('textbox', { name: 'Edit Name', exact: true }).evaluate(element => {
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot().commits))
      .toEqual([]);
  } finally { await page.close(); }
}, 30_000);

for (const outcome of ['resolve', 'reject'] as const) {
  browserTest(`late ${outcome} after unmount cannot navigate or reload another editor`, async () => {
    const page = await open();
    try {
      await page.getByRole('textbox', { name: 'Edit Name', exact: true }).press('Tab');
      await page.getByRole('status').waitFor();
      await page.evaluate(kind => {
        const api = (window as unknown as { inlineTextTest: Fixture }).inlineTextTest;
        api.unmount(); api[kind]();
      }, outcome);
      await settleFrame(page);
      const observed = await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot());
      expect(observed.navigated).toBe(0);
      expect(observed.reloaded).toBe(0);
      expect(await page.locator('#root').innerHTML()).toBe('');
    } finally { await page.close(); }
  }, 30_000);
}

browserTest('a failed post-acceptance navigation notification does not become a failed edit', async () => {
  const page = await open(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.failNavigation());
    await page.getByRole('textbox', { name: 'Edit Name', exact: true }).press('Tab');
    await page.getByRole('status').waitFor();
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.resolve());
    await settleFrame(page);
    expect(await page.locator('[data-save-state="saved"]').count()).toBe(1);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
