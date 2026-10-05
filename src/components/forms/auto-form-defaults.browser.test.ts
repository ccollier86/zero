/** Independent end-to-end generated-form default validation and encoding checks. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/auto-form-defaults.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map((log) => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

async function openHarness(): Promise<Page> {
  const page = await browser!.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Submit optional', exact: true }).waitFor();
  return page;
}

describe('AutoForm neutral defaults', () => {
  browserTest('untouched optional fields validate, encode and await completion', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('button', { name: 'Submit optional', exact: true }).click();
      expect(await page.evaluate(() => window.__autoFormDefaults.optionalSubmissions)).toEqual([{
        text: '', textarea: '', email: '', url: '', password: '', date: '', datetime: '',
        choice: '', enumChoice: '', singleTeam: '', multiChoice: '[]', tags: '[]', teams: '[]',
        window: '["",""]', settings: 'null', enabled: 0, count: 0,
      }]);
      expect(await page.getByRole('button', { name: 'Submit optional', exact: true }).isEnabled()).toBe(false);
      expect(await page.evaluate(() => window.__autoFormDefaults.optionalSuccesses())).toBe(0);
      await page.evaluate(() => window.__autoFormDefaults.resolve());
      await page.waitForFunction(() => window.__autoFormDefaults.optionalSuccesses() === 1);
      expect(await page.getByRole('button', { name: 'Submit optional', exact: true }).isEnabled()).toBe(true);
      expect(await page.evaluate(() => window.__autoFormDefaults.errors)).toEqual([]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('required blanks remain blocked and receive field errors', async () => {
    const page = await openHarness();
    try {
      await page.getByRole('button', { name: 'Submit required', exact: true }).click();
      expect(await page.evaluate(() => window.__autoFormDefaults.requiredSubmissions)).toEqual([]);
      expect(await page.locator('[data-defaults-form="required"] [data-slot="form-message"]').count()).toBeGreaterThan(0);
      expect(await page.getByRole('button', { name: 'Submit required', exact: true }).isEnabled()).toBe(true);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('optional does not weaken nonblank email validation', async () => {
    const page = await openHarness();
    try {
      const form = page.locator('[data-defaults-form="optional"] form');
      await form.locator('input[name="email"]').fill('not-an-email');
      // Exercise the schema validator rather than the browser's email constraint.
      await form.evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(await page.evaluate(() => window.__autoFormDefaults.optionalSubmissions)).toEqual([]);
      expect(await form.locator('[data-slot="form-message"]').count()).toBeGreaterThan(0);
      await form.locator('input[name="email"]').fill('synthetic@example.test');
      await form.evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(await page.evaluate(() => window.__autoFormDefaults.optionalSubmissions.length)).toBe(1);
      expect(await page.evaluate(() => window.__autoFormDefaults.optionalSubmissions[0]?.email)).toBe('synthetic@example.test');
    } finally { await page.close(); }
  }, 30_000);

  browserTest('untouched constrained optional numbers are omitted', async () => {
    const page = await openHarness();
    try {
      const section = page.locator('[data-defaults-form="numeric-create"]');
      expect(await section.locator('input[name="count"]').inputValue()).toBe('');
      await section.getByRole('button', { name: 'Create optional number', exact: true }).click();
      expect(await page.evaluate(() => window.__autoFormDefaults.numericSubmissions)).toEqual([{}]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('clearing an optional number emits explicit wire null, not a dropped PATCH field', async () => {
    const page = await openHarness();
    try {
      const section = page.locator('[data-defaults-form="numeric-edit"]');
      await section.locator('input[name="count"]').fill('');
      await section.getByRole('button', { name: 'Clear optional number', exact: true }).click();
      expect(await page.evaluate(() => window.__autoFormDefaults.numericSubmissions)).toEqual([{ count: null }]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('a stored nullable number renders blank and preserves its clear value', async () => {
    const page = await openHarness();
    try {
      const section = page.locator('[data-defaults-form="numeric-stored-null"]');
      expect(await section.locator('input[name="count"]').inputValue()).toBe('');
      await section.getByRole('button', { name: 'Save stored null', exact: true }).click();
      expect(await page.evaluate(() => window.__autoFormDefaults.numericSubmissions)).toEqual([{ count: null }]);
    } finally { await page.close(); }
  }, 30_000);

  browserTest('clearing a required number remains invalid', async () => {
    const page = await openHarness();
    try {
      const section = page.locator('[data-defaults-form="numeric-required"]');
      await section.locator('input[name="count"]').fill('');
      await section.getByRole('button', { name: 'Clear required number', exact: true }).click();
      expect(await page.evaluate(() => window.__autoFormDefaults.requiredNumericSubmissions)).toEqual([]);
      expect(await section.locator('[data-slot="form-message"]').count()).toBeGreaterThan(0);
    } finally { await page.close(); }
  }, 30_000);
});
