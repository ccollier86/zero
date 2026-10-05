/** Keyboard accessibility of the public password reveal control. */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/password-input.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map((log) => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

browserTest('keyboard users can reach and operate Show/Hide password before continuing', async () => {
  const page = await browser!.newPage();
  try {
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle });
    const input = page.getByLabel('Password', { exact: true });
    await input.focus();
    await input.press('Tab');
    const show = page.getByRole('button', { name: 'Show password', exact: true });
    expect(await show.evaluate(element => document.activeElement === element)).toBe(true);
    await show.press('Space');
    expect(await input.getAttribute('type')).toBe('text');
    expect(await input.inputValue()).toBe('synthetic-password');
    const hide = page.getByRole('button', { name: 'Hide password', exact: true });
    await hide.press('Enter');
    expect(await input.getAttribute('type')).toBe('password');
    await page.keyboard.press('Tab');
    expect(await page.getByRole('button', { name: 'Continue' }).evaluate(
      element => document.activeElement === element,
    )).toBe(true);
  } finally { await page.close(); }
}, 30_000);
