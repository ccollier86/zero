/** Source-level styled reader qualification. No application accounts, database or existing browser state. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Elysia } from 'elysia';
import type { Page } from 'playwright';
import { prepareCodeBlock } from '@zero/framework/components/code-block/server';
import { buildPlatformStyles } from '../../../../src/frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, type PlaywrightTestBrowserLease } from '../../../../src/test-support/playwright-test-browser';
import { DocsApp } from './docs-app';
import { readerFixture } from './docs-app.test';
import { docsCodeOptions } from './code-options';
import type { DocsPageProps } from './types';
import { buildDocsPassages } from '../content/search-passages';
import { searchDocs } from '../server/search';
import type { DocsManifest } from '../content/types';

const TIMEOUT = 60_000;
let lease: PlaywrightTestBrowserLease, directory: string, evidence: string;
let app: ReturnType<typeof serve> | undefined, baseUrl = '';
let props: DocsPageProps;
let searchManifest: DocsManifest;
const failures = new WeakMap<Page, string[]>();

function serve(cssPath: string, html: string, longHtml: string) {
  return new Elysia()
    .get('/reader.js', () => new Response(Bun.file(join(directory, 'reader.js')), { headers: { 'Content-Type': 'text/javascript' } }))
    .get('/reader.css', () => new Response(Bun.file(cssPath), { headers: { 'Content-Type': 'text/css' } }))
    .get('/docs/_api/search', ({ query }) => ({ results: query.q === 'organization' ? [{ route: '/docs/organizations', title: 'Organization apps', excerpt: 'Use Guardian and Fabric together.' }] : searchDocs(searchManifest, query.q ?? '') }))
    .post('/api/_zero/observability/events', () => ({ ok: true }))
    .get('/docs/long', () => new Response(longHtml, { headers: { 'Content-Type': 'text/html' } }))
    .get('/docs/*', () => new Response(html, { headers: { 'Content-Type': 'text/html' } }))
    .listen({ hostname: '127.0.0.1', port: 0 });
}

beforeAll(async () => {
  lease = await acquirePlaywrightTestBrowser();
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform', artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/docs-plugin';
  await mkdir(scratch, { recursive: true }); await mkdir(artifacts, { recursive: true });
  directory = await mkdtemp(join(scratch, 'docs-reader-')); evidence = await mkdtemp(join(artifacts, 'reader-'));
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', 'build', join(import.meta.dir, 'hydrate.tsx'), '--target=browser', '--format=iife', `--outfile=${join(directory, 'reader.js')}`], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (code) throw new Error(`Docs browser fixture could not build: ${stdout}\n${stderr}`);
  const platform = await buildPlatformStyles(directory, join(directory, 'empty-app'), [import.meta.dir]);
  const cssPath = join(directory, 'reader.css');
  await Bun.write(cssPath, await Bun.file(platform.cssPath).text() + '\n' + await Bun.file(join(import.meta.dir, 'docs.css')).text());
  const body = { ...readerFixture.page.body, children: [...readerFixture.page.body.children!,
    { type: 'paragraph' as const, children: [{ type: 'text' as const, value: 'Declare ' }, { type: 'inlineCode' as const, value: 'docs()' }, { type: 'text' as const, value: ' in the existing Zero extension loader.' }] },
    ...Array.from({ length: 12 }, (_, index) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, value: `Step ${index + 1}. Build reusable services with explicit authority and small responsibilities. ` + 'Keep the reading layout calm and focused. '.repeat(8) }] })),
    { type: 'heading' as const, depth: 2, id: 'verify', children: [{ type: 'text' as const, value: 'Verify' }] },
    { type: 'paragraph' as const, children: [{ type: 'text' as const, value: 'Verify the installed package and its documented contracts.' }] }] };
  const node = readerFixture.page.body.children!.find(node => node.type === 'code')!, prepared = await prepareCodeBlock(docsCodeOptions(node, 0));
  const indexed = buildDocsPassages(body);
  props = { ...readerFixture, page: { ...readerFixture.page, ...indexed, headings: [...readerFixture.page.headings, { id: 'verify', text: 'Verify', depth: 2 }] },
    navigation: [...readerFixture.navigation, ...Array.from({ length: 24 }, (_, index) => ({ type: 'page' as const, label: `Reference ${index + 1}`, route: `/docs/reference-${index + 1}` }))], highlights: [prepared.highlighted!] };
  const html = (data: DocsPageProps) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/reader.css"></head><body><div id="zero-docs-root">${renderToStaticMarkup(createElement(DocsApp, data))}</div><script src="/reader.js"></script></body></html>`;
  const longProps = { ...props, next: { route: '/docs/long', title: 'OrganizationSetupAndDeploymentConfiguration'.repeat(6) } };
  searchManifest = { version: 1, basePath: '/docs', hash: 'fixture', pages: [props.page], assets: [], navigation: props.navigation, redirects: [] };
  app = serve(cssPath, html(props), html(longProps)); baseUrl = `http://127.0.0.1:${app.server!.port}`;
}, TIMEOUT);
afterAll(async () => {
  try { await app?.stop(true); if (directory) await rm(directory, { recursive: true, force: true }); }
  finally { lease?.release(); }
}, TIMEOUT);
async function open(width = 1440, dark = false): Promise<Page> {
  const page = await lease.browser.newPage({ viewport: { width, height: 960 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; failures.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat|validat|React|server rendered/iu.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(theme => localStorage.setItem('zero-docs-test', theme), dark ? 'dark' : 'light');
  await page.goto(`${baseUrl}/docs/guide`); await page.getByRole('heading', { name: 'Build an app', exact: true }).waitFor();
  return page;
}

describe('Docs reader actual browser layout and behavior', () => {
  test('search stays within short visual viewports with pinned named input/footer and independently scrolling results', async () => {
    for (const [width, height] of [[640, 360], [390, 400]]) {
      const page = await open(width); try {
        await page.setViewportSize({ width: width!, height: height! });
        await page.route('**/_api/search?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: Array.from({ length: 20 }, (_, index) => ({
          route: `/docs/page-${Math.floor(index / 3)}#section-${index}`, pageRoute: `/docs/page-${Math.floor(index / 3)}`, path: `/docs/page-${Math.floor(index / 3)}`,
          title: `Guide ${Math.floor(index / 3)}`, section: `Result section ${index}`, excerpt: 'A useful passage describing the requested topic in detail.',
        })) }) }));
        await page.keyboard.press('Control+k');
        const dialog = page.getByRole('dialog', { name: 'Search documentation', exact: true });
        const input = dialog.getByRole('combobox', { name: 'Search documentation', exact: true }); await input.fill('topic');
        await dialog.getByText('20 results in 7 pages.').waitFor();
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
        const bounds = await dialog.evaluate(element => {
          const box = element.getBoundingClientRect(), input = element.querySelector('input')!.getBoundingClientRect(), footer = element.querySelector('.zero-docs-search-footer')!.getBoundingClientRect();
          const list = element.querySelector('[cmdk-list]')!;
          return { top: box.top, bottom: box.bottom, right: box.right, inputTop: input.top, footerBottom: footer.bottom, scrolling: list.scrollHeight > list.clientHeight };
        });
        expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(height! + 1); expect(bounds.right).toBeLessThanOrEqual(width! + 1);
        expect(bounds.inputTop).toBeGreaterThanOrEqual(0); expect(bounds.footerBottom).toBeLessThanOrEqual(height!); expect(bounds.scrolling).toBe(true);
        await page.screenshot({ path: join(evidence, `search-${width}-${height}.png`) });
        expect(failures.get(page)).toEqual([]);
      } finally { await page.close(); }
    }
  }, TIMEOUT);
  test('search over a mobile drawer returns focus inside the drawer, while modified navigation leaves it open', async () => {
    const page = await open(390); try {
      await page.getByRole('button', { name: 'Open documentation navigation' }).click();
      const close = page.getByRole('button', { name: 'Close documentation navigation' }); await close.focus();
      await page.keyboard.press('Control+k');
      const search = page.getByRole('dialog', { name: 'Search documentation', exact: true }); await search.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'combobox');
      await page.keyboard.press('Escape'); await search.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close documentation navigation');
      const link = page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link', { name: 'Build an app', exact: true });
      const modifier = await page.evaluate(() => navigator.platform.includes('Mac') ? 'Meta' as const : 'Control' as const);
      const popup = page.waitForEvent('popup'); await link.click({ modifiers: [modifier] }); const child = await popup;
      try { await child.waitForLoadState(); } finally { await child.close(); }
      expect(await close.isVisible()).toBe(true);
      await close.click(); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open documentation navigation');
      expect(failures.get(page)).toEqual([]);
    } finally { await page.close(); }
  }, TIMEOUT);
  test('selecting a same-page result from mobile navigation releases both modals before landing', async () => {
    const page = await open(390); try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Open documentation navigation' }).click();
      await page.getByRole('button', { name: 'Close documentation navigation' }).focus();
      await page.keyboard.press('Control+k');
      const search = page.getByRole('dialog', { name: 'Search documentation', exact: true }), input = search.getByRole('combobox');
      await input.fill('Zero'); await search.getByRole('option', { name: /Setup const app/ }).waitFor();
      await page.waitForFunction(() => !!document.querySelector('[cmdk-item][aria-selected="true"]'));
      await input.press('Enter');
      await page.getByRole('button', { name: 'Clear highlights' }).waitFor();
      expect(await page.getByRole('dialog').count()).toBe(0);
      expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-docs-search-target'))).toBe(true);
      expect(await page.locator('main').getAttribute('aria-hidden')).toBeNull();
      expect(failures.get(page)).toEqual([]);
    } finally { await page.close(); }
  }, TIMEOUT);
  test('section results are native links; same-page keyboard activation lands on code without reload or syntax mutations', async () => {
    const page = await open(); try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => { (window as Window & { docsSentinel?: number }).docsSentinel = 42; });
      const before = await page.locator('.shiki').innerHTML();
      await page.keyboard.press('Control+k');
      const dialog = page.getByRole('dialog', { name: 'Search documentation', exact: true }), input = dialog.getByRole('combobox', { name: 'Search documentation', exact: true });
      await input.fill('Zero'); const result = dialog.getByRole('option', { name: /Setup const app/ }); await result.waitFor();
      expect(await result.evaluate(element => element.tagName)).toBe('A'); expect(await result.getAttribute('href')).toBe('/docs/guide#setup');
      expect(await result.locator('mark').count()).toBeGreaterThan(0);
      await page.waitForFunction(() => !!document.querySelector('[cmdk-item][aria-selected="true"]'));
      await input.press('Enter'); await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Clear highlights' }).waitFor();
      expect(page.url()).toBe(`${baseUrl}/docs/guide#setup`);
      expect(await page.evaluate(() => (window as Window & { docsSentinel?: number }).docsSentinel)).toBe(42);
      expect(await page.locator('.shiki').innerHTML()).toBe(before);
      expect(await page.locator('[data-docs-search-target] .shiki').count()).toBe(1);
      expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-docs-search-target'))).toBe(true);
      expect(await page.evaluate(() => (CSS as typeof CSS & { highlights: Map<string, Set<Range>> }).highlights.get('zero-docs-search')?.size)).toBeGreaterThan(0);
      await page.screenshot({ path: join(evidence, 'search-passage-landing.png') });
      await page.getByRole('button', { name: 'Clear highlights' }).click();
      expect(await page.locator('[data-docs-search-target]').count()).toBe(0);
      expect(await page.evaluate(() => (CSS as typeof CSS & { highlights: Map<string, Set<Range>> }).highlights.has('zero-docs-search'))).toBe(false);
      expect(failures.get(page)).toEqual([]);
    } finally { await page.close(); }
  }, TIMEOUT);
  test('Ctrl+Enter opens the selected canonical result in a new tab without leaking search terms or closing the palette', async () => {
    const page = await open(); try {
      await page.keyboard.press('Control+k'); const dialog = page.getByRole('dialog', { name: 'Search documentation', exact: true });
      const input = dialog.getByRole('combobox'); await input.fill('Zero'); await dialog.getByRole('option', { name: /Setup const app/ }).waitFor();
      await page.waitForFunction(() => !!document.querySelector('[cmdk-item][aria-selected="true"]'));
      const popup = page.waitForEvent('popup'); await input.press('Control+Enter'); const child = await popup;
      try { await child.waitForLoadState(); expect(child.url()).toBe(`${baseUrl}/docs/guide#setup`); }
      finally { await child.close(); }
      expect(await dialog.isVisible()).toBe(true); expect(page.url()).toBe(`${baseUrl}/docs/guide`);
      expect(await page.evaluate(() => sessionStorage.getItem('zero-docs-search:/docs'))).toBeNull();
    } finally { await page.close(); }
  }, TIMEOUT);
  test('desktop and mobile light/dark render bounded reading surfaces, code and nested guide rails', async () => {
    for (const width of [1440, 390]) for (const dark of [false, true]) {
      const page = await open(width, dark); const errors = failures.get(page)!;
      try {
        const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth,
          code: !!document.querySelector('.shiki:not(.zero-code-block-fallback)'),
          background: getComputedStyle(document.querySelector('.zero-docs')!).backgroundColor,
          expected: getComputedStyle(document.documentElement).getPropertyValue('--public-background'),
          rail: document.querySelector('.zero-docs-nav-children') ? getComputedStyle(document.querySelector('.zero-docs-nav-children')!).borderLeftWidth : null,
          radius: document.querySelector('.zero-docs-nav-link') ? getComputedStyle(document.querySelector('.zero-docs-nav-link')!).borderTopLeftRadius : null,
          callout: getComputedStyle(document.querySelector('.zero-docs-callout')!).backgroundColor,
          tone: getComputedStyle(document.querySelector('.zero-docs-callout')!).getPropertyValue('--zero-docs-callout-tone'),
          mobileSearch: document.querySelector('.zero-docs-search-trigger')!.getBoundingClientRect().right,
          themeLeft: document.querySelector('.zero-docs-theme')!.getBoundingClientRect().left }));
        expect(layout.overflow).toBe(false); expect(layout.code).toBe(true); expect(layout.background).not.toBe('rgba(0, 0, 0, 0)');
        if (width > 768) { expect(layout.rail).toBe('1px'); expect(layout.radius).not.toBe('0px'); }
        if (width < 768) expect(layout.mobileSearch).toBeLessThanOrEqual(layout.themeLeft);
        expect(errors).toEqual([]); await Bun.write(join(evidence, `${width}-${dark ? 'dark' : 'light'}.json`), JSON.stringify(layout));
        expect(await page.getByRole('navigation', { name: 'Previous and next pages' }).getByRole('link', { name: 'Next page Organization apps' }).getAttribute('href')).toBe('/docs/organizations');
        await page.screenshot({ path: join(evidence, `${width}-${dark ? 'dark' : 'light'}.png`), fullPage: false });
      } finally { await page.close(); }
    }
  }, TIMEOUT);
  test('navigation scrolls independently, footer has actual page names, TOC follows the reading position', async () => {
    const page = await open(); try {
      const state = await page.locator('.zero-docs-nav-scroll').evaluate(element => ({ scroll: element.scrollHeight, height: element.clientHeight }));
      expect(state.scroll).toBeGreaterThan(state.height);
      await page.locator('.zero-docs-nav-scroll').evaluate(element => { element.scrollTop = 400; }); expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await page.getByRole('complementary', { name: 'On this page' }).getByRole('link', { name: 'Verify', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.zero-docs-toc a[aria-current=location]')?.textContent === 'Verify');
      expect(await page.locator('#verify').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(40);
      await page.screenshot({ path: join(evidence, 'desktop-footer.png'), fullPage: false });
    } finally { await page.close(); }
  }, TIMEOUT);
  test('command search supports keyboard opening, server-ranked results, retry, stale-query cancellation and focus return', async () => {
    const page = await open(); try {
      await page.keyboard.press('Control+k'); const dialog = page.getByRole('dialog', { name: 'Search documentation', exact: true }); await dialog.waitFor();
      const input = dialog.getByRole('combobox'); await input.fill('organization');
      await dialog.getByRole('option', { name: 'Organization apps Use Guardian and Fabric together.' }).waitFor();
      await input.fill('no-match'); await dialog.getByText('No matching pages. Try a different phrase.').waitFor();
      await page.route('**/_api/search?*', route => route.fulfill({ status: 503, body: '{}' }));
      await input.fill('retry'); await dialog.getByRole('alert').waitFor();
      expect(await dialog.getByRole('button', { name: 'Try again' }).isEnabled()).toBe(true);
      await page.unroute('**/_api/search?*'); await dialog.getByRole('button', { name: 'Try again' }).click();
      await dialog.getByText('No matching pages. Try a different phrase.').waitFor();
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Search documentation', exact: true }).click(); await dialog.waitFor();
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search documentation');
    } finally { await page.close(); }
  }, TIMEOUT);
  test('mobile navigation has a deliberate close/return, reduced-motion and theme controls remain reachable', async () => {
    const page = await open(390); try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Open documentation navigation' }).click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      expect(await dialog.getByRole('navigation', { name: 'Documentation', exact: true }).isVisible()).toBe(true);
      expect(await dialog.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number(animation.effect?.getTiming().duration) > 0).map(animation => animation.effect?.getTiming().duration))).toEqual([]);
      await dialog.getByRole('button', { name: 'Close documentation navigation' }).click(); await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open documentation navigation');
      await page.getByRole('button', { name: 'Open documentation navigation' }).click(); await dialog.waitFor();
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open documentation navigation');
      await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
      await page.getByRole('dialog', { name: 'Search documentation', exact: true }).waitFor();
      expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number(animation.effect?.getTiming().duration) > 0).map(animation => animation.effect?.getTiming().duration))).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
      expect(await page.evaluate(() => localStorage.getItem('zero-docs-test'))).toBe('dark');
    } finally { await page.close(); }
  }, TIMEOUT);
  test('a deliberately delayed obsolete search cannot replace the newer query results', async () => {
    const page = await open(); let releaseOld: (() => void) | undefined;
    try {
      let announceOld!: () => void; const oldStarted = new Promise<void>(resolve => { announceOld = resolve; });
      let announceComplete!: () => void; const oldComplete = new Promise<void>(resolve => { announceComplete = resolve; });
      await page.route('**/_api/search?*', async route => {
        if (new URL(route.request().url()).searchParams.get('q') !== 'obsolete') { await route.continue(); return; }
        announceOld(); await new Promise<void>(resolve => { releaseOld = resolve; });
        try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ route: '/docs/old', title: 'Obsolete page', excerpt: 'Never replace the newer query.' }] }) }); }
        catch { /* Browser cancellation may retire the old HTTP request before fulfillment. */ }
        finally { announceComplete(); }
      });
      await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Search documentation' }), input = dialog.getByRole('combobox');
      await input.fill('obsolete'); await oldStarted; await input.fill('organization');
      await dialog.getByRole('option', { name: 'Organization apps Use Guardian and Fabric together.' }).waitFor();
      releaseOld!(); await oldComplete;
      expect(await dialog.getByRole('option', { name: 'Obsolete page Never replace the newer query.' }).count()).toBe(0);
      expect(await dialog.getByRole('option', { name: 'Organization apps Use Guardian and Fabric together.' }).count()).toBe(1);
    } finally { releaseOld?.(); await page.close(); }
  }, TIMEOUT);
  test('long unbroken footer titles stay inside their tracks at narrow and desktop widths', async () => {
    for (const width of [320, 768, 1440]) {
      const page = await open(width); try {
        await page.goto(`${baseUrl}/docs/long`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
        const link = page.getByRole('link', { name: 'Next page ' + 'OrganizationSetupAndDeploymentConfiguration'.repeat(6) });
        const bounds = await link.evaluate(element => ({ link: element.getBoundingClientRect().width, parent: element.parentElement!.getBoundingClientRect().width }));
        expect(bounds.link).toBeLessThanOrEqual(bounds.parent + 1);
      } finally { await page.close(); }
    }
  }, TIMEOUT);
  test('article navigation, headings and colored examples work with JavaScript disabled', async () => {
    const page = await lease.browser.newPage({ javaScriptEnabled: false, viewport: { width: 1440, height: 960 } }); try {
      await page.goto(`${baseUrl}/docs/guide`);
      expect(await page.getByRole('heading', { name: 'Build an app', exact: true }).isVisible()).toBe(true);
      expect(await page.locator('pre').innerText()).toContain('const app =');
      expect(await page.locator('.shiki:not(.zero-code-block-fallback)').count()).toBe(1);
      expect(await page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link', { name: 'Build an app', exact: true }).isVisible()).toBe(true);
    } finally { await page.close(); }
  }, TIMEOUT);
});
