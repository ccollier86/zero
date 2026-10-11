/** Serial isolated public-facade/stream browser qualification; never imports app configuration or contacts a data service. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/native-charts';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'native-charts-'));
  try {
    const output = join(dir, 'fixture.js'); const child = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/native-charts.browser-fixture.tsx', '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw Error('Native public fixture: ' + (err || out));
    bundle = await Bun.file(output).text(); css = await Bun.file((await buildPlatformStyles(dir, join(dir, 'absent-app'))).cssPath).text();
  } finally { await rm(dir, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); await mkdir(artifacts, { recursive: true });
}, 60_000);
afterAll(() => lease?.release());
async function mount(width = 1100, dark = false, reduced = true) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message)); page.setDefaultTimeout(6000);
  await page.setContent('<!doctype html><html data-theme="' + (dark ? 'dark' : 'light') + '"' + (dark ? ' class="dark"' : '') + '><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: 'body{margin:0;background:var(--background);color:var(--foreground)}main{max-width:1050px;margin:auto;padding:22px}h1{font-size:24px;margin-bottom:6px}main>p{color:var(--muted-foreground);font-size:13px;margin-bottom:24px}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:20px}.card{min-width:0;padding:22px;border:1px solid var(--border);background:var(--card);border-radius:18px}' });
  await page.addScriptTag({ content: bundle }); await page.getByRole('heading', { name: 'Handmade Zero charts' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-zero-native-chart]').length === 8);
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
for (const [width, dark, name] of [[1100, false, 'light'], [1100, true, 'dark'], [390, false, 'phone-light'], [390, true, 'phone-dark']] as const) browserTest('Public handmade facade: exact data, finite geometry and ' + name, async () => {
  const page = await mount(width, dark); try {
    expect(await page.getByRole('table').count()).toBe(8);
    expect(await page.locator('svg path').evaluateAll(paths => paths.every(path => !/NaN|Infinity/.test(path.getAttribute('d') ?? '')))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(artifacts, name + '.png'), fullPage: true });
  } finally { await close(page); }
}, 30_000);
browserTest('Observed stream holds during inspection, resumes on retirement and preserves exact custom inspectors', async () => {
  const page = await mount(); try {
    const stream = page.getByTestId('stream'), plot = stream.getByRole('group'); await plot.scrollIntoViewIfNeeded(); await plot.focus(); await plot.press('End');
    await page.getByRole('tooltip').filter({ hasText: 'Observed threshold' }).waitFor();
    expect(await page.locator('[data-zero-tooltip]').evaluate(element => getComputedStyle(element).borderRadius)).toBe('10px');
    const before = await stream.locator('svg path').first().getAttribute('d');
    await page.evaluate(() => window.__nativeCharts.append()); await page.waitForFunction(() => window.__nativeCharts.state().data.length === 9);
    expect(await stream.locator('svg path').first().getAttribute('d')).toBe(before); expect(await stream.textContent()).toContain('Held window');
    await page.evaluate(() => window.__nativeCharts.patch({ custom: 'custom' })); await page.getByTestId('custom-stream').waitFor();
    expect(await page.getByTestId('custom-stream').textContent()).toContain('s7: 90');
    await page.evaluate(() => window.__nativeCharts.patch({ custom: 'hidden' })); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__nativeCharts.retire()); await page.waitForFunction(() => document.querySelector('[data-testid="stream"]')?.textContent?.includes('Latest observed window'));
    expect(await stream.getByRole('table').textContent()).toContain('new-scope');
    expect(await stream.locator('svg circle').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);
browserTest('Controlled stream pause requests cannot alter a held endpoint until accepted', async () => {
  const page = await mount(); try {
    const stream = page.getByTestId('stream'); await stream.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.__nativeCharts.patch({ paused: true })); await stream.getByRole('button', { name: 'Resume live' }).waitFor();
    const before = await stream.locator('svg path').first().getAttribute('d'); await page.evaluate(() => window.__nativeCharts.append());
    await stream.getByRole('button', { name: 'Resume live' }).click();
    expect(await page.evaluate(() => window.__nativeCharts.events)).toContain(false);
    expect(await stream.locator('svg path').first().getAttribute('d')).toBe(before); expect(await stream.textContent()).toContain('Held window');
    await page.evaluate(() => window.__nativeCharts.patch({ paused: false })); await stream.getByRole('button', { name: 'Hold view' }).waitFor();
    expect(await stream.locator('svg path').first().getAttribute('d')).not.toBe(before); expect(await stream.textContent()).toContain('Latest observed window');
  } finally { await close(page); }
}, 30_000);
browserTest('Rejected controlled stream inspection cannot silently freeze the live window', async () => {
  const page = await mount(); try {
    const stream = page.getByTestId('stream'), plot = stream.getByRole('group'); await plot.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.__nativeCharts.patch({ active: null })); await plot.focus(); await plot.press('End');
    expect(await page.getByRole('tooltip').count()).toBe(0); expect(await stream.textContent()).toContain('Latest observed window');
    const before = await stream.locator('svg path').first().getAttribute('d'); await page.evaluate(() => window.__nativeCharts.append());
    await page.waitForFunction(() => window.__nativeCharts.state().data.length === 9);
    expect(await stream.locator('svg path').first().getAttribute('d')).not.toBe(before);
  } finally { await close(page); }
}, 30_000);
browserTest('Stream native SVG suspends interrupted motion and unmounts the shared portal and animation work', async () => {
  const page = await mount(390, false, false); try {
    const stream = page.getByTestId('stream'), plot = stream.getByRole('group'); await plot.scrollIntoViewIfNeeded(); await plot.focus(); await plot.press('End');
    await page.getByRole('tooltip').waitFor(); await page.evaluate(() => window.__nativeCharts.append()); await page.evaluate(() => window.__nativeCharts.patch({ motion: false }));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-zero-native-chart]')).every(element => element.getAttribute('data-motion') === 'off'));
    expect(await stream.locator('svg path').evaluateAll(paths => paths.every(path => !/NaN|Infinity/.test(path.getAttribute('d') ?? '')))).toBe(true);
    await page.evaluate(() => window.__nativeCharts.unmount()); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__nativeChartsPending() === 0); expect(await page.locator('[data-zero-native-chart]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('Live rolling windows retarget the mounted line without replaying its entrance, including gap corrections', async () => {
  const page = await mount(1100, false, false); try {
    const stream = page.getByTestId('stream'); await stream.scrollIntoViewIfNeeded();
    const data = Array.from({ length: 7 }, (_, index) => ({ id: `rolling-${index}`, time: index * 5000, value: 20 + index % 4 * 10 }));
    await page.evaluate(data => window.__nativeCharts.patch({ data, active: null }), data);
    await page.waitForFunction(() => document.querySelector('[data-testid="stream"] svg path')?.getAttribute('stroke-dasharray') === '1 1');
    await stream.locator('svg path').evaluate(path => { path.setAttribute('data-review-mounted', 'original'); });
    for (let index = 7; index < 10; index++) {
      data.push({ id: `rolling-${index}`, time: index * 5000, value: 20 + index % 4 * 10 });
      await page.evaluate(data => window.__nativeCharts.patch({ data }), data);
      await page.waitForFunction(count => window.__nativeCharts.state().data.length === count, data.length);
      expect(await stream.locator('svg path').getAttribute('data-review-mounted')).toBe('original');
      expect(await stream.locator('svg path').getAttribute('stroke-dasharray')).toBe('1 1');
    }
    await page.evaluate(() => window.__nativeCharts.patch({ data: window.__nativeCharts.state().data.map(sample => sample.id === 'rolling-7' ? { ...sample, value: null } : sample) }));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="stream"] svg path').length === 2);
    expect(await stream.locator('svg path').evaluateAll(paths => paths.every(path => path.getAttribute('stroke-dasharray') === '1 1'))).toBe(true);
    expect(await stream.locator('svg path[data-review-mounted="original"]').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);
browserTest('Image-valued color inputs are rejected and raw legend paint cannot request an image', async () => {
  const page = await mount(); const requests: string[] = [];
  await page.route('**/*', async route => { requests.push(route.request().url()); await route.abort(); });
  try {
    const candidates = ['image-set("https://example.invalid/chart.png" 1x)', 'linear-gradient(red,blue)', 'var(--paint, image-set("https://example.invalid/chart.png" 1x))'];
    expect(await page.evaluate(values => values.map(value => window.__nativeCharts.colorAllowed(value)), candidates)).toEqual([false, false, false]);
    await page.evaluate(paint => window.__nativeCharts.patch({ paint }), candidates[0]!);
    const swatch = page.getByTestId('raw-legend').locator('i'); await swatch.waitFor();
    expect(await swatch.evaluate(element => getComputedStyle(element).backgroundImage)).toBe('none');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(requests).toEqual([]);
  } finally { await close(page); }
}, 30_000);
browserTest('A discarded concurrent stream snapshot cannot mutate committed path identity or replay its entrance', async () => {
  const page = await mount(1100, false, false); try {
    const stream = page.getByTestId('stream'); await stream.scrollIntoViewIfNeeded();
    const original = Array.from({ length: 7 }, (_, index) => ({ id: `committed-${index}`, time: index * 5000, value: 20 + index % 4 * 10 }));
    await page.evaluate(data => window.__nativeCharts.patch({ data, active: null }), original);
    await page.waitForFunction(() => document.querySelector('[data-testid="stream"] svg path')?.getAttribute('stroke-dasharray') === '1 1');
    await stream.locator('svg path').evaluate(path => { path.setAttribute('data-review-mounted', 'committed'); });
    const before = await stream.locator('svg path').getAttribute('d');
    await page.evaluate(() => window.__nativeCharts.suspend([{ id: 'discarded-scope', time: 120000, value: 90 }]));
    await page.waitForFunction(() => window.__nativeChartsSuspensions > 0);
    expect(await stream.locator('svg path').getAttribute('data-review-mounted')).toBe('committed');
    expect(await stream.locator('svg path').getAttribute('d')).toBe(before);
    await page.evaluate(data => window.__nativeCharts.patch({ data, suspended: false }), original);
    await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-suspended') === 'false' && window.__nativeCharts.state().data[0]?.id === 'committed-0');
    expect(await stream.locator('svg path').getAttribute('data-review-mounted')).toBe('committed');
    expect(await stream.locator('svg path').getAttribute('stroke-dasharray')).toBe('1 1');
    expect(await stream.locator('svg path').getAttribute('d')).toBe(before);
  } finally { await close(page); }
}, 30_000);
