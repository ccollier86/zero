/** Functional scoped mobile-sheet projection; synthetic real DOM, no screenshots, app boot or fonts. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease } from '../../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined;
let script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'sidebar-theme-'));
  try {
    const styles = await buildPlatformStyles(directory, join(directory, 'absent-app'), [], { themeFoundation: 'next' });
    css = await Bun.file(styles.cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  const build = await Bun.build({ entrypoints: [`${import.meta.dir}/sidebar-theme.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  script = await build.outputs[0]!.text();
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function mount(width = 600) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce', colorScheme: 'light' });
  page.setDefaultTimeout(5000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.getByTestId('toggle').waitFor();
  return page;
}
async function snapshot(page: Page) {
  return page.getByRole('dialog').evaluate(element => {
    const paint = getComputedStyle(element), body = getComputedStyle(element.querySelector('[data-testid="body"]')!),
      action = getComputedStyle(element.querySelector('[data-testid="action"]')!), navigation = getComputedStyle(element.querySelector('[data-slot="sidebar-menu-button"]')!);
    return { background: paint.backgroundColor, color: paint.color, scheme: paint.colorScheme, width: paint.width,
      bodySize: body.fontSize, bodyLeading: body.lineHeight, family: body.fontFamily,
      actionSize: action.fontSize, actionFamily: action.fontFamily, navigationFamily: navigation.fontFamily };
  });
}

browserTest('mobile Sidebar projects live scoped tokens without changing the existing sheet, focus, draft or refs', async () => {
  const page = await mount();
  try {
    await page.getByTestId('toggle').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await page.waitForFunction(() => {
      const action = document.querySelector('[role="dialog"] [data-testid="action"]');
      return action && getComputedStyle(action).fontSize === '19px';
    });
    expect(await dialog.evaluate(element => !document.querySelector('#source')!.contains(element))).toBe(true);
    expect(await snapshot(page)).toMatchObject({ background: 'rgb(17, 34, 51)', color: 'rgb(221, 238, 255)',
      family: 'monospace', navigationFamily: 'monospace', bodySize: '14px', bodyLeading: '21px', actionSize: '19px', width: '288px' });
    const original = await dialog.elementHandle();
    await page.getByTestId('draft').fill('kept while theme changes');
    await page.getByTestId('draft').focus();
    await page.locator('#source').evaluate(element => {
      const source = element as HTMLElement;
      source.dataset.zeroMode = 'dark';
      source.style.removeProperty('--sidebar'); source.style.removeProperty('--sidebar-foreground');
      source.style.setProperty('--zero-theme-font-body', 'serif'); source.style.setProperty('--zero-type-control-size', '21px');
    });
    await page.waitForFunction(() => {
      const action = document.querySelector('[role="dialog"] [data-testid="action"]');
      return action && getComputedStyle(action).fontSize === '21px' && getComputedStyle(action).fontFamily === 'serif';
    });
    expect(await snapshot(page)).toMatchObject({ background: 'rgb(20, 20, 20)', color: 'rgb(242, 242, 242)',
      family: 'serif', navigationFamily: 'serif', actionSize: '21px', scheme: 'dark', width: '288px' });
    expect(await original!.evaluate(element => element === document.querySelector('[role="dialog"]'))).toBe(true);
    expect(await page.getByTestId('draft').inputValue()).toBe('kept while theme changes');
    expect(await page.getByTestId('draft').evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => (window as any).__sidebarTheme.refs())).toMatchObject({ matches: true, mounts: 1, cleanups: 0 });
    expect(await page.locator('html').getAttribute('data-zero-theme')).toBeNull();
    expect(await page.locator('body').getAttribute('data-zero-theme')).toBeNull();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    expect(await page.getByTestId('toggle').evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => (window as any).__sidebarTheme.refs())).toMatchObject({ closes: 1 });
    await page.evaluate(() => (window as any).__sidebarTheme.unmount());
    expect(await page.evaluate(() => (window as any).__sidebarTheme.refs())).toMatchObject({ matches: false, mounts: 1, cleanups: 1 });
  } finally { await page.close(); }
}, 30_000);

browserTest('mobile Sidebar caller styles override projected paint and type; desktop geometry remains unchanged', async () => {
  const page = await mount();
  try {
    await page.getByTestId('toggle').click();
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => (window as any).__sidebarTheme.setStyle({ '--sidebar': '#445566', '--zero-theme-font-body': 'sans-serif',
      '--zero-type-control-size': '23px', fontFamily: 'serif', fontSize: '17px', lineHeight: 2 }));
    await page.waitForFunction(() => {
      const action = document.querySelector('[role="dialog"] [data-testid="action"]');
      return action && getComputedStyle(action).fontSize === '23px';
    });
    expect(await snapshot(page)).toMatchObject({ background: 'rgb(68, 85, 102)', family: 'serif', navigationFamily: 'serif',
      bodySize: '17px', bodyLeading: '34px', actionSize: '23px', actionFamily: 'sans-serif', width: '288px' });
    await page.locator('#source').evaluate(element => (element as HTMLElement).style.setProperty('--sidebar', '#778899'));
    expect(await snapshot(page)).toMatchObject({ background: 'rgb(68, 85, 102)', actionSize: '23px' });
  } finally { await page.close(); }

  const desktop = await mount(1200);
  try {
    expect(await desktop.getByRole('dialog').count()).toBe(0);
    const container = desktop.locator('[data-slot="sidebar-container"]');
    expect(await container.evaluate(element => getComputedStyle(element).width)).toBe('256px');
    expect(await desktop.locator('[data-slot="sidebar-gap"]').evaluate(element => getComputedStyle(element).width)).toBe('256px');
    expect(await desktop.locator('[data-slot="sidebar-inner"]').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 34, 51)');
    expect(await desktop.evaluate(() => (window as any).__sidebarTheme.refs())).toMatchObject({ matches: true, mounts: 1, cleanups: 0 });
  } finally { await desktop.close(); }
}, 30_000);
