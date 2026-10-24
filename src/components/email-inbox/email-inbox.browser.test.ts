/** Synthetic, local-only proof of the real inbox and HTML security boundary. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const faults: string[] = [];
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'zero-email-browser-'));
  try {
    const styles = await buildPlatformStyles(directory, join(directory, 'absent-app')); css = await Bun.file(styles.cssPath).text();
    // Isolate browser resolution from Bun test's already-loaded server graph.
    const compile = Bun.spawn([process.execPath, '--no-env-file', 'build', `${import.meta.dir}/email-inbox.browser-fixture.tsx`, '--target=browser', '--format=iife', '--define', 'process.env.NODE_ENV="test"', '--outdir', directory], { stdout: 'pipe', stderr: 'pipe' });
    const [exit, stderr] = await Promise.all([compile.exited, new Response(compile.stderr).text()]);
    if (exit) throw new Error(stderr);
    bundle = await Bun.file(join(directory, 'email-inbox.browser-fixture.js')).text();
    const componentCss = Bun.file(join(directory, 'email-inbox.browser-fixture.css')); if (await componentCss.exists()) css += '\n' + await componentCss.text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => { lease?.release(); expect(faults).toEqual([]); });

async function mount(width = 1440, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(8_000);
  page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('https://zero-email.invalid/')
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' }) : route.abort());
  await page.goto('https://zero-email.invalid/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  try { await page.getByRole('listitem').first().waitFor(); }
  catch (error) { console.error('Inbox mount failed:', await page.locator('body').innerText(), faults); await screenshot(page, 'mount-failure'); await page.close(); throw error; }
  if (width < 500) await screenshot(page, 'mobile-inbox');
  if (process.env.EMAIL_INBOX_LAYOUT_DEBUG) console.log(await page.evaluate(() => {
    const values = (element: Element | null) => { if (!element) return null; const e = element as HTMLElement, r = e.getBoundingClientRect(), s = getComputedStyle(e); return { slot: e.dataset.slot, tag: e.tagName, class: e.className, width: r.width, height: r.height, top: r.top, scroll: e.scrollHeight, display: s.display, flex: s.flex, minHeight: s.minHeight, style: e.getAttribute('style') }; };
    const section = document.querySelector('[data-slot="email-inbox"]'); return { viewport: innerWidth, inbox: values(section), parent: values(section?.parentElement ?? null), grandparent: values(section?.parentElement?.parentElement ?? null), group: values(section?.querySelector('[data-slot="resizable-panel-group"]') ?? null), panels: [...(section?.querySelectorAll('[data-slot="resizable-panel"]') ?? [])].map(values), scroll: values(document.querySelector('.zero-email-message-list [data-radix-scroll-area-viewport]')) };
  })); return page;
}
async function screenshot(page: Page, name: string) {
  const directory = process.env.EMAIL_INBOX_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
}
browserTest('bounded desktop panes, isolated newsletter, no passive network, and scoped image consent', async () => {
  const page = await mount(); const requests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('https://zero-email.invalid/')) requests.push(request.url()); });
  try {
    await screenshot(page, 'desktop-empty');
    const first = page.locator('[data-email-row-open]').first(); await first.click();
    const frame = page.frameLocator('iframe[title="Email content"]');
    await frame.getByText('coming together.', { exact: false }).waitFor();
    expect(await frame.locator('table').count()).toBeGreaterThan(0);
    expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-same-origin');
    expect(await frame.locator('script,form,iframe,object,svg').count()).toBe(0);
    expect(await frame.locator('img[src^="http"]').count()).toBe(0);
    expect(requests).toEqual([]);
    await page.waitForFunction(() => (document.querySelector('iframe')?.clientHeight ?? 0) > 250);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(901);
    await screenshot(page, 'desktop-reader');
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click(); await screenshot(page, 'dark-reader');
    const imageRequest = page.waitForRequest('https://tracker.invalid/email-open');
    await page.getByRole('button', { name: 'Load images', exact: true }).click();
    const image = await imageRequest; expect(image.headers().referer).toBeUndefined(); expect(image.frame().parentFrame()).not.toBeNull();
    await page.getByRole('button', { name: 'Change scope', exact: true }).click();
    await page.getByRole('listitem').first().waitFor(); expect(await page.locator('iframe').count()).toBe(0);
    await page.locator('[data-email-row-open]').first().click(); await page.getByRole('button', { name: 'Load images', exact: true }).waitFor();
  } finally { await page.close(); }
}, 30_000);

browserTest('hostile and wide messages keep app CSS isolated and expose a real horizontal ScrollArea', async () => {
  const page = await mount(900, 800); const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  try {
    await page.evaluate(() => { const fixture = (window as any).__emailInboxFixture, message = [...fixture.messages.values()][0] as any;
      message.html = `<style>body{background:rgb(255,0,0)}#root{display:none}td{min-width:300px}div{background:url(https://tracker.invalid/css)}</style><table><tr><td>One</td><td>Two</td><td>Three</td></tr></table><p>Safe body</p><img src="/auth/logout"><img srcset="https://tracker.invalid/srcset 2x"><script>parent.document.body.innerHTML='broken'</script><svg onload="alert(1)"></svg><iframe src="https://tracker.invalid/frame"></iframe><form action="/auth/logout"><input></form>`; });
    await page.locator('[data-email-row-open]').first().click();
    const frame = page.frameLocator('iframe[title="Email content"]'); await frame.getByText('Safe body', { exact: true }).waitFor();
    const horizontal = page.locator('[data-slot="email-html-body"] [data-radix-scroll-area-viewport]');
    await page.waitForFunction(() => { const viewport = document.querySelector('[data-slot="email-html-body"] [data-radix-scroll-area-viewport]'); return !!viewport && viewport.scrollWidth > viewport.clientWidth + 100; });
    await horizontal.evaluate(element => { element.scrollLeft = 500; }); expect(await horizontal.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    expect(await frame.locator('script,svg,form,iframe,input').count()).toBe(0); expect(requests).toEqual([]);
    expect(await page.locator('[data-slot="email-inbox"]').isVisible()).toBe(true);
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(255, 0, 0)');
    await page.setViewportSize({ width: 390, height: 800 }); await page.getByRole('button', { name: 'Back to messages', exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  } finally { await page.close(); }
}, 30_000);

browserTest('live arrival preserves existing row DOM and exposes new mail instead of resetting a scrolled list', async () => {
  const page = await mount();
  try {
    await page.locator('[data-email-row]').first().evaluate(element => { (window as any).__originalEmailRow = element; });
    await page.getByRole('button', { name: 'Incoming mail', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-email-row-open]')?.textContent?.includes('A new message just arrived'));
    expect(await page.evaluate(() => (window as any).__originalEmailRow.isConnected)).toBe(true);
    const viewport = page.locator('.zero-email-message-list [data-radix-scroll-area-viewport]');
    await viewport.evaluate(element => { element.scrollTop = 700; });
    await page.waitForFunction(() => (document.querySelector('.zero-email-message-list [data-radix-scroll-area-viewport]')?.scrollTop ?? 0) >= 500, undefined, { timeout: 2000 });
    await page.getByRole('button', { name: 'Incoming mail', exact: true }).click();
    await page.getByRole('button', { name: 'New mail available' }).waitFor();
    expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
    await page.getByRole('button', { name: 'New mail available' }).click();
    await page.waitForFunction(() => !document.querySelector('.zero-email-new-mail'));
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.zero-email-pagination')?.textContent?.includes('41–'));
    expect(await page.locator('[data-email-row]').count()).toBeGreaterThan(0);
  } finally { await page.close(); }
}, 30_000);

browserTest('structured composer saves and sends; narrow Back retains a single workspace tree', async () => {
  const page = await mount(390, 844);
  try {
    await page.locator('[data-email-row-open]').first().click();
    await page.getByRole('button', { name: 'Back to messages', exact: true }).click();
    await page.getByRole('button', { name: 'Compose', exact: true }).click();
    await page.getByRole('textbox', { name: 'To', exact: true }).fill('hello@example.test');
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('A thoughtful note');
    const editor = page.getByRole('textbox', { name: 'Message body', exact: true });
    await editor.fill('Hello from the new inbox.');
    await screenshot(page, 'mobile-composer');
    await page.getByRole('button', { name: 'Back to messages', exact: true }).click();
    expect(await page.locator('[data-slot="email-inbox"]').count()).toBe(1);
    const folder = page.getByRole('navigation', { name: 'Email folders' });
    await folder.getByRole('button', { name: /Drafts/ }).click();
    await page.getByText('A thoughtful note', { exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Subject', exact: true }).inputValue()).toBe('A thoughtful note');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Message accepted for sending.', { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).__emailInboxFixture.sent)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  } finally { await page.close(); }
}, 30_000);

browserTest('unfinished recipient text is autosaved and restored without ever becoming an invalid send header', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Compose', exact: true }).click();
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Saved while unfinished');
    await page.getByRole('textbox', { name: 'Message body', exact: true }).fill('A draft can be unfinished.');
    await page.getByRole('textbox', { name: 'To', exact: true }).fill('unfinished@');
    await page.waitForFunction(() => [...(window as any).__emailInboxFixture.drafts.values()].some((draft: any) => draft.value.recipientDrafts?.to === 'unfinished@'));
    await page.getByRole('button', { name: 'Close and keep draft', exact: true }).click();
    await page.getByRole('navigation', { name: 'Email folders' }).getByRole('button', { name: /Drafts/ }).click();
    await page.getByText('Saved while unfinished', { exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'To', exact: true }).inputValue()).toBe('unfinished@');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__emailInboxFixture.sent)).toBe(0);
    await page.getByRole('textbox', { name: 'To', exact: true }).fill('valid@example.test');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Message accepted for sending.', { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).__emailInboxFixture.sent)).toBe(1);
  } finally { await page.close(); }
}, 30_000);

browserTest('a receive-only mailbox disables compose and omits bulk mutation controls', async () => {
  const page = await mount();
  try {
    await page.evaluate(() => {
      const source = (window as any).__emailInboxFixture.source, accounts = source.accounts;
      source.accounts = async () => (await accounts()).map((account: any) => ({ ...account, capabilities: { ...account.capabilities, send: false, flags: false, move: false, drafts: false } }));
    });
    await page.getByRole('button', { name: 'Change scope', exact: true }).click();
    await page.getByRole('listitem').first().waitFor();
    expect(await page.getByRole('checkbox').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Compose', exact: true }).isEnabled()).toBe(false);
    await page.locator('[data-email-row-open]').first().click();
    await page.getByRole('article', { name: 'Selected email' }).waitFor();
    expect(await page.getByRole('button', { name: 'Move to trash', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Reply', exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);
