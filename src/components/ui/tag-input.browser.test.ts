/** Exercises the actual controlled input event boundary with synthetic text. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser } from 'playwright';
import {
  acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/tag-input.browser-fixture.tsx`], target: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

for (const [name, input, expected] of [
  ['batch', ' alpha, beta, gamma ', ['seed', 'alpha', 'beta', 'gamma']],
  ['bounded', 'alpha,alpha,beta,gamma', ['seed', 'alpha', 'beta']],
  ['duplicates', 'alpha,alpha,beta', ['seed', 'alpha', 'alpha', 'beta']],
] as const) {
  browserTest(`one ${name} delimiter event applies one coherent tag batch`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle });
      const control = page.locator(`[data-case="${name}"] input`);
      await control.waitFor();
      expect(await control.count()).toBe(1);
      await control.fill(input);
      const observed = await page.evaluate((key) =>
        (window as unknown as { tagInputTest: { changes(): Record<string, string[][]> } }).tagInputTest.changes()[key], name);
      expect(observed).toEqual([[...expected]]);
    } finally { await page.close(); }
  }, 30_000);
}
