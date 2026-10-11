/** Real Radix anchored motion/portals/focus with managed compiled styles; synthetic DOM and no application boot. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/anchored-surfaces-');
  try {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/anchored-surface.browser-fixture.tsx`], target: 'browser', format: 'iife',
      define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
    script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    // Component-local CSS imports are part of the browser bundle too, as in source-copied consumers.
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(reduced = false): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 1000, height: 760 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div><div id="modal-portals"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('anchor-trigger').waitFor();
  return page;
}
async function show(page: Page) {
  await page.getByTestId('anchor-trigger').click();
  const content = page.getByTestId('anchor-content'); await content.waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="anchor-content"]');
    return element && (!element.hasAttribute('data-zero-anchored-motion') || element.hasAttribute('data-zero-anchored-ready'));
  });
  return content;
}
async function settle(page: Page, id: string) {
  await page.getByTestId(id).evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}

browserTest('Popover grows from the actual collision-resolved side, stays in bounds and uses restrained reference geometry', async () => {
  const page = await mount();
  try {
    for (const [side, x, y, actual, shiftX, shiftY] of [
      ['bottom', 400, 350, 'bottom', '0px', '-5px'], ['top', 400, 350, 'top', '0px', '5px'],
      ['right', 400, 350, 'right', '-5px', '0px'], ['left', 400, 350, 'left', '5px', '0px'],
      ['top', 4, 4, 'bottom', '0px', '-5px'], ['right', 890, 350, 'left', '5px', '0px'],
    ] as const) {
      await page.evaluate(config => (window as any).__anchoredSurface.configure(config), { side, x, y });
      const content = await show(page);
      const entrance = await content.evaluate(element => element.getAnimations().flatMap(animation => {
        const effect = animation.effect as KeyframeEffect | null;
        return effect?.getKeyframes().filter(frame => frame.transform !== undefined).map(frame => {
          const matrix = new DOMMatrixReadOnly(String(frame.transform));
          return { scale: matrix.a, x: matrix.m41, y: matrix.m42 };
        }) ?? [];
      }));
      await settle(page, 'anchor-content');
      const snapshot = await content.evaluate(element => {
        const computed = getComputedStyle(element), rect = element.getBoundingClientRect();
        return { side: element.getAttribute('data-side'), motion: element.hasAttribute('data-zero-anchored-motion'),
          x: computed.getPropertyValue('--zero-anchored-x').trim(), y: computed.getPropertyValue('--zero-anchored-y').trim(),
          duration: computed.transitionDuration, transform: computed.transform, width: rect.width, left: rect.left, right: rect.right,
          top: rect.top, bottom: rect.bottom };
      });
      expect(snapshot.side).toBe(actual); expect(snapshot.motion).toBe(true);
      const start = entrance.find(frame => Math.abs(frame.scale - .97) < .001);
      expect(start).toBeDefined(); expect(start!.x).toBe(Number.parseFloat(shiftX)); expect(start!.y).toBe(Number.parseFloat(shiftY));
      // CSS calc is resolved by the animation; inspect its numeric start direction through a computed transform probe.
      expect(snapshot.x === shiftX || snapshot.x.includes('calc')).toBe(true);
      expect(snapshot.y === shiftY || snapshot.y.includes('calc')).toBe(true);
      expect(snapshot.duration).toBe('0.16s, 0.58s');
      expect(snapshot.width).toBeGreaterThan(180); expect(snapshot.width).toBeLessThan(300);
      expect(snapshot.left).toBeGreaterThanOrEqual(7); expect(snapshot.right).toBeLessThanOrEqual(993);
      expect(snapshot.top).toBeGreaterThanOrEqual(7); expect(snapshot.bottom).toBeLessThanOrEqual(753);
      await page.keyboard.press('Escape'); await content.waitFor({ state: 'detached' });
    }
  } finally { await page.close(); }
}, 30_000);

browserTest('closing keeps one 140ms departing surface; reopening reverses in place without remounting or losing draft/ref identity', async () => {
  const page = await mount();
  try {
    const content = await show(page); await settle(page, 'anchor-content');
    await page.getByRole('textbox', { name: 'Anchored draft' }).fill('retained');
    const before = await page.evaluate(() => (window as any).__anchoredSurface.refs());
    // Radix asChild may recompose native trigger callbacks; assert identity/cleanup, not incidental Slot callback counts.
    expect(before).toMatchObject({ triggerMatches: true, contentMatches: true, contentMounts: 1 });
    await content.evaluate(element => element.setAttribute('data-identity', 'same'));
    const interruption = await page.evaluate(async () => {
      const fixture = (window as any).__anchoredSurface;
      const content = document.querySelector('[data-testid="anchor-content"]')!;
      fixture.open(false);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const closed = { state: content.getAttribute('data-state'), duration: getComputedStyle(content).transitionDuration,
        pointerEvents: getComputedStyle(content).pointerEvents, count: document.querySelectorAll('[data-testid="anchor-content"]').length,
        opacity: Number(getComputedStyle(content).opacity) };
      fixture.open(true);
      return closed;
    });
    expect(interruption).toMatchObject({ state: 'closed', duration: '0.14s, 0.14s', pointerEvents: 'none', count: 1 });
    expect(interruption.opacity).toBeGreaterThan(0);
    await page.waitForFunction(() => document.querySelector('[data-testid="anchor-content"]')?.getAttribute('data-state') === 'open');
    await settle(page, 'anchor-content');
    expect(await content.getAttribute('data-identity')).toBe('same');
    expect(await page.evaluate(() => (window as any).__anchoredSurface.refs()))
      .toMatchObject({ triggerMatches: true, contentMatches: true, contentMounts: before.contentMounts });
    expect(await page.getByRole('textbox', { name: 'Anchored draft' }).inputValue()).toBe('retained');
    expect(await content.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await page.getByRole('button', { name: 'Close surface', exact: true }).click(); await content.waitFor({ state: 'detached' });
    expect(await page.getByTestId('anchor-trigger').evaluate(element => element === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 20_000);

browserTest('source theme changes propagate to the portal without focus/selection/remount, and explicit paint/motion remain caller-owned', async () => {
  const page = await mount();
  try {
    const content = await show(page); await settle(page, 'anchor-content');
    expect(await content.evaluate(element => ({ font: getComputedStyle(element).fontFamily, paint: getComputedStyle(element).backgroundColor })))
      .toEqual({ font: 'monospace', paint: 'rgb(17, 34, 51)' });
    await page.getByRole('textbox', { name: 'Anchored draft' }).fill('preserved');
    await content.evaluate(element => { element.setAttribute('data-identity', 'same'); (window as any).__anchorFocus = document.activeElement; });
    await page.locator('#anchor-source').evaluate(element => {
      const style = (element as HTMLElement).style; style.setProperty('--zero-theme-font-body', 'serif'); style.setProperty('--popover', '#223344');
      style.setProperty('--zero-popover-exit-duration', '260ms');
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="anchor-content"]')!).fontFamily === 'serif');
    expect(await content.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(34, 51, 68)');
    expect(await content.getAttribute('data-identity')).toBe('same');
    expect(await page.evaluate(() => document.activeElement === (window as any).__anchorFocus)).toBe(true);
    expect(await page.evaluate(() => (window as any).__anchoredSurface.changes())).toEqual([true]);
    await page.evaluate(() => (window as any).__anchoredSurface.overrides({ '--popover': '#334455', fontFamily: 'monospace' }));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="anchor-content"]')!).backgroundColor === 'rgb(51, 68, 85)');
    await page.evaluate(() => (window as any).__anchoredSurface.open(false));
    await page.waitForFunction(() => document.querySelector('[data-testid="anchor-content"]')?.getAttribute('data-state') === 'closed');
    expect(await content.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0.26s, 0.26s');
    await content.waitFor({ state: 'detached' });
    await page.evaluate(() => (window as any).__anchoredSurface.configure({ custom: true }));
    await show(page); expect(await content.getAttribute('data-zero-anchored-motion')).toBeNull();
  } finally { await page.close(); }
}, 20_000);

browserTest('reduced motion removes transforms while keeping opacity and existing Radix focus/controlled opening', async () => {
  const page = await mount(true);
  try {
    const content = await show(page); await settle(page, 'anchor-content');
    expect(await content.evaluate(element => ({ transform: getComputedStyle(element).transform, duration: getComputedStyle(element).transitionDuration })))
      .toEqual({ transform: 'none', duration: '0.12s' });
    await page.keyboard.press('Escape'); await content.waitFor({ state: 'detached' });
    expect(await page.getByTestId('anchor-trigger').evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => (window as any).__anchoredSurface.changes())).toEqual([true, false]);
  } finally { await page.close(); }
}, 15_000);

browserTest('owner container and layers stay protected while source/caller theme take precedence and inactive owners stay inert', async () => {
  const page = await mount(true);
  try {
    await page.getByTestId('owned-trigger').click(); const content = page.getByTestId('owned-content'); await content.waitFor();
    expect(await content.evaluate(element => ({ container: document.querySelector('#owned-container')!.contains(element),
      font: getComputedStyle(element).fontFamily, paint: getComputedStyle(element).backgroundColor, z: getComputedStyle(element).zIndex })))
      .toEqual({ container: true, font: 'monospace', paint: 'rgb(68, 85, 102)', z: '1402' });
    expect(await page.evaluate(() => (window as any).__anchoredSurface.registered())).toBe(true);
    await page.evaluate(() => (window as any).__anchoredSurface.overrides({ '--popover': '#556677', zIndex: 9999, pointerEvents: 'auto' }));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="owned-content"]')!).backgroundColor === 'rgb(85, 102, 119)');
    expect(await content.evaluate(element => getComputedStyle(element).zIndex)).toBe('1402');
    await page.evaluate(() => (window as any).__anchoredSurface.active(false));
    await page.waitForFunction(() => document.querySelector('[data-testid="owned-content"]')?.hasAttribute('inert'));
    expect(await content.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
    await page.evaluate(() => (window as any).__anchoredSurface.active(true));
    await page.waitForFunction(() => !document.querySelector('[data-testid="owned-content"]')?.hasAttribute('inert'));
    expect(await content.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('auto');
  } finally { await page.close(); }
}, 15_000);

browserTest('dropdown roots/submenus use shared anchored motion and remain in their stacked modal owner portal with child-first dismissal', async () => {
  const page = await mount(true);
  try {
    await page.getByRole('button', { name: 'Open modal owner', exact: true }).click();
    const parent = page.getByRole('dialog', { name: 'Parent anchored owner', exact: true, includeHidden: true }); await parent.waitFor();
    await parent.getByRole('button', { name: 'Open parent menu', exact: true }).click();
    const menu = page.getByTestId('parent-menu'); await menu.waitFor();
    const owner = await menu.getAttribute('data-zero-overlay-owner'); expect(owner).toBeTruthy();
    expect(await menu.getAttribute('data-zero-anchored-motion')).toBe('');
    expect(await menu.evaluate(element => element.closest('#modal-portals') !== null)).toBe(true);
    await page.getByRole('menuitem', { name: 'More actions', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    const submenu = page.getByTestId('parent-submenu'); await submenu.waitFor();
    expect(await submenu.getAttribute('data-zero-overlay-owner')).toBe(owner);
    expect(await submenu.getAttribute('data-zero-anchored-motion')).toBe('');
    expect(await submenu.getAttribute('data-side')).toMatch(/left|right/);
    expect(await submenu.evaluate(element => element.closest('#modal-portals') !== null)).toBe(true);
    // Radix's left arrow returns from a submenu; Escape intentionally dismisses the whole menu tree.
    await page.keyboard.press('ArrowLeft'); await submenu.waitFor({ state: 'detached' });
    expect(await menu.isVisible()).toBe(true); expect(await parent.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' }); expect(await parent.isVisible()).toBe(true);
    await parent.getByRole('button', { name: 'Open child owner', exact: true }).click();
    const child = page.getByRole('dialog', { name: 'Child anchored owner', exact: true, includeHidden: true }); await child.waitFor();
    await child.getByRole('button', { name: 'Open child menu', exact: true }).click();
    const childMenu = page.getByTestId('child-menu'); await childMenu.waitFor();
    expect(await childMenu.getAttribute('data-zero-overlay-owner')).not.toBe(owner);
    expect(await childMenu.evaluate(element => element.closest('#modal-portals') !== null)).toBe(true);
    await page.keyboard.press('Escape'); await childMenu.waitFor({ state: 'detached' }); expect(await child.isVisible()).toBe(true);
    await page.keyboard.press('Escape'); await child.waitFor({ state: 'detached' }); expect(await parent.isVisible()).toBe(true);
  } finally { await page.close(); }
}, 25_000);
