/** Computed scoped-backdrop and real scene-retirement checks; no app bootstrap or default-theme activation. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/backdrop-browser-');
  let componentCss = '';
  try {
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', `${import.meta.dir}/modal-backdrop-theme.browser-fixture.tsx`,
      '--target=browser', '--format=iife', '--outdir=' + directory, '--entry-naming=fixture.[ext]'], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, output, diagnostic] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Backdrop fixture build failed: ${output}\n${diagnostic}`);
    bundle = await Bun.file(directory + '/fixture.js').text();
    if (await Bun.file(directory + '/fixture.css').exists()) componentCss = await Bun.file(directory + '/fixture.css').text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  const require = createRequire(import.meta.url), { compile } = require('@tailwindcss/node') as typeof import('@tailwindcss/node');
  const url = new URL('../frontend/styles/globals.css', import.meta.url);
  const compiler = await compile(await Bun.file(url).text(), { base: new URL('../frontend/styles/', import.meta.url).pathname,
    from: url.pathname, onDependency() {} });
  const button = await Bun.file(new URL('../components/ui/button.tsx', import.meta.url)).text();
  css = compiler.build(button.match(/[^\s"'`]+/gu) ?? []) + '\n' + componentCss;
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(reduced = true): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5000);
  await page.setContent('<!doctype html><html><body><div id="root"></div><div id="backdrop-portals"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByTestId('primary-trigger').waitFor();
  return page;
}
async function waitPaint(page: Page, expected: string) {
  await page.waitForFunction(color => {
    const backdrop = document.querySelector('.zero-modal-backdrop');
    return backdrop && getComputedStyle(backdrop).backgroundColor === color;
  }, expected);
}
async function paint(page: Page) {
  return page.locator('.zero-modal-backdrop').evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.backgroundColor, zIndex: style.zIndex, hidden: (element as HTMLElement).hidden,
      blur: style.backdropFilter };
  });
}
async function settled(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title, exact: true, includeHidden: true }); await dialog.waitFor();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  return dialog;
}

browserTest('one shared backdrop follows live source paint, top child ownership and latest parent restoration', async () => {
  const page = await mount();
  try {
    await page.getByTestId('primary-trigger').click();
    const parent = await settled(page, 'Scoped parent');
    await waitPaint(page, 'rgba(10, 20, 30, 0.9)');
    expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    expect(await page.locator('.zero-modal-backdrop').evaluate(element => !!element.closest('#backdrop-portals'))).toBe(true);
    await page.locator('.zero-modal-backdrop').evaluate(element => element.setAttribute('data-identity', 'same'));
    await parent.getByLabel('Parent draft').fill('Still retained');
    await page.getByTestId('primary-source').evaluate(element => (element as HTMLElement).style.setProperty('--zero-modal-backdrop-color', 'rgb(20 30 40 / .85)'));
    await waitPaint(page, 'rgba(20, 30, 40, 0.85)');
    await parent.getByRole('button', { name: 'Open scoped child' }).click();
    const child = await settled(page, 'Scoped child');
    await waitPaint(page, 'rgba(70, 80, 90, 0.8)');
    expect(await parent.evaluate(element => (element.parentElement as HTMLElement).inert)).toBe(true);
    expect((await paint(page)).zIndex).toBe('1010');
    await page.getByTestId('primary-source').evaluate(element => (element as HTMLElement).style.setProperty('--zero-modal-backdrop-color', 'rgb(30 40 50 / .75)'));
    await page.waitForFunction(() => {
      const parent = document.querySelector('[data-zero-modal-id]');
      return parent && getComputedStyle(parent).getPropertyValue('--zero-modal-backdrop-color').trim() === 'rgb(30 40 50 / .75)';
    });
    expect((await paint(page)).color).toBe('rgba(70, 80, 90, 0.8)');
    await child.getByRole('button', { name: 'Close', exact: true }).click();
    await child.waitFor({ state: 'detached' });
    await waitPaint(page, 'rgba(30, 40, 50, 0.75)');
    expect(await parent.getByLabel('Parent draft').inputValue()).toBe('Still retained');
    expect(await parent.evaluate(element => (element.parentElement as HTMLElement).inert)).toBe(false);
    expect(await parent.getByRole('button', { name: 'Open scoped child' }).evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.locator('.zero-modal-backdrop').getAttribute('data-identity')).toBe('same');
    await parent.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => document.body.style.overflow === '');
    expect((await paint(page)).hidden).toBe(true);
    expect(await page.getByTestId('primary-trigger').evaluate(element => element === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

browserTest('final scene fade retains outgoing paint and stale retirement cannot clear a rapidly reopened owner', async () => {
  const page = await mount(false);
  try {
    await page.getByTestId('primary-trigger').click();
    const parent = page.getByRole('dialog', { name: 'Scoped parent', exact: true }); await parent.waitFor();
    expect(await parent.evaluate(element => element.getAnimations().map(animation => animation.effect!.getTiming().duration))).toContain(975);
    await settled(page, 'Scoped parent'); await waitPaint(page, 'rgba(10, 20, 30, 0.9)');
    expect((await paint(page)).blur).toBe('blur(6px)');
    await parent.getByRole('button', { name: 'Close', exact: true }).click();
    await parent.waitFor({ state: 'detached' });
    await page.locator('.zero-modal-layer').waitFor({ state: 'detached' });
    expect(await paint(page)).toMatchObject({ color: 'rgba(10, 20, 30, 0.9)', hidden: false });
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.locator('.zero-modal-backdrop').evaluate(element => element.setAttribute('data-identity', 'same'));
    await page.evaluate(() => window.__modalBackdropTheme.reopen());
    const fresh = await settled(page, 'Fresh owner'); await waitPaint(page, 'rgba(100, 110, 120, 0.7)');
    expect(await paint(page)).toMatchObject({ color: 'rgba(100, 110, 120, 0.7)', hidden: false, blur: 'blur(6px)' });
    expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    expect(await page.locator('.zero-modal-backdrop').getAttribute('data-identity')).toBe('same');
    expect(await fresh.getByLabel('Fresh draft').evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await fresh.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => document.body.style.overflow === '');
    expect((await paint(page)).hidden).toBe(true);
  } finally { await page.close(); }
}, 30_000);

browserTest('programmatic opening reuses the captured opener theme while retaining Rise and approved timing', async () => {
  const page = await mount(false);
  try {
    await page.getByTestId('primary-trigger').focus();
    await page.evaluate(() => window.__modalBackdropTheme.programmatic());
    const parent = page.getByRole('dialog', { name: 'Scoped parent', exact: true }); await parent.waitFor();
    expect(await parent.evaluate(element => element.getAnimations().map(animation => animation.effect!.getTiming().duration))).toContain(900);
    await waitPaint(page, 'rgba(10, 20, 30, 0.9)');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await parent.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => document.body.style.overflow === '');
    expect((await paint(page)).hidden).toBe(true);
  } finally { await page.close(); }
}, 30_000);
