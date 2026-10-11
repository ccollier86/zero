/** Independent production-risk checks; no application preview, configuration or service boot. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { renderThemeFoundationCss } from '../../../design-system/theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const built = await Bun.build({ entrypoints: [`${import.meta.dir}/menu-highlight-review.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
  script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
  css = renderThemeFoundationCss();
  for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function mount(): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 800, height: 500 }, reducedMotion: 'no-preference' });
  page.setDefaultTimeout(4000); await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await page.getByTestId('left').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="left-frame"] .zero-scroll-decoration'));
  return page;
}
async function configure(page: Page, id: string, next: Record<string, unknown>) {
  await page.evaluate(({ id, next }) => (window as any).__highlightReview.configure(id, next), { id, next });
}
async function aligned(page: Page, id: string) {
  await page.waitForFunction(id => {
    const row = document.querySelector(`[data-testid="${id}"]`), material = row?.parentElement?.querySelector('.zero-menu-active-highlight');
    if (!row || !material) return false;
    const a = row.getBoundingClientRect(), b = material.getBoundingClientRect();
    return Math.abs(a.left - b.left) < .4 && Math.abs(a.top - b.top) < .4 && getComputedStyle(material).opacity === '1';
  }, id);
}

browserTest('first hover, rapid reversal and keyboard focus share instance-local stationary choices', async () => {
  const page = await mount();
  try {
    await page.getByTestId('left-0').hover(); await aligned(page, 'left-0');
    expect(await page.getByTestId('right').locator('.zero-menu-active-highlight').count()).toBe(0);
    const before = await page.getByTestId('left-0').boundingBox();
    await page.getByTestId('left-2').hover(); await page.getByTestId('left-0').hover(); await aligned(page, 'left-0');
    expect(await page.getByTestId('left-0').boundingBox()).toEqual(before);
    await page.getByTestId('left-1').hover();
    await page.waitForFunction(() => document.querySelector('[data-testid="left"] .zero-menu-active-highlight') && getComputedStyle(document.querySelector('[data-testid="left"] .zero-menu-active-highlight')!).opacity === '0');
    await page.getByTestId('right-0').focus(); await aligned(page, 'right-0');
    expect(await page.getByTestId('left').locator('.zero-menu-active-highlight').count()).toBe(1);
  } finally { await page.close(); }
}, 15_000);

browserTest('live reduced-motion change snaps an in-flight magnetic material without waiting for its old spring', async () => {
  const page = await mount();
  try {
    await configure(page, 'left', { duration: '2400ms' });
    await page.getByTestId('left-0').hover(); await aligned(page, 'left-0');
    await page.getByTestId('left-2').hover();
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-testid="left-2"]')!, paint = document.querySelector('[data-testid="left"] .zero-menu-active-highlight')!;
      return Math.abs(row.getBoundingClientRect().top - paint.getBoundingClientRect().top) > 10;
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-testid="left-2"]')!, paint = document.querySelector('[data-testid="left"] .zero-menu-active-highlight')!;
      return Math.abs(row.getBoundingClientRect().top - paint.getBoundingClientRect().top) < .4;
    }, undefined, { timeout: 350 });
    expect(await page.getByTestId('left').locator('.zero-menu-active-highlight').count()).toBe(1);
  } finally { await page.close(); }
}, 15_000);

browserTest('removing virtual rows releases owned row decorations before the container itself unmounts', async () => {
  const page = await mount();
  try {
    await page.getByTestId('left-2').hover(); await aligned(page, 'left-2');
    await page.getByTestId('left-2').evaluate(element => { (window as any).__removedMenuRow = element; });
    await configure(page, 'left', { count: 1 });
    await page.getByTestId('left-2').waitFor({ state: 'detached' });
    await page.waitForFunction(() => !(window as any).__removedMenuRow.hasAttribute('data-zero-menu-choice'), undefined, { timeout: 500 });
    expect(await page.evaluate(() => (window as any).__removedMenuRow.hasAttribute('data-zero-menu-static'))).toBe(false);
    expect(await page.evaluate(() => (window as any).__removedMenuRow.hasAttribute('data-zero-menu-material'))).toBe(false);
  } finally { await page.close(); }
}, 15_000);

browserTest('hiding captured rails cancels stale drag intent before overlay rails appear again', async () => {
  const page = await mount();
  try {
    const thumb = page.getByTestId('left-frame').locator('[data-axis="y"] [data-zero-scroll-thumb]');
    const bounds = (await thumb.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('[data-testid="left-frame"] .zero-scroll-decoration')?.getAttribute('data-dragging') === 'y');
    await configure(page, 'left', { scrollbars: 'hidden' });
    await page.getByTestId('left-frame').locator('.zero-scroll-decoration').waitFor({ state: 'detached' });
    await configure(page, 'left', { scrollbars: 'always' });
    await page.getByTestId('left-frame').locator('.zero-scroll-decoration').waitFor();
    expect(await page.getByTestId('left-frame').locator('.zero-scroll-decoration').getAttribute('data-dragging')).toBeNull();
    await page.mouse.up();
    const nextBounds = (await thumb.boundingBox())!;
    await page.mouse.move(nextBounds.x + nextBounds.width / 2, nextBounds.y + nextBounds.height / 2); await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('[data-testid="left-frame"] .zero-scroll-decoration')?.getAttribute('data-dragging') === 'y');
    await configure(page, 'left', { count: 1 }); await thumb.waitFor({ state: 'detached' });
    await configure(page, 'left', { count: 5 }); await thumb.waitFor();
    expect(await page.getByTestId('left-frame').locator('.zero-scroll-decoration').getAttribute('data-dragging')).toBeNull();
    await page.mouse.up();
  } finally { await page.close(); }
}, 15_000);

browserTest('touch hover does not seed material; initial focus is exact and an inert branch does not react to physical pointer travel', async () => {
  const page = await mount();
  try {
    await page.getByTestId('left-0').dispatchEvent('pointerover', { pointerType: 'touch' });
    expect(await page.getByTestId('left').locator('.zero-menu-active-highlight').count()).toBe(0);
    await page.getByTestId('right-2').focus(); await aligned(page, 'right-2');
    expect(await page.getByTestId('right').locator('.zero-menu-active-highlight').getAttribute('aria-hidden')).toBe('true');
    expect(await page.getByTestId('right').locator('.zero-menu-active-highlight').getAttribute('tabindex')).toBeNull();
    await page.getByTestId('left-0').hover(); await aligned(page, 'left-0');
    const before = await page.getByTestId('left').locator('.zero-menu-active-highlight').boundingBox();
    await configure(page, 'left', { inert: true });
    const row = (await page.getByTestId('left-2').boundingBox())!;
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    expect(await page.getByTestId('left').locator('.zero-menu-active-highlight').boundingBox()).toEqual(before);
    await configure(page, 'left', { mounted: false });
    expect(await page.getByTestId('left-frame').locator('.zero-menu-active-highlight').count()).toBe(0);
  } finally { await page.close(); }
}, 15_000);
