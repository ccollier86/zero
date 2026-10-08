/** Real styled scroll extents sampled during motion; genuine wide-table input stays usable. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'; // Bun has no equivalent temporary-directory lifecycle API.
import { join } from 'node:path';
import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const failures = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'table-overflow-'));
  try {
    css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
    const output = join(directory, 'fixture.js');
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'data-table-overflow.browser-fixture.tsx'),
      '--target=browser', '--format=iife', '--outfile', output], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Overflow fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function open(options: { loading?: boolean; wide?: boolean; chrome?: boolean } = {}) {
  const page = await lease!.browser.newPage({ viewport: { width: 900, height: 760 }, reducedMotion: 'no-preference' });
  const messages: string[] = []; failures.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent(`<!doctype html><html data-loading="${Boolean(options.loading)}" data-wide="${Boolean(options.wide)}" data-chrome="${Boolean(options.chrome)}"><body style="margin:0;padding:12px"><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    type Sample = { at: number; x: number; y: number; innerOverflow: string[]; chrome: boolean };
    const windowWithSamples = window as unknown as { __overflowSamples: Sample[]; __overflowRaf: number };
    windowWithSamples.__overflowSamples = [];
    const sample = () => {
      const grid = document.querySelector('[data-slot="data-table-grid"]');
      const viewport = grid?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
      if (viewport) windowWithSamples.__overflowSamples.push({ at: performance.now(),
        x: viewport.scrollWidth - viewport.clientWidth, y: viewport.scrollHeight - viewport.clientHeight,
        innerOverflow: [...grid!.querySelectorAll('[data-slot="table-container"]')].map(element => getComputedStyle(element).overflow),
        chrome: [...grid!.querySelectorAll('[data-table-scrollbar="horizontal"]')].some(element => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().height > 0),
      });
      windowWithSamples.__overflowRaf = requestAnimationFrame(sample);
    };
    sample();
  });
  await page.addScriptTag({ content: bundle }); await page.locator('[data-slot="data-table-grid"]').waitFor();
  return page;
}
async function close(page: Page) { try { expect(failures.get(page)).toEqual([]); } finally { await page.close(); } }
async function samples(page: Page) {
  return page.evaluate(() => (window as unknown as { __overflowSamples: { at: number; x: number; y: number; innerOverflow: string[]; chrome: boolean }[] }).__overflowSamples);
}
async function settled(page: Page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="data-table-skeleton-crossfade"]')
    && !document.querySelector('[data-slot="data-table-skeleton-body"]')
    && !document.querySelector('[data-slot="data-table-grid"]')?.getAnimations({ subtree: true }).length);
}

for (const loading of [false, true]) browserTest(`${loading ? 'skeleton resolve' : 'initial populated reveal'} never creates transient x/y overflow or native nested scrollbars`, async () => {
  const page = await open({ loading });
  try {
    await page.locator('[data-slot="data-table-grid"]').hover();
    if (loading) {
      await page.locator('[data-slot="data-table-skeleton-body"]').waitFor();
      await page.evaluate(() => window.__tableOverflow.resolve());
    }
    await settled(page);
    const frames = await samples(page);
    expect(frames.length).toBeGreaterThan(15);
    expect(Math.max(...frames.map(frame => frame.x))).toBeLessThanOrEqual(1);
    expect(Math.max(...frames.map(frame => frame.y))).toBeLessThanOrEqual(1);
    expect(frames.every(frame => frame.innerOverflow.every(overflow => overflow === 'clip'))).toBe(true);
    expect(frames.some(frame => frame.chrome)).toBe(false);
    expect(await page.locator('[data-radix-scroll-area-viewport]').evaluate(element => getComputedStyle(element).overflowX)).toBe('scroll');
  } finally { await close(page); }
}, 30_000);

browserTest('page entrance 8px motion stays clipped to the real table width on every sampled frame', async () => {
  const page = await open();
  try {
    await settled(page);
    await page.evaluate(() => (window as unknown as { __overflowSamples: unknown[] }).__overflowSamples = []);
    for (const [direction, range] of [['Next page', 'Showing 11-20 of 24'], ['Next page', 'Showing 21-24 of 24'], ['Previous page', 'Showing 11-20 of 24']] as const) {
      await page.getByRole('button', { name: direction, exact: true }).click();
      await page.getByRole('status', { name: range, exact: true }).waitFor();
      await page.waitForFunction(() => Boolean(document.querySelector('tbody')?.getAnimations().length));
      await settled(page);
    }
    const frames = await samples(page);
    expect(frames.length).toBeGreaterThan(15);
    expect(Math.max(...frames.map(frame => frame.x))).toBeLessThanOrEqual(1);
    expect(Math.max(...frames.map(frame => frame.y))).toBeLessThanOrEqual(1);
    expect(frames.some(frame => frame.chrome)).toBe(false);
  } finally { await close(page); }
}, 30_000);

browserTest('default-hidden horizontal chrome preserves real overflow, horizontal wheel input, and keyboard focus reveal', async () => {
  const page = await open({ wide: true });
  try {
    await settled(page);
    const viewport = page.locator('[data-radix-scroll-area-viewport]');
    expect(await viewport.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(250);
    expect(await viewport.evaluate(element => getComputedStyle(element).overflowX)).toBe('scroll');
    await viewport.hover(); await page.mouse.wheel(280, 0);
    await page.waitForFunction(() => document.querySelector('[data-radix-scroll-area-viewport]')!.scrollLeft > 0);
    expect((await samples(page)).some(frame => frame.chrome)).toBe(false);
    await page.getByRole('button', { name: 'Record 0', exact: true }).focus();
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await expectFocusedRightmost(page);
    const geometry = await page.getByRole('button', { name: 'Very-long-unbroken-record-result-value-0', exact: true }).evaluate(element => {
      const viewport = element.closest('[data-radix-scroll-area-viewport]')!.getBoundingClientRect();
      const button = element.getBoundingClientRect();
      return { scrollLeft: element.closest('[data-radix-scroll-area-viewport]')!.scrollLeft, right: button.right, viewportRight: viewport.right };
    });
    expect(geometry.scrollLeft).toBeGreaterThan(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportRight + 1);
  } finally { await close(page); }
}, 30_000);
async function expectFocusedRightmost(page: Page) {
  expect(await page.getByRole('button', { name: 'Very-long-unbroken-record-result-value-0', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
}

browserTest('horizontal scrollbar chrome is explicitly opt-in and never shown for a table that fits', async () => {
  const page = await open({ wide: true, chrome: true });
  try {
    await settled(page); await page.locator('[data-slot="data-table-grid"]').hover();
    const scrollbar = page.locator('[data-table-scrollbar="horizontal"]');
    await scrollbar.waitFor(); expect(await scrollbar.isVisible()).toBe(true);
    await page.evaluate(() => window.__tableOverflow.chrome(false));
    expect(await scrollbar.isVisible()).toBe(false);
  } finally { await close(page); }
  const fits = await open({ chrome: true });
  try {
    await settled(fits); await fits.locator('[data-slot="data-table-grid"]').hover();
    expect(await fits.locator('[data-table-scrollbar="horizontal"]').count()).toBe(0);
    expect((await samples(fits)).some(frame => frame.chrome)).toBe(false);
  } finally { await close(fits); }
}, 30_000);
