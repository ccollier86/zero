/** Isolated existing component; no app configuration/provider/storage is opened. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined, lease: PlaywrightTestBrowserLease | undefined, bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const build = await Bun.build({ entrypoints: [`${import.meta.dir}/storage-settings-validation.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
});
afterAll(() => lease?.release());

browserTest('malformed limits never dispatch unlimited settings; explicit empty/zero remains supported', async () => {
  const page = await browser!.newPage();
  try {
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle });
    const limit = page.getByLabel('Drive limit', { exact: true });
    await limit.waitFor();
    for (const invalid of ['not bytes', '-1', '1.5', '9007199254740992']) {
      await limit.fill(invalid); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      expect(await page.getByRole('status', { name: 'Save result', exact: true }).textContent()).toBe('No mutation');
    }
    await limit.fill(''); await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    const saved = await page.getByRole('status', { name: 'Save result', exact: true }).textContent();
    expect(JSON.parse(saved!).max_size_bytes).toBe(0);
    expect(JSON.parse(saved!).max_file_size_bytes).toBe(100);
  } finally { await page.close(); }
});

browserTest('parent-reported rejected saves remain failed without unhandled browser rejection', async () => {
  const page = await browser!.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle });
    const save = page.getByRole('button', { name: 'Save settings', exact: true });
    await save.waitFor();
    await page.getByRole('button', { name: 'Reject next save', exact: true }).click();
    await save.click();
    expect(await page.getByRole('status', { name: 'Save result', exact: true }).textContent()).toBe('Server rejected');
    expect(await save.isEnabled()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
