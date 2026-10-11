/** Real open owned-portal theme updates in isolated Chromium; synthetic CSS, no application config/database/provider. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { buildPlatformStyles } from '../../../frontend/server/style-bundle';
import { renderThemeFoundationCss } from '../../../design-system/theme-css';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/overlay-live-theme';
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
const errors = new WeakMap<Page, string[]>();

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  await mkdir(SCRATCH, { recursive: true });
  const directory = await mkdtemp(join(SCRATCH, 'overlay-live-theme-'));
  try {
    const output = await Bun.build({ entrypoints: [join(import.meta.dir, 'overlay-live-theme.browser-fixture.tsx')],
      outdir: directory, naming: { entry: 'fixture.[ext]' }, target: 'browser', format: 'iife' });
    if (!output.success) throw new Error(output.logs.map(log => log.message).join('\n'));
    script = await Bun.file(join(directory, 'fixture.js')).text();
    css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
    css += '\n' + renderThemeFoundationCss() + '\n.fixture-local-paint{background:var(--popover);color:var(--popover-foreground)}';
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function mount() {
  const page = await lease!.browser.newPage({ viewport: { width: 1000, height: 700 }, colorScheme: 'light', reducedMotion: 'no-preference' });
  page.setDefaultTimeout(5000);
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent('<!doctype html><html><body><div id="root"></div><div id="overlay-target"></div></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByRole('button', { name: 'Open main menu', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open main menu', exact: true }).click();
  await page.getByTestId('main-popover').waitFor(); await settle(page);
  return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
async function paint(target: Locator) {
  return target.evaluate(element => {
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    return { background: style.backgroundColor, foreground: style.color, zIndex: style.zIndex,
      borderWidth: style.borderWidth, local: style.getPropertyValue('--fixture-local-token').trim(), colorScheme: style.colorScheme };
  });
}
async function token(target: Locator, name: string): Promise<string> {
  return target.evaluate((element, key) => element.ownerDocument.defaultView!.getComputedStyle(element).getPropertyValue(key).trim(), name);
}

browserTest('already open owned popovers follow next mode/density while preserving identity, focus, input and local overrides', async () => {
  const page = await mount();
  try {
    const popup = page.getByTestId('main-popover'), input = page.getByRole('textbox', { name: 'Continuity main', exact: true });
    await input.fill('Unchanged live draft');
    await popup.evaluate(element => { element.setAttribute('data-instance-evidence', 'same'); });
    expect(await paint(popup)).toMatchObject({ background: 'rgb(255, 255, 255)', zIndex: '1402', borderWidth: '3px', local: 'local' });
    expect(await token(popup, '--zero-theme-control-height')).toBe('2rem');
    await page.getByTestId('main-scope').evaluate(element => {
      element.setAttribute('data-zero-mode', 'dark'); element.setAttribute('data-zero-density', 'comfortable');
    });
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="main-popover"]')?.style.getPropertyValue('--zero-theme-control-height') === '2.25rem');
    expect(await paint(popup)).toMatchObject({ background: 'rgb(31, 31, 31)', colorScheme: 'dark', zIndex: '1402', borderWidth: '3px', local: 'local' });
    expect(await popup.getAttribute('data-instance-evidence')).toBe('same');
    expect(await input.inputValue()).toBe('Unchanged live draft');
    expect(await input.evaluate(element => element === element.ownerDocument.activeElement)).toBe(true);
    expect(await paint(page.getByTestId('main-local'))).toMatchObject({ background: 'rgb(221, 238, 255)', foreground: 'rgb(51, 68, 85)' });
    expect(await page.evaluate(() => window.__overlayThemeHarness.registered('main'))).toBe(true);
    const commits = await page.evaluate(() => window.__overlayThemeHarness.commits.main);
    await settle(page);
    expect(await page.evaluate(() => window.__overlayThemeHarness.commits.main)).toBe(commits);
    await mkdir(ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(ARTIFACTS, 'open-dark-owned-popover.png') });
  } finally { await close(page); }
}, 30_000);

browserTest('next theme activation/deactivation and legacy public/class/style changes refresh the same portal', async () => {
  const page = await mount();
  try {
    const popup = page.getByTestId('main-popover'), scope = page.getByTestId('main-scope');
    await scope.evaluate(element => { element.removeAttribute('data-zero-theme'); element.removeAttribute('data-zero-mode'); element.classList.add('dark'); });
    await settle(page);
    expect(await token(popup, '--background')).toBe(await token(scope, '--background'));
    await scope.evaluate(element => { element.setAttribute('data-zero-theme', 'next'); element.setAttribute('data-zero-mode', 'light'); });
    await settle(page); expect(await paint(popup)).toMatchObject({ background: 'rgb(255, 255, 255)' });
    await scope.evaluate(element => { (element as HTMLElement).style.setProperty('--popover', '#123456'); });
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="main-popover"]')?.style.getPropertyValue('--popover') === '#123456');
    expect(await paint(popup)).toMatchObject({ background: 'rgb(18, 52, 86)' });
    await page.addStyleTag({ content: '[data-zero-page="public"][data-zero-surface="public"]{--popover:#556677}' });
    await scope.evaluate(element => { (element as HTMLElement).style.removeProperty('--popover'); element.setAttribute('data-zero-page', 'public'); element.setAttribute('data-zero-surface', 'public'); });
    await settle(page); expect(await paint(popup)).toMatchObject({ background: 'rgb(85, 102, 119)' });
  } finally { await close(page); }
}, 30_000);

browserTest('live system-color/reduced-motion and resize-driven media updates reach existing owned portals', async () => {
  const page = await mount();
  try {
    const popup = page.getByTestId('main-popover');
    await page.getByTestId('main-scope').evaluate(element => element.setAttribute('data-zero-mode', 'system'));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="main-popover"]')?.style.getPropertyValue('--zero-theme-scroll-show-duration') === '0ms');
    expect(await paint(popup)).toMatchObject({ background: 'rgb(31, 31, 31)', colorScheme: 'dark' });
    expect(await token(popup, '--zero-theme-hold-confirm-duration')).toBe('1500ms');
    await page.addStyleTag({ content: '@media(max-width:600px){[data-zero-theme="next"]{--fixture-responsive:small}}@media(min-width:601px){[data-zero-theme="next"]{--fixture-responsive:large}}' });
    await page.setViewportSize({ width: 500, height: 700 }); await settle(page);
    expect(await token(popup, '--fixture-responsive')).toBe('small');
    await page.setViewportSize({ width: 1000, height: 700 }); await settle(page);
    expect(await token(popup, '--fixture-responsive')).toBe('large');
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' }); await settle(page);
    expect(await paint(popup)).toMatchObject({ background: 'rgb(255, 255, 255)', colorScheme: 'light' });
    expect(await token(popup, '--zero-theme-scroll-show-duration')).toBe('160ms');
  } finally { await close(page); }
}, 30_000);

browserTest('source ancestry is rebound after reparent and inactive ownership does not lose layers or registration', async () => {
  const page = await mount();
  try {
    const popup = page.getByTestId('main-popover');
    await page.evaluate(() => {
      const parent = document.createElement('div'); parent.id = 'new-owner-ancestor'; document.body.append(parent);
      parent.append(document.querySelector('#main-scope')!);
    });
    await settle(page);
    await page.locator('#new-owner-ancestor').evaluate(element => (element as HTMLElement).style.setProperty('--fixture-ancestor', 'rebound'));
    await settle(page); expect(await token(popup, '--fixture-ancestor')).toBe('rebound');
    await page.evaluate(() => window.__overlayThemeHarness.setActive('main', false)); await settle(page);
    expect(await popup.getAttribute('inert')).not.toBeNull(); expect(await paint(popup)).toMatchObject({ zIndex: '1402' });
    expect(await page.evaluate(() => window.__overlayThemeHarness.registered('main'))).toBe(true);
    await page.evaluate(() => window.__overlayThemeHarness.setActive('main', true)); await settle(page);
    expect(await popup.getAttribute('inert')).toBeNull();
  } finally { await close(page); }
}, 30_000);

browserTest('coarse-pointer and forced-colors preference changes refresh tokens without reopening the popup', async () => {
  const page = await mount();
  const session = await page.context().newCDPSession(page);
  try {
    const popup = page.getByTestId('main-popover');
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.waitForFunction(() => matchMedia('(pointer: coarse)').matches);
    await settle(page);
    expect(await token(popup, '--zero-theme-hit-target-min')).toBe('2.75rem');
    expect(await token(popup, '--zero-modal-close-target')).toBe('44px');
    await page.addStyleTag({ content: '@media(forced-colors:active){[data-zero-theme="next"]{--fixture-forced-colors:active}}' });
    await page.emulateMedia({ forcedColors: 'active' }); await settle(page);
    expect(await token(popup, '--fixture-forced-colors')).toBe('active');
    await page.emulateMedia({ forcedColors: 'none' });
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.waitForFunction(() => !matchMedia('(pointer: coarse)').matches); await settle(page);
    expect(await token(popup, '--zero-theme-hit-target-min')).toBe('2rem');
    expect(await token(popup, '--zero-modal-close-target')).toBe('32px');
    expect(await popup.getAttribute('data-state')).toBe('open');
  } finally { await session.detach(); await close(page); }
}, 30_000);

browserTest('iframe sources use their own rendering realm and detached triggers fall back to their owning document', async () => {
  const page = await mount();
  try {
    await page.evaluate(content => window.__overlayThemeHarness.installIframe(content), css);
    const frame = page.frameLocator('#theme-frame');
    const trigger = frame.getByRole('button', { name: 'Open frame menu', exact: true }); await trigger.waitFor(); await trigger.click();
    const popup = frame.getByTestId('frame-popover'); await popup.waitFor(); await settle(page);
    await frame.getByTestId('frame-scope').evaluate(element => (element as HTMLElement).style.setProperty('--popover', '#224466')); await settle(page);
    expect(await paint(popup)).toMatchObject({ background: 'rgb(34, 68, 102)' });
    await frame.getByTestId('frame-scope').evaluate(element => { (element as HTMLElement).style.removeProperty('--popover'); element.setAttribute('data-zero-mode', 'dark'); }); await settle(page);
    expect(await paint(popup)).toMatchObject({ background: 'rgb(31, 31, 31)', colorScheme: 'dark' });
    await frame.getByTestId('frame-scope').evaluate(element => element.setAttribute('data-zero-mode', 'light')); await settle(page);
    expect(await paint(popup)).toMatchObject({ background: 'rgb(255, 255, 255)', colorScheme: 'light' });
    await trigger.evaluate(element => element.remove()); await settle(page);
    expect(await paint(popup)).toMatchObject({ background: 'rgb(31, 31, 31)', colorScheme: 'dark' });
    expect(await page.evaluate(() => window.__overlayThemeHarness.registered('frame'))).toBe(true);
  } finally { await close(page); }
}, 30_000);

browserTest('unmount retires theme observers/media work and clears owned-branch admission without later style reads', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => window.__overlayThemeHarness.unmount()); await settle(page);
    expect(await page.evaluate(() => window.__overlayThemeHarness.registered('main'))).toBe(false);
    expect(await page.getByTestId('main-popover').count()).toBe(0);
    const reads = await page.evaluate(() => window.__overlayThemeHarness.reads.main);
    await page.locator('html').evaluate(element => { element.setAttribute('data-zero-mode', 'dark'); (element as HTMLElement).style.setProperty('--fixture-after-unmount', 'retired'); });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.setViewportSize({ width: 700, height: 700 }); await settle(page);
    expect(await page.evaluate(() => window.__overlayThemeHarness.reads.main)).toBe(reads);
  } finally { await close(page); }
}, 30_000);
