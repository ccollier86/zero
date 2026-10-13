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
    // Imported component CSS is a separate output; a single --outfile aliases
    // the CSS and JS paths. Keep both actual build artifacts in this fixture.
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'data-table-overflow.browser-fixture.tsx')], target: 'browser', format: 'iife' });
    if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
    bundle = await build.outputs.find(output => output.path.endsWith('.js'))!.text();
    css += '\n' + (await Promise.all(build.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()))).join('\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function open(options: { loading?: boolean; wide?: boolean; chrome?: boolean; pageScroll?: boolean; bounded?: boolean; nested?: boolean; server?: boolean } = {}) {
  const page = await lease!.browser.newPage({ viewport: { width: 900, height: 760 }, reducedMotion: 'no-preference' });
  const messages: string[] = []; failures.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  const root = '<div id="root"></div>';
  const content = options.nested
    ? `<div data-page-scroll-container style="height:500px;width:760px;overflow-y:auto"><div style="height:220px"></div>${root}<div style="height:1800px"></div></div>`
    : root;
  await page.setContent(`<!doctype html><html data-loading="${Boolean(options.loading)}" data-wide="${Boolean(options.wide)}" data-chrome="${Boolean(options.chrome)}" data-server="${Boolean(options.server)}"><body style="margin:0;padding:12px;${options.pageScroll ? 'min-height:2400px' : ''}">${content}</body></html>`);
  await page.addStyleTag({ content: css });
  if (options.bounded) await page.addStyleTag({ content: '[data-slot="data-table-grid"] { height: 180px; }' });
  if (options.pageScroll && !options.nested) await page.addStyleTag({ content: '#root { margin-top: 220px; }' });
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
    for (const [direction, range, offset] of [['Next page', 'Showing 11-20 of 24', 8], ['Next page', 'Showing 21-24 of 24', 8], ['Previous page', 'Showing 11-20 of 24', -8]] as const) {
      await page.getByRole('button', { name: direction, exact: true }).click();
      await page.getByRole('status', { name: range, exact: true }).waitFor();
      await expectDirectionalPage(page, offset);
      await settled(page);
    }
    const frames = await samples(page);
    expect(frames.length).toBeGreaterThan(15);
    expect(Math.max(...frames.map(frame => frame.x))).toBeLessThanOrEqual(1);
    expect(Math.max(...frames.map(frame => frame.y))).toBeLessThanOrEqual(1);
    expect(frames.some(frame => frame.chrome)).toBe(false);
  } finally { await close(page); }
}, 30_000);

async function expectDirectionalPage(page: Page, offset: number) {
  await page.waitForFunction(offset => document.querySelector('tbody')?.getAnimations().some(animation =>
    (animation.effect as KeyframeEffect).getKeyframes()[0]?.transform === `translateX(${offset}px)`), offset);
  const transition = await page.locator('tbody').first().evaluate(body => ({
    rows: [...body.querySelectorAll('[data-row-id]')].map(row => row.getAnimations().length),
    initialCopy: document.querySelectorAll('[data-slot="data-table-skeleton-crossfade"]').length,
    pages: body.getAnimations().map(animation => ({ delay: animation.effect!.getTiming().delay,
      duration: animation.effect!.getTiming().duration, frames: (animation.effect as KeyframeEffect).getKeyframes() })),
  }));
  expect(transition.rows.every(count => count === 0)).toBe(true);
  expect(transition.initialCopy).toBe(0);
  expect(transition.pages).toHaveLength(1);
  expect(transition.pages[0]!.delay).toBe(0); expect(transition.pages[0]!.duration).toBe(525);
  expect(transition.pages[0]!.frames[0]!.transform).toBe(`translateX(${offset}px)`);
  expect(transition.pages[0]!.frames.at(-1)!.transform).toBe('none');
}

browserTest('footer pagination stays directional after a slow server page and on cached back navigation, never replaying first-load rows', async () => {
  const page = await open({ server: true });
  try {
    await page.getByText('Record 0', { exact: true }).waitFor(); await settled(page);
    await page.evaluate(() => window.__tableOverflow.holdPageReads(true));
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.locator('[data-slot="data-table-skeleton-body"]').waitFor();
    await page.evaluate(() => window.__tableOverflow.releasePage());
    await page.getByText('Record 10', { exact: true }).waitFor();
    await expectDirectionalPage(page, 8); await settled(page);
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await page.getByText('Record 0', { exact: true }).waitFor();
    await expectDirectionalPage(page, -8); await settled(page);
    expect(await page.locator('[data-slot="data-table-skeleton-crossfade"]').count()).toBe(0);
    expect((await samples(page)).some(frame => frame.chrome)).toBe(false);
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

browserTest('a page-flow table passes vertical wheel gestures to the page in both directions', async () => {
  const page = await open({ pageScroll: true, wide: true });
  try {
    await settled(page);
    await page.evaluate(() => window.scrollTo(0, 100));
    const viewport = page.locator('[data-radix-scroll-area-viewport]');
    await viewport.hover();
    expect(await viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    await page.mouse.wheel(0, 140);
    await page.waitForFunction(() => window.scrollY > 180, undefined, { timeout: 3000 });
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, -90);
    await page.waitForFunction(previous => window.scrollY < previous - 40, before, { timeout: 3000 });
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(0);
    // Real horizontal overflow must not trap an unrelated vertical gesture.
    expect(await viewport.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(250);
  } finally { await close(page); }
}, 30_000);

for (const nested of [false, true]) browserTest(`bounded table scrolls internally, then chains at both edges to the ${nested ? 'nearest scroll parent' : 'page'}`, async () => {
  const page = await open({ pageScroll: true, bounded: true, nested });
  try {
    await settled(page);
    await page.evaluate(nested => {
      if (nested) document.querySelector('[data-page-scroll-container]')!.scrollTop = 100;
      else window.scrollTo(0, 100);
    }, nested);
    const viewport = page.locator('[data-radix-scroll-area-viewport]');
    await viewport.hover();
    expect(await viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    await page.mouse.wheel(0, 60);
    await page.waitForFunction(() => document.querySelector('[data-radix-scroll-area-viewport]')!.scrollTop > 30);
    const ancestorOffset = () => page.evaluate(nested => nested ? document.querySelector('[data-page-scroll-container]')!.scrollTop : window.scrollY, nested);
    expect(await ancestorOffset()).toBe(100);
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.mouse.wheel(0, 90);
    await page.waitForFunction(nested => (nested ? document.querySelector('[data-page-scroll-container]')!.scrollTop : window.scrollY) > 150, nested, { timeout: 3000 });
    const bottom = await ancestorOffset();
    await viewport.evaluate(element => { element.scrollTop = 0; });
    await viewport.hover(); await page.mouse.wheel(0, -70);
    await page.waitForFunction(({ nested, bottom }) => (nested ? document.querySelector('[data-page-scroll-container]')!.scrollTop : window.scrollY) < bottom - 30, { nested, bottom }, { timeout: 3000 });
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(0);
    if (nested) expect(await page.evaluate(() => window.scrollY)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('table fades follow actual overflow on both axes without enabling horizontal scrollbar chrome', async () => {
  const page = await open({ wide: true, bounded: true });
  try {
    await settled(page);
    const viewport = page.locator('[data-radix-scroll-area-viewport]');
    await viewport.hover();
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
      return viewport.style.getPropertyValue('--zero-scroll-edge-bottom') !== '0px'
        && viewport.style.getPropertyValue('--zero-scroll-edge-right') !== '0px';
    }, undefined, { timeout: 3000 });
    expect(await viewport.getAttribute('data-zero-scroll-fade')).toBe('both');
    expect(await viewport.evaluate(element => getComputedStyle(element).maskImage.split('linear-gradient').length - 1)).toBe(2);
    expect(await page.locator('.zero-scroll-track[data-axis="x"]').count()).toBe(0);
    expect((await samples(page)).some(frame => frame.chrome)).toBe(false);
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; });
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
      return viewport.style.getPropertyValue('--zero-scroll-edge-bottom') === '0px'
        && viewport.style.getPropertyValue('--zero-scroll-edge-right') === '0px'
        && viewport.style.getPropertyValue('--zero-scroll-edge-top') !== '0px'
        && viewport.style.getPropertyValue('--zero-scroll-edge-left') !== '0px';
    });
  } finally { await close(page); }
  const fits = await open();
  try {
    await settled(fits);
    expect(await fits.locator('[data-radix-scroll-area-viewport]').evaluate(element => ['top', 'bottom', 'left', 'right']
      .map(edge => (element as HTMLElement).style.getPropertyValue(`--zero-scroll-edge-${edge}`)))).toEqual(['0px', '0px', '0px', '0px']);
  } finally { await close(fits); }
}, 30_000);

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
