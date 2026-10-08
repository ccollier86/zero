/** Isolated styled Chromium qualification; tests only synthetic modal presentation. */
import { beforeAll, afterAll, test, expect } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises'; // No Bun temporary-directory/removal API.
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';

let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/modal-presentation-');
  try {
    const output = directory + '/fixture.js';
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/modal-presentation.browser-fixture.tsx',
      '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code) throw new Error('Presentation fixture build failed: ' + (stderr || stdout));
    bundle = await Bun.file(output).text();
    css = await Bun.file((await buildPlatformStyles(directory, directory + '/absent-app')).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function open(width = 1100, reduced = true) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const failures: string[] = []; errors.set(page, failures); page.on('pageerror', error => failures.push(error.message));
  await page.setContent('<div id="root"></div><div id="presentation-portals"></div>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Modal presentation fixture' }).waitFor();
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
async function dismiss(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'detached', timeout: 4000 });
  try {
    await page.waitForFunction(() => document.body.style.overflow === '', undefined, { timeout: 4000 });
  } catch {
    const state = await page.evaluate(() => ({
      overflow: document.body.style.overflow,
      surfaceInert: document.querySelector<HTMLElement>('[data-zero-modal-surface]')?.inert,
      backdropHidden: document.querySelector<HTMLElement>('.zero-modal-backdrop')?.hidden,
      layers: document.querySelectorAll('.zero-modal-layer').length,
    }));
    throw new Error('Detached modal did not release page scroll: ' + JSON.stringify(state));
  }
}
const bounds = async (page: Page, title: string) => {
  const dialog = page.getByRole('dialog', { name: title, exact: true }); await dialog.waitFor();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  return dialog.boundingBox();
};

test('left/right/custom/full sizes stay bounded and custom portal roots remain outside recession', async () => {
  for (const width of [1100, 375]) {
    const page = await open(width);
    try {
      for (const title of ['Custom left', 'Custom right', 'Clamped custom', 'Full frame']) {
        await page.getByRole('button', { name: title, exact: true }).click();
        const box = (await bounds(page, title))!;
        expect(box.x).toBeGreaterThanOrEqual(-.5); expect(box.y).toBeGreaterThanOrEqual(-.5);
        expect(box.x + box.width).toBeLessThanOrEqual(width + .5); expect(box.y + box.height).toBeLessThanOrEqual(800.5);
        if (width === 1100 && title === 'Custom left') expect(Math.round(box.x)).toBe(32);
        if (width === 1100 && title === 'Custom right') expect(Math.round(box.x + box.width)).toBe(1068);
        if (title === 'Clamped custom') { expect(box.width).toBeLessThanOrEqual(700.5); expect(box.height).toBeLessThanOrEqual(520.5); }
        expect(await page.getByRole('dialog', { name: title }).evaluate(element => element.closest('#presentation-portals') !== null)).toBe(true);
        if (width === 375 && title === 'Full frame') { expect(Math.round(box.width)).toBe(375); expect(Math.round(box.height)).toBe(800); }
        await dismiss(page, title);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await close(page); }
  }
}, 30_000);

test('hidden/thin scrollbar settings preserve actual body scroll and anchored header/footer', async () => {
  const page = await open();
  try {
    for (const [title, scrollbar] of [['Hidden scroll', 'none'], ['Thin scroll', 'thin']]) {
      await page.getByRole('button', { name: title!, exact: true }).click();
      await bounds(page, title!);
      const body = page.getByRole('dialog', { name: title! }).locator('.zero-modal__body');
      expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      expect(await body.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe(scrollbar);
      const before = await page.getByRole('dialog', { name: title! }).locator('.zero-modal__head').boundingBox();
      await body.evaluate(element => { element.scrollTop = 160; });
      expect(await body.evaluate(element => element.scrollTop)).toBe(160);
      expect((await page.getByRole('dialog', { name: title! }).locator('.zero-modal__head').boundingBox())?.y).toBe(before?.y);
      await dismiss(page, title!);
    }
  } finally { await close(page); }
}, 30_000);

test('live platform/public and dark theme tokens follow the initiating surface through managed popup portals', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Theme detail', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Theme detail' }); await dialog.waitFor();
    const initial = await dialog.evaluate(element => getComputedStyle(element).backgroundColor);
    const initialForeground = await dialog.evaluate(element => getComputedStyle(element).color);
    const source = page.getByTestId('theme-source');
    const initialClass = await source.getAttribute('class');
    // The lane attribute must independently invalidate theme inheritance. Changing
    // dark mode in the same action would let a missing lane observer pass.
    await page.evaluate(() => window.__modalPresentation.theme('public', false));
    await page.waitForFunction(before => {
      const element = document.querySelector('[data-zero-modal-id]');
      return element && getComputedStyle(element).color !== before;
    }, initialForeground);
    const publicForeground = await source.evaluate(element => getComputedStyle(element).getPropertyValue('--zero-modal-foreground').trim());
    expect(await dialog.evaluate(element => getComputedStyle(element).getPropertyValue('--zero-modal-foreground').trim())).toBe(publicForeground);
    expect(await source.getAttribute('class')).toBe(initialClass);
    await page.evaluate(() => window.__modalPresentation.theme('platform', false));
    await page.waitForFunction(before => {
      const element = document.querySelector('[data-zero-modal-id]');
      return element && getComputedStyle(element).color === before;
    }, initialForeground);
    expect(await source.getAttribute('class')).toBe(initialClass);
    await page.evaluate(() => window.__modalPresentation.theme('public', true));
    await page.waitForFunction(before => {
      const element = document.querySelector('[data-zero-modal-id]');
      return element && getComputedStyle(element).backgroundColor !== before;
    }, initial);
    const sourceToken = await page.getByTestId('theme-source').evaluate(element => getComputedStyle(element).getPropertyValue('--zero-modal-background').trim());
    expect(await dialog.evaluate(element => getComputedStyle(element).getPropertyValue('--zero-modal-background').trim())).toBe(sourceToken);
    await dialog.getByRole('button', { name: 'Theme popup', exact: true }).click();
    const popup = page.getByText('Owned popup', { exact: true }); await popup.waitFor();
    await popup.evaluate(async element => {
      const owner = element.closest('[data-zero-overlay-owner]');
      if (owner) await Promise.all(owner.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    expect(await popup.evaluate(element => getComputedStyle(element.parentElement!).getPropertyValue('--zero-modal-background').trim())).toBe(sourceToken);
    const directory = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/modal-system';
    await mkdir(directory, { recursive: true }); await page.screenshot({ path: directory + '/public-dark-presentation.png' });
    await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' });
    expect(await dialog.isVisible()).toBe(true);
    await page.evaluate(() => window.__modalPresentation.theme('platform', false));
    await page.waitForFunction(before => {
      const element = document.querySelector('[data-zero-modal-id]');
      return element && getComputedStyle(element).backgroundColor === before;
    }, initial);
  } finally { await close(page); }
}, 30_000);

test('all six real WAAPI entrances preserve exact duration and settled bounded geometry', async () => {
  const page = await open(1100, false);
  try {
    for (const [preset, duration] of [['rise',900], ['grow',750], ['origin',975], ['spring',1050], ['focus',840], ['drop',900]] as const) {
      const title = 'Motion ' + preset;
      await page.getByRole('button', { name: title, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: title }); await dialog.waitFor();
      expect(await dialog.evaluate(element => element.getAnimations().map(animation => animation.effect!.getTiming().duration))).toContain(duration);
      const box = (await bounds(page, title))!;
      expect(box.x).toBeGreaterThan(0); expect(box.x + box.width).toBeLessThan(1100);
      expect(box.y).toBeGreaterThan(0); expect(box.y + box.height).toBeLessThan(800);
      expect(await dialog.evaluate(element => getComputedStyle(element).transform)).toBe('none');
      await dismiss(page, title);
    }
  } finally { await close(page); }
}, 30_000);

test('live reduced preference can close programmatic dialogs then return to full entrance timing', async () => {
  const page = await open(1100, false);
  try {
    await page.getByRole('button', { name: 'Motion rise', exact: true }).click();
    await bounds(page, 'Motion rise'); await dismiss(page, 'Motion rise');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => { window.__modalPresentation.programmatic(); });
    await page.getByRole('dialog', { name: 'Programmatic' }).waitFor({ timeout: 4000 }); await dismiss(page, 'Programmatic');
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.evaluate(() => { window.__modalPresentation.programmatic(); });
    const dialog = page.getByRole('dialog', { name: 'Programmatic' }); await dialog.waitFor({ timeout: 4000 });
    expect(await dialog.evaluate(element => element.getAnimations().map(animation => animation.effect!.getTiming().duration))).toContain(900);
    await dismiss(page, 'Programmatic'); expect(await page.locator('.zero-modal-layer').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
