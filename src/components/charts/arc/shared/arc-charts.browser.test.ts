/** Isolated all-family public entry/theme qualification; no app, database or provider. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { buildPlatformStyles } from '../../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/arc-charts';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'arc-gallery-'));
  try {
    const output = join(directory, 'fixture.js'), child = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/arc-charts.browser-fixture.tsx', '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error('Arc gallery build failed: ' + (stderr || stdout));
    bundle = await Bun.file(output).text(); css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); await mkdir(artifacts, { recursive: true });
}, 60_000);
afterAll(() => lease?.release());
const galleryCss = `body{margin:0;background:var(--background);font-family:var(--font-platform-sans,system-ui);color:var(--foreground)}.arc-gallery{max-width:1240px;margin:0 auto;padding:32px 20px}.arc-gallery header{margin-bottom:24px}.arc-gallery h1{font-size:28px;font-weight:600;letter-spacing:-.035em;margin:6px 0}.arc-gallery header p{color:var(--muted-foreground);font-size:13px;margin:6px 0}.gallery-eyebrow{font-size:10px!important;letter-spacing:.13em}.gallery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.gallery-card{min-width:0;align-self:stretch;padding:18px;background:var(--card);border:1px solid var(--border);border-radius:16px}.gallery-card h2{margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:.025em;color:var(--muted-foreground)}@media(max-width:800px){.gallery-grid{grid-template-columns:minmax(0,1fr)}}`;
for (const dark of [false, true]) browserTest(`twelve actual public organisms share a bounded ${dark ? 'dark' : 'light'} gallery`, async () => {
  const page = await lease!.browser.newPage({ viewport: { width: 1280, height: 2000 }, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(`<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"${dark ? ' class="dark"' : ''}><body><div id="root"></div></body></html>`);
    await page.addStyleTag({ content: css + galleryCss }); await page.addScriptTag({ content: bundle });
    await page.getByRole('heading', { name: 'Twelve charts. One design language.' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-zero-arc-chart]').length === 12 && [...document.querySelectorAll('[data-zero-arc-chart]')].every(element => element.getAttribute('data-motion') === 'off'));
    await page.waitForFunction(() => !!document.querySelector('.zero-arc-line-chart__line')?.getAttribute('d') && [...document.querySelectorAll('.zero-arc-treemap__tile')].some(element => getComputedStyle(element).visibility === 'visible'));
    expect(await page.locator('[data-zero-arc-chart]').count()).toBe(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('[data-zero-arc-chart]').evaluateAll(elements => elements.every(element => getComputedStyle(element).color === getComputedStyle(elements[0]!).color))).toBe(true);
    expect(await page.locator('.gallery-card').count()).toBe(12);
    await page.screenshot({ path: join(artifacts, dark ? 'gallery-dark.png' : 'gallery-light.png'), fullPage: true });
    await page.locator('.arc-gallery').evaluate(element => { (element as HTMLElement).style.setProperty('--zero-chart-font-family', 'monospace'); });
    expect(await page.locator('[data-zero-arc-chart]').evaluateAll(elements => elements.every(element => getComputedStyle(element).fontFamily === 'monospace'))).toBe(true);
    await page.setViewportSize({ width: 390, height: 2000 });
    await page.locator('.zero-arc-line-chart__toggleLabel, .zero-arc-streamgraph__toggleLabel').evaluateAll(elements => elements.forEach(element => { element.textContent = 'Authorized source with a long identifier '.repeat(80); }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.evaluate(() => window.__arcGalleryUnmount());
    expect(await page.locator('[data-zero-arc-chart]').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);
