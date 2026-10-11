/** Actual shared-calendar navigation, picker views, selection policies and reduced motion. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'; // Bun has no directory/temp-directory/removal equivalent.
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';

let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/calendar-browser-');
  try {
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build',
      `${import.meta.dir}/calendar.browser-fixture.tsx`, '--target=browser', '--format=iife', '--outdir', directory],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Calendar fixture build failed: ${stderr || stdout}`);
    bundle = await Bun.file(`${directory}/calendar.browser-fixture.js`).text();
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.css'))) css += '\n' + await Bun.file(`${directory}/${name}`).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function open(reduced = false, width = 1100) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByTestId('single').getByRole('grid').waitFor();
  return page;
}
async function monthPicker(page: Page) { return page.getByTestId('single').getByRole('button', { name: /choose month/i }); }
async function magneticAt(page: Page, scope: string, selector: string) {
  await page.waitForFunction(({ scope, selector }) => {
    const root = document.querySelector(`[data-testid="${scope}"]`)!;
    const target = root.querySelector<HTMLElement>(selector), paint = root.querySelector<HTMLElement>('[data-slot="calendar-stage"] > div:first-child .zero-menu-active-highlight');
    if (!target || !paint || Number(getComputedStyle(paint).opacity) < .98) return false;
    const a = target.getBoundingClientRect(), b = paint.getBoundingClientRect();
    return Math.abs(a.left - b.left) < 1.5 && Math.abs(a.top - b.top) < 1.5 && Math.abs(a.width - b.width) < 1.5 && Math.abs(a.height - b.height) < 1.5;
  }, { scope, selector });
}

test('calendar magnetic day material follows hover and native focus without entering tables or changing selection', async () => {
  const page = await open();
  try {
    const scope = page.getByTestId('single'), output = await scope.locator('output').textContent();
    const first = scope.locator('[data-day="2026-10-15"] button'), second = scope.locator('[data-day="2026-10-16"] button');
    await first.hover(); await magneticAt(page, 'single', '[data-day="2026-10-15"] button');
    await scope.locator('[data-slot="calendar-stage"] > div:first-child .zero-menu-active-highlight').evaluate(element => { (window as any).__calendarMaterial = element; });
    await second.hover(); await magneticAt(page, 'single', '[data-day="2026-10-16"] button');
    expect(await scope.locator('[data-slot="calendar-stage"] > div:first-child .zero-menu-active-highlight').evaluate(element => element === (window as any).__calendarMaterial)).toBe(true);
    await first.focus(); await page.keyboard.press('ArrowRight');
    await magneticAt(page, 'single', '[data-day="2026-10-16"] button');
    expect(await second.evaluate(element => element === document.activeElement)).toBe(true);
    expect(await scope.locator('output').textContent()).toBe(output);
    expect(await scope.locator('table .zero-menu-active-highlight').count()).toBe(0);
    expect(await scope.locator('table').evaluate(element => Array.from(element.children).every(child => ['THEAD', 'TBODY', 'TFOOT', 'CAPTION', 'COLGROUP'].includes(child.tagName)))).toBe(true);
    expect(await scope.getByRole('grid', { name: 'October 2026', exact: true }).count()).toBe(1);
    expect(await scope.locator('.zero-menu-active-highlight').evaluate(element => ({ hidden: element.getAttribute('aria-hidden'), tab: element.hasAttribute('tabindex'), pointer: getComputedStyle(element).pointerEvents })))
      .toEqual({ hidden: 'true', tab: false, pointer: 'none' });
  } finally { await page.close(); }
}, 30_000);

test('calendar magnetic paint retains selected/today/outside and range fills, even under a scaled owner', async () => {
  const page = await open(true);
  try {
    const scope = page.getByTestId('single');
    await scope.evaluate(element => { (element as HTMLElement).style.transform = 'scale(.9)'; (element as HTMLElement).style.transformOrigin = 'top left'; });
    const selected = scope.locator('[data-day="2026-10-07"] button');
    const colors = await selected.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    await scope.locator('[data-day="2026-10-15"] button').hover(); await magneticAt(page, 'single', '[data-day="2026-10-15"] button');
    await selected.hover();
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="single"] .zero-menu-active-highlight')!).opacity) < .01);
    expect(await selected.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))).toEqual(colors);
    expect(await scope.locator('[data-day="2026-10-07"]').getAttribute('data-today')).toBe('true');
    const outside = scope.locator('[data-outside="true"]').first();
    const faded = await outside.evaluate(element => getComputedStyle(element).opacity);
    await outside.locator('button').hover();
    expect(await outside.evaluate(element => getComputedStyle(element).opacity)).toBe(faded);
    expect(await outside.getAttribute('data-outside')).toBe('true');
    const range = page.getByTestId('range');
    await range.getByRole('grid', { name: 'October 2026', exact: true }).getByRole('button', { name: /Friday, October 30th, 2026/i }).click();
    await range.getByRole('grid', { name: 'November 2026', exact: true }).getByRole('button', { name: /Tuesday, November 3rd, 2026/i }).click();
    const middle = range.getByRole('grid', { name: 'November 2026', exact: true }).locator('[data-day="2026-11-02"]');
    const middleColor = await middle.evaluate(element => getComputedStyle(element).backgroundColor);
    await middle.locator('button').hover();
    expect(await middle.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(middleColor);
    expect(await middle.getAttribute('aria-selected')).toBe('true');
    expect(await range.locator('output').textContent()).toBe('30-3');
  } finally { await page.close(); }
}, 30_000);

test('calendar month/year magnetic material uses existing roving focus and one decorated virtual year viewport', async () => {
  const page = await open(true);
  try {
    const scope = page.getByTestId('single'), output = await scope.locator('output').textContent();
    await scope.getByRole('button', { name: /choose month/i }).click();
    await page.keyboard.press('ArrowRight'); await magneticAt(page, 'single', '[data-choice="10"]');
    expect(await scope.getByRole('button', { name: 'November 2026', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('Escape');
    const years = page.getByTestId('large-years');
    await years.getByRole('button', { name: /choose year/i }).click();
    const grid = years.getByRole('grid', { name: 'Years', exact: true });
    expect(await years.locator('.zero-scroll-viewport').count()).toBe(1);
    expect(await grid.evaluate(element => ({ class: element.classList.contains('zero-scroll-viewport'), overflow: element.scrollHeight > element.clientHeight,
      nested: element.querySelector('.zero-scroll-viewport') !== null, railsInside: element.querySelector('.zero-scroll-decoration') !== null })))
      .toEqual({ class: true, overflow: true, nested: false, railsInside: false });
    expect(await years.locator('.zero-scroll-decoration').count()).toBe(1);
    expect(await years.locator('[data-slot="calendar-heading"]').evaluate(element => getComputedStyle(element).maskImage)).toBe('none');
    await page.keyboard.press('End'); await magneticAt(page, 'large-years', '[data-choice="10000"]');
    expect(await grid.getByRole('button').count()).toBeLessThan(60);
    expect(await grid.getByRole('button', { name: '10000', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    expect(await grid.evaluate(element => element.style.getPropertyValue('--zero-scroll-edge-bottom'))).toBe('0px');
    expect(await scope.locator('output').textContent()).toBe(output);
    expect(await years.locator('.zero-menu-active-highlight').evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
    for (const name of ['custom-month', 'custom-grid']) expect(await page.getByTestId(name).locator('.zero-menu-active-highlight').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);

test('month/year headings drill down and Escape returns to days without mutating a selection', async () => {
  const page = await open();
  try {
    const scope = page.getByTestId('single'); const original = await scope.locator('output').textContent();
    await (await monthPicker(page)).click({ timeout: 2500 });
    expect(await scope.getByRole('grid', { name: 'Months in 2026' }).isVisible()).toBe(true);
    expect(await scope.getByRole('grid', { name: 'Months in 2026' }).getByRole('button').count()).toBe(12);
    await scope.getByRole('button', { name: 'December 2026', exact: true }).click();
    expect(await scope.getByRole('grid', { name: 'December 2026', exact: true }).isVisible()).toBe(true);
    await scope.getByRole('button', { name: /choose year/i }).click();
    expect(await scope.getByRole('grid', { name: 'Years', exact: true }).isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await scope.getByRole('grid', { name: 'December 2026', exact: true }).isVisible()).toBe(true);
    expect(await scope.locator('output').textContent()).toBe(original);
  } finally { await page.close(); }
}, 30_000);

test('header arrows stay within their calendar and controlled navigation changes the displayed month', async () => {
  const page = await open();
  try {
    const scope = page.getByTestId('controlled');
    const next = scope.getByRole('button', { name: /next month/i });
    const calendar = scope.locator('[data-slot="calendar"]');
    const rect = await calendar.boundingBox(), button = await next.boundingBox();
    expect(button!.x).toBeGreaterThanOrEqual(rect!.x);
    expect(button!.y).toBeGreaterThanOrEqual(rect!.y);
    await next.click(); expect(await scope.locator('output').textContent()).toBe('2026-11');
    expect(await scope.getByRole('grid', { name: 'November 2026', exact: true }).isVisible()).toBe(true);
    await scope.getByRole('button', { name: /previous month/i }).click();
    expect(await scope.locator('output').textContent()).toBe('2026-10');
  } finally { await page.close(); }
}, 30_000);

test('month and year picks honor navigation bounds and leave disabled/hidden day policies intact', async () => {
  const page = await open(true);
  try {
    const scope = page.getByTestId('bounded');
    expect(await scope.getByRole('button', { name: /previous month/i }).isDisabled()).toBe(true);
    await scope.getByRole('button', { name: /choose month/i }).click();
    expect(await scope.getByRole('button', { name: 'September 2026', exact: true }).isDisabled()).toBe(true);
    await scope.getByRole('button', { name: 'December 2026', exact: true }).click();
    await scope.getByRole('button', { name: /choose year/i }).click();
    expect(await scope.getByRole('grid', { name: 'Years', exact: true }).getByRole('button').allTextContents()).toEqual(['2026', '2027']);
    await scope.getByRole('button', { name: '2027', exact: true }).click();
    expect(await scope.getByRole('grid', { name: 'February 2027', exact: true }).isVisible()).toBe(true);
    expect(await scope.getByRole('button', { name: /next month/i }).isDisabled()).toBe(true);
    expect(await scope.getByRole('button', { name: /Sunday, February 21st, 2027/i }).isDisabled()).toBe(true);
    const hidden = page.getByTestId('hidden');
    expect(await hidden.getByRole('button', { name: /October 8th, 2026/i }).count()).toBe(0);
    expect(await hidden.getByRole('button', { name: /October 9th, 2026/i }).isDisabled()).toBe(true);
    const disabled = page.getByTestId('disabled-nav');
    expect(await disabled.getByRole('button', { name: /choose month/i }).isDisabled()).toBe(true);
    expect(await disabled.getByRole('button', { name: /next month/i }).isDisabled()).toBe(true);
  } finally { await page.close(); }
}, 30_000);

test('day selection still uses DayPicker single, multiple, and two-month range semantics', async () => {
  const page = await open(true);
  try {
    const single = page.getByTestId('single');
    await single.getByRole('button', { name: /Thursday, October 15th, 2026/i }).click();
    expect(await single.locator('output').textContent()).toContain('2026-10-15');
    const multiple = page.getByTestId('multiple');
    await multiple.getByRole('button', { name: /Thursday, October 15th, 2026/i }).click();
    await multiple.getByRole('button', { name: /Friday, October 16th, 2026/i }).click();
    expect(await multiple.locator('output').textContent()).toBe('15,16');
    expect(await multiple.getByRole('button', { name: /Saturday, October 17th, 2026/i }).isDisabled()).toBe(true);
    const range = page.getByTestId('range');
    await range.getByRole('grid', { name: 'October 2026', exact: true }).getByRole('button', { name: /Friday, October 30th, 2026/i }).click();
    await range.getByRole('grid', { name: 'November 2026', exact: true }).getByRole('button', { name: /Tuesday, November 3rd, 2026/i }).click();
    expect(await range.locator('output').textContent()).toBe('30-3');
    await range.getByRole('button', { name: 'November, choose month', exact: true }).click();
    await range.getByRole('button', { name: 'December 2026', exact: true }).click();
    // Match the existing DayPicker dropdown contract: a caption pick becomes the first visible month.
    expect(await range.getByRole('grid', { name: 'December 2026', exact: true }).isVisible()).toBe(true);
    expect(await range.getByRole('grid', { name: 'January 2027', exact: true }).isVisible()).toBe(true);
    expect(await range.locator('output').textContent()).toBe('30-3');
  } finally { await page.close(); }
}, 30_000);

test('month and year grids have roving keyboard focus; Today only navigates; RTL and locale remain supported', async () => {
  const page = await open(true);
  try {
    const single = page.getByTestId('single'); const original = await single.locator('output').textContent();
    await single.getByRole('button', { name: /choose month/i }).click();
    await page.keyboard.press('ArrowRight');
    expect(await single.getByRole('button', { name: 'November 2026', exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.press('Enter');
    expect(await single.getByRole('grid', { name: 'November 2026', exact: true }).isVisible()).toBe(true);
    await single.getByRole('button', { name: /choose year/i }).click();
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    expect(await single.getByRole('grid', { name: 'November 2023', exact: true }).isVisible()).toBe(true);
    await single.getByRole('button', { name: /^Today,/ }).click();
    expect(await single.getByRole('grid', { name: 'October 2026', exact: true }).isVisible()).toBe(true);
    expect(await single.locator('output').textContent()).toBe(original);
    const localized = page.getByTestId('locale');
    await localized.getByRole('button', { name: /octobre, choose month/i }).click();
    expect(await localized.getByRole('button', { name: 'décembre 2026', exact: true }).isVisible()).toBe(true);
    const rtl = page.getByTestId('rtl');
    await rtl.getByRole('button', { name: /choose month/i }).click(); await page.keyboard.press('ArrowRight');
    expect(await rtl.getByRole('button', { name: 'September 2026', exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

test('native dropdown and caller-owned Month/MonthGrid overrides retain usable navigation', async () => {
  const page = await open(true);
  try {
    const dropdown = page.getByTestId('dropdown');
    await dropdown.getByLabel('Choose the Month').selectOption('11');
    expect(await dropdown.getByRole('grid', { name: 'December 2026', exact: true }).isVisible()).toBe(true);
    for (const name of ['custom-month', 'custom-grid']) {
      const scope = page.getByTestId(name);
      expect(await scope.getByRole('button', { name: /choose month/i }).count()).toBe(0);
      await scope.getByRole('button', { name: /next month/i }).click();
      expect(await scope.getByRole('grid', { name: 'November 2026', exact: true }).isVisible()).toBe(true);
    }
  } finally { await page.close(); }
}, 30_000);

test('rapid view and month changes retire inert exits and reduced motion leaves no running animations', async () => {
  const page = await open();
  try {
    const scope = page.getByTestId('single');
    for (let index = 0; index < 5; index++) {
      await scope.getByRole('button', { name: /choose month/i }).click();
      await scope.getByRole('button', { name: /choose year/i }).click();
      await page.keyboard.press('Escape');
    }
    for (let index = 0; index < 4; index++) await scope.getByRole('button', { name: /next month/i }).click();
    expect(await scope.getByRole('grid', { name: 'February 2027', exact: true }).isVisible()).toBe(true);
    await page.waitForFunction(() => document.querySelector('[data-testid="single"] [data-slot="calendar-stage"]')?.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished'));
    expect(await scope.getByRole('grid').count()).toBe(1);
    expect(await scope.locator('[data-slot="calendar-stage"] [inert] > *').count()).toBe(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scope.getByRole('button', { name: /choose year/i }).click();
    expect(await scope.locator('[data-slot="calendar-stage"]').evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1100);
  } finally { await page.close(); }
}, 30_000);

test('large year ranges virtualize bounded DOM while keyboard End reaches the actual final year', async () => {
  const page = await open(true);
  try {
    const scope = page.getByTestId('large-years');
    await scope.getByRole('button', { name: /choose year/i }).click();
    const grid = scope.getByRole('grid', { name: 'Years', exact: true });
    expect(await grid.getByRole('button').count()).toBeLessThan(60);
    await page.keyboard.press('End');
    await scope.getByRole('button', { name: '10000', exact: true }).waitFor();
    expect(await scope.getByRole('button', { name: '10000', exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
    expect(await grid.getByRole('button').count()).toBeLessThan(60);
    await page.keyboard.press('Escape');
    expect(await scope.getByRole('grid', { name: 'October 2026', exact: true }).isVisible()).toBe(true);
  } finally { await page.close(); }
}, 30_000);

test('calendar remains within a 320px pane and preserves native day keyboard navigation', async () => {
  const page = await open(true, 320);
  try {
    const scope = page.getByTestId('single');
    await scope.getByRole('grid').getByRole('button', { name: /Wednesday, October 7th, 2026/i }).focus();
    await page.keyboard.press('ArrowRight');
    expect(await scope.getByRole('button', { name: /Thursday, October 8th, 2026/i }).evaluate(element => document.activeElement === element)).toBe(true);
    await page.keyboard.press('PageDown');
    expect(await scope.getByRole('grid', { name: 'November 2026', exact: true }).isVisible()).toBe(true);
    await scope.getByRole('button', { name: /choose month/i }).click();
    expect(await scope.getByRole('grid', { name: 'Months in 2026' }).isVisible()).toBe(true);
    const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('*')]
      .filter(element => element.getBoundingClientRect().right > 321)
      .map(element => ({ slot: element.dataset.slot, tag: element.tagName, className: element.className, width: element.clientWidth })).slice(0, 10));
    expect(overflow).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  } finally { await page.close(); }
}, 30_000);

test('initial controlled picker views have a constrained usable body without a previous days measurement', async () => {
  const page = await open(true);
  try {
    const years = page.getByTestId('initial-years'), months = page.getByTestId('initial-months');
    expect((await years.locator('[data-slot="calendar-stage"]').boundingBox())!.height).toBeGreaterThan(200);
    expect((await months.locator('[data-slot="calendar-stage"]').boundingBox())!.height).toBeGreaterThan(200);
    expect(await years.getByRole('button', { name: '2026', exact: true }).isVisible()).toBe(true);
    expect(await months.getByRole('button', { name: 'December 2026', exact: true }).isVisible()).toBe(true);
    await years.getByRole('button', { name: '2027', exact: true }).click();
    expect(await years.getByRole('grid', { name: 'October 2027', exact: true }).isVisible()).toBe(true);
  } finally { await page.close(); }
}, 30_000);

test('320px shared day/month/year surfaces stay bounded and respond to light/dark theme tokens', async () => {
  const page = await open(true, 320);
  const directory = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/calendar-field-editors';
  await mkdir(directory, { recursive: true });
  try {
    const scope = page.getByTestId('single'), calendar = scope.locator('[data-slot="calendar"]');
    const colors: { text: string; surface: string; selection: string }[] = [];
    for (const theme of ['light', 'dark']) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
      colors.push(await calendar.evaluate(element => ({ text: getComputedStyle(element).color,
        surface: getComputedStyle(document.body).backgroundColor,
        selection: getComputedStyle(element.querySelector('[data-selected]')!).backgroundColor })));
      const selected = calendar.locator('[data-selected] button');
      const selectedColors = await selected.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
      await selected.hover();
      expect(await selected.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))).toEqual(selectedColors);
      expect(selectedColors.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(selectedColors.color).not.toBe(selectedColors.background);
      await page.mouse.move(0, 0);
      for (const view of ['days', 'months', 'years']) {
        if (view !== 'days') await scope.getByRole('button', { name: view === 'months' ? /choose month/i : /choose year/i }).click();
        const stage = calendar.locator('[data-slot="calendar-stage"]');
        expect(await stage.getAttribute('data-calendar-view')).toBe(view);
        const bounds = await calendar.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        expect((await stage.boundingBox())!.height).toBeGreaterThan(200);
        await calendar.screenshot({ path: `${directory}/calendar-${theme}-${view}.png` });
      }
      await page.keyboard.press('Escape');
    }
    expect(colors[1]).not.toEqual(colors[0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    expect(await scope.locator('output').textContent()).toContain('2026-10-07');
  } finally { await page.close(); }
}, 30_000);

test('after/around navigation and custom caption/label extension points retain both working month arrows', async () => {
  const page = await open(true);
  try {
    for (const name of ['after-nav', 'around-nav', 'custom-caption', 'custom-label']) {
      const scope = page.getByTestId(name), previous = scope.getByRole('button', { name: /previous month/i }), next = scope.getByRole('button', { name: /next month/i });
      expect(await previous.count()).toBe(1); expect(await next.count()).toBe(1);
      await next.click(); expect(await scope.getByRole('grid', { name: 'November 2026', exact: true }).isVisible()).toBe(true);
      await previous.click(); expect(await scope.getByRole('grid', { name: 'October 2026', exact: true }).isVisible()).toBe(true);
    }
  } finally { await page.close(); }
}, 30_000);
