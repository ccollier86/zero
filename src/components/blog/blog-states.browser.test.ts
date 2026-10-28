/** Real native surfaces, CSS, input ownership and public request lifetimes; no external services. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import type { Page } from 'playwright';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/messaging-support-review/blog-states';
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '', server: ReturnType<typeof Bun.serve> | undefined;
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-states-');
  try {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/blog-states.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
    script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(root, `${root}/absent`, [], { themeFoundation: 'next' })).cssPath).text();
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(root, { recursive: true, force: true }); }
  await mkdir(evidence, { recursive: true }); lease = await acquirePlaywrightTestBrowser();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
    if (path === '/fixture.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } });
    if (path === '/cover.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#728279"/></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
    if (path !== '/') return new Response(null, { status: 404 });
    return new Response('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } });
}, 60_000);
afterAll(async () => { await server?.stop(true); await lease?.release(); });
async function mount(width = 1440, reduced = true): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width, height: 960 }, reducedMotion: reduced ? 'reduce' : 'no-preference' }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === server!.url.origin ? route.continue() : route.abort());
  await page.goto(server!.url.href); await page.getByTestId('blog-state-fixture').waitFor(); return page;
}
browserTest('zero/one/two/three/many magazine states stay deliberate, unique, responsive and reduced-motion safe', async () => {
  const page = await mount();
  try {
    for (const count of [0, 1, 2, 3, 4, 12]) {
      await page.getByRole('button', { name: `${count} articles`, exact: true }).click();
      const cards = page.locator('.zero-blog-list .zero-blog-card');
      await page.waitForFunction(expected => document.querySelectorAll('.zero-blog-list .zero-blog-card').length === expected, Math.min(count, 9));
      expect(await cards.count()).toBe(Math.min(count, 9));
      const hrefs = await cards.locator('h3 a').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
      expect(new Set(hrefs).size).toBe(hrefs.length);
      if (count > 0 && count < 4) expect(await page.locator('.zero-blog-all-posts').count()).toBe(0);
      if (!count) await page.getByText('No articles yet', { exact: true }).waitFor();
      if (count === 1 || count === 2) {
        await page.screenshot({ path: `${evidence}/magazine-${count}-light.png`, fullPage: false });
        const widths = await cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
      }
    }
    await page.getByRole('button', { name: 'Toggle dark', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${evidence}/magazine-mobile-dark.png`, fullPage: false });
    await page.getByRole('button', { name: 'Set loading', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Loading articles' }).waitFor();
    expect(await page.locator('.zero-blog-card').count()).toBe(0);
    expect(await page.locator('.zero-blog-skeleton').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    expect(await page.locator('.zero-blog-list').textContent()).not.toContain('0 articles');
    await page.screenshot({ path: `${evidence}/loading-mobile-dark.png`, fullPage: false });
  } finally { await page.close(); }
}, 35_000);
browserTest('list filters can clear and actual retrieval failure can retry without a false empty state', async () => {
  const page = await mount();
  try {
    const input = page.getByRole('searchbox'); await input.fill('missing'); await page.getByText('No matching articles', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Show all articles', exact: true }).click(); expect(await input.inputValue()).toBe('');
    await page.getByRole('button', { name: 'Set error', exact: true }).click(); await page.getByRole('alert').waitFor();
    expect(await page.locator('.zero-blog-list').textContent()).not.toContain('No articles yet');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('.zero-blog-card').waitFor(); expect(await page.getByTestId('retries').textContent()).toBe('1');
  } finally { await page.close(); }
}, 25_000);
browserTest('default composed search inherits its failed source rather than offering stale article choices', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show list palette', exact: true }).click();
    await page.getByRole('button', { name: 'Set error', exact: true }).click();
    await page.getByRole('button', { name: 'Search articles', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search articles', exact: true });
    await dialog.getByRole('alert').waitFor(); expect(await dialog.getByRole('option').count()).toBe(0);
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
    await dialog.getByRole('option', { name: /Considered story 1/ }).waitFor();
    expect(await page.getByTestId('retries').textContent()).toBe('1');
  } finally { await page.close(); }
}, 25_000);
browserTest('anchored and palette searches keep query ownership and distinguish empty, missing, loading and retry', async () => {
  const page = await mount(390);
  try {
    await page.getByRole('button', { name: '0 articles', exact: true }).click(); await page.getByRole('button', { name: 'Show dropdown', exact: true }).click();
    const input = page.getByRole('combobox', { name: 'Search articles', exact: true }); await input.focus();
    await page.getByText('No articles yet', { exact: true }).waitFor(); await input.fill('missing');
    await page.getByText('No matching articles', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Clear search', exact: true }).click(); expect(await input.inputValue()).toBe('');
    await input.press('Escape'); await page.getByRole('button', { name: '1 articles', exact: true }).click();
    await page.getByRole('button', { name: 'Set loading', exact: true }).click(); await input.fill('considered');
    await page.getByRole('status').filter({ hasText: 'Searching articles' }).waitFor(); expect(await page.getByRole('option').count()).toBe(0);
    await input.press('Escape'); await page.getByRole('button', { name: 'Set error', exact: true }).click(); await input.focus();
    await page.getByRole('alert').waitFor(); expect(await input.inputValue()).toBe('considered');
    await page.getByRole('button', { name: 'Try again', exact: true }).click(); await page.getByRole('option').waitFor();
    await input.press('ArrowDown'); await input.press('Enter'); expect(await page.getByTestId('selection').textContent()).toBe('p0');
    await page.getByRole('button', { name: 'Show palette', exact: true }).click(); await page.getByRole('button', { name: 'Search articles', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search articles', exact: true }); const command = dialog.getByRole('combobox');
    await command.fill('missing'); await dialog.getByText('No matching results', { exact: true }).waitFor();
    // A background source update must not reset the uncontrolled command input.
    await page.evaluate(() => (document.querySelector('[aria-label="Synthetic fixture controls"] button') as HTMLButtonElement).click());
    expect(await command.inputValue()).toBe('missing');
    await command.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Search articles', exact: true }).click(); expect(await dialog.getByRole('combobox').inputValue()).toBe('');
  } finally { await page.close(); }
}, 35_000);
function summary(id: string, title: string) { return { id, siteId: 'default', publicRevision: 1, publishedAt: 1780000000000, updatedAt: 1780000000000,
  title, slug: id, excerpt: 'Published synthetic search result.', authorId: 'writer', author: { id: 'writer', name: 'Writer' }, featuredImage: null, categoryIds: [], tagIds: [] }; }
browserTest('public search rejects stale responses and retries the identical current query through the native facade', async () => {
  const page = await mount(); let releaseSlow: (() => void) | undefined, sawSlow: (() => void) | undefined;
  const slowSeen = new Promise<void>(resolve => { sawSlow = resolve; }), held = new Promise<void>(resolve => { releaseSlow = resolve; });
  const requests: string[] = []; let failures = 0;
  await page.route('**/api/blog/public/default/posts?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('search')!; requests.push(query);
    if (query === 'slow') { sawSlow?.(); await held; }
    if (query === 'retry' && failures++ === 0) return route.fulfill({ status: 503, body: 'PRIVATE_TRANSPORT_DETAIL' });
    const body = JSON.stringify({ items: query === 'none' ? [] : [summary(query, `${query} result`)], total: query === 'none' ? 0 : 1, limit: 20, offset: 0, hasMore: false });
    try { await route.fulfill({ contentType: 'application/json', body }); } catch { /* The old native request may already have been aborted. */ }
  });
  try {
    await page.getByRole('button', { name: 'Show remote', exact: true }).click(); await page.getByRole('button', { name: 'Search articles', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search articles', exact: true }), input = dialog.getByRole('combobox');
    await input.fill('slow'); await slowSeen; expect(await dialog.getByRole('option').count()).toBe(0);
    await input.fill('fast'); await dialog.getByRole('option', { name: /fast result/ }).waitFor(); releaseSlow?.();
    expect(await dialog.getByRole('option', { name: /slow result/ }).count()).toBe(0);
    await input.fill('retry'); await dialog.getByRole('alert').waitFor(); expect(await dialog.textContent()).not.toContain('PRIVATE_TRANSPORT_DETAIL');
    expect(await input.inputValue()).toBe('retry'); expect(await dialog.getByRole('option').count()).toBe(0);
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click(); await dialog.getByRole('option', { name: /retry result/ }).waitFor();
    expect(requests.filter(query => query === 'retry')).toHaveLength(2);
    await input.fill('none'); await dialog.getByText('No matching results', { exact: true }).waitFor();
    expect(await dialog.getByRole('alert').count()).toBe(0); await dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
    expect(await input.inputValue()).toBe(''); await dialog.getByRole('option', { name: /Considered story 1/ }).waitFor();
  } finally { releaseSlow?.(); await page.close(); }
}, 35_000);
