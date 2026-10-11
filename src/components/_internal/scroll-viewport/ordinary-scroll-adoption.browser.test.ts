/**
 * ordinary-scroll-adoption.browser.test.ts
 *
 * Qualifies shared scroll treatment on real DatePicker and ContextMenu
 * consumers under compiled platform CSS, retaining original native contracts.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { Locator, Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import {
  acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/ordinary-scroll-adoption';
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
const pageErrors = new WeakMap<Page, string[]>();
const allPageErrors: string[] = [];
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/ordinary-scroll-');
  try {
    const bundle = await Bun.build({ entrypoints: [`${import.meta.dir}/ordinary-scroll-adoption.browser-fixture.tsx`],
      target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!bundle.success) throw new Error(bundle.logs.map(log => log.message).join('\n'));
    script = await bundle.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    // New adapters own local CSS alongside the unchanged managed theme bundle.
    for (const output of bundle.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
    await mkdir(artifacts, { recursive: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => { lease?.release(); expect(allPageErrors).toEqual([]); });

async function mount(options: { width?: number; height?: number; reduced?: boolean } = {}): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: options.width ?? 1050, height: options.height ?? 760 },
    reducedMotion: options.reduced === false ? 'no-preference' : 'reduce' });
  const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => {
    const message = error.stack ?? error.message; errors.push(message); allPageErrors.push(message);
  });
  page.setDefaultTimeout(6000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('ordinary-ready').waitFor(); await frames(page); return page;
}
async function frames(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function configured(page: Page, next: Record<string, unknown>, date = false) {
  await page.evaluate(({ next, date }) => date ? window.__ordinaryScroll.configureDate(next) : window.__ordinaryScroll.configure(next), { next, date });
  await frames(page);
}
const menu = (page: Page) => page.getByTestId('menu');
const menuViewport = (page: Page) => menu(page).locator('[data-slot="context-menu-viewport"]');
const datePopup = (page: Page) => page.locator('[data-slot="date-picker-popover"]');
const dateViewport = (page: Page) => page.locator('[data-slot="date-picker-calendar-viewport"]');
const trigger = (page: Page) => page.getByRole('button', { name: 'Open date picker', exact: true });
async function openMenu(page: Page, keyboard = false) {
  const target = page.getByTestId('menu-target');
  if (keyboard) { await target.focus(); await target.press('Shift+F10'); }
  else await target.click({ button: 'right' });
  await menu(page).waitFor(); await frames(page); return menu(page);
}
async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-testid="menu"]')?.getAttribute('data-state') !== 'open');
  await frames(page);
}
async function openDate(page: Page) {
  await trigger(page).click(); await datePopup(page).waitFor(); await frames(page);
}
async function managedOwner(page: Page) {
  const owner = page.getByRole('dialog', { name: 'Managed context owner', exact: true });
  try { await owner.waitFor(); }
  catch (cause) {
    const state = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"],.zero-modal-layer')).map(element => ({
      role: element.getAttribute('role'), text: element.textContent?.slice(0, 100), hidden: getComputedStyle(element).visibility,
      ariaHidden: element.getAttribute('aria-hidden'), labelledby: element.getAttribute('aria-labelledby'),
      display: getComputedStyle(element).display, rect: element.getBoundingClientRect().toJSON(), inert: (element as HTMLElement).inert,
    })));
    throw new Error(`Managed fixture did not open: ${JSON.stringify({ errors: pageErrors.get(page), state })}`, { cause });
  }
  // An open native modal menu temporarily hides its parent from the a11y tree.
  // The same actual dialog DOM remains owned and painted; do not fake an
  // accessible role while Radix's hideOthers lease is active.
  return page.locator(`[data-zero-modal-id="${await owner.getAttribute('data-zero-modal-id')}"]`);
}
async function scrollers(locator: Locator) {
  return locator.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>('*')).filter(child => {
    const overflow = getComputedStyle(child);
    return (['auto', 'scroll'].includes(overflow.overflowY) && child.scrollHeight > child.clientHeight + 1)
      || (['auto', 'scroll'].includes(overflow.overflowX) && child.scrollWidth > child.clientWidth + 1);
  }).map(child => child.dataset.slot));
}

browserTest('context content owns one native viewport; Arc decoration stays inside the unchanged border and does not nest another scroller', async () => {
  const page = await mount();
  try {
    const outer = await openMenu(page), viewport = menuViewport(page);
    await viewport.waitFor();
    expect(await outer.evaluate(element => element === window.__ordinaryScroll.surface())).toBe(true);
    expect(await viewport.evaluate(element => element === window.__ordinaryScroll.viewport())).toBe(true);
    expect(await scrollers(outer)).toEqual(['context-menu-viewport']);
    expect(await outer.locator('[data-slot="context-menu-viewport"]').count()).toBe(1);
    expect(await outer.locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
    expect(await outer.evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
    expect(await outer.evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThan(0);
    expect(await viewport.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'))).toContain('28px');
    expect(await outer.locator('[data-zero-scroll-decoration="next"] [tabindex]').count()).toBe(0);
    await viewport.evaluate(element => { element.scrollTop = 79; }); await frames(page);
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(79);
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-top'))).toContain('28px');
    await outer.screenshot({ path: `${artifacts}/context-partial.png` });
  } finally { await page.close(); }
}, 20_000);

browserTest('managed context root/submenu inherit the owner portal, theme and reserved layer; Escape releases only the genuinely open branch', async () => {
  const page = await mount();
  try {
    await page.getByTestId('managed-open').click();
    const owner = await managedOwner(page);
    await page.getByTestId('managed-target').focus(); await page.keyboard.press('Shift+F10');
    const surface = page.getByTestId('managed-menu'); await surface.waitFor(); await frames(page);
    const id = await owner.getAttribute('data-zero-modal-id'); expect(await surface.getAttribute('data-zero-overlay-owner')).toBe(id);
    expect(await page.getByTestId('portal-container').locator('[data-testid="managed-menu"]').count()).toBe(1);
    const parentLayer = await owner.evaluate(element => parseInt((element.closest('.zero-modal-layer') as HTMLElement).style.zIndex));
    expect(await surface.evaluate(element => parseInt(getComputedStyle(element).zIndex))).toBe(parentLayer + 2);
    expect(await surface.evaluate(element => getComputedStyle(element).getPropertyValue('--zero-test-owned-token').trim())).toBe('owned-from-trigger');
    expect(await surface.evaluate(element => (element as HTMLElement).style.getPropertyValue('--radix-popover-content-available-height'))).toBe('');
    expect(await surface.evaluate(element => {
      const box = element.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + 14)?.closest('[data-testid="managed-menu"]') === element;
    })).toBe(true);
    await surface.getByRole('menuitem', { name: 'Keep managed menu open', exact: true }).click();
    expect(await owner.isVisible()).toBe(true); expect(await surface.getAttribute('data-state')).toBe('open');
    const submenuTrigger = surface.getByRole('menuitem', { name: 'Managed destinations', exact: true });
    await submenuTrigger.focus(); await submenuTrigger.press('ArrowRight');
    const submenu = page.getByTestId('managed-submenu'); await submenu.waitFor(); await frames(page);
    expect(await submenu.getAttribute('data-zero-overlay-owner')).toBe(id);
    expect(await submenu.evaluate(element => parseInt(getComputedStyle(element).zIndex))).toBe(parentLayer + 2);
    await page.keyboard.press('Escape'); await submenu.waitFor({ state: 'detached' });
    // Native ContextMenu Escape closes the complete menu tree; a directional
    // return key closes only the submenu (qualified separately below).
    await surface.waitFor({ state: 'detached' });
    expect(await owner.isVisible()).toBe(true);
    expect(await page.evaluate(id => window.__ordinaryScroll.registered(id!), id)).toBe(false);
    await page.keyboard.press('Escape'); await owner.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 25_000);

browserTest('caller-retained closed managed content releases Zero registration and rails while original Radix modality lasts until caller retirement', async () => {
  const page = await mount();
  try {
    await configured(page, { forceMount: true, mounted: false }); await page.getByTestId('managed-open').click(); const owner = await managedOwner(page);
    const id = await owner.getAttribute('data-zero-modal-id');
    await page.getByTestId('managed-target').focus(); await page.keyboard.press('Shift+F10');
    const surface = page.getByTestId('managed-menu'); await surface.waitFor(); await frames(page);
    expect(await page.evaluate(id => window.__ordinaryScroll.registered(id!), id)).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-testid="managed-menu"]')?.getAttribute('data-state') === 'closed'); await frames(page);
    expect(await page.evaluate(id => window.__ordinaryScroll.registered(id!), id)).toBe(false);
    expect(await surface.locator('[data-slot="context-menu-viewport"]').getAttribute('inert')).not.toBeNull();
    expect(await surface.locator('[data-zero-scroll-decoration="next"]').count()).toBe(0);
    // Native forceMount retains Radix's hideOthers/DismissableLayer as well as
    // the DOM. Caller-hidden paint alone cannot retire that original lifecycle.
    expect(await owner.evaluate(element => element.closest('.zero-modal-layer')?.getAttribute('aria-hidden'))).toBe('true');
    await page.evaluate(() => window.__ordinaryScroll.releaseManagedRetention()); await surface.waitFor({ state: 'detached' }); await frames(page);
    expect(await owner.evaluate(element => element.closest('.zero-modal-layer')?.getAttribute('aria-hidden'))).toBeNull();
    await page.getByTestId('managed-target').focus(); await page.keyboard.press('Escape'); await owner.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 25_000);

browserTest('a retained managed context branch becomes inert below a new dialog and cannot intercept the child dismissal', async () => {
  const page = await mount();
  try {
    await page.getByTestId('managed-open').click();
    const owner = await managedOwner(page);
    await page.getByTestId('managed-target').focus(); await page.keyboard.press('Shift+F10');
    const surface = page.getByTestId('managed-menu'); await surface.waitFor();
    await surface.getByRole('menuitem', { name: 'Open stacked context dialog', exact: true }).click();
    const child = page.getByRole('dialog', { name: 'Stacked context child', exact: true }); await child.waitFor(); await frames(page);
    expect(await surface.getAttribute('inert')).not.toBeNull();
    expect(await surface.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
    expect(await surface.locator('[data-slot="context-menu-viewport"]').getAttribute('inert')).not.toBeNull();
    expect(await surface.locator('[data-zero-scroll-decoration="next"]').count()).toBe(0);
    await page.keyboard.press('Escape'); await child.waitFor({ state: 'detached' }); await frames(page);
    expect(await owner.isVisible()).toBe(true);
    // Retained caller-mounted content must release registration once it closes,
    // otherwise every later parent Escape would remain incorrectly blocked.
    await page.getByTestId('managed-target').focus(); await page.keyboard.press('Escape'); await frames(page);
    if (await owner.count()) { await page.keyboard.press('Escape'); await owner.waitFor({ state: 'detached' }); }
  } finally { await page.close(); }
}, 25_000);

browserTest('a managed asChild section cannot forge its owner or layer and cannot undo inactive stacking guards with child style or inert props', async () => {
  const page = await mount();
  try {
    await configured(page, { asChild: true }); await page.getByTestId('managed-open').click();
    const owner = await managedOwner(page);
    await page.getByTestId('managed-target').focus(); await page.keyboard.press('Shift+F10');
    const surface = page.getByTestId('managed-menu'); await surface.waitFor(); await frames(page);
    const ownerId = await owner.getAttribute('data-zero-modal-id');
    expect(await surface.evaluate(element => element.tagName)).toBe('SECTION');
    expect(await surface.getAttribute('data-hostile-child')).toBe('retained');
    expect(await surface.getAttribute('data-zero-overlay-owner')).toBe(ownerId);
    const layer = await owner.evaluate(element => parseInt((element.closest('.zero-modal-layer') as HTMLElement).style.zIndex));
    expect(await surface.evaluate(element => parseInt(getComputedStyle(element).zIndex))).toBe(layer + 2);
    await surface.getByRole('menuitem', { name: 'Open stacked context dialog', exact: true }).click();
    const child = page.getByRole('dialog', { name: 'Stacked context child', exact: true }); await child.waitFor(); await frames(page);
    expect(await surface.getAttribute('data-zero-overlay-owner')).toBe(ownerId);
    expect(await surface.getAttribute('inert')).not.toBeNull();
    expect(await surface.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
    expect(await surface.locator('[data-slot="context-menu-viewport"]').getAttribute('inert')).not.toBeNull();
    await page.keyboard.press('Escape'); await child.waitFor({ state: 'detached' }); await frames(page);
    expect(await owner.isVisible()).toBe(true);
    await page.getByTestId('managed-target').focus(); await page.keyboard.press('Escape'); await frames(page);
    if (await owner.count()) { await page.keyboard.press('Escape'); await owner.waitFor({ state: 'detached' }); }
  } finally { await page.close(); }
}, 25_000);

browserTest('fitting context menus have no painted rails; both-axis partial content uses exact native offsets without masking its shell', async () => {
  const page = await mount();
  try {
    await configured(page, { rows: 2 }); const outer = await openMenu(page);
    const fitting = await menuViewport(page).evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth,
      height: element.clientHeight, scrollHeight: element.scrollHeight, style: getComputedStyle(element).cssText }));
    expect(await outer.locator('.zero-scroll-track').count(), JSON.stringify(fitting)).toBe(0);
    expect(await menuViewport(page).evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'))).toBe('0px');
    await closeMenu(page); await configured(page, { rows: 32, wide: true }); await openMenu(page);
    const viewport = menuViewport(page);
    expect(await viewport.evaluate(element => [element.scrollWidth > element.clientWidth, element.scrollHeight > element.clientHeight])).toEqual([true, true]);
    expect(await outer.locator('[data-axis="x"]').count()).toBe(1); expect(await outer.locator('[data-axis="y"]').count()).toBe(1);
    await viewport.evaluate(element => { element.scrollTop = 38; element.scrollLeft = 87; }); await frames(page);
    expect(await viewport.evaluate(element => [element.scrollTop, element.scrollLeft])).toEqual([38, 87]);
    expect(await outer.evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-left'))).toContain('28px');
    const mutations = await viewport.evaluate(async element => {
      let count = 0; const observer = new MutationObserver(records => { count += records.length; });
      observer.observe(element, { attributes: true }); await new Promise(resolve => setTimeout(resolve, 140)); observer.disconnect(); return count;
    });
    expect(mutations).toBe(0);
  } finally { await page.close(); }
}, 20_000);

browserTest('context keyboard/typeahead and native item selection stay owned by Radix; highlighted edge text remains readable', async () => {
  const page = await mount();
  try {
    const outer = await openMenu(page, true), viewport = menuViewport(page);
    await page.keyboard.press('ArrowDown');
    expect(await outer.locator('[data-highlighted]').textContent()).not.toBe('Disabled action');
    await page.keyboard.press('End'); await frames(page);
    expect(await outer.locator('[data-highlighted]').textContent()).toBe('Zebra action');
    const edge = await viewport.evaluate(element => {
      const item = element.querySelector<HTMLElement>('[data-highlighted]')!, bounds = element.getBoundingClientRect(), box = item.getBoundingClientRect();
      return { bottom: (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'), gap: bounds.bottom - box.bottom,
        focused: element.contains(document.activeElement), top: element.scrollTop };
    });
    expect(edge.focused).toBe(true); expect(edge.top).toBeGreaterThan(0);
    if (edge.gap <= 2) expect(edge.bottom).toBe('0px');
    await page.keyboard.press('Home'); await page.keyboard.type('Action 24'); await frames(page);
    expect(await outer.locator('[data-highlighted]').textContent()).toBe('Action 24');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__ordinaryScroll.actions())).toEqual(['action-24']);
    expect(await outer.getAttribute('data-state')).toBe('open');
    await closeMenu(page);
    expect(await page.getByTestId('menu-target').evaluate(element => document.activeElement === element)).toBe(true);
  } finally { await page.close(); }
}, 20_000);

browserTest('context submenus independently scroll and return focus directionally in LTR and RTL', async () => {
  for (const rtl of [false, true]) {
    const page = await mount();
    try {
      await configured(page, { rtl }); const outer = await openMenu(page, true);
      const subTrigger = outer.getByRole('menuitem', { name: 'Move to', exact: true });
      await subTrigger.focus(); await subTrigger.press(rtl ? 'ArrowLeft' : 'ArrowRight');
      const submenu = page.getByTestId('submenu'); await submenu.waitFor(); await frames(page);
      const viewport = submenu.locator('[data-slot="context-menu-viewport"]');
      expect(await scrollers(submenu)).toEqual(['context-menu-viewport']);
      expect(await submenu.locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
      await page.keyboard.press('End'); await frames(page);
      expect(await submenu.locator('[data-highlighted]').textContent()).toBe('Destination 24');
      expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await menuViewport(page).evaluate(element => element.scrollTop)).toBe(0);
      await page.keyboard.press(rtl ? 'ArrowRight' : 'ArrowLeft'); await submenu.waitFor({ state: 'detached' });
      expect(await subTrigger.evaluate(element => document.activeElement === element)).toBe(true);
      expect(await outer.getAttribute('data-state')).toBe('open');
    } finally { await page.close(); }
  }
}, 25_000);

browserTest('custom container, nonportal and forceMount retain native menu semantics while closed rails cannot admit interaction', async () => {
  for (const portal of ['custom', 'none']) {
    const page = await mount();
    try {
      await configured(page, { portal, forceMount: true });
      const outer = menu(page); await outer.waitFor({ state: 'attached' });
      expect(await outer.getAttribute('data-state')).toBe('closed');
      const owner = portal === 'custom' ? page.getByTestId('portal-container') : page.getByTestId('menu-host');
      expect(await owner.locator('[data-testid="menu"]').count()).toBe(1);
      await openMenu(page); const viewport = menuViewport(page);
      await viewport.evaluate(element => { element.scrollTop = 42; }); await closeMenu(page);
      expect(await outer.getAttribute('data-state')).toBe('closed');
      const snapshot = await outer.evaluate(element => {
        const viewport = element.querySelector<HTMLElement>('[data-slot="context-menu-viewport"]')!;
        const before = viewport.scrollTop, track = element.querySelector('[data-axis="y"]');
        track?.dispatchEvent(new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true }));
        return { before, after: viewport.scrollTop,
          inactive: viewport.inert || Boolean(viewport.closest('[inert]')) };
      });
      expect(snapshot.inactive).toBe(true); expect(snapshot.after).toBe(snapshot.before);
      await configured(page, { mounted: false });
      expect(await page.evaluate(() => window.__ordinaryScroll.surface())).toBeNull();
      expect(await owner.locator('.zero-scroll-decoration').count()).toBe(0);
    } finally { await page.close(); }
  }
}, 25_000);

browserTest('opaque asChild and explicit native retain original DOM, public/child cleanup refs and native animation/drag handlers', async () => {
  const page = await mount();
  try {
    await configured(page, { asChild: true, scrollTreatment: 'native' }); const outer = await openMenu(page);
    expect(await outer.evaluate(element => element.tagName)).toBe('SECTION');
    expect(await outer.evaluate(element => element === window.__ordinaryScroll.surface() && element === window.__ordinaryScroll.child())).toBe(true);
    expect(await outer.locator('[data-slot="context-menu-viewport"]').count()).toBe(0);
    expect(await outer.locator('.zero-scroll-decoration').count()).toBe(0);
    await outer.evaluate(element => {
      element.dispatchEvent(new AnimationEvent('animationstart', { bubbles: true }));
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
    });
    expect(await page.evaluate(() => window.__ordinaryScroll.events().filter(event => event.kind === 'animation' || event.kind === 'drag')))
      .toEqual([{ kind: 'animation', native: true, exact: true }, { kind: 'drag', native: true, exact: true }]);
    await outer.evaluate(element => { (window as unknown as { __retiredContextSection: Element }).__retiredContextSection = element; });
    await configured(page, { childTag: 'article', scrollTreatment: 'arc' });
    expect(await outer.evaluate(element => element.tagName)).toBe('ARTICLE');
    expect(await outer.locator('.zero-scroll-decoration').count()).toBe(0);
    const replaced = await page.evaluate(() => window.__ordinaryScroll.refs());
    for (const owner of ['child', 'public'] as const) {
      expect(replaced.some(event => event.owner === owner && event.phase === 'cleanup' && event.tag === 'SECTION')).toBe(true);
      expect(replaced.some(event => event.owner === owner && event.phase === 'attach' && event.tag === 'ARTICLE')).toBe(true);
    }
    expect(await page.evaluate(() => (window as unknown as { __retiredContextSection: Element }).__retiredContextSection.isConnected)).toBe(false);
    await configured(page, { mounted: false });
    expect(await page.evaluate(() => [window.__ordinaryScroll.surface(), window.__ordinaryScroll.child()])).toEqual([null, null]);
  } finally { await page.close(); }
}, 20_000);

browserTest('context preserves the compact 120ms entrance and uses no scrollbar transition or masking in reduced/forced-color modes', async () => {
  const page = await mount({ reduced: false });
  try {
    await page.evaluate(() => {
      const native = Element.prototype.animate;
      (window as unknown as { __contextTimings: number[] }).__contextTimings = [];
      Element.prototype.animate = function (this: Element, ...args: Parameters<typeof native>) {
        const animation = native.apply(this, args);
        if (this.getAttribute('data-testid') === 'menu') {
          const duration = animation.effect?.getTiming().duration;
          if (typeof duration === 'number') (window as unknown as { __contextTimings: number[] }).__contextTimings.push(duration);
        }
        return animation;
      };
    });
    const outer = await openMenu(page);
    // ContextMenuSurface remains the original imperative 0.12-second recipe.
    const duration = await page.evaluate(() => (window as unknown as { __contextTimings: number[] }).__contextTimings);
    expect(duration.some(value => value === 120)).toBe(true);
    await closeMenu(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await openMenu(page);
    expect(await outer.evaluate(element => element.getAnimations().length)).toBe(0);
    expect(await outer.locator('[data-axis="y"]').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
    await page.emulateMedia({ forcedColors: 'active' });
    expect(await menuViewport(page).evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
  } finally { await page.close(); }
}, 20_000);

browserTest('explicit ContextMenuViewport composes Arc inside a consumer-owned asChild host without replacing its refs or border', async () => {
  const page = await mount();
  try {
    await configured(page, { asChild: true, customViewport: true }); const outer = await openMenu(page), viewport = menuViewport(page);
    expect(await outer.evaluate(element => element.tagName)).toBe('SECTION');
    expect(await outer.evaluate(element => element === window.__ordinaryScroll.surface() && element === window.__ordinaryScroll.child())).toBe(true);
    expect(await viewport.evaluate(element => element === window.__ordinaryScroll.viewport())).toBe(true);
    expect(await scrollers(outer)).toEqual(['context-menu-viewport']);
    expect(await outer.locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
    expect(await outer.evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
    expect(await outer.locator('[data-testid="custom-fixed-header"], [data-testid="custom-fixed-footer"]').count()).toBe(2);
    expect(await outer.locator('[data-testid="custom-fixed-header"], [data-testid="custom-fixed-footer"]').evaluateAll(elements => elements.every(element => !element.closest('.zero-scroll-viewport')))).toBe(true);
    await configured(page, { childTag: 'article' }); await frames(page);
    expect(await outer.evaluate(element => element.tagName)).toBe('ARTICLE');
    expect(await outer.locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
    expect(await viewport.evaluate(element => element === window.__ordinaryScroll.viewport())).toBe(true);
    await configured(page, { mounted: false });
    expect(await page.evaluate(() => window.__ordinaryScroll.viewport())).toBeNull();
  } finally { await page.close(); }
}, 20_000);

browserTest('DatePicker fitting and constrained day/month bodies keep one exact native owner and never fade the fixed footer or popover border', async () => {
  const page = await mount();
  try {
    await openDate(page); const popup = datePopup(page), viewport = dateViewport(page);
    expect(await viewport.evaluate(element => element.classList.contains('zero-scroll-viewport'))).toBe(true);
    expect(await popup.locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
    expect(await popup.locator('.zero-scroll-track').count()).toBe(0);
    expect(await popup.evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
    await page.getByRole('button', { name: 'Close date picker', exact: true }).click(); await popup.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 360, height: 320 }); await openDate(page);
    expect(await scrollers(popup)).toEqual(['date-picker-calendar-viewport']);
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'))).toContain('28px');
    expect(await page.locator('[data-slot="date-picker-footer"]').evaluate(element => element.closest('.zero-scroll-viewport'))).toBeNull();
    const footer = (await page.locator('[data-slot="date-picker-footer"]').boundingBox())!;
    expect(footer.y).toBeGreaterThanOrEqual(0); expect(footer.y + footer.height).toBeLessThanOrEqual(320);
    await viewport.evaluate(element => { element.scrollTop = 70; }); await frames(page);
    expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await viewport.evaluate(element => { element.scrollTop = 0; });
    await page.getByRole('button', { name: 'February, choose month', exact: true }).click(); await frames(page);
    expect(await scrollers(popup)).toEqual(['date-picker-calendar-viewport']);
    expect(await popup.locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
    expect(await popup.getByRole('grid', { name: 'Months in 2026', exact: true }).count()).toBe(1);
    await popup.screenshot({ path: `${artifacts}/date-months-constrained.png` });
  } finally { await page.close(); }
}, 20_000);

browserTest('DatePicker years retire the outer treatment and use only the original virtual year owner; Escape reverses the handoff cleanly', async () => {
  const page = await mount({ width: 360, height: 320 });
  try {
    await configured(page, { yearRange: [1000, 3000] }, true); await openDate(page);
    const viewport = dateViewport(page), popup = datePopup(page);
    await viewport.evaluate(element => { (window as unknown as { __outerDateViewport: HTMLElement }).__outerDateViewport = element as HTMLElement; });
    await page.getByRole('button', { name: '2026, choose year', exact: true }).click(); await frames(page);
    await page.getByRole('grid', { name: 'Years', exact: true }).waitFor();
    expect(await viewport.evaluate(element => element === (window as unknown as { __outerDateViewport: HTMLElement }).__outerDateViewport)).toBe(true);
    expect(await viewport.evaluate(element => element.classList.contains('zero-scroll-viewport'))).toBe(false);
    expect(await viewport.getAttribute('data-zero-scroll-fade')).toBeNull();
    expect(await popup.locator('[data-zero-scroll-decoration="next"]').count()).toBe(0);
    expect(await scrollers(popup)).toEqual(['calendar-year-grid']);
    const years = popup.locator('[data-slot="calendar-year-grid"]');
    expect(await years.evaluate(element => element.classList.contains('zero-scroll-viewport'))).toBe(true);
    expect(await years.getByRole('button').count()).toBeLessThan(100);
    await page.keyboard.press('End'); await frames(page);
    expect(await years.getByRole('button', { name: '3000', exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.press('Escape'); await frames(page);
    expect(await popup.locator('[data-slot="calendar-year-grid"]').count()).toBe(0);
    expect(await viewport.evaluate(element => element.classList.contains('zero-scroll-viewport'))).toBe(true);
    expect(await popup.locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
    await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => window.__ordinaryScroll.changes())).toEqual([]);
    expect(await trigger(page).evaluate(element => document.activeElement === element)).toBe(true);
  } finally { await page.close(); }
}, 20_000);

browserTest('DatePicker both-axis RTL, selection/draft/read-only and controlled-open contracts remain native', async () => {
  const page = await mount({ width: 360, height: 320 });
  try {
    await configured(page, { wide: true, rtl: true }, true); await openDate(page);
    const viewport = dateViewport(page), popup = datePopup(page);
    expect(await viewport.evaluate(element => [element.scrollWidth > element.clientWidth, element.scrollHeight > element.clientHeight])).toEqual([true, true]);
    expect(await popup.locator('[data-axis="x"]').count()).toBe(1);
    await viewport.evaluate(element => { element.scrollLeft = -80; element.scrollTop = 38; }); await frames(page);
    expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' });
    await configured(page, { wide: false, rtl: false }, true);
    const input = page.getByRole('textbox', { name: 'Due date', exact: true }); await input.fill('02/30/2026');
    await openDate(page); await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' });
    expect(await input.inputValue()).toBe('02/30/2026'); expect(await page.evaluate(() => window.__ordinaryScroll.changes())).toEqual([]);
    await configured(page, { controlled: true }, true); await trigger(page).click();
    expect(await popup.count()).toBe(0); expect(await page.evaluate(() => window.__ordinaryScroll.requests().at(-1))).toBe(true);
    await configured(page, { open: true }, true); await popup.waitFor();
    await configured(page, { readOnly: true }, true); await popup.waitFor({ state: 'detached' });
    expect(await trigger(page).isDisabled()).toBe(true); expect(await input.inputValue()).toBe('02/30/2026');
    await configured(page, { readOnly: false, controlled: false, open: false }, true); await openDate(page);
    await popup.getByRole('button', { name: /Tuesday, February 10th, 2026/ }).click(); await popup.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => window.__ordinaryScroll.changes())).toEqual(['2026-02-10']);
  } finally { await page.close(); }
}, 25_000);

browserTest('DatePicker scroll owner unmount restores retained mask attributes and leaves no detached decoration', async () => {
  const page = await mount({ width: 360, height: 320 });
  try {
    await openDate(page); const viewport = dateViewport(page), popup = datePopup(page);
    await viewport.evaluate(element => { (window as unknown as { __retiredDate: HTMLElement }).__retiredDate = element as HTMLElement; });
    await configured(page, { mounted: false }, true); await popup.waitFor({ state: 'detached' });
    expect(await page.locator('[data-zero-scroll-decoration="next"]').count()).toBe(0);
    expect(await page.evaluate(() => {
      const old = (window as unknown as { __retiredDate: HTMLElement }).__retiredDate;
      return { connected: old.isConnected, decorated: old.classList.contains('zero-scroll-viewport'), fade: old.getAttribute('data-zero-scroll-fade'),
        top: old.style.getPropertyValue('--zero-scroll-edge-top'), bottom: old.style.getPropertyValue('--zero-scroll-edge-bottom') };
    })).toEqual({ connected: false, decorated: false, fade: null, top: '', bottom: '' });
  } finally { await page.close(); }
}, 20_000);

browserTest('DatePicker custom Root forwards its actual native rootRef through view changes while the wrapper attaches only to the existing viewport', async () => {
  const page = await mount({ width: 360, height: 320 });
  try {
    await configured(page, { customRoot: true }, true); await openDate(page);
    const root = datePopup(page).locator('[data-consumer-root="retained"]');
    expect(await root.evaluate(element => element === window.__ordinaryScroll.calendar())).toBe(true);
    await root.evaluate(element => { (window as unknown as { __originalConsumerCalendar: Element }).__originalConsumerCalendar = element; });
    expect(await dateViewport(page).evaluate(element => element.classList.contains('zero-scroll-viewport'))).toBe(true);
    await page.getByRole('button', { name: 'February, choose month', exact: true }).click(); await frames(page);
    expect(await root.evaluate(element => element === window.__ordinaryScroll.calendar()
      && element === (window as unknown as { __originalConsumerCalendar: Element }).__originalConsumerCalendar)).toBe(true);
    expect(await datePopup(page).locator('[data-zero-scroll-decoration="next"]').count()).toBe(1);
    await page.keyboard.press('Escape'); await frames(page); await page.keyboard.press('Escape');
    await datePopup(page).waitFor({ state: 'detached' });
    expect(await page.evaluate(() => window.__ordinaryScroll.calendar())).toBeNull();
    const callbacks = await page.evaluate(() => window.__ordinaryScroll.refs().filter(ref => ref.owner === 'calendar'));
    expect(callbacks.filter(ref => ref.phase === 'attach').length).toBe(callbacks.filter(ref => ref.phase === 'cleanup').length);
  } finally { await page.close(); }
}, 20_000);

browserTest('live native and Arc presentation switches preserve the original uncontrolled picker engine, incomplete draft, open month view and native scroll offset', async () => {
  const page = await mount({ width: 360, height: 320 });
  try {
    await configured(page, { controlledDraft: false }, true);
    const input = page.getByRole('textbox', { name: 'Due date', exact: true }); await input.fill('02/');
    await openDate(page); await page.getByRole('button', { name: 'February, choose month', exact: true }).click(); await frames(page);
    const popup = datePopup(page), viewport = dateViewport(page);
    await viewport.evaluate(element => {
      element.scrollTop = 47;
      (window as unknown as { __retainedPickerViewport: Element }).__retainedPickerViewport = element;
    });
    await input.evaluate(element => { (window as unknown as { __retainedPickerInput: Element }).__retainedPickerInput = element; });
    await frames(page); const offset = await viewport.evaluate(element => element.scrollTop);
    expect(offset).toBeGreaterThan(0);
    for (const scrollTreatment of ['native', 'arc', 'native', 'arc']) {
      await configured(page, { scrollTreatment }, true);
      expect(await popup.count()).toBe(1); expect(await popup.isVisible()).toBe(true);
      expect(await popup.getByRole('grid', { name: 'Months in 2026', exact: true }).count()).toBe(1);
      expect(await input.inputValue()).toBe('02/');
      expect(await input.evaluate(element => element === (window as unknown as { __retainedPickerInput: Element }).__retainedPickerInput)).toBe(true);
      expect(await viewport.evaluate(element => element === (window as unknown as { __retainedPickerViewport: Element }).__retainedPickerViewport)).toBe(true);
      expect(await viewport.evaluate(element => element.scrollTop)).toBe(offset);
      expect(await viewport.evaluate(element => element.classList.contains('zero-scroll-viewport'))).toBe(scrollTreatment === 'arc');
      expect(await popup.locator('[data-zero-scroll-decoration="next"]').count()).toBe(scrollTreatment === 'arc' ? 1 : 0);
      expect(await page.evaluate(() => window.__ordinaryScroll.changes())).toEqual([]);
    }
    await page.keyboard.press('Escape'); await frames(page);
    await page.getByRole('button', { name: 'Close date picker', exact: true }).click(); await popup.waitFor({ state: 'detached' });
    expect(await input.inputValue()).toBe('02/'); expect(await page.evaluate(() => window.__ordinaryScroll.changes())).toEqual([]);
  } finally { await page.close(); }
}, 20_000);

browserTest('shared attachment follows an independently reparented native viewport and restores exact parent/viewport inline priorities on retirement', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__ordinaryScroll.mountRaw(true));
    const first = page.getByTestId('first-parent'), second = page.getByTestId('second-parent'), viewport = page.getByTestId('independent-native');
    await first.locator('[data-zero-scroll-decoration="next"]').waitFor();
    expect(await first.evaluate(element => [(element as HTMLElement).style.getPropertyValue('position'), (element as HTMLElement).style.getPropertyPriority('position')]))
      .toEqual(['relative', 'important']);
    await page.evaluate(() => window.__ordinaryScroll.reparentRaw());
    await second.locator('[data-zero-scroll-decoration="next"]').waitFor(); await frames(page);
    expect(await first.locator('.zero-scroll-decoration').count()).toBe(0);
    expect(await first.evaluate(element => [(element as HTMLElement).style.getPropertyValue('position'), (element as HTMLElement).style.getPropertyPriority('position')]))
      .toEqual(['static', 'important']);
    expect(await second.evaluate(element => [(element as HTMLElement).style.getPropertyValue('position'), (element as HTMLElement).style.getPropertyPriority('position')]))
      .toEqual(['relative', 'important']);
    await second.evaluate(element => { (window as unknown as { __leasedParent: HTMLElement }).__leasedParent = element as HTMLElement; });
    expect(await viewport.evaluate(element => element === window.__ordinaryScroll.raw())).toBe(true);
    await page.evaluate(() => window.__ordinaryScroll.mountRaw(false)); await page.getByTestId('independent-host').waitFor({ state: 'detached' });
    const retired = await page.evaluate(() => {
      const element = window.__ordinaryScroll.raw()!;
      return { connected: element.isConnected, fade: element.dataset.zeroScrollFade, decorated: element.classList.contains('zero-scroll-viewport'),
        top: element.style.getPropertyValue('--zero-scroll-edge-top'), priority: element.style.getPropertyPriority('--zero-scroll-edge-top'),
        parentPosition: (window as unknown as { __leasedParent: HTMLElement }).__leasedParent.style.getPropertyValue('position'),
        parentPriority: (window as unknown as { __leasedParent: HTMLElement }).__leasedParent.style.getPropertyPriority('position') };
    });
    expect(retired).toEqual({ connected: false, fade: 'owner-sentinel', decorated: false, top: '3px', priority: 'important', parentPosition: 'static', parentPriority: 'important' });
  } finally { await page.close(); }
}, 20_000);
