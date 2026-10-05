/** Actual source+Tailwind computed colors; no app config/client/service is started. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { buildPlatformStyles } from '../../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined, lease: PlaywrightTestBrowserLease | undefined;
let bundle = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'zero-sidebar-outline-'));
  try {
    const styles = await buildPlatformStyles(directory, join(directory, 'absent-app'));
    css = await Bun.file(styles.cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  const build = await Bun.build({ entrypoints: [`${import.meta.dir}/sidebar-outline.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());

for (const dark of [false, true]) {
  browserTest(`sidebar outline uses complete semantic colors in ${dark ? 'dark' : 'light'} mode`, async () => {
    const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
    try {
      await page.setContent(`<div id="root"></div><span id="expected"></span>`);
      await page.addStyleTag({ content: css });
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      await page.addScriptTag({ content: bundle });
      const button = page.getByRole('button', { name: 'Synthetic outline', exact: true });
      await button.waitFor();
      for (const [hover, token] of [[false, '--sidebar-border'], [true, '--sidebar-accent']] as const) {
        if (hover) await button.hover();
        const expected = await page.locator('#expected').evaluate((element, token) => {
          (element as HTMLElement).style.boxShadow = `0 0 0 1px var(${token})`;
          return getComputedStyle(element).boxShadow;
        }, token);
        const shadow = await button.evaluate(element => getComputedStyle(element).boxShadow);
        expect(shadow).not.toBe('none');
        expect(shadow).toContain(expected);
      }
    } finally { await page.close(); }
  }, 30_000);
}
