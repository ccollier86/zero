/** Styled isolated acceptance for compact groups and shared presence visuals. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, css = '', bundle = '';
const failures = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform/avatar-group';
  const styles = await buildPlatformStyles(root, `${root}/absent-app`);
  css = await Bun.file(styles.cssPath).text();
  expect(css).toContain('.zero-avatar-group');
  const build = await Bun.build({ entrypoints: [`${import.meta.dir}/avatar-group.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!build.success) throw new Error(build.logs.map((entry) => entry.message).join('\n'));
  bundle = await build.outputs[0]!.text();
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());

async function open(options: { touch?: boolean; reduced?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 640, height: 650 }, hasTouch: options.touch,
    reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  const errors: string[] = []; failures.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Motion's development build announces an intentionally emulated system
    // preference. The test verifies zero lift; all other warnings still fail.
    if (message.type() === 'warning'
      && message.text().startsWith('You have Reduced Motion enabled on your device.')) return;
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  await page.setContent('<div id="root"></div>'); await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle }); await page.getByTestId('primary').waitFor();
  return page;
}
async function close(page: Page) { expect(failures.get(page)).toEqual([]); await page.close(); }

browserTest('hover and keyboard descriptions, exact actions, no duplicate focus stops and stable roster keys', async () => {
  const page = await open();
  try {
    const group = page.getByTestId('primary');
    const ada = group.getByRole('img', { name: 'Ada Lovelace', exact: true });
    expect(await group.locator('[data-slot="avatar-container"][tabindex]').count()).toBe(0);
    await ada.hover(); await page.getByRole('tooltip', { name: 'Ada Lovelace', exact: true }).waitFor();
    await page.mouse.move(610, 620); await ada.focus();
    await page.getByRole('tooltip', { name: 'Ada Lovelace', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    const original = await ada.elementHandle();
    await page.evaluate(() => window.__avatarGroupFixture.reorder());
    expect(await original!.evaluate((node) => node.isConnected && document.activeElement === node)).toBe(true);
    const count = group.getByRole('button', { name: '5 more members', exact: true });
    await count.focus(); await count.press('Enter');
    const add = group.getByRole('button', { name: 'Invite teammate', exact: true });
    await add.focus(); await add.press('Enter');
    expect(await page.getByTestId('actions').textContent()).toBe('Invites 1 · Counts 1');
    expect(await group.locator('button button').count()).toBe(0);
    await page.evaluate(() => window.__avatarGroupFixture.pending(true));
    expect(await add.isDisabled()).toBe(true);
    expect(await add.getAttribute('aria-busy')).toBe('true');
  } finally { await close(page); }
}, 30_000);

browserTest('presence opt-in, matching square radii, theme colors and metric overrides', async () => {
  const page = await open();
  try {
    const group = page.getByTestId('primary');
    expect(await group.locator('[data-slot="avatar-presence-indicator"]').count()).toBe(0);
    expect(await group.getByRole('img', { name: 'Ada Lovelace', exact: true }).count()).toBe(1);
    await page.evaluate(() => window.__avatarGroupFixture.enablePresence(true));
    await group.getByRole('img', { name: 'Ada Lovelace — Busy', exact: true }).waitFor();
    expect(await group.locator('[data-slot="avatar-presence-indicator"]').count()).toBe(2);
    for (const id of ['rounded', 'square']) {
      expect(await page.getByTestId(id).getByRole('img', { name: 'Ada Lovelace — Busy', exact: true }).evaluate((node) => {
        const ring = node.querySelector('[data-slot="avatar-presence-indicator"]')!;
        return getComputedStyle(node).borderRadius === getComputedStyle(ring).borderRadius;
      })).toBe(true);
    }
    const tokens = page.getByTestId('tokens');
    const tokenGeometry = await tokens.evaluate((node) => {
      const first = node.querySelector('.zero-avatar-group-member')!;
      const next = first.closest('[data-slot="avatar-container"]')!.nextElementSibling!;
      const icon = node.querySelector('.zero-avatar-group-count svg')!;
      return { size: first.getBoundingClientRect().width, margin: getComputedStyle(next).marginInlineStart,
        icon: icon.getBoundingClientRect().width, font: getComputedStyle(first.querySelector('[data-slot="avatar-fallback"]')!).fontSize };
    });
    expect(tokenGeometry).toEqual({ size: 36, margin: '-12px', icon: 18, font: '13px' });
    await page.screenshot({ path: '/Volumes/code-bank/artifacts/zero-platform/diagnostics/avatar-group-light.png', animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: '/Volumes/code-bank/artifacts/zero-platform/diagnostics/avatar-group-dark.png', animations: 'disabled' });
    await page.evaluate(() => window.__avatarGroupFixture.enablePresence(false));
    expect(await group.locator('[data-slot="avatar-presence-indicator"]').count()).toBe(0);
    expect(await group.getByRole('img', { name: 'Ada Lovelace', exact: true }).count()).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('touch does not leave sticky hover tooltips, and reduced motion suppresses lift', async () => {
  const page = await open({ touch: true, reduced: true });
  try {
    const ada = page.getByTestId('primary').getByRole('img', { name: 'Ada Lovelace', exact: true });
    await ada.tap();
    expect(await page.getByRole('tooltip').count()).toBe(0);
    await ada.hover();
    await page.getByRole('tooltip', { name: 'Ada Lovelace', exact: true }).waitFor();
    expect(await ada.evaluate((node) => getComputedStyle(node.parentElement!).transform)).toBe('none');
    await page.setViewportSize({ width: 320, height: 500 });
    await page.evaluate(() => document.documentElement.dir = 'rtl');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await close(page); }
}, 30_000);
