/** Numeric absence semantics through actual inline editing and acknowledged writes. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
    entrypoints: [`${import.meta.dir}/editable-cell-numeric.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map((log) => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

describe('EditableCell numeric clear', () => {
  browserTest('optional clear commits wire null only after acceptance', async () => {
    const page = await browser!.newPage();
    try {
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle });
      const section = page.locator('[data-numeric-cell="optional"]');
      await section.locator('[data-slot="editable-cell-display"]').click();
      const input = section.locator('input');
      await input.fill('');
      await input.press('Enter');
      await page.waitForFunction(() => window.__inlineNumericDefaults.writes.optional?.length === 1);
      expect(await page.evaluate(() => window.__inlineNumericDefaults.writes.optional)).toEqual([null]);
      expect(await page.evaluate(() => window.__inlineNumericDefaults.stored.optional)).toBe(2);
      expect(await page.evaluate(() => window.__inlineNumericDefaults.accepted.optional)).toBe(0);
      expect(await input.isDisabled()).toBe(true);
      await page.evaluate(() => window.__inlineNumericDefaults.resolve());
      await page.waitForFunction(() => window.__inlineNumericDefaults.accepted.optional === 1);
      expect(await page.evaluate(() => window.__inlineNumericDefaults.stored.optional)).toBeNull();
      expect(await section.locator('[data-slot="editable-cell-editor"]').count()).toBe(0);
      await section.locator('[data-slot="editable-cell-display"]').click();
      expect(await section.locator('input').inputValue()).toBe('');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('required clear is rejected and retains the previous stored number', async () => {
    const page = await browser!.newPage();
    try {
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle });
      const section = page.locator('[data-numeric-cell="required"]');
      await section.locator('[data-slot="editable-cell-display"]').click();
      await section.locator('input').fill('');
      await section.locator('input').press('Enter');
      await section.getByRole('alert').waitFor();
      expect(await page.evaluate(() => window.__inlineNumericDefaults.writes.required)).toEqual(['']);
      expect(await page.evaluate(() => window.__inlineNumericDefaults.stored.required)).toBe(2);
      expect(await page.evaluate(() => window.__inlineNumericDefaults.accepted.required)).toBe(0);
      expect(await section.getByRole('alert').textContent()).toContain('The change could not be saved. Try again.');
      expect(await section.locator('input').isEnabled()).toBe(true);
      expect(await page.locator('body').textContent()).not.toContain('Synthetic schema rejected');
    } finally { await page.close(); }
  }, 30_000);
});
