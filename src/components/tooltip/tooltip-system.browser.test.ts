/** Isolated full-style tooltip browser contracts; no app config, credentials, database or provider executes. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises'; // Bun has no direct temp-directory/removal API.
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const screenshots = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/tooltip-system';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const pageErrors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'tooltip-browser-'));
  try {
    const output = join(directory, 'fixture.js');
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/tooltip-system.browser-fixture.tsx',
      '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error('Tooltip fixture build failed: ' + (stderr || stdout));
    bundle = await Bun.file(output).text();
    css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(width = 1100, reduced = false, touch = false) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 800 }, hasTouch: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(4000);
  const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div><div id="tooltip-portals"></div><div id="tooltip-extra-portals"></div>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Tooltip system fixture', exact: true }).waitFor();
  return page;
}
async function close(page: Page) { try { expect(pageErrors.get(page)).toEqual([]); } finally { await page.close(); } }
function visual(page: Page) { return page.locator('[data-zero-tooltip]:not([data-state="closed"])'); }
async function show(page: Page, name: string, text?: string): Promise<Locator> {
  await page.getByRole('button', { name, exact: true }).hover();
  const tooltip = text ? visual(page).filter({ hasText: text }) : visual(page);
  try { await tooltip.waitFor({ state: 'visible' }); }
  catch {
    const diagnostic = await page.evaluate(label => ({
      trigger: [...document.querySelectorAll('button')].filter(element => element.textContent === label)
        .map(element => ({ state: element.dataset.state, hovered: element.matches(':hover'), focusVisible: element.matches(':focus-visible'),
          description: element.getAttribute('aria-describedby'), rect: element.getBoundingClientRect().toJSON() })),
      hints: [...document.querySelectorAll('[data-zero-tooltip]')].map(element => ({ state: element.getAttribute('data-state'),
        motion: element.getAttribute('data-motion'), text: element.textContent, rect: element.getBoundingClientRect().toJSON() })),
      pointer: document.querySelector(':hover')?.tagName,
    }), name);
    throw new Error('Tooltip failed to open for ' + name + ': ' + JSON.stringify(diagnostic));
  }
  return tooltip;
}
async function settled(tooltip: Locator) {
  await tooltip.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const host = element.closest('[data-zero-tooltip-shared]') ?? element;
    await Promise.all(host.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
}
async function hide(page: Page) {
  await page.getByRole('button', { name: 'Outside control', exact: true }).hover();
  await page.waitForFunction(() => document.querySelectorAll('[data-zero-tooltip]:not([data-state="closed"])').length === 0);
}
async function screenshot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true }); await page.screenshot({ path: join(screenshots, name + '.png') });
}

browserTest('default Grow has a delayed first hover, warm neighboring hover and exact independent fade with an arrow', async () => {
  const page = await mount();
  try {
    const started = Date.now();
    const tooltip = await show(page, 'Default tooltip', 'Default Grow hint');
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    expect(await tooltip.getAttribute('data-motion')).toBe('grow');
    expect(await tooltip.getAttribute('data-variant')).toBe('neutral');
    expect(await tooltip.locator('[data-slot="tooltip-arrow"]').count()).toBe(1);
    const durations = await page.evaluate(() => window.__tooltipSystem.animations().map(animation => animation.duration));
    expect(durations).toContain(400); expect(durations).toContain(200);
    await settled(tooltip);
    const warm = Date.now(); await show(page, 'Warm neighbor', 'Warm provider hint');
    expect(Date.now() - warm).toBeLessThan(350);
    await hide(page);
  } finally { await close(page); }
}, 30_000);

browserTest('hover and keyboard hints dismiss on click or Escape without focus pinning; rich content has optional arrows', async () => {
  const page = await mount(1100, true);
  try {
    const trigger = page.getByRole('button', { name: 'Immediate help', exact: true });
    await show(page, 'Immediate help', 'Keyboard and hover description');
    await trigger.click(); await visual(page).waitFor({ state: 'hidden' });
    expect(await trigger.evaluate(element => element === document.activeElement)).toBe(true);
    await page.mouse.move(1000, 750); await trigger.hover(); await visual(page).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape'); await visual(page).waitFor({ state: 'hidden' });
    expect(await trigger.evaluate(element => element === document.activeElement)).toBe(true);
    await page.getByRole('button', { name: 'Outside control', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    // Use actual keyboard focus on a known standalone trigger, not mouse focus.
    await trigger.focus(); await visual(page).waitFor({ state: 'visible' });
    expect(await trigger.getAttribute('aria-describedby')).toBeTruthy();
    await page.keyboard.press('Escape'); await visual(page).waitFor({ state: 'hidden' });
    const rich = await show(page, 'Rich hint', 'Rich tooltip title');
    expect(await rich.locator('.zero-tooltip-description').textContent()).toBe('Helpful noninteractive detail.');
    expect(await rich.locator('[data-slot="kbd"]').allTextContents()).toEqual(['⌘', 'K']);
    expect(await rich.locator('[data-slot="tooltip-arrow"]').count()).toBe(0);
    await screenshot(page, 'rich-arrowless');
    await hide(page);
    await show(page, 'Custom component trigger', 'DOM-only custom description');
    expect(await page.getByRole('tooltip').textContent()).toBe('DOM-only custom description');
  } finally { await close(page); }
}, 30_000);

browserTest('all four real tooltip motion presets preserve their tuned durations and settle before bounded exits', async () => {
  const page = await mount();
  try {
    for (const [preset, enter, fade, exit] of [['grow',400,200,200], ['spring',750,220,200], ['blur',500,500,220], ['swing',620,200,220]] as const) {
      await page.evaluate(() => window.__tooltipSystem.animations(true));
      const tooltip = await show(page, 'Motion ' + preset);
      const durations = await page.evaluate(() => window.__tooltipSystem.animations().map(animation => animation.duration));
      expect(durations).toContain(enter); expect(durations).toContain(fade);
      await settled(tooltip);
      expect(await tooltip.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      await page.evaluate(() => window.__tooltipSystem.animations(true));
      await page.keyboard.press('Escape');
      await visual(page).waitFor({ state: 'hidden' });
      await page.waitForFunction(duration => window.__tooltipSystem.animations().some(animation => animation.duration === duration), exit);
      expect(await page.evaluate(() => window.__tooltipSystem.animations().map(animation => animation.duration))).toContain(exit);
      await page.mouse.move(1000, 750);
    }
  } finally { await close(page); }
}, 30_000);

browserTest('placements collide safely, long text wraps and overflow-only hints use the full trigger label', async () => {
  const page = await mount(375, true);
  try {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const tooltip = await show(page, 'Placement ' + side); await settled(tooltip);
      const box = (await tooltip.boundingBox())!;
      const geometry = await tooltip.evaluate(element => ({
        bubble: element.getBoundingClientRect().toJSON(), parent: element.parentElement!.getBoundingClientRect().toJSON(),
        wrapper: element.closest('[data-radix-popper-content-wrapper]')?.getBoundingClientRect().toJSON(),
        transform: getComputedStyle(element).transform, maxWidth: getComputedStyle(element).maxWidth,
        width: getComputedStyle(element).width, side: element.getAttribute('data-side'),
      }));
      expect(box.x, JSON.stringify(geometry)).toBeGreaterThanOrEqual(7); expect(box.x + box.width).toBeLessThanOrEqual(368);
      expect(box.y).toBeGreaterThanOrEqual(7); expect(box.y + box.height).toBeLessThanOrEqual(793);
      await hide(page);
    }
    const edge = await show(page, 'Viewport edge', 'Synthetic extremely long'); await settled(edge);
    const box = (await edge.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(260.5); expect(box.x + box.width).toBeLessThanOrEqual(368);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await screenshot(page, 'narrow-viewport-edge'); await hide(page);
    await page.getByTestId('overflow-trigger').hover();
    const tooltip = visual(page); await tooltip.waitFor({ state: 'visible' });
    expect(await tooltip.textContent()).toContain('Synthetic overflowing record label that should be revealed');
    await hide(page); await page.getByRole('button', { name: 'Fits', exact: true }).hover();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await visual(page).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('grouped hints reuse one physical bubble through morphs and rapid trigger changes', async () => {
  const page = await mount();
  try {
    const first = await show(page, 'Group alpha', 'Short shared hint'); await settled(first);
    const bubble = await first.elementHandle();
    const host = page.locator('[data-zero-tooltip-shared="true"]');
    expect(await host.count()).toBe(1);
    await page.getByRole('button', { name: 'Group beta', exact: true }).hover();
    await visual(page).filter({ hasText: 'A longer shared hint' }).waitFor({ state: 'visible' });
    expect(await bubble!.evaluate(element => element.isConnected && element === document.querySelector('[data-zero-tooltip]'))).toBe(true);
    expect(await host.count()).toBe(1);
    expect(await host.evaluate(element => element.getAnimations({ subtree: true }).map(animation => animation.effect!.getTiming().duration))).toContain(420);
    await page.getByRole('button', { name: 'Group gamma', exact: true }).hover();
    await page.getByRole('button', { name: 'Group beta', exact: true }).hover();
    const final = await show(page, 'Group alpha', 'Short shared hint'); await settled(final);
    expect(await host.count()).toBe(1); expect(await visual(page).count()).toBe(1);
    expect(await final.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await page.keyboard.press('Escape'); await visual(page).waitFor({ state: 'hidden' });
    expect(await page.getByRole('button', { name: 'Group alpha', exact: true }).getAttribute('aria-describedby')).toBeNull();
  } finally { await close(page); }
}, 30_000);

browserTest('live reduced preference, controlled close and trigger unmount leave no retained hint or description', async () => {
  const page = await mount();
  try {
    const tooltip = await show(page, 'Motion spring');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(tooltip);
    await hide(page);
    const reduced = await show(page, 'Motion grow');
    expect(await reduced.evaluate(element => element.getAnimations({ subtree: true }).every(animation => Number(animation.effect!.getTiming().duration) <= 1))).toBe(true);
    await hide(page);
    await page.evaluate(() => window.__tooltipSystem.controlled(true));
    await visual(page).filter({ hasText: 'Controlled tooltip content' }).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape'); await visual(page).waitFor({ state: 'hidden' });
    expect(await page.getByRole('button', { name: 'Controlled hint', exact: true }).getAttribute('aria-describedby')).toBeNull();
    await show(page, 'Unmounting hint', 'Disposable tooltip content');
    await page.evaluate(() => window.__tooltipSystem.mounted(false));
    await visual(page).waitFor({ state: 'hidden' });
    expect(await page.getByRole('button', { name: 'Unmounting hint', exact: true }).count()).toBe(0);
    expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('shared provider/root/content settings update live and removed overrides resume inherited defaults', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__tooltipSystem.configure({ motion: 'spring', arrow: false, variant: 'accent' }));
    const tooltip = await show(page, 'Dynamic group hint', 'Initial grouped content'); await settled(tooltip);
    expect(await tooltip.getAttribute('data-motion')).toBe('spring'); expect(await tooltip.getAttribute('data-variant')).toBe('accent');
    expect(await tooltip.locator('[data-slot="tooltip-arrow"]').count()).toBe(0);
    await page.evaluate(() => window.__tooltipSystem.configure({ override: 'grow', contentOverride: 'blur', contentArrow: true }));
    await page.waitForFunction(() => document.querySelector('[data-zero-tooltip]')?.getAttribute('data-motion') === 'blur');
    expect(await tooltip.locator('[data-slot="tooltip-arrow"]').count()).toBe(1);
    await page.evaluate(() => window.__tooltipSystem.configure({ contentOverride: undefined, contentArrow: undefined }));
    await page.waitForFunction(() => document.querySelector('[data-zero-tooltip]')?.getAttribute('data-motion') === 'grow');
    expect(await tooltip.locator('[data-slot="tooltip-arrow"]').count()).toBe(0);
    await page.evaluate(() => window.__tooltipSystem.configure({ override: undefined, motion: 'swing', arrow: true, variant: 'light' }));
    await page.waitForFunction(() => document.querySelector('[data-zero-tooltip]')?.getAttribute('data-motion') === 'swing');
    expect(await tooltip.getAttribute('data-variant')).toBe('light'); expect(await tooltip.locator('[data-slot="tooltip-arrow"]').count()).toBe(1);
    await settled(tooltip);
    const trigger = page.getByRole('button', { name: 'Dynamic group hint', exact: true }), box = (await trigger.boundingBox())!;
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(tooltip);
    expect(await tooltip.evaluate(element => getComputedStyle(element.parentElement!.parentElement!).transform)).toBe('none');
    await hide(page);
  } finally { await close(page); }
}, 30_000);

browserTest('group content changed mid-entry settles current text and a controlled owner can reject close or handoff', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__tooltipSystem.configure({ motion: 'spring' }));
    const tooltip = await show(page, 'Dynamic group hint');
    await page.evaluate(() => window.__tooltipSystem.configure({ label: 'Latest grouped content' }));
    await visual(page).filter({ hasText: 'Latest grouped content' }).waitFor({ state: 'visible' }); await settled(tooltip);
    expect(await tooltip.textContent()).toContain('Latest grouped content');
    expect(await tooltip.evaluate(element => getComputedStyle(element.parentElement!).opacity)).toBe('1');
    expect(await tooltip.evaluate(element => getComputedStyle(element.parentElement!).transform)).toBe('none');
    await hide(page);
    await page.evaluate(() => window.__tooltipSystem.locked(true));
    const controlled = visual(page).filter({ hasText: 'Controlled group remains' }); await controlled.waitFor({ state: 'visible' }); await settled(controlled);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="controlled-group-close-requests"]')?.textContent) >= 1);
    expect(await controlled.isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Controlled group neighbor', exact: true }).hover();
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="controlled-group-close-requests"]')?.textContent) >= 2);
    expect(await controlled.isVisible()).toBe(true); expect(await visual(page).count()).toBe(1);
    await page.evaluate(() => window.__tooltipSystem.locked(false));
    await page.waitForFunction(() => document.querySelectorAll('[data-zero-tooltip]:not([data-state="closed"])').length === 0);
    expect(await page.getByRole('button', { name: 'Controlled group owner', exact: true }).getAttribute('aria-describedby')).toBeNull();
  } finally { await close(page); }
}, 30_000);

browserTest('standalone and shared hints inherit live modal theme/layers and Escape closes only the active tooltip first', async () => {
  const page = await mount(1100, true);
  try {
    await page.getByRole('button', { name: 'Open tooltip modal', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Tooltip ownership', exact: true }); await dialog.waitFor();
    for (const name of ['Owned standalone hint', 'Owned grouped hint']) {
      const tooltip = await show(page, name); await settled(tooltip);
      const owner = await dialog.getAttribute('data-zero-modal-id');
      expect(await tooltip.getAttribute('data-zero-overlay-owner'), name).toBe(owner);
      expect(await tooltip.evaluate(element => !!element.closest('#tooltip-portals'))).toBe(true);
      const dialogLayer = await dialog.evaluate(element => Number(getComputedStyle(element.closest('.zero-modal-layer')!).zIndex));
      const tooltipLayer = await tooltip.evaluate(element => Number(getComputedStyle(element.closest('[data-radix-popper-content-wrapper], [data-zero-tooltip-shared]')!).zIndex));
      expect(tooltipLayer).toBeGreaterThan(dialogLayer);
      const initialForeground = await tooltip.evaluate(element => getComputedStyle(element).color);
      await page.evaluate(() => window.__tooltipSystem.theme('public', false));
      try {
        await page.waitForFunction(before => {
          const tooltip = document.querySelector('[data-zero-tooltip]:not([data-state="closed"])');
          return tooltip && getComputedStyle(tooltip).color !== before;
        }, initialForeground);
      } catch {
        const diagnostic = await page.evaluate(() => {
          const read = (element: Element | null) => element && ({ color: getComputedStyle(element).color,
            foreground: getComputedStyle(element).getPropertyValue('--zero-tooltip-neutral-foreground').trim(),
            publicForeground: getComputedStyle(element).getPropertyValue('--public-surface-foreground').trim(),
            inlineForeground: (element as HTMLElement).style.getPropertyValue('--zero-tooltip-neutral-foreground'),
            owner: element.getAttribute('data-zero-overlay-owner') });
          const tooltip = document.querySelector('[data-zero-tooltip]:not([data-state="closed"])');
          return { source: read(document.querySelector('[data-testid="theme-source"]')),
            dialog: read(document.querySelector('[data-zero-modal-id]')), tooltip: read(tooltip), parent: read(tooltip?.parentElement ?? null) };
        });
        throw new Error('Live modal tooltip lane failed for ' + name + ': ' + JSON.stringify(diagnostic));
      }
      const sourceToken = await page.getByTestId('theme-source').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-tooltip-neutral-foreground').trim());
      expect(await tooltip.evaluate(element => getComputedStyle(element).getPropertyValue('--zero-tooltip-neutral-foreground').trim())).toBe(sourceToken);
      await page.evaluate(() => window.__tooltipSystem.theme('public', true));
      await settled(tooltip); await screenshot(page, name.includes('grouped') ? 'modal-group-public-dark' : 'modal-standalone-public-dark');
      await page.keyboard.press('Escape'); await visual(page).waitFor({ state: 'hidden' });
      expect(await dialog.isVisible(), name).toBe(true);
      await page.evaluate(() => window.__tooltipSystem.theme('platform', false));
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('existing descriptions survive owned hint removal and custom portals/boundaries stay in the same document', async () => {
  const page = await mount(1100, true);
  try {
    const trigger = page.getByRole('button', { name: 'External descriptions', exact: true });
    await show(page, 'External descriptions');
    await page.waitForFunction(() => document.querySelector('button[aria-describedby*="persistent-child-description"]')?.getAttribute('aria-describedby')?.split(/\s+/).length === 3);
    const ids = (await trigger.getAttribute('aria-describedby'))!.split(/\s+/);
    expect(ids).toContain('persistent-child-description'); expect(ids).toContain('persistent-trigger-description');
    await page.keyboard.press('Escape'); await visual(page).waitFor({ state: 'hidden' });
    expect((await trigger.getAttribute('aria-describedby'))!.split(/\s+/).sort()).toEqual(['persistent-child-description', 'persistent-trigger-description']);
    const custom = await show(page, 'Custom tooltip portal');
    expect(await custom.evaluate(element => !!element.closest('#tooltip-extra-portals'))).toBe(true);
    await hide(page);
    for (const name of ['Boundary standalone', 'Boundary grouped']) {
      const tooltip = await show(page, name); await settled(tooltip);
      const panel = (await page.getByTestId('placement-boundary').boundingBox())!, box = (await tooltip.boundingBox())!;
      expect(box.x, name).toBeGreaterThanOrEqual(panel.x + 7); expect(box.x + box.width, name).toBeLessThanOrEqual(panel.x + panel.width - 7);
      const diagnostic = await tooltip.evaluate(element => ({
        bubble: element.getBoundingClientRect().toJSON(), parent: element.parentElement!.getBoundingClientRect().toJSON(),
        width: getComputedStyle(element).width, height: getComputedStyle(element).height,
        parentHeight: getComputedStyle(element.parentElement!).height,
        cssHeight: (element as HTMLElement).style.height, text: element.textContent,
        wrapper: element.closest('[data-radix-popper-content-wrapper]')?.getBoundingClientRect().toJSON(),
      }));
      expect(box.y, name).toBeGreaterThanOrEqual(panel.y + 7); expect(box.y + box.height, name + ' ' + JSON.stringify(diagnostic)).toBeLessThanOrEqual(panel.y + panel.height - 7);
      await hide(page);
    }
    await page.evaluate(() => window.__tooltipSystem.configure({ boundaryLabel: 'A genuinely long description constrained to the small panel. '.repeat(30) }));
    for (const name of ['Boundary standalone', 'Boundary grouped']) {
      const tooltip = await show(page, name); await settled(tooltip);
      const panel = (await page.getByTestId('placement-boundary').boundingBox())!, box = (await tooltip.boundingBox())!;
      expect(box.x, name).toBeGreaterThanOrEqual(panel.x + 7);
      expect(box.x + box.width, name).toBeLessThanOrEqual(panel.x + panel.width - 7);
      expect(box.y, name).toBeGreaterThanOrEqual(panel.y + 7);
      expect(box.y + box.height, name).toBeLessThanOrEqual(panel.y + panel.height - 7);
      const scroll = await tooltip.locator('.zero-tooltip-body').evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
      expect(scroll.content, name).toBeGreaterThan(scroll.height);
      expect(scroll.overflow, name).toBe('auto');
      if (name === 'Boundary grouped') {
        expect(await tooltip.evaluate(element => (element as HTMLElement).style.getPropertyValue('--radix-tooltip-content-available-height'))).not.toBe('');
        await page.evaluate(() => window.__tooltipSystem.configure({ avoidBoundaryCollisions: false }));
        await page.waitForFunction(() => {
          const bubble = document.querySelector<HTMLElement>('[data-zero-tooltip]:not([data-state="closed"])');
          return bubble && bubble.style.getPropertyValue('--radix-tooltip-content-available-height') === '';
        });
        expect(await tooltip.evaluate(element => (element as HTMLElement).style.getPropertyValue('--radix-tooltip-content-available-width'))).toBe('');
      }
      await hide(page);
    }
  } finally { await close(page); }
}, 30_000);

browserTest('touch activation does not pin a hint and active modal retirement removes owned standalone/group branches', async () => {
  const touch = await mount(1100, true, true);
  try {
    for (const name of ['Immediate help', 'Group alpha']) {
      const box = (await touch.getByRole('button', { name, exact: true }).boundingBox())!;
      await touch.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await touch.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await visual(touch).count(), name).toBe(0);
    }
  } finally { await close(touch); }
  const page = await mount(1100, true);
  try {
    for (const name of ['Owned standalone hint', 'Owned grouped hint']) {
      await page.getByRole('button', { name: 'Open tooltip modal', exact: true }).click();
      await page.getByRole('dialog', { name: 'Tooltip ownership', exact: true }).waitFor();
      await show(page, name); await page.evaluate(() => window.__tooltipSystem.retireOwner());
      await page.getByRole('dialog', { name: 'Tooltip ownership', exact: true }).waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelectorAll('[data-zero-tooltip]:not([data-state="closed"])').length === 0);
      expect(await page.getByRole('tooltip').count()).toBe(0);
      expect(await page.locator('[data-zero-tooltip-shared="true"]').count()).toBe(0);
    }
  } finally { await close(page); }
}, 30_000);

browserTest('standalone exit interrupts a live entrance without resetting its composited opacity', async () => {
  const page = await mount();
  try {
    const tooltip = await show(page, 'Motion spring'), element = await tooltip.elementHandle();
    const before = await tooltip.evaluate(node => Number(getComputedStyle(node).opacity));
    await page.keyboard.press('Escape');
    const after = await element!.evaluate(node => Number(getComputedStyle(node).opacity));
    expect(after).toBeLessThanOrEqual(before + .15);
    await page.mouse.move(1050, 750); await show(page, 'Motion spring');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(visual(page));
    expect(await visual(page).evaluate(node => getComputedStyle(node).opacity)).toBe('1');
    await hide(page); await page.getByRole('tooltip').waitFor({ state: 'hidden' }); expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('standalone cursor-follow translation stops and resets when reduced motion becomes active', async () => {
  const page = await mount();
  try {
    const tooltip = await show(page, 'Follow pointer'); await settled(tooltip);
    const trigger = page.getByRole('button', { name: 'Follow pointer', exact: true }), box = (await trigger.boundingBox())!;
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
    await page.waitForFunction(() => {
      const tooltip = document.querySelector('[data-zero-tooltip]:not([data-state="closed"])');
      return tooltip && getComputedStyle(tooltip).transform !== 'none';
    });
    expect(await tooltip.evaluate(element => getComputedStyle(element).transform)).not.toBe('none');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(tooltip);
    expect(await tooltip.evaluate(element => getComputedStyle(element).transform)).toBe('none');
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await tooltip.evaluate(element => getComputedStyle(element).transform)).toBe('none');
    await hide(page);
  } finally { await close(page); }
}, 30_000);
