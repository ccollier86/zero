/** Production action trays on an isolated fixture origin; no real application or backend executes. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { Locator, Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';
import { FloatingButtonGroup } from './floating-button-group';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
let origin: ReturnType<typeof Bun.serve> | undefined;
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'floating-button-group-browser-'));
  try {
    const output = join(directory, 'fixture.js');
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'floating-button-group.browser-fixture.tsx'),
      '--target=browser', '--format=iife', `--outdir=${directory}`, '--entry-naming=fixture.[ext]'], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Floating Button Group fixture failed to build.\n${stderr || stdout}`);
    script = await Bun.file(output).text();
    css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  const hydration = renderToString(createElement(FloatingButtonGroup, { label: 'Hydrated actions', items: [
    { id: 'first', label: 'Hydrated first' }, { id: 'disabled', label: 'Hydrated unavailable', disabled: true }, { id: 'last', label: 'Hydrated last' },
  ] }));
  origin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
    if (path === '/fixture.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } });
    if (path !== '/') return new Response('Not found', { status: 404 });
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="hydrate-root" data-zero-theme="next" data-zero-mode="light">${hydration}</div><div id="root"></div><script src="/fixture.js"></script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } });
  } });
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(async () => { await origin?.stop(true); lease?.release(); });

async function mount({ reduced = false, touch = false, forced = false, dpr = 1 } = {}): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: touch,
    reducedMotion: reduced ? 'reduce' : 'no-preference', forcedColors: forced ? 'active' : 'none', deviceScaleFactor: dpr });
  const reported: string[] = []; errors.set(page, reported); page.on('pageerror', error => reported.push(error.message));
  page.setDefaultTimeout(6000); await page.goto(`http://127.0.0.1:${origin!.port}/`);
  await page.getByRole('heading', { name: 'Floating Button Group fixture', exact: true }).waitFor();
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
const tray = (page: Page) => page.getByTestId('dynamic');
const action = (page: Page, id: string) => tray(page).locator(`[data-zero-floating-action="${id}"]`);
const highlight = (page: Page) => tray(page).locator('.zero-floating-button-group-highlight');
async function configure(page: Page, next: object) {
  await page.evaluate(value => (window as any).__floatingFixture.configure(value), next);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function focused(target: Locator) { await target.evaluate(element => new Promise<void>((resolve, reject) => {
  let frames = 0;
  const check = () => element === document.activeElement ? resolve() : ++frames > 180 ? reject(new Error('Expected native focus did not settle.')) : requestAnimationFrame(check);
  check();
})); }
async function aligned(page: Page, id: string) {
  try { await page.waitForFunction(id => {
    const host = document.querySelector('[data-testid="dynamic"]');
    const target = host?.querySelector(`[data-zero-floating-action="${id}"]`), paint = host?.querySelector('.zero-floating-button-group-highlight');
    if (!target || !paint) return false;
    const a = target.getBoundingClientRect(), b = paint.getBoundingClientRect();
    return Math.abs(a.left - b.left) < .8 && Math.abs(a.top - b.top) < .8 && Math.abs(a.width - b.width) < .8 && Math.abs(a.height - b.height) < .8;
  }, id); } catch (cause) {
    const diagnostic = await page.evaluate(id => {
      const root = document.querySelector('[data-testid="dynamic"]') as HTMLElement;
      const target = root?.querySelector(`[data-zero-floating-action="${id}"]`) as HTMLElement;
      const paint = root?.querySelector('.zero-floating-button-group-highlight') as HTMLElement;
      return { id, root: root?.getBoundingClientRect().toJSON(), target: target?.getBoundingClientRect().toJSON(),
        paint: paint?.getBoundingClientRect().toJSON(), opacity: paint && getComputedStyle(paint).opacity,
        rootSize: root && [root.offsetWidth, root.offsetHeight, root.clientWidth, root.clientHeight, root.clientLeft, root.clientTop],
        scale: root?.parentElement && getComputedStyle(root.parentElement).transform, paintStyle: paint?.getAttribute('style'),
        active: { tag: document.activeElement?.tagName, action: document.activeElement?.getAttribute('data-zero-floating-action'),
          testId: document.activeElement?.getAttribute('data-testid') }, dpr: devicePixelRatio };
    }, id);
    throw new Error(`Magnetic geometry did not align: ${JSON.stringify(diagnostic)}`, { cause });
  }
}
async function recorded(page: Page) { return page.evaluate(() => (window as any).__floatingFixture.events() as string[]); }
async function screenshot(page: Page, name: string) {
  const directory = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/floating-button-group';
  await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, name), fullPage: true });
}
async function hiddenMaterial(page: Page) {
  await page.waitForFunction(() => {
    const material = document.querySelector('[data-testid="dynamic"] .zero-floating-button-group-highlight');
    return !material || Number(getComputedStyle(material).opacity) < .01;
  });
}

browserTest('native action intent is exactly once, item then group, without implicit form submission or mode toggling', async () => {
  const page = await mount({ reduced: true }); try {
    expect(await tray(page).getAttribute('role')).toBe('toolbar');
    expect(await tray(page).getAttribute('aria-label')).toBe('Document actions');
    expect(await tray(page).locator('button[tabindex="0"]').count()).toBe(1);
    expect(await action(page, 'beta').getAttribute('aria-disabled')).toBe('true');
    expect(await action(page, 'beta').evaluate(element => (element as HTMLButtonElement).disabled)).toBe(false);
    expect(await action(page, 'beta').getAttribute('tabindex')).toBe('-1');
    for (const id of ['alpha', 'beta', 'gamma', 'delta', 'plain']) {
      expect(await action(page, id).count()).toBe(1);
      expect(await action(page, id).evaluate(element => element.tagName === 'BUTTON' && element.classList.contains('zero-floating-button-group-action'))).toBe(true);
    }
    // Existing Tooltip owns its trigger slot; action identity stays on the
    // same native button through the family class, stable action ID and ref.
    expect(await action(page, 'alpha').getAttribute('data-slot')).toBe('tooltip-trigger');
    await action(page, 'alpha').click();
    expect(await recorded(page)).toEqual(['item:alpha', 'group:alpha']);
    await action(page, 'gamma').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    expect(await recorded(page)).toEqual(['item:alpha', 'group:alpha', 'item:gamma', 'group:gamma', 'item:gamma', 'group:gamma']);
    await action(page, 'beta').click({ force: true });
    expect(await recorded(page)).not.toContain('item:beta');
    expect(await page.getByTestId('submit-count').textContent()).toBe('0');
    expect(await action(page, 'delta').getAttribute('aria-pressed')).toBe('false');
    await action(page, 'delta').hover();
    expect(await action(page, 'delta').getAttribute('aria-pressed')).toBe('false');
    await configure(page, { pressed: true });
    expect(await action(page, 'delta').getAttribute('aria-pressed')).toBe('true');
    expect(await tray(page).locator('[role="separator"][tabindex]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('server-rendered native actions hydrate without replacement or recoverable mismatch and retain keyboard command semantics', async () => {
  const page = await mount({ reduced: true }); try {
    const hydrated = page.getByRole('toolbar', { name: 'Hydrated actions', exact: true });
    await hydrated.getByRole('button', { name: 'Hydrated first', exact: true }).focus();
    await page.keyboard.press('ArrowRight'); await focused(hydrated.getByRole('button', { name: 'Hydrated last', exact: true }));
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as any).__floatingHydration.events())).toEqual(['item:last', 'group:last']);
    expect(await page.evaluate(() => (window as any).__floatingHydration.errors())).toEqual([]);
    expect(await hydrated.locator('button[tabindex="0"]').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('horizontal, vertical and RTL roving focus skip disabled actions and wrap independently', async () => {
  const page = await mount({ reduced: true }); try {
    await action(page, 'alpha').focus(); await page.keyboard.press('ArrowRight'); await focused(action(page, 'gamma'));
    await page.keyboard.press('End'); await focused(action(page, 'plain'));
    await page.keyboard.press('ArrowRight'); await focused(action(page, 'alpha'));
    await page.keyboard.press('ArrowLeft'); await focused(action(page, 'plain'));
    await page.keyboard.press('Home'); await focused(action(page, 'alpha'));
    await configure(page, { dir: 'rtl' });
    await page.keyboard.press('ArrowLeft'); await focused(action(page, 'gamma'));
    const positions = await tray(page).locator('button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().left));
    expect(positions[0]).toBeGreaterThan(positions.at(-1)!);
    await configure(page, { orientation: 'vertical' });
    await action(page, 'alpha').focus(); await page.keyboard.press('ArrowDown'); await focused(action(page, 'gamma'));
    await page.keyboard.press('ArrowUp'); await focused(action(page, 'alpha'));
    await page.keyboard.press('ArrowUp'); await focused(action(page, 'plain'));
    const independent = page.getByTestId('independent');
    await independent.getByRole('button', { name: 'Another Share', exact: true }).focus();
    await page.keyboard.press('ArrowRight'); await focused(independent.getByRole('button', { name: 'Another Export', exact: true }));
    expect(await tray(page).locator('button[tabindex="0"]').count()).toBe(1);
    expect(await independent.locator('button[tabindex="0"]').count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('magnetic geometry changes on independent paint tracks without moving native button boxes', async () => {
  const page = await mount(); try {
    const before = await tray(page).locator('button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
    await action(page, 'alpha').hover(); await aligned(page, 'alpha');
    const paint = await highlight(page).elementHandle();
    await tray(page).getByRole('separator').hover(); await aligned(page, 'alpha');
    expect(await highlight(page).evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(.99);
    await action(page, 'gamma').hover(); await aligned(page, 'gamma');
    expect(await paint!.evaluate(element => element === document.querySelector('[data-testid="dynamic"] .zero-floating-button-group-highlight'))).toBe(true);
    expect(await tray(page).locator('button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))).toEqual(before);
    await action(page, 'alpha').hover(); await action(page, 'delta').hover(); await action(page, 'gamma').hover(); await aligned(page, 'gamma');
    await action(page, 'gamma').focus(); await page.keyboard.press('ArrowLeft'); await focused(action(page, 'alpha')); await aligned(page, 'alpha');
    await screenshot(page, 'light-row.png');
    await page.getByTestId('outside').hover(); await page.getByTestId('outside').focus(); await hiddenMaterial(page);
    expect(await recorded(page)).toEqual([]);
  } finally { await close(page); }
}, 30_000);

browserTest('fractional nonuniform scale, borders, horizontal scrolling and live reflow keep material locally aligned', async () => {
  const page = await mount({ reduced: true, dpr: 1.25 }); try {
    await configure(page, { scaleX: .8, scaleY: 1.25 });
    await action(page, 'gamma').hover(); await aligned(page, 'gamma');
    // Keep a keyboard-owned anchor while geometry changes beneath the pointer;
    // a legitimate native pointerleave must still retire pointer-only material.
    await action(page, 'gamma').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
    await focused(action(page, 'gamma')); await aligned(page, 'gamma');
    await tray(page).evaluate(element => {
      const host = element as HTMLElement;
      host.style.padding = '9.5px 11.25px'; host.style.borderWidth = '2.5px';
    });
    await aligned(page, 'gamma');
    await tray(page).evaluate(element => { const host = element as HTMLElement;
      host.style.maxWidth = '280px'; host.style.overflowX = 'auto'; host.scrollLeft = 60;
    });
    await aligned(page, 'gamma');
    await tray(page).evaluate(element => { const host = element as HTMLElement; host.style.maxWidth = ''; host.style.overflowX = ''; host.scrollLeft = 0; });
    await configure(page, { size: 'sm', label: 'Copied successfully' }); await aligned(page, 'gamma');
    await tray(page).evaluate(element => { const host = element as HTMLElement;
      host.style.setProperty('--zero-floating-button-group-font-family', 'monospace');
      host.style.setProperty('--zero-floating-button-group-sm-font-size', '19px');
      element.ownerDocument.fonts.dispatchEvent(new Event('loadingdone'));
    });
    await aligned(page, 'gamma');
  } finally { await close(page); }
}, 30_000);

browserTest('unsupported rotated owners retire only decorative geometry while native focus and actions remain usable', async () => {
  const page = await mount({ reduced: true }); try {
    await action(page, 'gamma').focus(); await aligned(page, 'gamma');
    await page.getByTestId('transform-host').evaluate(element => (element as HTMLElement).style.transform = 'rotate(8deg)');
    await hiddenMaterial(page);
    await page.keyboard.press('ArrowRight'); await focused(action(page, 'delta'));
    await page.keyboard.press('Enter');
    expect(await recorded(page)).toEqual(['item:delta', 'group:delta']);
    await page.getByTestId('transform-host').evaluate(element => (element as HTMLElement).style.transform = 'none');
    await aligned(page, 'delta');
    await action(page, 'delta').evaluate(element => (element as HTMLElement).style.rotate = '8deg');
    await hiddenMaterial(page);
    await action(page, 'delta').evaluate(element => { const host = element as HTMLElement; host.style.rotate = 'none'; host.style.scale = '1 -1'; });
    await hiddenMaterial(page);
    await action(page, 'delta').evaluate(element => (element as HTMLElement).style.scale = 'none');
    await aligned(page, 'delta');
  } finally { await close(page); }
}, 30_000);

browserTest('dynamic removal, disable and empty states recover focused users without retaining stale command or highlight identity', async () => {
  const page = await mount({ reduced: true }); try {
    await action(page, 'alpha').focus(); await aligned(page, 'alpha');
    await configure(page, { removed: ['alpha'] });
    await page.waitForFunction(() => document.activeElement?.matches('[data-testid="dynamic"] [data-zero-floating-action]:not([aria-disabled="true"])'));
    expect(await action(page, 'alpha').count()).toBe(0);
    const active = await page.evaluate(() => document.activeElement?.getAttribute('data-zero-floating-action'));
    await aligned(page, active!);
    await configure(page, { disabled: ['beta', 'gamma', 'delta', 'plain'] }); await focused(tray(page)); await hiddenMaterial(page);
    expect(await tray(page).getAttribute('tabindex')).toBe('0');
    expect(await tray(page).locator('button[tabindex="0"]').count()).toBe(0);
    await page.keyboard.press('Enter'); await page.keyboard.press('Space'); expect(await recorded(page)).toEqual([]);
    await configure(page, { empty: true }); await focused(tray(page));
    expect(await tray(page).locator('button').count()).toBe(0); expect(await tray(page).getAttribute('tabindex')).toBe('0');
    await configure(page, { empty: false, disabled: ['beta'], removed: [] });
    expect(await tray(page).locator('button[tabindex="0"]').count()).toBe(1);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.activeElement?.matches('[data-testid="dynamic"] [data-zero-floating-action]:not([aria-disabled="true"])'));
  } finally { await close(page); }
}, 30_000);

browserTest('reserved changing labels keep native widths, clean accessible names and live item refs', async () => {
  const page = await mount(); try {
    await action(page, 'alpha').focus(); await aligned(page, 'alpha');
    const original = (await action(page, 'alpha').boundingBox())!;
    const icon = await action(page, 'alpha').locator('svg').elementHandle(), iconRect = await icon!.evaluate(element => element.getBoundingClientRect().toJSON());
    await configure(page, { label: 'Copied successfully' });
    expect(await action(page, 'alpha').getAttribute('aria-label')).toBe('Copied successfully');
    expect(await icon!.evaluate(element => element.isConnected)).toBe(true);
    expect(await icon!.evaluate(element => element.getBoundingClientRect().toJSON())).toEqual(iconRect);
    await aligned(page, 'alpha');
    expect((await action(page, 'alpha').boundingBox())!.width).toBeCloseTo(original.width, 1);
    await configure(page, { label: 'Share' }); await configure(page, { label: 'Copied successfully' }); await configure(page, { label: 'Share' });
    expect(await action(page, 'alpha').getAttribute('aria-label')).toBe('Share');
    expect((await action(page, 'alpha').boundingBox())!.width).toBeCloseTo(original.width, 1);
    await configure(page, { iconOnly: true });
    expect(await action(page, 'plain').innerText()).toBe('No icon');
    await action(page, 'gamma').focus(); await aligned(page, 'gamma');
    const refs = await page.evaluate(() => (window as any).__floatingFixture.refs());
    expect(refs.tray).toBe(true); expect(refs.items.every((item: { exact: boolean; connected: boolean }) => item.exact && item.connected)).toBe(true);
    await configure(page, { mounted: false });
    expect(await tray(page).count()).toBe(0);
    const retired = await page.evaluate(() => (window as any).__floatingFixture.refs());
    expect(retired.tray).toBe(false); expect(retired.items).toEqual([]);
    for (const id of ['alpha', 'beta', 'gamma', 'delta', 'plain']) {
      expect(retired.events.filter((event: { id: string; phase: string }) => event.id === id && event.phase === 'attach').length)
        .toBe(retired.events.filter((event: { id: string; phase: string }) => event.id === id && event.phase === 'cleanup').length);
    }
    expect(await page.locator('[data-zero-tooltip]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('the retained private paint adapter observes same-ID DOM replacements and their later resize', async () => {
  const page = await mount({ reduced: true }); try {
    const probe = page.getByTestId('replacement-probe'), prior = await probe.locator('button').elementHandle();
    const waitProbe = () => page.waitForFunction(() => {
      const host = document.querySelector('[data-testid="replacement-probe"]'), button = host?.querySelector('button'), paint = host?.querySelector('[data-testid="replacement-paint"]');
      if (!button || !paint) return false;
      const a = button.getBoundingClientRect(), b = paint.getBoundingClientRect();
      return Math.abs(a.left - b.left) < .8 && Math.abs(a.top - b.top) < .8 && Math.abs(a.width - b.width) < .8 && Math.abs(a.height - b.height) < .8;
    });
    await waitProbe();
    await page.evaluate(() => (window as any).__floatingReplacement());
    await probe.locator('[data-replaced="true"]').waitFor();
    expect(await prior!.evaluate(element => element.isConnected)).toBe(false); await waitProbe();
    await probe.locator('button').evaluate(element => (element as HTMLElement).style.width = '190px');
    await waitProbe(); expect((await page.getByTestId('replacement-paint').boundingBox())!.width).toBeCloseTo(190, 0);
  } finally { await close(page); }
}, 30_000);

browserTest('every tooltip side uses the existing Grow/400ms, arrow and owned portal layer including disabled readable actions', async () => {
  const page = await mount(); try {
    await configure(page, { iconOnly: true });
    for (const side of ['top', 'right', 'bottom', 'left']) {
      await page.getByTestId('outside').hover(); await page.getByTestId('outside').focus();
      await configure(page, { side });
      await page.evaluate(() => (window as any).__floatingFixture.playback(true));
      await action(page, 'gamma').hover();
      const tip = page.locator('[data-zero-tooltip]:not([data-state="closed"])').filter({ hasText: 'Export' });
      await tip.waitFor({ state: 'visible' });
      expect(await tip.getAttribute('data-motion')).toBe('grow');
      expect(await tip.getAttribute('data-side')).toBe(side);
      expect(await tip.locator('[data-slot="tooltip-arrow"]').count()).toBe(1);
      expect(await tip.evaluate(element => getComputedStyle(element).zIndex)).toBe('1702');
      const durations = await page.evaluate(() => (window as any).__floatingFixture.playback().filter((record: { target: string }) => record.target === 'tooltip').map((record: { duration: number }) => record.duration));
      expect(durations).toContain(400); expect(durations).toContain(200);
      expect(await action(page, 'gamma').getAttribute('aria-describedby')).toBeTruthy();
      await page.keyboard.press('Escape'); await tip.waitFor({ state: 'hidden' });
    }
    await action(page, 'beta').hover();
    await page.locator('[data-zero-tooltip]:not([data-state="closed"])').filter({ hasText: 'Unavailable' }).waitFor({ state: 'visible' });
    await action(page, 'beta').click({ force: true }); expect(await recorded(page)).toEqual([]);
    await page.getByTestId('outside').hover(); await page.getByTestId('outside').focus();
    await page.getByTestId('vertical').getByRole('button', { name: 'Last column action', exact: true }).hover();
    const columnHint = page.locator('[data-zero-tooltip]:not([data-state="closed"])').filter({ hasText: 'Last column action' });
    await columnHint.waitFor({ state: 'visible' }); expect(await columnHint.getAttribute('data-side')).toBe('right');
    await page.getByTestId('outside').hover(); await page.getByTestId('outside').focus();
    await configure(page, { active: false });
    await action(page, 'alpha').dispatchEvent('click'); expect(await recorded(page)).toEqual([]);
    await page.waitForFunction(() => !document.querySelector('[data-zero-tooltip]:not([data-state="closed"]):not([inert])'));
  } finally { await close(page); }
}, 40_000);

browserTest('touch release, pointer cancellation and document departure retire press paint without a later pointerleave', async () => {
  const page = await mount({ reduced: true, touch: true }); try {
    await action(page, 'alpha').tap();
    expect(await recorded(page)).toEqual(['item:alpha', 'group:alpha']);
    await page.getByTestId('outside').focus(); await hiddenMaterial(page);
    await action(page, 'gamma').evaluate(element => {
      element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, button: 0 }));
      element.ownerDocument.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true }));
    });
    await hiddenMaterial(page); expect(await recorded(page)).toEqual(['item:alpha', 'group:alpha']);
    await action(page, 'gamma').evaluate(element => {
      element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, pointerType: 'pen', isPrimary: true, bubbles: true, button: 0 }));
      element.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 8, pointerType: 'pen', bubbles: true }));
    });
    await hiddenMaterial(page);
    await action(page, 'gamma').hover();
    await page.mouse.down(); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
    const pressSettled = await highlight(page).evaluate(element => [getComputedStyle(element).transform,
      ...[...element.children].map(child => getComputedStyle(child).transform)]
      .every(value => value === 'none' || Math.abs(new DOMMatrixReadOnly(value).a - 1) < .001));
    expect(pressSettled).toBe(true);
    await configure(page, { mounted: false }); expect(await page.locator('[data-testid="dynamic"] .zero-floating-button-group-highlight').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('scoped token paint, compact geometry, 44px touch targets and forced-color keyboard focus remain usable', async () => {
  const page = await mount({ reduced: true, touch: true, forced: true }); try {
    await action(page, 'alpha').focus(); await page.keyboard.press('ArrowRight'); await focused(action(page, 'gamma')); await aligned(page, 'gamma');
    const focus = await action(page, 'gamma').evaluate(element => {
      const style = getComputedStyle(element); return { outline: style.outlineStyle, width: style.outlineWidth,
        box: style.boxShadow, rect: element.getBoundingClientRect().toJSON() };
    });
    expect(focus.outline !== 'none' && Number.parseFloat(focus.width) > 0 || focus.box !== 'none').toBe(true);
    expect(focus.rect.height).toBeGreaterThanOrEqual(44);
    await configure(page, { size: 'sm', iconOnly: true });
    const compact = await action(page, 'gamma').evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(), radius: getComputedStyle(element).borderRadius }));
    expect(compact.rect.width).toBeGreaterThanOrEqual(44); expect(compact.rect.height).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(compact.radius)).toBeGreaterThanOrEqual(0);
    expect(await highlight(page).evaluate(element => element.getAnimations({ subtree: true }).every(animation => Number(animation.effect!.getTiming().duration) <= 1))).toBe(true);
    await page.emulateMedia({ forcedColors: 'none' });
    await configure(page, { variant: 'muted' });
    await tray(page).evaluate(element => (element as HTMLElement).style.setProperty('--zero-floating-button-group-background', 'rgb(12, 34, 56)'));
    expect(await tray(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(12, 34, 56)');
    expect(await page.getByTestId('independent').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(12, 34, 56)');
    await tray(page).evaluate(element => (element as HTMLElement).style.removeProperty('--zero-floating-button-group-background'));
    await page.locator('main').evaluate(element => element.setAttribute('data-zero-mode', 'dark'));
    await configure(page, { orientation: 'vertical', variant: 'floating' });
    await action(page, 'gamma').focus(); await aligned(page, 'gamma'); await screenshot(page, 'dark-column-touch.png');
  } finally { await close(page); }
}, 30_000);

browserTest('nested touch density stays 44px on a fine pointer and a live reduced preference immediately settles material', async () => {
  const page = await mount(); try {
    await tray(page).evaluate(element => element.parentElement!.setAttribute('data-zero-density', 'touch'));
    await configure(page, { size: 'sm', iconOnly: true });
    const bounds = (await action(page, 'gamma').boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
    await action(page, 'alpha').hover(); await aligned(page, 'alpha');
    await action(page, 'gamma').hover(); await page.emulateMedia({ reducedMotion: 'reduce' }); await aligned(page, 'gamma');
    expect(await highlight(page).evaluate(element => element.getAnimations({ subtree: true }).every(animation => Number(animation.effect!.getTiming().duration) <= 1))).toBe(true);
    await page.getByTestId('outside').hover(); await page.getByTestId('outside').focus(); await hiddenMaterial(page);
  } finally { await close(page); }
}, 30_000);
