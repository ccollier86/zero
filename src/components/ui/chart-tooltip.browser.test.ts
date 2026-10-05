/** Actual tooltip label precedence with an in-memory synthetic React bundle. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/chart-tooltip.browser-fixture.tsx`],
    target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

browserTest('labelKey selects config label while hidden/formatter/default precedence remains', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root"></div>');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(errors).toEqual([]);
    await page.locator('[data-chart]').first().waitFor();
    expect(await page.locator('[data-case="default"]').textContent()).toContain('Raw heading');
    const heading = (name: string) => page.locator(`[data-case="${name}"] .font-medium`).first();
    await heading('default').waitFor({ state: 'attached' });
    expect(await heading('configured').textContent()).toBe('Configured heading');
    expect(await heading('unknown').textContent()).toBe('Raw heading');
    expect(await heading('default').textContent()).toBe('Raw heading');
    expect(await heading('formatter').textContent()).toBe('Formatted Raw heading');
    expect(await page.locator('[data-case="hidden"]').textContent()).not.toContain('heading');
    expect(await page.locator('[data-case="hidden"]').textContent()).toContain('Count series');
  } finally { await page.close(); }
}, 30_000);
