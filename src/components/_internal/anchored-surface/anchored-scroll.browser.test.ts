/** Headless native Radix scroll ownership: exact refs, masks, keyboard and rail gestures; no application boot. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Page, Locator } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/anchored-scroll-');
  try {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/anchored-scroll.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
    script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function mount() {
  const page = await lease!.browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000); await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('scroll-menu-trigger').waitFor(); return page;
}
async function dragRail(page: Page, surface: Locator) {
  const thumb = surface.locator('[data-axis="y"] [data-zero-scroll-thumb]'); await thumb.waitFor();
  const bounds = (await thumb.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 20); await page.mouse.up();
}
browserTest('long dropdown root/submenu retain Radix refs, keyboard and magnetic selection while only their inner viewport scrolls', async () => {
  const page = await mount();
  try {
    await page.getByTestId('scroll-menu-trigger').press('ArrowDown');
    const menu = page.getByTestId('scroll-menu'); await menu.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="scroll-menu"] .zero-scroll-decoration'));
    const viewport = menu.locator('[data-slot="dropdown-menu-viewport"]');
    expect(await menu.evaluate(element => ({ ref: element === (window as any).__anchoredScroll.menu(), overflow: getComputedStyle(element).overflowY,
      mask: getComputedStyle(element).maskImage, owner: element.getAttribute('data-zero-overlay-owner') })))
      .toEqual({ ref: true, overflow: 'hidden', mask: 'none', owner: 'anchored-scroll-owner' });
    expect(await viewport.evaluate(element => ({ ref: element === (window as any).__anchoredScroll.menuViewport(), overflow: element.scrollHeight > element.clientHeight,
      class: element.classList.contains('caller-menu-viewport'), custom: getComputedStyle(element).getPropertyValue('--caller-viewport').trim(), nested: element.querySelector('.zero-scroll-viewport') !== null })))
      .toEqual({ ref: true, overflow: true, class: true, custom: 'retained', nested: false });
    expect(await menu.locator('.zero-scroll-viewport').count()).toBe(1);
    expect(await menu.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(180);
    expect(await viewport.evaluate(element => element.clientHeight)).toBeLessThan(await menu.evaluate(element => element.clientHeight));
    expect(await viewport.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
    await dragRail(page, menu);
    expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await menu.isVisible()).toBe(true); expect(await page.evaluate(() => (window as any).__anchoredScroll.selected())).toBe('');
    expect(await page.evaluate(() => (window as any).__anchoredScroll.menuChanges())).toEqual([true]);
    await menu.getByRole('menuitem', { name: 'Action 1', exact: true }).focus(); await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.textContent === 'Action 3');
    await page.keyboard.press('End'); await page.waitForFunction(() => document.activeElement?.textContent === 'Action 30');
    expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const edge = await viewport.evaluate(element => ({ fade: (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'),
      gap: element.getBoundingClientRect().bottom - document.activeElement!.getBoundingClientRect().bottom }));
    if (edge.gap <= 2) expect(edge.fade).toBe('0px');
    await menu.getByRole('menuitem', { name: 'More actions', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    const submenu = page.getByTestId('scroll-submenu'); await submenu.waitFor();
    expect(await submenu.locator('.zero-scroll-viewport').count()).toBe(1);
    expect(await submenu.locator('[data-slot="dropdown-menu-viewport"]').evaluate(element => element === (window as any).__anchoredScroll.subViewport())).toBe(true);
    await dragRail(page, submenu); expect(await submenu.isVisible()).toBe(true); expect(await menu.isVisible()).toBe(true);
    await page.keyboard.press('ArrowLeft'); await submenu.waitFor({ state: 'detached' });
    await menu.getByRole('menuitem', { name: 'Action 30', exact: true }).focus(); await page.keyboard.press('Enter');
    await menu.waitFor({ state: 'detached' }); expect(await page.evaluate(() => (window as any).__anchoredScroll.selected())).toBe('Action 30');
    expect(await page.getByTestId('scroll-menu-trigger').evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => (window as any).__anchoredScroll.cleanups())).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).__anchoredScroll.registered())).toBe(false);
    // Without the caller's tighter bound, Radix's actual collision-resolved
    // available height is still the outer ceiling and the inner viewport shrinks.
    await page.evaluate(() => (window as any).__anchoredScroll.configure({ bounded: false }));
    await page.getByTestId('scroll-menu-trigger').press('ArrowDown'); await menu.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="scroll-menu"]')?.hasAttribute('data-zero-anchored-ready'));
    const defaultBound = await menu.evaluate(element => ({ height: element.clientHeight,
      available: Number.parseFloat(getComputedStyle(element).getPropertyValue('--radix-dropdown-menu-content-available-height')),
      inner: element.querySelector<HTMLElement>('[data-slot="dropdown-menu-viewport"]')!.clientHeight,
      content: element.querySelector<HTMLElement>('[data-slot="dropdown-menu-viewport"]')!.scrollHeight }));
    expect(defaultBound.height).toBeLessThanOrEqual(defaultBound.available + 1);
    expect(defaultBound.inner).toBeLessThan(defaultBound.height); expect(defaultBound.content).toBeGreaterThan(defaultBound.inner);
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 20_000);
browserTest('existing Time, Calendar and cmdk popovers retain their exact native viewport without automatic PopoverViewport wrapping', async () => {
  const page = await mount();
  try {
    await page.getByRole('combobox', { name: 'Existing time', exact: true }).click();
    const time = page.locator('[data-slot="time-picker-popover"]'); await time.waitFor();
    expect(await time.locator('.zero-scroll-viewport').count()).toBe(1); expect(await time.locator('[data-slot="popover-viewport"]').count()).toBe(0);
    await time.getByRole('button', { name: 'Close time picker', exact: true }).click(); await time.waitFor({ state: 'detached' });
    await page.getByTestId('existing-calendar-trigger').click(); const calendar = page.getByTestId('existing-calendar'); await calendar.waitFor();
    await calendar.getByRole('button', { name: /choose year/i }).click();
    expect(await calendar.locator('.zero-scroll-viewport').count()).toBe(1); expect(await calendar.locator('[data-slot="popover-viewport"]').count()).toBe(0);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await calendar.waitFor({ state: 'detached' });
    await page.getByTestId('existing-command-trigger').click(); const command = page.getByTestId('existing-command'); await command.waitFor();
    expect(await command.locator('.zero-scroll-viewport').count()).toBe(1); expect(await command.locator('[data-slot="popover-viewport"]').count()).toBe(0);
    await page.keyboard.press('Escape'); await command.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 20_000);
browserTest('opt-in PopoverViewport retains forms, fixed chrome and caller refs while scaled rail dragging stays inside the native Content', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => (window as any).__anchoredScroll.configure({ scale: .8, custom: true }));
    await page.getByTestId('scroll-popover-trigger').click(); const popover = page.getByTestId('scroll-popover'); await popover.waitFor();
    const viewport = page.getByTestId('scroll-form-body'); await popover.locator('.zero-scroll-decoration').waitFor();
    expect(await popover.getAttribute('data-zero-anchored-motion')).toBeNull();
    // The caller's explicit Motion recipe is preserved even in reduced mode.
    // Compare fixed chrome after that entrance, not two different animation frames.
    await page.waitForFunction(() => {
      const transform = getComputedStyle(document.querySelector('[data-testid="scroll-popover"]')!).transform;
      return transform === 'none' || Math.abs(new DOMMatrixReadOnly(transform).a - 1) < .000001;
    });
    expect(await popover.evaluate(element => element === (window as any).__anchoredScroll.popover())).toBe(true);
    expect(await viewport.evaluate(element => ({ ref: element === (window as any).__anchoredScroll.popoverViewport(), class: element.classList.contains('caller-form-body'),
      custom: getComputedStyle(element).getPropertyValue('--caller-body').trim(), role: element.getAttribute('role') })))
      .toEqual({ ref: true, class: true, custom: 'retained', role: null });
    expect(await popover.locator('.zero-scroll-viewport').count()).toBe(1); expect(await popover.locator('.zero-menu-active-highlight').count()).toBe(0);
    const header = page.getByTestId('scroll-form-header'), footer = page.getByTestId('scroll-form-footer');
    const before = { header: await header.boundingBox(), footer: await footer.boundingBox() };
    expect(await header.evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
    expect(await footer.evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
    await dragRail(page, popover);
    expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await popover.isVisible()).toBe(true); expect(await page.evaluate(() => (window as any).__anchoredScroll.popoverChanges())).toEqual([true]);
    expect(await header.boundingBox()).toEqual(before.header); expect(await footer.boundingBox()).toEqual(before.footer);
    expect(await page.getByTestId('scroll-form').evaluate(element => new FormData(element as HTMLFormElement).getAll('entry').length)).toBe(30);
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="scroll-form-body"]')?.style.getPropertyValue('--zero-scroll-edge-bottom') === '0px');
    await page.getByRole('button', { name: 'Close form', exact: true }).click(); await popover.waitFor({ state: 'detached' });
    expect(await page.getByTestId('scroll-popover-trigger').evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => (window as any).__anchoredScroll.popoverViewport())).toBeNull();
  } finally { await page.close(); }
}, 20_000);
