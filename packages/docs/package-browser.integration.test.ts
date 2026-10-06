/** Opt-in browser qualification of the real installed/compiled reader, not a source fixture. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { acquirePlaywrightTestBrowser, type PlaywrightTestBrowserLease } from '../../src/test-support/playwright-test-browser';

const target = Bun.env.ZERO_DOCS_INSTALLED_BROWSER_URL;
const suite = target ? describe : describe.skip;
const TIMEOUT = 60_000;
let lease: PlaywrightTestBrowserLease, evidence = '';
const failures = new WeakMap<Page, string[]>();

suite('installed compiled DocsApp browser boundary', () => {
  beforeAll(async () => {
    const url = new URL(target!);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('This gate only accepts its isolated loopback fixture');
    lease = await acquirePlaywrightTestBrowser();
    const root = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/docs-plugin';
    await mkdir(root, { recursive: true }); evidence = await mkdtemp(join(root, 'compiled-browser-'));
  }, TIMEOUT);
  afterAll(() => lease?.release());

  async function open(width = 1440, dark = false) {
    const context = await lease.browser.newContext({ viewport: { width, height: 960 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const errors: string[] = []; failures.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), dark ? 'dark' : 'light');
    const response = await page.goto(target!);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self' 'nonce-");
    await page.getByRole('heading', { name: 'Installed reader', exact: true }).waitFor();
    await page.getByRole('button', { name: dark ? 'Switch to system theme' : 'Switch to dark theme' }).waitFor();
    return { page, context };
  }

  test('emitted ESM hydrates under nonce CSP with saved themes, bounded layouts and prepared code', async () => {
    for (const width of [1440, 390]) for (const dark of [false, true]) {
      const { page, context } = await open(width, dark);
      try {
        await page.waitForFunction(expected => document.documentElement.classList.contains('dark') === expected, dark);
        const layout = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
          highlighted: Boolean(document.querySelector('.shiki:not(.zero-code-block-fallback)')),
          esm: [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map(script => ({ type: script.type, src: script.getAttribute('src') })),
          image: [...document.images].every(image => image.complete && image.naturalWidth > 0),
          codeLine: document.querySelector('.zero-code-block-line-highlighted')?.textContent }));
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width); expect(layout.highlighted).toBe(true); expect(layout.image).toBe(true);
        expect(layout.esm.some(script => script.type === 'module' && script.src?.startsWith('/_build/plugins/'))).toBe(true);
        expect(failures.get(page)).toEqual([]);
        await Bun.write(join(evidence, `${width}-${dark ? 'dark' : 'light'}.json`), JSON.stringify(layout));
        await page.screenshot({ path: join(evidence, `${width}-${dark ? 'dark' : 'light'}.png`), fullPage: false });
      } finally { await context.close(); }
    }
  }, TIMEOUT);

  test('keyboard search reaches server-ranked pages and the installed footer navigates', async () => {
    const { page, context } = await open();
    try {
      await page.keyboard.press('Control+k');
      const dialog = page.getByRole('dialog', { name: 'Search documentation', exact: true }); await dialog.waitFor();
      await dialog.getByRole('combobox').fill('integration');
      await dialog.getByRole('option', { name: /Details Public package integration details/ }).waitFor();
      await dialog.getByRole('combobox').press('Enter');
      await page.waitForURL('**/docs/guides/start#details');
      await page.getByRole('heading', { name: 'Start', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Clear highlights' }).waitFor();
      expect(await page.locator('[data-docs-search-target]').innerText()).toContain('Public package integration details.');
      expect(new URL(page.url()).search).toBe('');
      expect(failures.get(page)).toEqual([]);
      const previous = page.getByRole('navigation', { name: 'Previous and next pages' }).getByRole('link', { name: 'Previous page Guides' });
      await previous.click(); await page.getByRole('heading', { name: 'Guides', exact: true }).waitFor();
      expect(new URL(page.url()).pathname).toBe('/docs/guides');
    } finally { await context.close(); }
  }, TIMEOUT);

  test('mobile navigation and search restore focus and honor actual reduced motion', async () => {
    const { page, context } = await open(390);
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Open documentation navigation' }).click();
      const navigation = page.getByRole('dialog'); await navigation.waitFor();
      expect(await navigation.getByRole('navigation', { name: 'Documentation', exact: true }).isVisible()).toBe(true);
      expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number(animation.effect?.getTiming().duration) > 0).length)).toBe(0);
      await navigation.getByRole('button', { name: 'Close documentation navigation' }).click(); await navigation.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open documentation navigation');
      await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
      const search = page.getByRole('dialog', { name: 'Search documentation', exact: true }); await search.waitFor();
      expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number(animation.effect?.getTiming().duration) > 0).length)).toBe(0);
      await page.keyboard.press('Escape'); await search.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search documentation');
      expect(failures.get(page)).toEqual([]);
      await page.screenshot({ path: join(evidence, 'mobile-closed.png'), fullPage: false });
    } finally { await context.close(); }
  }, TIMEOUT);

  test('shared CodeBlock and page-copy controls copy canonical content from the compiled reader', async () => {
    const { page, context } = await open();
    try {
      await page.getByRole('button', { name: 'Copy code', exact: true }).click();
      await page.getByRole('button', { name: 'Code copied', exact: true }).waitFor();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const installed = true;');
      await page.getByRole('button', { name: 'Copy page as Markdown', exact: true }).click();
      await page.getByRole('button', { name: 'Markdown copied', exact: true }).waitFor();
      const markdown = await page.evaluate(() => navigator.clipboard.readText());
      expect(markdown).toContain('/docs/guides/start#details'); expect(markdown).not.toContain('PRIVATE_INSTALLED');
      expect(failures.get(page)).toEqual([]);
    } finally { await context.close(); }
  }, TIMEOUT);

  test('the installed HTML remains a readable highlighted document without JavaScript', async () => {
    const page = await lease.browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 960 } });
    try {
      await page.goto(target!);
      expect(await page.getByRole('heading', { name: 'Installed reader', exact: true }).isVisible()).toBe(true);
      expect(await page.locator('.shiki:not(.zero-code-block-fallback)').count()).toBe(1);
      await page.getByText('Browse documentation', { exact: true }).click();
      expect(await page.getByRole('navigation', { name: 'Documentation without JavaScript' }).getByRole('link', { name: 'Start', exact: true }).isVisible()).toBe(true);
    } finally { await page.close(); }
    await Bun.write(join(evidence, 'target.json'), JSON.stringify({ target, evidence, sourceMode: 'installed compiled no-source/no-node_modules', checkedAt: new Date().toISOString() }));
  }, TIMEOUT);
});
