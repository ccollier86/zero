/** Regression proof for synchronous selection privacy and stale actions under React StrictMode. */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
browserTest('selection never renders another operation and old callbacks cannot cancel the replacement', async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/vector-hook-browser-');
  const lease = await acquirePlaywrightTestBrowser();
  const page = await lease.browser.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const output = join(directory, 'fixture.js');
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/vector-visualization-hooks.browser-fixture.tsx',
      '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error('Hook fixture build failed: ' + (stderr || stdout));
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: await Bun.file(output).text() });
    await page.locator('output').filter({ hasText: 'A' }).waitFor();
    await page.evaluate(() => { window.__vectorHookFixture.saveCancel(); window.__vectorHookFixture.select('B'); });
    await page.locator('output').filter({ hasText: 'B' }).waitFor();
    expect(await page.evaluate(() => window.__vectorHookFixture.history().filter(item => item.selected === 'B' && item.presented === 'A'))).toEqual([]);
    expect(await page.evaluate(() => window.__vectorHookFixture.cancelOld())).toBe('AbortError');
    expect(await page.evaluate(() => window.__vectorHookFixture.cancellations())).toEqual([]);
    expect(await page.evaluate(() => window.__vectorHookFixture.cancelCurrent())).toBe('ok');
    expect(await page.evaluate(() => window.__vectorHookFixture.cancellations())).toEqual(['B']);
    await page.evaluate(() => window.__vectorHookFixture.unmount());
    expect(await page.evaluate(() => window.__vectorHookFixture.cancelCurrent())).toBe('AbortError');
    expect(await page.evaluate(() => window.__vectorHookFixture.subscriberCount())).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); await lease.release(); await rm(directory, { recursive: true, force: true }); }
}, 60_000);
