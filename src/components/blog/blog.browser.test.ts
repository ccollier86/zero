/** Real compiled Zero controls, shared modal ownership and token/viewport contracts; no backend or external requests. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-ui';
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-ui-');
  try {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/blog.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
    script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(root, `${root}/absent`, [], { themeFoundation: 'next' })).cssPath).text();
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(root, { recursive: true, force: true }); }
  await mkdir(evidence, { recursive: true }); lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function mount(width = 1440, reduced = true): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width, height: 960 }, reducedMotion: reduced ? 'reduce' : 'no-preference' }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => route.request().url().endsWith('/cover.svg') ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#536889"/><circle cx="760" cy="280" r="210" fill="#8296b3"/></svg>' }) : route.abort());
  await page.setContent('<!doctype html><html><head><base href="http://zero-blog.test/"></head><body><div id="root"></div></body></html>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('blog-fixture').waitFor(); return page;
}
browserTest('Magazine defaults, scoped overrides, local filters, pagination and bounded layouts', async () => {
  const page = await mount();
  try {
    expect(await page.locator('.zero-blog-list').getAttribute('data-variant')).toBe('magazine');
    expect(await page.locator('.zero-blog-recent-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>('.zero-blog-card-media img'); return image?.complete && image.naturalWidth > 0; });
    await page.addStyleTag({ content: '.fixture-toolbar{display:none!important}' });
    await page.screenshot({ path: `${evidence}/magazine-light.png`, fullPage: false });
    const filter = page.getByRole('group', { name: 'Article categories', exact: true });
    await filter.getByRole('button', { name: 'Design', exact: true }).click();
    expect(await page.locator('.zero-blog-all-posts .zero-blog-card').count()).toBe(9);
    expect(await filter.getByRole('button', { name: 'Design', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await page.getByRole('button', { name: 'All articles', exact: true }).click();
    await page.getByRole('link', { name: 'Page 2', exact: true }).click();
    expect(await page.getByRole('link', { name: 'Page 2', exact: true }).getAttribute('aria-current')).toBe('page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.close(); }
}, 25_000);
browserTest('rich search uses the shared manager, groups, magnetic highlight and keyboard selection', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Search articles', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search articles', exact: true }); await dialog.waitFor();
    expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    await dialog.getByRole('combobox').fill('@Avery');
    await dialog.getByRole('option', { name: /Avery Brooks/ }).waitFor();
    await dialog.getByRole('combobox').press('ArrowDown'); await dialog.getByRole('combobox').press('Enter');
    await dialog.waitFor({ state: 'detached' }); expect(await page.getByTestId('selection').textContent()).toBe('avery');
    await page.getByRole('button', { name: 'Search articles', exact: true }).click(); await dialog.waitFor();
    await page.addStyleTag({ content: '.fixture-toolbar,[data-testid="selection"]{visibility:hidden!important}' });
    await page.screenshot({ path: `${evidence}/rich-search.png`, fullPage: false });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search articles');
  } finally { await page.close(); }
}, 25_000);
browserTest('article defaults auto TOC, real ScrollArea, inherited type and origin-managed image preview', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show article', exact: true }).click();
    expect(await page.locator('.zero-blog-post').getAttribute('data-variant')).toBe('with-sidebar');
    await page.locator('.zero-blog-article-sidebar a[href="#introduction"]').waitFor();
    expect(await page.locator('.zero-blog-hero h1').evaluate(element => getComputedStyle(element).fontSize)).toBe('60px');
    await page.addStyleTag({ content: '.fixture-toolbar{display:none!important}' });
    expect(await page.locator('.zero-blog-prose').evaluate(element => getComputedStyle(element).fontSize)).toBe('19px');
    expect(await page.locator('.zero-blog-article-sidebar [data-slot="scroll-area"]').count()).toBe(1);
    expect(await page.locator('.zero-blog-article-sidebar [data-radix-scroll-area-viewport]').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.locator('.zero-blog-article-body').evaluate(element => element.scrollIntoView());
    await page.screenshot({ path: `${evidence}/article-sidebar.png`, fullPage: false });
    await page.getByRole('button', { name: 'Expand Editorial detail', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'A shared managed lightbox', exact: true }); await dialog.waitFor();
    expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click(); expect(await dialog.locator('output').textContent()).toBe('150%');
    expect(await dialog.locator('[data-radix-scroll-area-viewport]').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Expand Editorial detail');
  } finally { await page.close(); }
}, 25_000);
browserTest('mobile/dark inherit the app, preserve readable layout and obey reduced motion', async () => {
  const page = await mount(390);
  try {
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.getByRole('button', { name: 'Show article', exact: true }).click();
    expect(await page.locator('.zero-blog-article-sidebar').isVisible()).toBe(false);
    expect(await page.locator('.zero-blog-inline-toc').isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.zero-blog-post').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--zero-blog-duration-enter')))).toBe(0);
    await page.addStyleTag({ content: '.fixture-toolbar{display:none!important}' });
    await page.screenshot({ path: `${evidence}/article-mobile-dark.png`, fullPage: false });
  } finally { await page.close(); }
}, 25_000);
browserTest('generic commands keep failures local and retryable without exposing exception content', async () => {
  const page = await mount();
  try {
    await page.getByRole('checkbox', { name: 'Fail command', exact: true }).check(); await page.getByRole('button', { name: 'App commands', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'App commands', exact: true }); await dialog.waitFor();
    expect(await dialog.evaluate(element => getComputedStyle(element).width)).toBe('576px');
    await dialog.getByRole('option', { name: /Open billing/ }).click(); await dialog.getByRole('alert').waitFor();
    expect(await dialog.textContent()).not.toContain('PRIVATE_COMMAND_ERROR'); expect(await dialog.getByRole('combobox').isEnabled()).toBe(true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 25_000);
browserTest('blog search awaits rejected callbacks and retains a retryable managed opening', async () => {
  const page = await mount();
  try {
    await page.getByRole('checkbox', { name: 'Fail command', exact: true }).check();
    await page.getByRole('button', { name: 'Search articles', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search articles', exact: true }); await dialog.waitFor();
    await dialog.getByRole('option').first().click(); await dialog.getByRole('alert').waitFor();
    expect(await dialog.textContent()).not.toContain('PRIVATE_BLOG_ERROR');
    expect(await dialog.getByRole('combobox').isEnabled()).toBe(true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.getByRole('checkbox', { name: 'Fail command', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Search articles', exact: true }).click(); await dialog.waitFor();
    await dialog.getByRole('option').first().click(); await dialog.waitFor({ state: 'detached' });
    expect(await page.getByTestId('selection').textContent()).toBe('post-0');
  } finally { await page.close(); }
}, 25_000);
