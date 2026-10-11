/** Isolated Chromium qualification of native modal scroll owners and the additive next affordance. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const failures = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/modal-scroll-treatment-');
  try {
    const built = await Bun.build({ entrypoints: [import.meta.dir + '/modal-scroll-treatment.browser-fixture.tsx'], target: 'browser',
      format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
    bundle = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(scratch, scratch + '/absent-app')).cssPath).text();
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(scratch, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount({ width = 1100, reduced = true, touch = false } = {}) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1.25, hasTouch: touch,
    reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5000);
  const errors: string[] = []; failures.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Modal scroll treatment fixture' }).waitFor();
  await page.getByTestId('raw-frame').locator('[data-zero-scroll-decoration="next"]').waitFor();
  return page;
}
async function close(page: Page) { try { expect(failures.get(page)).toEqual([]); } finally { await page.close(); } }
async function frames(page: Page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function configured(page: Page, options: Record<string, unknown>) {
  await page.evaluate(config => window.__modalScroll.configure(config), options); await frames(page);
}
async function opened(page: Page, launcher: string, title: string) {
  await page.getByRole('button', { name: launcher, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: title, exact: true }); await dialog.waitFor(); await frames(page);
  return dialog;
}
async function dismissed(page: Page, title: string) {
  await page.getByRole('dialog', { name: title, exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: title, exact: true }).waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.body.style.overflow === '');
}
function body(page: Page, title: string) { return page.getByRole('dialog', { name: title, exact: true }).locator('.zero-modal__body:not([hidden])'); }
const raw = (page: Page) => page.getByTestId('raw-viewport');
const rawFrame = (page: Page) => page.getByTestId('raw-frame');
async function dragStart(page: Page, axis: 'x' | 'y' = 'y') {
  const thumb = rawFrame(page).locator(`[data-axis="${axis}"] [data-zero-scroll-thumb]`), box = (await thumb.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y); await page.mouse.down(); return point;
}

browserTest('modal masks only its existing body and keeps fixed header, close and footer outside both-axis treatment', async () => {
  const page = await mount();
  try {
    const dialog = await opened(page, 'Open overflow', 'Overflow'), viewport = body(page, 'Overflow');
    await dialog.locator('[data-zero-scroll-decoration="next"] [data-axis="x"]').waitFor();
    await dialog.locator('[data-zero-scroll-decoration="next"] [data-axis="y"]').waitFor();
    const initial = await viewport.evaluate(element => {
      const view = element as HTMLElement;
      return { owner: view.classList.contains('zero-scroll-viewport'), x: view.scrollWidth > view.clientWidth, y: view.scrollHeight > view.clientHeight,
        top: view.style.getPropertyValue('--zero-scroll-edge-top'), bottom: view.style.getPropertyValue('--zero-scroll-edge-bottom'),
        left: view.style.getPropertyValue('--zero-scroll-edge-left'), right: view.style.getPropertyValue('--zero-scroll-edge-right'),
        bars: getComputedStyle(view).scrollbarWidth };
    });
    expect(initial).toMatchObject({ owner: true, x: true, y: true, top: '0px', left: '0px', bars: 'none' });
    expect(initial.bottom).toContain('28px'); expect(initial.right).toContain('28px');
    expect(await dialog.locator('[data-radix-scroll-area-viewport]').count()).toBe(0);
    const chrome = dialog.locator('.zero-modal__head, .zero-modal__close, .zero-modal__foot');
    const before = await chrome.evaluateAll(elements => elements.map(element => ({ y: element.getBoundingClientRect().y,
      masked: element.closest('.zero-scroll-viewport') !== null, mask: getComputedStyle(element).maskImage })));
    expect(before.every(element => !element.masked && element.mask === 'none')).toBe(true);
    await viewport.evaluate(element => { element.scrollTop = 123; element.scrollLeft = 87; }); await frames(page);
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-top'))).toContain('28px');
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-left'))).toContain('28px');
    expect(await chrome.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y))).toEqual(before.map(element => element.y));
    expect(await dialog.locator('.zero-modal__inner').getAttribute('data-scrolled')).not.toBeNull();
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth; }); await frames(page);
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'))).toBe('0px');
    expect(await viewport.evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-right'))).toBe('0px');
    expect(await dialog.locator('.zero-modal__inner').getAttribute('data-more')).toBeNull();
    const directory = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/scroll-adoption';
    await mkdir(directory, { recursive: true }); await page.screenshot({ path: directory + '/modal-content-both-axes.png' });
    await dismissed(page, 'Overflow');
  } finally { await close(page); }
}, 20_000);

browserTest('fitting content has no fades or rails; hidden rails preserve fades and explicit native retains its old skin', async () => {
  const page = await mount();
  try {
    const fitting = await opened(page, 'Open fitting', 'Fitting');
    expect(await fitting.locator('.zero-scroll-track').count()).toBe(0);
    expect(await body(page, 'Fitting').evaluate(element => ['top', 'bottom', 'left', 'right'].map(edge =>
      (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-' + edge)))).toEqual(['0px', '0px', '0px', '0px']);
    await dismissed(page, 'Fitting');
    const hidden = await opened(page, 'Open hidden rails', 'Hidden rails');
    expect(await hidden.locator('.zero-scroll-track').count()).toBe(0);
    expect(await body(page, 'Hidden rails').evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'))).toContain('28px');
    await body(page, 'Hidden rails').evaluate(element => { element.scrollTop = 111; });
    expect(await body(page, 'Hidden rails').evaluate(element => element.scrollTop)).toBe(111);
    await dismissed(page, 'Hidden rails');
    const thin = await opened(page, 'Open thin rails', 'Thin rails');
    expect(await thin.locator('[data-axis="y"] [data-zero-scroll-thumb]').evaluate(element => getComputedStyle(element, '::after').width)).toBe('5px');
    await dismissed(page, 'Thin rails');
    const native = await opened(page, 'Open native scroll', 'Native scroll');
    expect(await native.locator('[data-zero-scroll-decoration="next"]').count()).toBe(0);
    expect(await body(page, 'Native scroll').evaluate(element => ({ decorated: element.classList.contains('zero-scroll-viewport'),
      mask: getComputedStyle(element).maskImage, scrollbar: getComputedStyle(element).scrollbarWidth }))).toEqual({ decorated: false, mask: 'none', scrollbar: 'thin' });
    await dismissed(page, 'Native scroll');
  } finally { await close(page); }
}, 20_000);

browserTest('tab bodies stay mounted with independent native positions and chrome remains outside panel masking', async () => {
  const page = await mount();
  try {
    const dialog = await opened(page, 'Open retained tabs', 'Retained tabs');
    await body(page, 'Retained tabs').evaluate(element => { element.scrollTop = 175; element.scrollLeft = 84; });
    await dialog.getByRole('tab', { name: 'Beta', exact: true }).click(); await frames(page);
    expect(await body(page, 'Retained tabs').evaluate(element => element.scrollTop)).toBe(0);
    await body(page, 'Retained tabs').evaluate(element => { element.scrollTop = 260; });
    await dialog.getByRole('tab', { name: 'Alpha', exact: true }).click(); await frames(page);
    expect(await body(page, 'Retained tabs').evaluate(element => [element.scrollTop, element.scrollLeft])).toEqual([175, 84]);
    expect(await dialog.locator('[role="tabpanel"]').count()).toBe(2);
    expect(await dialog.getByTestId('alpha').count()).toBe(1); expect(await dialog.getByTestId('beta').count()).toBe(1);
    expect(await dialog.locator('.zero-modal__top').evaluate(element => element.closest('.zero-scroll-viewport'))).toBeNull();
    await dialog.getByRole('tab', { name: 'Beta', exact: true }).click(); await frames(page);
    expect(await body(page, 'Retained tabs').evaluate(element => element.scrollTop)).toBe(260);
    await dismissed(page, 'Retained tabs');
  } finally { await close(page); }
}, 20_000);

browserTest('desktop side navigation and phone tab strip each receive independent correctly oriented treatment', async () => {
  for (const width of [1100, 375]) {
    const page = await mount({ width });
    try {
      const dialog = await opened(page, 'Open independent navigation', 'Independent navigation'), nav = dialog.getByRole('tablist');
      const orientation = width > 640 ? 'vertical' : 'horizontal';
      expect(await nav.getAttribute('data-zero-scroll-orientation')).toBe(orientation);
      const dimensions = await nav.evaluate(element => ({ x: element.scrollWidth > element.clientWidth, y: element.scrollHeight > element.clientHeight }));
      expect(width > 640 ? dimensions.y : dimensions.x).toBe(true);
      await body(page, 'Independent navigation').evaluate(element => { element.scrollTop = 93; });
      await nav.evaluate((element, vertical) => { if (vertical) element.scrollTop = 210; else element.scrollLeft = 250; }, width > 640); await frames(page);
      expect(await body(page, 'Independent navigation').evaluate(element => element.scrollTop)).toBe(93);
      expect(await nav.evaluate((element, vertical) => vertical ? element.scrollTop : element.scrollLeft, width > 640)).toBeGreaterThan(0);
      expect(await dialog.locator('.zero-modal__head, .zero-modal__foot').evaluateAll(elements => elements.every(element => !element.closest('.zero-scroll-viewport')))).toBe(true);
      const box = (await dialog.boundingBox())!; expect(box.width).toBeLessThanOrEqual(width); expect(box.x).toBeGreaterThanOrEqual(0);
      await dismissed(page, 'Independent navigation');
    } finally { await close(page); }
  }
}, 25_000);

browserTest('open navigation switches axis live at the phone breakpoint without replacing body owners or duplicating rails', async () => {
  const page = await mount();
  try {
    const dialog = await opened(page, 'Open independent navigation', 'Independent navigation'), nav = dialog.getByRole('tablist');
    await body(page, 'Independent navigation').evaluate(element => {
      element.scrollTop = 137;
      (window as unknown as { __retainedBody: Element }).__retainedBody = element;
    });
    expect(await nav.getAttribute('data-zero-scroll-orientation')).toBe('vertical');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForFunction(() => document.querySelector('[role="tablist"]')?.getAttribute('data-zero-scroll-orientation') === 'horizontal');
    expect(await body(page, 'Independent navigation').evaluate(element => element === (window as unknown as { __retainedBody: Element }).__retainedBody)).toBe(true);
    expect(await body(page, 'Independent navigation').evaluate(element => element.scrollTop)).toBe(137);
    const parent = nav.locator('..');
    expect(await parent.locator(':scope > [data-zero-scroll-decoration="next"]').count()).toBe(1);
    expect(await parent.locator(':scope > [data-zero-scroll-decoration="next"] [data-axis="y"]').count()).toBe(0);
    expect(await parent.locator(':scope > [data-zero-scroll-decoration="next"] [data-axis="x"]').count()).toBe(1);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForFunction(() => document.querySelector('[role="tablist"]')?.getAttribute('data-zero-scroll-orientation') === 'vertical');
    expect(await body(page, 'Independent navigation').evaluate(element => element.scrollTop)).toBe(137);
    expect(await parent.locator(':scope > [data-zero-scroll-decoration="next"]').count()).toBe(1);
    await dismissed(page, 'Independent navigation');
  } finally { await close(page); }
}, 20_000);

browserTest('next track paging is smooth ninety percent and live reduced preference makes the same action immediate', async () => {
  const page = await mount({ reduced: false });
  try {
    await page.evaluate(() => {
      const viewport = window.__modalScroll.native()!, original = viewport.scrollTo.bind(viewport);
      (window as unknown as { __scrollCalls: ScrollToOptions[] }).__scrollCalls = [];
      viewport.scrollTo = ((options: ScrollToOptions) => {
        (window as unknown as { __scrollCalls: ScrollToOptions[] }).__scrollCalls.push(options); original(options);
      }) as typeof viewport.scrollTo;
    });
    const track = rawFrame(page).locator('[data-axis="y"]'), bounds = (await track.boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height - 3);
    const first = await page.evaluate(() => (window as unknown as { __scrollCalls: ScrollToOptions[] }).__scrollCalls.at(-1)!);
    expect(first.behavior).toBe('smooth');
    expect(first.top).toBeCloseTo(await raw(page).evaluate(element => element.clientHeight * .9), 5);
    await page.waitForFunction(target => Math.abs(window.__modalScroll.native()!.scrollTop - target!) < 2, first.top);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await raw(page).evaluate(element => { element.scrollTop = 0; }); await frames(page);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height - 3);
    const last = await page.evaluate(() => (window as unknown as { __scrollCalls: ScrollToOptions[] }).__scrollCalls.at(-1)!);
    expect(last.behavior).toBe('instant');
    expect(await raw(page).evaluate(element => element.scrollTop)).toBeCloseTo(last.top!, 0);
  } finally { await close(page); }
}, 20_000);

browserTest('horizontal conversion leaves nested native scrollers, editors, Shift and shadow-root gestures untouched', async () => {
  const page = await mount();
  try {
    await configured(page, { orientation: 'horizontal', wheelMode: 'horizontal' });
    const state = await raw(page).evaluate(element => {
      const content = element.firstElementChild!, child = document.createElement('div');
      child.style.cssText = 'overflow:auto;width:100px;height:60px'; child.innerHTML = '<div style="height:400px">Nested native scroller</div>';
      content.prepend(child);
      const input = document.createElement('input'); input.type = 'number'; content.prepend(input);
      const host = document.createElement('div'), shadow = host.attachShadow({ mode: 'open' }), shadowInput = document.createElement('textarea');
      shadow.append(shadowInput); content.prepend(host);
      const wheel = (target: Element, shiftKey = false) => {
        const event = new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true, composed: true, shiftKey });
        target.dispatchEvent(event); return event.defaultPrevented;
      };
      return { nested: wheel(child), input: wheel(input), shadow: wheel(shadowInput), shifted: wheel(element, true), left: element.scrollLeft };
    });
    expect(state).toEqual({ nested: false, input: false, shadow: false, shifted: false, left: 0 });
    await frames(page);
    const track = rawFrame(page).locator('[data-axis="x"]');
    await track.dispatchEvent('wheel', { deltaY: 35, deltaMode: 0, bubbles: true, cancelable: true });
    expect(await raw(page).evaluate(element => element.scrollLeft)).toBe(35);
    await raw(page).evaluate(element => { element.scrollLeft = element.scrollWidth; });
    const boundary = await track.evaluate(element => {
      const event = new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true }); element.dispatchEvent(event); return event.defaultPrevented;
    });
    expect(boundary).toBe(false);
  } finally { await close(page); }
}, 20_000);

browserTest('per-axis transformed thumb dragging uses native offsets and restores exact snap ownership on release and cancel', async () => {
  const page = await mount();
  try {
    await configured(page, { scaleX: 1.2, scaleY: .7, snap: true });
    const metric = await raw(page).evaluate(element => ({ maximum: element.scrollHeight - element.clientHeight, track: element.clientHeight - 16 }));
    const start = await dragStart(page);
    expect(await raw(page).evaluate(element => [(element as HTMLElement).style.getPropertyValue('scroll-snap-type'),
      (element as HTMLElement).style.getPropertyPriority('scroll-snap-type')])).toEqual(['none', 'important']);
    const thumbLength = await rawFrame(page).locator('[data-axis="y"] [data-zero-scroll-thumb]').evaluate(element => (element as HTMLElement).offsetHeight);
    await page.mouse.move(start.x, start.y + 21);
    expect(await raw(page).evaluate(element => element.scrollTop)).toBeCloseTo(30 / (metric.track - thumbLength) * metric.maximum, 0);
    await page.mouse.up();
    expect(await raw(page).evaluate(element => [(element as HTMLElement).style.getPropertyValue('scroll-snap-type'),
      (element as HTMLElement).style.getPropertyPriority('scroll-snap-type')])).toEqual(['y mandatory', 'important']);
    await configured(page, { snap: false }); await raw(page).evaluate(element => { element.scrollTop = 0; }); await frames(page);
    const point = await dragStart(page);
    await page.mouse.move(point.x, point.y + 14);
    await rawFrame(page).locator('[data-axis="y"]').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
    await page.mouse.up();
    expect(await rawFrame(page).locator('[data-zero-scroll-decoration="next"]').getAttribute('data-dragging')).toBeNull();
    expect(await raw(page).evaluate(element => (element as HTMLElement).style.getPropertyValue('scroll-snap-type'))).toBe('');
  } finally { await close(page); }
}, 20_000);

browserTest('horizontal wheel conversion consumes only admitted movement and passes through edges, Ctrl and native horizontal input', async () => {
  const page = await mount();
  try {
    await configured(page, { orientation: 'horizontal', wheelMode: 'horizontal' });
    const dispatch = (deltaY: number, deltaX = 0, ctrlKey = false) => raw(page).evaluate((element, values) => {
      const event = new WheelEvent('wheel', { deltaY: values.deltaY, deltaX: values.deltaX, ctrlKey: values.ctrlKey, bubbles: true, cancelable: true });
      element.dispatchEvent(event); return { prevented: event.defaultPrevented, left: element.scrollLeft, top: element.scrollTop, parents: window.__modalScroll.parentWheels() };
    }, { deltaY, deltaX, ctrlKey });
    const consumed = await dispatch(65); expect(consumed.prevented).toBe(true); expect(consumed.left).toBe(65); expect(consumed.top).toBe(0);
    const ctrl = await dispatch(65, 0, true); expect(ctrl.prevented).toBe(false); expect(ctrl.left).toBe(65);
    const horizontal = await dispatch(0, 24); expect(horizontal.prevented).toBe(false); expect(horizontal.left).toBe(65);
    await raw(page).evaluate(element => { element.scrollLeft = element.scrollWidth; });
    const edge = await dispatch(65); expect(edge.prevented).toBe(false); expect(edge.parents).toBeGreaterThan(consumed.parents);
    await configured(page, { rtl: true }); await raw(page).evaluate(element => { element.scrollLeft = 0; }); await frames(page);
    const rtl = await dispatch(80); expect(rtl.prevented).toBe(true); expect(rtl.left).toBe(-80);
    await raw(page).evaluate(element => { element.scrollLeft = -element.scrollWidth; });
    const rtlEdge = await dispatch(80); expect(rtlEdge.prevented).toBe(false);
  } finally { await close(page); }
}, 20_000);

browserTest('a live thumb grip follows current viewport, content and per-axis scale geometry during the same drag', async () => {
  const page = await mount();
  try {
    await configured(page, { scaleX: 1.2, scaleY: .7, snap: true });
    const before = await dragStart(page);
    await page.mouse.move(before.x, before.y + 14);
    expect(await raw(page).evaluate(element => (element as HTMLElement).style.getPropertyValue('scroll-snap-type'))).toBe('none');
    await configured(page, { viewportWidth: 360, viewportHeight: 210, width: 1200, height: 1800, scaleX: 1.4, scaleY: 1.1 });
    const track = rawFrame(page).locator('[data-axis="y"]'), thumb = track.locator('[data-zero-scroll-thumb]');
    const dimensions = await track.evaluate(element => ({ track: (element as HTMLElement).offsetHeight,
      thumb: (element.querySelector('[data-zero-scroll-thumb]') as HTMLElement).offsetHeight }));
    const painted = (await track.boundingBox())!, scale = painted.height / dimensions.track;
    const desiredPosition = 40;
    const pointer = { x: painted.x + painted.width / 2, y: painted.y + (desiredPosition + dimensions.thumb / 2) * scale };
    await page.mouse.move(pointer.x, pointer.y); await frames(page);
    const native = await raw(page).evaluate(element => ({ offset: element.scrollTop, maximum: element.scrollHeight - element.clientHeight }));
    expect(Number.isFinite(native.offset)).toBe(true);
    expect(native.offset).toBeCloseTo(native.maximum * desiredPosition / (dimensions.track - dimensions.thumb), 0);
    const grip = (await thumb.boundingBox())!;
    expect(grip.y + grip.height / 2).toBeCloseTo(pointer.y, 0);
    await page.mouse.up();
    expect(await raw(page).evaluate(element => [(element as HTMLElement).style.getPropertyValue('scroll-snap-type'),
      (element as HTMLElement).style.getPropertyPriority('scroll-snap-type')])).toEqual(['y mandatory', 'important']);
  } finally { await close(page); }
}, 20_000);

browserTest('exact viewport replacement and unmount retire dragging and restore the old owner mask/snap attributes', async () => {
  const page = await mount();
  try {
    await configured(page, { snap: true }); await dragStart(page);
    await configured(page, { revision: 1 }); await page.mouse.up();
    expect(await page.evaluate(() => {
      const old = window.__modalScroll.retired()!;
      return { connected: old.isConnected, decorated: old.classList.contains('zero-scroll-viewport'), fade: old.getAttribute('data-zero-scroll-fade'),
        top: old.style.getPropertyValue('--zero-scroll-edge-top'), snap: old.style.getPropertyValue('scroll-snap-type'), priority: old.style.getPropertyPriority('scroll-snap-type') };
    })).toEqual({ connected: false, decorated: false, fade: 'owner-sentinel', top: '7px', snap: 'y mandatory', priority: 'important' });
    expect(await rawFrame(page).locator('[data-zero-scroll-decoration="next"]').getAttribute('data-dragging')).toBeNull();
    await dragStart(page); await configured(page, { mounted: false }); await page.mouse.up();
    expect(await page.evaluate(() => window.__modalScroll.native())).toBeNull();
    expect(await rawFrame(page).locator('.zero-scroll-decoration').count()).toBe(0);
    expect(await page.evaluate(() => window.__modalScroll.retired()!.style.getPropertyValue('scroll-snap-type'))).toBe('y mandatory');
  } finally { await close(page); }
}, 20_000);

browserTest('content growth/removal updates real edge distances without an idle mutation loop and forced colors remove masks', async () => {
  const page = await mount();
  try {
    await configured(page, { width: 100, height: 50 });
    // The content contains ordinary children, so remove them before asserting fitting geometry.
    await page.getByTestId('raw-content').evaluate(element => element.replaceChildren()); await frames(page);
    expect(await rawFrame(page).locator('.zero-scroll-track').count()).toBe(0);
    await configured(page, { width: 1000, height: 1200 }); await rawFrame(page).locator('[data-axis="y"]').waitFor();
    expect(await raw(page).evaluate(element => (element as HTMLElement).style.getPropertyValue('--zero-scroll-edge-bottom'))).toContain('28px');
    const changes = await raw(page).evaluate(async element => {
      let count = 0; const observer = new MutationObserver(records => { count += records.length; }); observer.observe(element, { attributes: true });
      await new Promise(resolve => setTimeout(resolve, 160)); observer.disconnect(); return count;
    });
    expect(changes).toBe(0);
    expect(await rawFrame(page).locator('[data-axis="y"]').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
    await page.emulateMedia({ forcedColors: 'active' });
    expect(await raw(page).evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
    const thumb = rawFrame(page).locator('[data-axis="y"] [data-zero-scroll-thumb]');
    expect(await thumb.evaluate(element => getComputedStyle(element, '::after').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  } finally { await close(page); }
}, 20_000);

browserTest('touch pointer cancellation clears rail dragging without adding a focus region', async () => {
  const page = await mount({ touch: true });
  try {
    const track = rawFrame(page).locator('[data-axis="y"]'), thumb = track.locator('[data-zero-scroll-thumb]');
    const bounds = (await thumb.boundingBox())!;
    const client = await page.context().newCDPSession(page);
    try {
      // Trusted browser touch delivery creates a real pointer-capture lease.
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 41 }] });
      expect(await rawFrame(page).locator('[data-zero-scroll-decoration="next"]').getAttribute('data-dragging')).toBe('y');
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 + 24, id: 41 }] });
      expect(await raw(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    } finally { await client.detach(); }
    expect(await rawFrame(page).locator('[data-zero-scroll-decoration="next"]').getAttribute('data-dragging')).toBeNull();
    expect(await rawFrame(page).locator('.zero-scroll-decoration [tabindex]').count()).toBe(0);
    expect(await raw(page).getAttribute('tabindex')).toBe('0');
  } finally { await close(page); }
}, 20_000);
