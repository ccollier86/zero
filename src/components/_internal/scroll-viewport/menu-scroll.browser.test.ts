/** Real native scrolling, cmdk selection and paint-only magnetic handoff under compiled managed styles. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/menu-scroll-');
  try {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/menu-scroll.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
    script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function mount(reduced = false): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5000); await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script }); await page.getByTestId('area').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="area"] .zero-scroll-decoration') !== null);
  return page;
}
async function configured(page: Page, next: Record<string, unknown>) {
  await page.evaluate(config => (window as any).__menuScroll.configure(config), next);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
browserTest('one Radix native viewport retains refs/axes while overlay rails use exact minimum/hover geometry', async () => {
  const page = await mount(true);
  try {
    const area = page.getByTestId('area');
    expect(await area.locator('[data-radix-scroll-area-viewport]').count()).toBe(1);
    expect(await area.locator('[data-zero-scroll-registration]').evaluateAll(elements => elements.every(element => getComputedStyle(element).display === 'none'))).toBe(true);
    const viewport = area.locator('[data-radix-scroll-area-viewport]');
    expect(await viewport.evaluate(element => element === (window as any).__menuScroll.native())).toBe(true);
    const thumb = area.locator('[data-axis="y"] [data-zero-scroll-thumb]');
    expect(await thumb.evaluate(element => element.getBoundingClientRect().height)).toBe(28);
    expect(await thumb.evaluate(element => getComputedStyle(element, '::after').width)).toBe('5px');
    await area.hover(); await page.waitForFunction(() => document.querySelector('[data-testid="area"] .zero-scroll-decoration')?.hasAttribute('data-visible'));
    await area.locator('[data-axis="y"]').hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="area"] [data-axis="y"] [data-zero-scroll-thumb]')!, '::after').width === '7px');
    expect(await thumb.evaluate(element => getComputedStyle(element, '::after').width)).toBe('7px');
    await viewport.evaluate(element => { element.scrollTop = 80; });
    await page.waitForFunction(() => (window as any).__menuScroll.native().style.getPropertyValue('--zero-scroll-edge-top').includes('28px'));
    expect(await viewport.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
    await configured(page, { mounted: false }); expect(await page.evaluate(() => (window as any).__menuScroll.native())).toBeNull();
    expect(await page.evaluate(() => (window as any).__menuScroll.refCleanups())).toBeGreaterThan(0);
  } finally { await page.close(); }
}, 15_000);
browserTest('track paging, dragging and wheel scroll the exact native viewport, including scaled surfaces and RTL', async () => {
  const page = await mount(true);
  try {
    await configured(page, { type: 'always', scale: .7, rtl: true });
    const track = page.getByTestId('area').locator('[data-axis="y"]'); const bounds = (await track.boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height - 4);
    expect(await page.evaluate(() => (window as any).__menuScroll.native().scrollTop)).toBeCloseTo(142.2, 0);
    await page.evaluate(() => { (window as any).__menuScroll.native().scrollTop = 0; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="area"] [data-axis="y"] [data-zero-scroll-thumb]')!).transform.endsWith('0)'));
    const thumb = page.getByTestId('area').locator('[data-axis="y"] [data-zero-scroll-thumb]'); const initial = (await thumb.boundingBox())!;
    await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2); await page.mouse.down();
    await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2 + 21);
    const dragTop = await page.evaluate(() => (window as any).__menuScroll.native().scrollTop);
    // 21 paint px at .7 scale = 30 layout px, over 114px travel.
    expect(dragTop).toBeCloseTo(30 / 114 * 2242, 0); await page.mouse.up();
    await track.dispatchEvent('wheel', { deltaY: 100, deltaMode: 0 });
    expect(await page.evaluate(() => (window as any).__menuScroll.native().scrollTop)).toBeCloseTo(dragTop + 100, 0);
    await page.evaluate(() => { (window as any).__menuScroll.native().scrollLeft = -300; });
    await page.waitForFunction(() => document.querySelector('[data-testid="area"] [data-axis="x"] [data-zero-scroll-thumb]')?.getAttribute('style')?.includes('translateX'));
    expect(await page.getByTestId('area').locator('[data-axis="x"] [data-zero-scroll-thumb]').evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)).toBeGreaterThan(0);
  } finally { await page.close(); }
}, 15_000);
browserTest('rail edges inherit viewport containment while page-chaining and Ctrl gestures remain native', async () => {
  const page = await mount(true);
  try {
    await configured(page, { type: 'always' });
    const viewport = page.getByTestId('area').locator('[data-radix-scroll-area-viewport]');
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const track = page.getByTestId('area').locator('[data-axis="y"]');
    const consumed = () => track.evaluate(element => {
      const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
      element.dispatchEvent(event); return event.defaultPrevented;
    });
    expect(await consumed()).toBe(true);
    await viewport.evaluate(element => { (element as HTMLElement).style.overscrollBehavior = 'auto'; });
    expect(await consumed()).toBe(false);
    expect(await track.evaluate(element => {
      const event = new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true });
      element.dispatchEvent(event); return event.defaultPrevented;
    })).toBe(false);
  } finally { await page.close(); }
}, 15_000);

browserTest('dynamic later children and header offsets update fades/rails without a nested scroller or an observer loop', async () => {
  const page = await mount(true);
  try {
    const raw = page.getByTestId('raw'), frame = page.getByTestId('raw-frame');
    expect(await frame.locator('[data-axis="y"]').count()).toBe(0);
    await configured(page, { contentHeight: 320 }); await frame.locator('[data-axis="y"]').waitFor();
    expect(await raw.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'))).toContain('28px');
    await configured(page, { headerHeight: 60 });
    expect(await frame.locator('.zero-scroll-decoration').evaluate(element => (element as HTMLElement).style.top)).toBe('60px');
    await raw.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="raw"]')?.style.getPropertyValue('--zero-scroll-edge-bottom') === '0px');
    const changes = await raw.evaluate(async element => {
      let count = 0; const observer = new MutationObserver(records => { count += records.length; }); observer.observe(element, { attributes: true });
      await new Promise(resolve => setTimeout(resolve, 120)); observer.disconnect(); return count;
    });
    expect(changes).toBe(0);
  } finally { await page.close(); }
}, 15_000);
browserTest('cmdk hover/keyboard/typeahead keep native values, one magnetic layer and fixed chrome; active edge labels stay legible', async () => {
  const page = await mount(true);
  try {
    // cmdk supplies its root label via aria-labelledby; that native accessible
    // name takes precedence over an additional caller aria-label.
    const input = page.getByTestId('command').locator('[cmdk-input]'); await input.focus();
    const choices = page.getByTestId('choices'); await choices.locator('.zero-menu-active-highlight').waitFor();
    expect(await choices.locator('.zero-menu-active-highlight').count()).toBe(1);
    await page.keyboard.press('ArrowDown');
    expect(await choices.locator('[data-selected="true"]').textContent()).toBe('Option 3');
    expect(await page.evaluate(() => (window as any).__menuScroll.selected())).toBe('');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="choices"]')!.scrollTop > 0);
    const edge = await choices.evaluate(element => {
      const selected = element.querySelector('[data-selected="true"]')!, bounds = element.getBoundingClientRect(), row = selected.getBoundingClientRect();
      return { bottom: (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'), gap: bounds.bottom - row.bottom };
    });
    if (edge.gap <= 2) expect(edge.bottom).toBe('0px');
    expect(await page.getByTestId('command-footer').evaluate(element => !element.closest('.zero-scroll-viewport'))).toBe(true);
    await input.fill('Option 30'); await choices.getByRole('option', { name: 'Option 30', exact: true }).waitFor();
    await page.keyboard.press('Enter'); expect(await page.evaluate(() => (window as any).__menuScroll.selected())).toBe('Option 30');
    expect(await choices.locator('.zero-menu-active-highlight').count()).toBe(1);
  } finally { await page.close(); }
}, 15_000);
browserTest('scroll-only visibility does not turn into hover; reduced and forced-colors remove visual masking/transitions', async () => {
  const page = await mount(true);
  try {
    await configured(page, { type: 'scroll' }); await page.getByTestId('area').hover();
    expect(await page.getByTestId('area').locator('.zero-scroll-decoration').getAttribute('data-visible')).toBeNull();
    await page.evaluate(() => { (window as any).__menuScroll.native().scrollTop = 50; });
    await page.waitForFunction(() => document.querySelector('[data-testid="area"] .zero-scroll-decoration')?.hasAttribute('data-visible'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="area"] .zero-scroll-decoration')?.hasAttribute('data-visible'));
    expect(await page.getByTestId('area').locator('[data-axis="y"]').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
    await page.emulateMedia({ forcedColors: 'active' });
    expect(await page.getByTestId('area').locator('[data-radix-scroll-area-viewport]').evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
  } finally { await page.close(); }
}, 15_000);
