/** Local-only UI/hook proof. Real room/tenant authorization is covered by ephemeral-channel tests. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import type {} from './messaging.browser-fixture';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const faults: string[] = [];
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'zero-messaging-browser-'));
  try {
    const styles = await buildPlatformStyles(directory, join(directory, 'absent-app')); css = await Bun.file(styles.cssPath).text();
    const compile = Bun.spawn([process.execPath, '--no-env-file', 'build', `${import.meta.dir}/messaging.browser-fixture.tsx`, '--target=browser', '--format=iife', '--define', 'process.env.NODE_ENV="test"', '--outdir', directory], { stdout: 'pipe', stderr: 'pipe' });
    const [exit, stderr] = await Promise.all([compile.exited, new Response(compile.stderr).text()]);
    if (exit) throw new Error(stderr);
    bundle = await Bun.file(join(directory, 'messaging.browser-fixture.js')).text();
    const componentCss = Bun.file(join(directory, 'messaging.browser-fixture.css')); if (await componentCss.exists()) css += '\n' + await componentCss.text();
    css += '\nbody{margin:0}.fixture-toolbar{height:48px;display:flex;align-items:center;gap:16px;padding:8px 20px;font:11px system-ui;color:var(--muted-foreground)}.fixture-workspace{height:calc(100dvh - 48px);padding:0 16px 16px;box-sizing:border-box}';
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 120_000);
afterAll(() => { lease?.release(); expect(faults).toEqual([]); });

async function mount(width = 1240, height = 900, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion });
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => route.request().url() === 'https://zero-messaging.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' }) : route.abort());
  await page.goto('https://zero-messaging.invalid/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByTestId('typing-state').waitFor();
  return page;
}
async function screenshot(page: Page, name: string) {
  const directory = process.env.MESSAGING_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, name + '.png'), fullPage: true });
}

browserTest('compact panes use shared ScrollArea/magnetic material, retain rows and respect narrow navigation', async () => {
  const page = await mount();
  try {
    expect(await page.locator('[data-slot="scroll-area"]').count()).toBe(2);
    await page.locator('[data-conversation-id="c1"]').hover();
    await page.waitForFunction(() => !!document.querySelector('[data-conversation-id="c1"][data-zero-menu-material]'));
    await page.locator('[data-conversation-id="c2"]').hover();
    await page.waitForFunction(() => !!document.querySelector('[data-conversation-id="c2"][data-zero-menu-material]'));
    await page.locator('[data-conversation-id="c1"]').focus();
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.conversationId)).toBe('c2');
    await page.evaluate(() => window.__messagingFixture.peer());
    await page.getByText('Alex Rivera is typing…', { exact: true }).waitFor();
    expect(await page.locator('[data-slot="conversation-typing"] [data-slot="avatar"]').count()).toBe(1);
    await screenshot(page, 'desktop-light');
    const transcript = page.locator('.zero-messaging-main [data-radix-scroll-area-viewport]');
    await transcript.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await transcript.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(901);
    await page.locator('[data-message-id="m0"]').evaluate(element => { (window as any).__originalMessage = element; });
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Synthetic local draft');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__originalMessage.isConnected)).toBe(true);
    expect(await page.locator('[data-message-id="local-1"]').textContent()).toContain('Queued');
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click(); await screenshot(page, 'desktop-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.getByRole('textbox', { name: 'Message', exact: true }).isVisible()).toBe(false);
    await page.locator('[data-conversation-id="c1"]').click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await screenshot(page, 'mobile-conversation');
    await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Message', exact: true }).isVisible()).toBe(false);
    expect(await page.locator('[data-slot="messaging-layout"]').count()).toBe(1);
  } finally { await page.close(); }
}, 45_000);

browserTest('typing is throttled, idle-bounded, session-scoped, transient offline and rejects retained callbacks', async () => {
  const page = await mount();
  try {
    const keys = await page.evaluate(() => [window.__messagingFixture.key(), window.__messagingFixture.key('second')]);
    expect(keys[0]).not.toBe(keys[1]); expect(keys[0]).toMatch(/^user:staff:session:/);
    await page.evaluate(() => { window.__messagingFixture.clearSent(); window.__messagingFixture.mark(); window.__messagingFixture.mark(); window.__messagingFixture.mark('second'); });
    let messages = await page.evaluate(() => window.__messagingFixture.sent()) as any[];
    expect(messages.filter(message => message.type === 'ephemeral.set')).toHaveLength(2);
    expect(messages.filter(message => message.type === 'ephemeral.set').every(message => message.ttl === 5000)).toBe(true);
    await page.evaluate(() => { window.__messagingFixture.clearSent(); window.__messagingFixture.clear(); });
    messages = await page.evaluate(() => window.__messagingFixture.sent()) as any[];
    expect(messages.filter(message => message.type === 'ephemeral.delete').map(message => message.key)).toEqual([keys[0]]);
    await page.waitForFunction(() => window.__messagingFixture.sent().some((message: any) => message.type === 'ephemeral.delete' && message.key.endsWith(window.__messagingFixture.key('second').split(':session:')[1]!)), undefined, { timeout: 6000 });
    await page.evaluate(() => { window.__messagingFixture.connected(false); window.__messagingFixture.clearSent(); window.__messagingFixture.mark(); });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    await page.evaluate(() => { window.__messagingFixture.connected(true); window.__messagingFixture.saveMark(); window.__messagingFixture.selectRoom('room-b'); });
    await page.evaluate(() => { window.__messagingFixture.clearSent(); window.__messagingFixture.invokeOldMark(); });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    await page.evaluate(() => {
      window.__messagingFixture.clearSent(); window.__messagingFixture.mark();
      window.dispatchEvent(new Event('blur'));
    });
    messages = await page.evaluate(() => window.__messagingFixture.sent()) as any[];
    expect(messages.filter(message => message.type === 'ephemeral.delete')).toHaveLength(1);
    await page.evaluate(() => { window.__messagingFixture.clearSent(); window.__messagingFixture.mark(); });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__messagingFixture.clearSent(); window.__messagingFixture.mark();
    });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    await page.evaluate(() => { window.__messagingFixture.selectRoom('room-a'); window.__messagingFixture.clearSent(); window.__messagingFixture.invokeOldMark(); });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    await page.evaluate(() => { window.__messagingFixture.saveMark(); window.__messagingFixture.publish(false); window.__messagingFixture.clearSent(); window.__messagingFixture.invokeOldMark(); });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    await page.evaluate(() => { window.__messagingFixture.publish(true); window.__messagingFixture.saveMark(); window.__messagingFixture.scope(); window.__messagingFixture.clearSent(); window.__messagingFixture.invokeOldMark(); });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    await page.evaluate(() => { window.__messagingFixture.saveMark(); window.__messagingFixture.unmount(); window.__messagingFixture.clearSent(); window.__messagingFixture.invokeOldMark(); });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

browserTest('IME/modified Enter never submits, upload readiness blocks send, and admission errors do not masquerade as activity', async () => {
  const page = await mount(1240, 900, 'reduce');
  try {
    const input = page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill('An unfinished composition');
    await input.dispatchEvent('compositionstart', { data: '' }); await input.press('Enter');
    expect(await page.evaluate(() => window.__messagingFixture.submissions())).toBe(0);
    await input.dispatchEvent('compositionend', { data: 'An unfinished composition' }); await input.press('Shift+Enter');
    for (const key of ['Control+Enter', 'Meta+Enter', 'Alt+Enter']) await input.press(key);
    expect(await page.evaluate(() => window.__messagingFixture.submissions())).toBe(0);
    await page.evaluate(() => window.__messagingFixture.files([{ id: 'f1', name: 'fixture.pdf', state: 'uploading', progress: 40 }]));
    expect(await page.getByRole('button', { name: 'Send message', exact: true }).isEnabled()).toBe(false);
    await input.press('Enter'); expect(await page.evaluate(() => window.__messagingFixture.submissions())).toBe(0);
    await page.evaluate(() => window.__messagingFixture.files([{ id: 'f1', name: 'fixture.pdf', state: 'ready' }]));
    await input.press('Enter'); expect(await page.evaluate(() => window.__messagingFixture.submissions())).toBe(1);
    await page.evaluate(() => window.__messagingFixture.peer(1)); await page.locator('.zero-messaging-typing-dots i').first().waitFor();
    expect(await page.locator('.zero-messaging-typing-dots i').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await page.evaluate(() => window.__messagingFixture.reject());
    await page.waitForFunction(() => document.querySelector('[data-testid="typing-state"]')?.textContent === 'EPHEMERAL_FORBIDDEN');
    expect(await page.locator('[data-slot="conversation-typing"]').count()).toBe(0);
    await page.evaluate(() => { window.__messagingFixture.clearSent(); window.__messagingFixture.mark(); });
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([]);
    expect(await page.evaluate(() => window.__messagingFixture.retry())).toBe(true);
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toContainEqual({ type: 'ephemeral.subscribe', topic: 'typing:room-a' });
    await page.evaluate(() => { window.__messagingFixture.reject('set'); });
    await page.waitForFunction(() => document.querySelector('[data-testid="typing-state"]')?.textContent === 'EPHEMERAL_FORBIDDEN');
    await page.evaluate(() => { window.__messagingFixture.clearSent(); window.__messagingFixture.connected(false); });
    expect(await page.evaluate(() => window.__messagingFixture.retry())).toBe(false);
    expect(await page.getByTestId('typing-state').textContent()).toBe('EPHEMERAL_FORBIDDEN');
    await page.evaluate(() => window.__messagingFixture.connected(true));
    expect(await page.evaluate(() => window.__messagingFixture.retry())).toBe(true);
    expect(await page.evaluate(() => window.__messagingFixture.sent())).toEqual([{ type: 'ephemeral.subscribe', topic: 'typing:room-a' }]);
  } finally { await page.close(); }
}, 30_000);
