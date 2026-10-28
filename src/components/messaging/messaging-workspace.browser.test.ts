/** Native browser acceptance: actual Guardian, public SDK, AppProvider, Fabric, private bytes and live streams. No external provider or app data. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Browser, BrowserContext } from 'playwright';
import { createApp } from '../../frontend/server/app-factory';
import { defineZeroPlugin } from '../../frontend/server/server-extensions';
import { AuthError } from '../../auth/types';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import { launchNativeWindowBrowser } from '../../test-support/playwright-native-window';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform', evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing/messaging-workspace-browser';
let lease: PlaywrightTestBrowserLease | undefined, scriptPath = '', css = '';
const browserAssets = new Map<string, { contents: Blob; type: string }>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = await mkdtemp(join(scratch, 'messaging-workspace-build-'));
  const styles = await buildPlatformStyles(root, join(root, 'absent-app')); css = await Bun.file(styles.cssPath).text();
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'messaging-workspace.browser-fixture.tsx')], outdir: join(root, 'browser'),
    target: 'browser', format: 'esm', splitting: true, define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  scriptPath = '/_fixture/' + basename(build.outputs.find(file => file.kind === 'entry-point')!.path);
  for (const output of build.outputs) browserAssets.set('/_fixture/' + basename(output.path), { contents: output,
    type: output.path.endsWith('.mp3') ? 'audio/mpeg' : output.path.endsWith('.css') ? 'text/css' : 'application/javascript' });
  for (const output of build.outputs.filter(file => file.path.endsWith('.css'))) css += '\n' + await output.text();
  await mkdir(evidence, { recursive: true }); lease = await acquirePlaywrightTestBrowser();
}, 90000);
afterAll(() => lease?.release());
async function fixture(support: boolean | 'website' | 'review' | 'notice-review' | 'notices' = false) {
  const root = await mkdtemp(join(scratch, 'messaging-workspace-native-')); await mkdir(join(root, 'app'));
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('Synthetic port reservation') });
  const port = reservation.port!; await reservation.stop(true); const base = 'http://127.0.0.1:' + port;
  let providerCalls = 0;
  const noticeReview = support === 'notice-review';
  const notices = support === 'notices', hasSupport = !!support && !noticeReview && !notices;
  const provider = support === 'review' ? Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    if (++providerCalls === 1) return Response.json({ error: { message: 'Synthetic provider failure' } }, { status: 503 });
    return Response.json({ id: 'synthetic-reviewed-answer', object: 'chat.completion', created: 1, model: 'chat', choices: [{ index: 0, message: { role: 'assistant', content: 'SYNTHETIC_REVIEWED_BROWSER_ANSWER' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } });
  } }) : null;
  const app = await createApp({ projectRoot: root, appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    app: { publicUrl: base },
    db: { mode: 'file', path: join(root, 'app.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') }, tables: {},
    auth: { bootstrap: 'public', presence: { enabled: true } }, messaging: { support: support === 'website' ? { entries: { website: { origin: base, assistant: false } } } : hasSupport ? {} : false, ...(provider ? { assistant: { model: 'synthetic/chat' } } : {}), ...(noticeReview || notices ? { notifications: true } : {}) }, logging: false,
    ai: provider ? { autoDetect: false, providers: { synthetic: { type: 'openai-compatible', apiKey: 'synthetic-test-key', baseURL: 'http://127.0.0.1:' + provider.port + '/v1' } } } : false,
    email: false, workflows: provider || noticeReview || notices ? {} : false, vector: false, pdf: false, kv: false, stateSync: false, observability: false,
    ...(noticeReview ? { serverExtensions: [defineZeroPlugin({ name: 'synthetic-notice-review', setup({ zero }) {
      zero.notifications!.notifyUsersOnce = () => { throw new AuthError('Synthetic invalid native notice.', 'NOTIFICATION_INPUT_INVALID', 422); };
    } })] } : {}),
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false });
  app.get('/_fixture/*', ({ request }) => { const asset = browserAssets.get(new URL(request.url).pathname);
    return asset ? new Response(asset.contents, { headers: { 'Content-Type': asset.type } }) : new Response('Missing synthetic asset', { status: 404 }); });
  app.get('/workspace', () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nhtml,body,#root{margin:0;height:100dvh}#root{box-sizing:border-box;padding:12px}#root:has([data-testid=sound-status]){display:flex;flex-direction:column}.zero-messaging-workspace{flex:1;min-height:0}</style><div id="root"></div><script>window.__PLATFORM_CONFIG__={auth:true,presence:true,logging:false,stateSync:false,routeAuth:'protected-by-default',publicPaths:['/workspace']}</script><script type="module" src="${scriptPath}"></script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  app.get('/support', () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nhtml,body,#root{margin:0;min-height:100dvh}#root{box-sizing:border-box;padding:12px;max-width:560px;margin:auto}</style><div id="root"></div><script type="module" src="${scriptPath}"></script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  app.listen({ hostname: '127.0.0.1', port });
  const call = async (method: string, path: string, body?: unknown, token?: string, key?: string) => {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error(`Synthetic native request rejected: ${response.status} ${value.code ?? ''}`); return value;
  };
  const admin = await call('POST', '/auth/register', { username: 'workspace-admin', email: 'workspace-admin@example.test', password: 'Synthetic-workspace-password-123' });
  const peer = await call('POST', '/auth/register', { username: 'workspace-peer', email: 'workspace-peer@example.test', password: 'Synthetic-workspace-password-123' });
  const other = await call('POST', '/auth/register', { username: 'workspace-other', email: 'workspace-other@example.test', password: 'Synthetic-workspace-password-123' });
  const conversation = await call('POST', '/api/messaging/conversations', { userIds: [peer.user.userId] }, admin.accessToken, 'native-workspace-chat');
  const send = (text: string, key: string = crypto.randomUUID()) => call('POST', `/api/messaging/conversations/${conversation.id}/messages`, { text }, peer.accessToken, key);
  for (let i = 1; i <= (noticeReview || notices ? 0 : 55); i++) await send('Synthetic native history ' + i, 'history-' + i);
  return { base, app, call, admin, peer, other, conversation, send, close: async () => { await app.stop(true); await provider?.stop(true); } };
}
browserTest('native alert policy suppresses the active chat, chooses exactly one correct sound, and never replays history or muted alerts', () => qualifyAlertPolicy(lease!.browser), 120000);
async function qualifyAlertPolicy(browser: Browser, realBackground = false, nativeContext?: BrowserContext) {
  const f = await fixture('notices'), context = nativeContext ?? await browser.newContext({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' }), page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 800 });
  page.setDefaultTimeout(12000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await f.send('SYNTHETIC_BEFORE_SUBSCRIPTION', 'audio-history');
    const waitNotices = async (count: number) => {
      const until = Date.now() + 12000;
      while ((await f.call('GET', '/notifications', undefined, f.admin.accessToken)).notifications.length < count) {
        if (Date.now() >= until) throw new Error('Synthetic native notice did not complete.');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    await waitNotices(1);
    await page.addInitScript(() => {
      const target = window as unknown as { __played: string[] }; target.__played = [];
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const audible = this.volume > 0, src = this.src;
        const result = original.call(this);
        void result.then(() => { if (audible) target.__played.push(src); }).catch(() => {});
        return result;
      };
    });
    const played = () => page.evaluate(() => (window as unknown as { __played: string[] }).__played);
    await page.goto(f.base + '/workspace?manual&sounds');
    await page.getByTestId('notice-count').getByText('1', { exact: true }).waitFor();
    await page.getByTestId('sound-status').getByText('locked', { exact: true }).waitFor();
    expect(await played()).toEqual([]); expect(await page.locator('[data-sonner-toast]').count()).toBe(0);
    await page.getByRole('button', { name: 'Enable test sounds', exact: true }).click();
    await page.getByTestId('sound-status').getByText('ready', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'workspace-peer', exact: false }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).click();
    expect(await page.evaluate(() => document.hasFocus() && document.visibilityState === 'visible')).toBe(true);
    await f.send('SYNTHETIC_ACTIVE_QUIET', 'audio-active');
    await page.getByTestId('notice-count').getByText('2', { exact: true }).waitFor();
    await page.locator('.zero-messaging-transcript').getByText('SYNTHETIC_ACTIVE_QUIET', { exact: true }).waitFor();
    expect(await played()).toEqual([]); expect(await page.locator('[data-sonner-toast]').count()).toBe(0);
    const other = await f.call('POST', '/api/messaging/conversations', { userIds: [f.other.user.userId] }, f.admin.accessToken, 'audio-other');
    await f.call('POST', `/api/messaging/conversations/${other.id}/messages`, { text: 'SYNTHETIC_OTHER_ALERT' }, f.other.accessToken, 'audio-other-message');
    await page.waitForFunction(() => (window as unknown as { __played: string[] }).__played.length === 1);
    expect((await played())[0]).toMatch(/\/chat-message-[a-z0-9]+\.mp3$/);
    await page.getByTestId('notice-count').getByText('3', { exact: true }).waitFor();
    expect(await page.locator('[data-sonner-toast]').count()).toBe(1);
    // This grace exceeds the deliberate 750ms burst coalescing interval; it is
    // not a retry of failed publication or a way to make the active chat quiet.
    await page.waitForTimeout(800);
    await f.call('POST', '/notifications', { title: 'SYNTHETIC_GENERAL_ALERT', targetType: 'user', targetValue: f.admin.user.userId }, f.admin.accessToken);
    await page.waitForFunction(() => (window as unknown as { __played: string[] }).__played.length === 2);
    expect((await played())[1]).toMatch(/\/notification-[a-z0-9]+\.mp3$/);
    await page.getByRole('button', { name: 'Mute test sounds', exact: true }).click();
    await page.getByTestId('sound-status').getByText('disabled', { exact: true }).waitFor();
    await f.call('POST', '/notifications', { title: 'SYNTHETIC_MUTED_ALERT', targetType: 'user', targetValue: f.admin.user.userId }, f.admin.accessToken);
    await page.getByTestId('notice-count').getByText('5', { exact: true }).waitFor();
    expect(await played()).toHaveLength(2);
    await page.getByRole('button', { name: 'Unmute test sounds', exact: true }).click();
    await page.getByTestId('sound-status').getByText('locked', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Enable test sounds', exact: true }).click();
    await page.getByTestId('sound-status').getByText('ready', { exact: true }).waitFor();
    expect(await played()).toHaveLength(2);
    const current = await f.call('GET', '/api/messaging/conversations/' + f.conversation.id, undefined, f.admin.accessToken);
    expect(current.unreadCount).toBeGreaterThan(0); // Quiet is not a fabricated read acknowledgment.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    expect(await page.locator('.zero-messaging-main').isVisible()).toBe(false);
    await f.send('SYNTHETIC_HIDDEN_MOBILE_PANE', 'audio-mobile-list');
    await page.getByTestId('notice-count').getByText('6', { exact: true }).waitFor();
    await page.waitForFunction(() => (window as unknown as { __played: string[] }).__played.length === 3);
    expect((await played())[2]).toMatch(/\/chat-message-[a-z0-9]+\.mp3$/);
    await page.setViewportSize({ width: 1100, height: 800 });
    // Headless pages do not model native-window visibility/focus. Minimize the
    // actual headed window; never replace a getter or dispatch lifecycle events.
    if (realBackground) {
      const cdp = await context.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      try {
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        await page.waitForFunction(() => document.visibilityState !== 'visible' || !document.hasFocus());
        expect(await page.evaluate(() => document.visibilityState === 'visible' && document.hasFocus())).toBe(false);
        await page.waitForTimeout(800);
        await f.send('SYNTHETIC_BACKGROUND_CHAT', 'audio-background');
        await page.getByTestId('notice-count').getByText('7', { exact: true }).waitFor();
        await page.waitForFunction(() => (window as unknown as { __played: string[] }).__played.length === 4);
        expect((await played())[3]).toMatch(/\/chat-message-[a-z0-9]+\.mp3$/);
        await Bun.write(join(evidence, 'notification-real-window.json'), JSON.stringify({ headless: false, lifecycle: 'native-window-minimized',
          overriddenDocumentApis: false, syntheticLifecycleEvents: false, state: await page.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState })),
          audio: (await played()).map(src => basename(new URL(src).pathname)) }, null, 2));
      } finally { await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); }
    }
    await page.bringToFront(); await page.reload(); await page.getByTestId('notice-count').getByText(realBackground ? '7' : '6', { exact: true }).waitFor();
    expect(await played()).toEqual([]); expect(await page.locator('[data-sonner-toast]').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { if (nativeContext) await page.close(); else await context.close(); await f.close(); }
}
browserTest('the native operator review surface inspects retained failure and explicitly confirms one new AI attempt', async () => {
  const f = await fixture('review'), staff = await lease!.browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' });
  staff.setDefaultTimeout(12000); const errors: string[] = []; staff.on('pageerror', error => errors.push(error.message));
  try {
    const opened = await f.call('POST', '/api/messaging/support', {}, f.peer.accessToken, 'browser-review-open');
    await f.call('POST', '/api/messaging/conversations/' + opened.id + '/messages', { text: 'SYNTHETIC_REVIEW_BROWSER_QUESTION' }, f.peer.accessToken, 'browser-review-turn');
    await staff.goto(f.base + '/workspace?manual'); await staff.getByRole('button', { name: 'Open support queue', exact: true }).click();
    await staff.getByRole('button', { name: /^Claim support request / }).click();
    await staff.getByRole('button', { name: 'Review messaging work (1)', exact: true }).click();
    await staff.getByRole('button', { name: 'Inspect', exact: true }).click();
    const detail = staff.getByRole('dialog', { name: 'Review messaging work', exact: true }); await detail.waitFor();
    await detail.getByText('provider outcome unknown', { exact: true }).waitFor();
    await detail.getByRole('button', { name: 'Review and retry', exact: true }).click();
    const confirm = staff.getByRole('alertdialog', { name: 'Retry this work?', exact: true });
    await confirm.getByRole('button', { name: 'Acknowledge risk and retry', exact: true }).click();
    await detail.getByText('Resolved: a new attempt was requested. The original evidence is retained.', { exact: true }).waitFor();
    // Resolution accepts a new durable attempt; it is not proof that the
    // asynchronous provider reply has already committed. Observe that separately.
    await staff.locator('.zero-messaging-transcript').getByText('SYNTHETIC_REVIEWED_BROWSER_ANSWER', { exact: true }).waitFor();
    expect((await f.call('GET', '/api/messaging/conversations/' + opened.id + '/review', undefined, f.admin.accessToken)).items).toHaveLength(0);
    const rows = await f.call('GET', '/api/messaging/conversations/' + opened.id + '/messages', undefined, f.peer.accessToken);
    expect(rows.items.filter((row: any) => row.text === 'SYNTHETIC_REVIEWED_BROWSER_ANSWER')).toHaveLength(1);
    expect(errors).toEqual([]); await staff.screenshot({ path: join(evidence, 'operator-review-native.png') });
  } finally { await staff.close(); await f.close(); }
}, 90000);
browserTest('peer senders inspect and dismiss native notification failures without a support role or resend control', async () => {
  const f = await fixture('notice-review'), page = await lease!.browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' });
  const faults: string[] = []; page.on('pageerror', error => faults.push(error.message)); page.setDefaultTimeout(12000);
  try {
    await page.goto(f.base + '/workspace?manual'); await page.getByRole('button', { name: 'workspace-peer', exact: false }).click();
    expect(await page.getByRole('button', { name: /^Review messaging work/ }).count()).toBe(0);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Synthetic peer message with a failed native notice');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByRole('button', { name: 'Review messaging work (1)', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'Review messaging work', exact: true }); await detail.waitFor();
    expect(await detail.getByRole('button', { name: 'Review and retry', exact: true }).count()).toBe(0);
    await detail.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Dismiss this work?', exact: true }).getByRole('button', { name: 'Dismiss work', exact: true }).click();
    await detail.getByText('Resolved: dismissed. The original evidence is retained.', { exact: true }).waitFor();
    expect((await f.call('GET', '/api/messaging/conversations/' + f.conversation.id + '/review', undefined, f.admin.accessToken)).items).toHaveLength(0);
    expect((await f.call('GET', '/api/messaging/conversations/' + f.conversation.id + '/messages', undefined, f.peer.accessToken)).items).toHaveLength(1);
    expect(faults).toEqual([]);
  } finally { await page.close(); await f.close(); }
}, 90000);
browserTest('the anonymous website widget uses native cookies, private file stages and the same reactive staff handoff without a Guardian account', async () => {
  const f = await fixture('website'), staff = await lease!.browser.newPage({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });
  const guestContext = await lease!.browser.newContext({ viewport: { width: 390, height: 760 }, reducedMotion: 'reduce' }), guest = await guestContext.newPage();
  const errors: string[] = []; for (const page of [staff, guest]) { page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000); }
  try {
    await staff.goto(f.base + '/workspace?manual'); await staff.getByRole('button', { name: 'Open support queue', exact: true }).click();
    await staff.getByText('No requests waiting on this page.', { exact: true }).waitFor();
    await guest.goto(f.base + '/support'); await guest.getByRole('button', { name: 'Start a conversation', exact: true }).click();
    await guest.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    expect(await guest.getByRole('complementary', { name: 'Conversations' }).count()).toBe(0);
    expect(await guest.evaluate(() => document.cookie)).not.toContain('zero_support_');
    const cookie = (await guestContext.cookies()).find(value => value.name === 'zero_support_website')!;
    expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Strict');
    await guest.getByRole('textbox', { name: 'Message', exact: true }).fill('SYNTHETIC_ANONYMOUS_QUESTION');
    await guest.getByRole('button', { name: 'Send message', exact: true }).click();
    await staff.getByRole('button', { name: /^Claim support request / }).click();
    await staff.locator('.zero-messaging-transcript').getByText('SYNTHETIC_ANONYMOUS_QUESTION', { exact: true }).waitFor();
    await guest.bringToFront(); await guest.getByRole('textbox', { name: 'Message', exact: true }).click();
    expect(await guest.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState }))).toEqual({ focused: true, visibility: 'visible' });
    const typingResponse = guest.waitForResponse(response => new URL(response.url()).pathname.endsWith('/typing') && response.request().method() === 'POST');
    await guest.getByRole('textbox', { name: 'Message', exact: true }).fill('ACTIVITY_TEXT_MUST_NOT_LEAVE_TYPING');
    expect((await typingResponse).status()).toBe(200);
    await staff.getByText('Visitor is typing…', { exact: true }).waitFor();
    await guest.getByRole('textbox', { name: 'Message', exact: true }).fill('');
    await staff.bringToFront(); await staff.getByRole('textbox', { name: 'Message', exact: true }).click();
    await staff.getByRole('textbox', { name: 'Message', exact: true }).fill('SYNTHETIC_PUBLIC_HUMAN_REPLY');
    await guest.getByText('workspace-admin is typing…', { exact: true }).waitFor();
    await staff.getByRole('button', { name: 'Send message', exact: true }).click();
    await guest.locator('.zero-messaging-transcript').getByText('SYNTHETIC_PUBLIC_HUMAN_REPLY', { exact: true }).waitFor();
    await guest.locator('input[type=file]').setInputFiles({ name: 'website-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic website bytes') });
    await guest.getByText('Ready', { exact: true }).waitFor(); await guest.getByRole('button', { name: 'Send message', exact: true }).click();
    await staff.getByRole('button', { name: 'website-note.txt', exact: false }).waitFor();
    await guest.reload(); await guest.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    await guest.locator('.zero-messaging-transcript').getByText('SYNTHETIC_PUBLIC_HUMAN_REPLY', { exact: true }).waitFor();
    expect((await guestContext.cookies()).find(value => value.name === 'zero_support_website')!.value).toBe(cookie.value);
    await staff.getByRole('button', { name: 'Conversation options', exact: true }).click();
    await staff.getByRole('button', { name: 'Resolve support request', exact: true }).click();
    await staff.getByRole('alertdialog').getByRole('button', { name: 'Resolve support request', exact: true }).click();
    await guest.getByText('Archived conversation', { exact: true }).waitFor(); expect(await guest.getByRole('textbox', { name: 'Message', exact: true }).isDisabled()).toBe(true);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]); await guest.screenshot({ path: join(evidence, 'public-support-native.png') });
    await guest.getByRole('button', { name: 'End chat', exact: true }).click(); await guest.getByRole('alertdialog').getByRole('button', { name: 'End session', exact: true }).click();
    await guest.getByRole('button', { name: 'Reconnect to support', exact: true }).waitFor();
    expect((await guestContext.cookies()).some(value => value.name === 'zero_support_website')).toBe(false);
  } finally { await guestContext.close(); await staff.close(); await f.close(); }
}, 90000);
browserTest('native human-first support enters a live content-free staff queue and claims the same customer conversation', async () => {
  const f = await fixture(true), staff = await lease!.browser.newPage({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' }), customer = await lease!.browser.newPage({ viewport: { width: 390, height: 760 }, reducedMotion: 'reduce' });
  const errors: string[] = []; for (const page of [staff, customer]) { page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000); }
  try {
    await staff.goto(f.base + '/workspace?manual');
    await staff.getByRole('button', { name: 'Open support queue', exact: true }).click();
    await staff.getByText('No requests waiting on this page.', { exact: true }).waitFor();
    await customer.goto(f.base + '/workspace?user=peer&manual');
    await customer.getByRole('button', { name: 'New conversation', exact: true }).click();
    await customer.getByRole('button', { name: 'Talk to a person', exact: true }).click();
    await customer.getByText('Waiting for a person', { exact: true }).waitFor();
    await customer.getByRole('textbox', { name: 'Message', exact: true }).fill('SYNTHETIC_CUSTOMER_SUPPORT_QUESTION');
    await customer.getByRole('button', { name: 'Send message', exact: true }).click();
    const claim = staff.getByRole('button', { name: /^Claim support request / });
    await claim.waitFor(); expect(await staff.getByText('SYNTHETIC_CUSTOMER_SUPPORT_QUESTION', { exact: true }).count()).toBe(0);
    await claim.click();
    await staff.getByText('SYNTHETIC_CUSTOMER_SUPPORT_QUESTION', { exact: true }).waitFor();
    await customer.getByText('Assigned to support', { exact: true }).waitFor();
    await staff.getByRole('textbox', { name: 'Message', exact: true }).fill('SYNTHETIC_NATIVE_HUMAN_REPLY');
    await staff.getByRole('button', { name: 'Send message', exact: true }).click();
    await customer.locator('.zero-messaging-transcript').getByText('SYNTHETIC_NATIVE_HUMAN_REPLY', { exact: true }).waitFor();
    await staff.getByRole('checkbox', { name: 'Private team note' }).check();
    await staff.getByRole('textbox', { name: 'Message', exact: true }).fill('SYNTHETIC_PRIVATE_SUPPORT_NOTE');
    await staff.getByRole('button', { name: 'Send message', exact: true }).click();
    await staff.getByText('SYNTHETIC_PRIVATE_SUPPORT_NOTE', { exact: true }).waitFor();
    expect(await customer.getByText('SYNTHETIC_PRIVATE_SUPPORT_NOTE', { exact: true }).count()).toBe(0);
    expect(await customer.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await customer.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(761);
    expect(errors).toEqual([]);
    await customer.screenshot({ path: join(evidence, 'support-human-native.png') });
  } finally { await staff.close(); await customer.close(); await f.close(); }
}, 90000);

browserTest('default AppProvider workspace loads real identities, retains rows on live append, backfills and privately uploads native attachments', async () => {
  const f = await fixture(), page = await lease!.browser.newPage({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000);
  const typing: object[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => { try { const value = JSON.parse(String(frame.payload));
    if (value.type === 'ephemeral.set' && value.topic?.startsWith('typing:messaging:')) typing.push({ type: value.type, topic: value.topic, value: value.value });
  } catch { /* Ignore non-JSON control frames; never retain auth frames. */ } }));
  try {
    await page.goto(f.base + '/workspace?manual');
    await page.getByRole('button', { name: 'workspace-peer', exact: false }).click();
    const transcript = page.locator('.zero-messaging-transcript');
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
    await page.locator('.zero-messaging-conversation-header [data-slot="avatar-presence-indicator"]').waitFor();
    await transcript.getByText('Synthetic native history 55', { exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(761);
    expect(errors).toEqual([]);
    const retained = page.locator('[data-message-id]').filter({ hasText: 'Synthetic native history 55' });
    await retained.evaluate(element => { element.dataset.retained = 'kept'; });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await retained.evaluate(element => getComputedStyle(element.closest('.zero-messaging-workspace-message')!).animationName)).toBe('none');
    await f.send('Synthetic live incoming'); await transcript.getByText('Synthetic live incoming', { exact: true }).waitFor();
    expect(await retained.getAttribute('data-retained')).toBe('kept');
    const incoming = transcript.getByText('Synthetic live incoming', { exact: true });
    expect(await incoming.evaluate(element => getComputedStyle(element.closest('.zero-messaging-workspace-message')!).animationName)).toBe('zero-messaging-message-enter');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await incoming.evaluate(element => getComputedStyle(element.closest('.zero-messaging-workspace-message')!).animationName)).toBe('none');
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(56);
    const viewport = page.locator('.zero-messaging-main [data-radix-scroll-area-viewport]');
    await viewport.evaluate(element => { element.scrollTop = 0; });
    await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
    await transcript.getByText('Synthetic native history 1', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Browser-authored native message');
    await page.waitForFunction(() => document.querySelector('[data-slot="messaging-composer"] textarea')?.getAttribute('disabled') === null);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await transcript.getByText('Browser-authored native message', { exact: true }).waitFor();
    const input = page.locator('input[type=file]'); await input.setInputFiles({ name: 'synthetic-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic private bytes') });
    await page.getByText('Ready', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByRole('button', { name: 'synthetic-note.txt', exact: false }).waitFor();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'synthetic-note.txt', exact: false }).click();
    const downloaded = await downloadEvent; expect(downloaded.suggestedFilename()).toBe('synthetic-note.txt');
    const bytes = await downloaded.createReadStream(); let contents = '';
    for await (const chunk of bytes!) contents += chunk.toString();
    expect(contents).toBe('Synthetic private bytes');
    const messages = await f.call('GET', `/api/messaging/conversations/${f.conversation.id}/messages`, undefined, f.peer.accessToken);
    expect(messages.items.filter((row: any) => row.text === 'Browser-authored native message')).toHaveLength(1);
    expect(messages.items[0].attachmentIds).toHaveLength(1);
    expect(typing.length).toBeGreaterThan(0); expect(JSON.stringify(typing)).not.toContain('Browser-authored native message');
    // Lose only the response, after the native server accepted the exact intent.
    let lost = false;
    await page.route('**/api/messaging/conversations/*/messages', async route => {
      if (!lost && route.request().method() === 'POST') { lost = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Native accepted response lost');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByRole('button', { name: 'Check send result', exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Message', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Check send result', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('[data-slot="messaging-composer"] textarea') as HTMLTextAreaElement)?.value === '' && !document.querySelector('[data-slot="messaging-composer"] textarea')?.hasAttribute('disabled'));
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}/messages`, undefined, f.peer.accessToken)).items.filter((row: any) => row.text === 'Native accepted response lost')).toHaveLength(1);
    await page.unroute('**/api/messaging/conversations/*/messages');
    const sent = messages.items.find((row: any) => row.text === 'Browser-authored native message');
    const ownMessage = page.locator(`[data-message-id="${sent.id}"]`);
    await ownMessage.getByRole('button', { name: 'Message options', exact: true }).click();
    await page.getByRole('button', { name: 'React 👍', exact: true }).click();
    await ownMessage.getByRole('button', { name: '👍, 1 reaction', exact: true }).waitFor();
    await ownMessage.getByRole('button', { name: 'Message options', exact: true }).click();
    await page.getByRole('button', { name: 'Edit message', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit message', exact: true }).fill('Browser-authored edited message');
    await page.getByRole('button', { name: 'Save message', exact: true }).click();
    await ownMessage.getByText('Browser-authored edited message', { exact: true }).waitFor();
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}/messages/${sent.id}`, undefined, f.peer.accessToken)).revision).toBe(2);
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: join(evidence, 'native-desktop-light.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: join(evidence, 'native-desktop-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.screenshot({ path: join(evidence, 'native-mobile-light.png'), fullPage: true });
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    const start = page.getByRole('dialog', { name: 'Start a conversation' });
    await start.getByRole('button', { name: 'workspace-peer', exact: true }).click();
    await start.getByRole('button', { name: 'workspace-other', exact: true }).click();
    await start.getByRole('textbox', { name: 'Group name', exact: true }).fill('Native browser group');
    await start.getByRole('button', { name: 'Start group (2)', exact: true }).click();
    await page.locator('.zero-messaging-conversation-header').getByRole('heading', { name: 'Native browser group', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
    await page.getByRole('textbox', { name: 'Conversation name', exact: true }).fill('Native renamed group');
    await page.getByRole('button', { name: 'Save conversation name', exact: true }).click();
    await page.locator('.zero-messaging-conversation-header').getByRole('heading', { name: 'Native renamed group', exact: true }).waitFor();
    await page.screenshot({ path: join(evidence, 'native-group-settings.png'), fullPage: true });
    const otherMember = page.locator(`[data-participant-id="${f.other.user.userId}"]`);
    await otherMember.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Remove participant', exact: true }).getByRole('button', { name: 'Remove participant', exact: true }).click();
    await otherMember.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
    await page.getByRole('button', { name: 'Add workspace-other', exact: true }).click();
    await otherMember.waitFor();
    await page.getByRole('button', { name: 'Archive conversation', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Archive conversation', exact: true });
    await confirm.getByRole('button', { name: 'Archive conversation', exact: true }).click(); await confirm.waitFor({ state: 'detached' });
    await page.locator('.zero-messaging-conversation-header').getByText('Archived conversation', { exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Message', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
    await page.getByRole('button', { name: 'Restore conversation', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Restore conversation', exact: true }).getByRole('button', { name: 'Restore conversation', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-slot="messaging-composer"] textarea')?.hasAttribute('disabled'));
    await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
    await page.locator(`[data-participant-id="${f.peer.user.userId}"]`).getByRole('button', { name: 'Make owner', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Transfer ownership', exact: true }).getByRole('button', { name: 'Transfer ownership', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
    await page.getByRole('button', { name: 'Leave conversation', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Leave conversation', exact: true }).getByRole('button', { name: 'Leave conversation', exact: true }).click();
    await page.getByText('Select a conversation', { exact: true }).waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); await f.close(); }
}, 90000);

browserTest('visible-end reads require viewport visibility and dwell, respect an explicit blur fence, and clear native revoked history', async () => {
  const f = await fixture(), context = await lease!.browser.newContext({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' }), page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000);
  try {
    await page.goto(f.base + '/workspace'); await page.bringToFront();
    await page.getByRole('button', { name: 'workspace-peer', exact: false }).click();
    await page.evaluate(() => { document.getElementById('root')!.style.transform = 'translateY(1200px)'; });
    await page.locator('.zero-messaging-transcript').getByText('Synthetic native history 55', { exact: true }).waitFor({ state: 'attached' });
    // Negative observation spans the documented 750ms dwell, not a network-ready heuristic.
    await page.waitForTimeout(1000);
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(55);
    await page.evaluate(() => { document.getElementById('root')!.style.transform = ''; });
    const firstRead = page.waitForResponse(response => response.url().endsWith('/read') && response.request().method() === 'POST' && response.status() === 200);
    await page.bringToFront(); await page.getByRole('textbox', { name: 'Message', exact: true }).focus(); await firstRead;
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(0);
    // Headless Chromium/Playwright force document focus; switching tabs is not
    // an OS-focus qualification. Exercise the explicit browser-event fence and
    // retain that limitation in the evidence instead of faking hasFocus().
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
    await f.send('Not read in an unfocused tab'); await page.waitForTimeout(1000);
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(1);
    const nextRead = page.waitForResponse(response => response.url().endsWith('/read') && response.request().method() === 'POST' && response.status() === 200);
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus'))); await nextRead;
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(0);
    const revocable = await f.call('POST', '/api/messaging/conversations', { kind: 'group', title: 'Native revocation check', userIds: [f.admin.user.userId] }, f.peer.accessToken, 'revocable-group');
    await f.call('POST', `/api/messaging/conversations/${revocable.id}/messages`, { text: 'Revocable synthetic history' }, f.peer.accessToken, 'revocable-history');
    await page.getByRole('button', { name: 'Native revocation check', exact: false }).click();
    await page.locator('.zero-messaging-transcript').getByText('Revocable synthetic history', { exact: true }).waitFor();
    await f.call('POST', `/api/messaging/conversations/${revocable.id}/remove`, { expectedRevision: revocable.revision, userId: f.admin.user.userId }, f.peer.accessToken, 'revoke-browser-membership');
    await page.getByRole('alert').filter({ hasText: 'This conversation is unavailable. Recheck your access before retrying.' }).waitFor();
    expect(await page.locator('.zero-messaging-transcript').getByText('Revocable synthetic history', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('textbox', { name: 'Message', exact: true }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); await f.close(); }
}, 90000);

browserTest('read focus resamples a delayed getter, cancels on blur and requires trusted activity to recover a missed focus event', async () => {
  const f = await fixture(), page = await lease!.browser.newPage({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12000);
  try {
    await page.goto(f.base + '/workspace');
    const initial = page.waitForResponse(response => response.url().endsWith('/read') && response.request().method() === 'POST' && response.status() === 200);
    await page.getByRole('button', { name: 'workspace-peer', exact: false }).click(); await page.getByRole('textbox', { name: 'Message', exact: true }).click(); await initial;
    // Deterministic event-order regression only, not OS-focus qualification.
    await page.evaluate(() => {
      let focused = false;
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
      Object.assign(window, { __syntheticFocus: (value: boolean) => { focused = value; } });
      window.dispatchEvent(new FocusEvent('blur'));
    });
    await f.send('Synthetic delayed focus getter');
    await page.locator('.zero-messaging-transcript').getByText('Synthetic delayed focus getter', { exact: true }).waitFor();
    const resumed = page.waitForResponse(response => response.url().endsWith('/read') && response.request().method() === 'POST' && response.status() === 200);
    await page.evaluate(() => { window.dispatchEvent(new FocusEvent('focus')); (window as any).__syntheticFocus(true); }); await resumed;
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(0);
    await page.evaluate(() => { (window as any).__syntheticFocus(false); window.dispatchEvent(new FocusEvent('blur')); });
    await f.send('Synthetic blur cancels the pending frame');
    await page.locator('.zero-messaging-transcript').getByText('Synthetic blur cancels the pending frame', { exact: true }).waitFor();
    await page.evaluate(() => { window.dispatchEvent(new FocusEvent('focus')); (window as any).__syntheticFocus(true); window.dispatchEvent(new FocusEvent('blur')); });
    await page.waitForTimeout(1000);
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(1);
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await page.waitForTimeout(1000);
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(1);
    const clicked = page.waitForResponse(response => response.url().endsWith('/read') && response.request().method() === 'POST' && response.status() === 200);
    await page.getByRole('textbox', { name: 'Message', exact: true }).click(); await clicked;
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(0);
  } finally { await page.close(); await f.close(); }
}, 90000);

// Opt in on a workstation with a real window server. CI's headless event-fence
// check above cannot establish actual tab visibility/focus behavior.
const headedTest = playwrightTestBrowserAvailable && process.env.ZERO_MESSAGING_HEADED === '1' ? test : test.skip;
headedTest('headed Chromium qualifies native background-window admission and both notification audio files', async () => {
  const native = await launchNativeWindowBrowser();
  try { await qualifyAlertPolicy(native.browser, true, native.context); } finally { await native.close(); }
}, 120000);
headedTest('headed Chromium actual window focus interrupts read dwell and resumes only when visible and focused', async () => {
  const f = await fixture();
  const native = await launchNativeWindowBrowser(), context = native.context;
  const page = await context.newPage(), other = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 760 });
  const faults: string[] = []; page.on('pageerror', error => faults.push(error.message)); page.setDefaultTimeout(12000);
  await page.addInitScript(() => {
    const rows: unknown[] = []; Object.assign(window, { __nativeReadFocus: rows });
    for (const type of ['focus', 'blur', 'focusin', 'visibilitychange', 'pointerdown']) {
      const target = type === 'visibilitychange' || type === 'focusin' || type === 'pointerdown' ? document : window;
      target.addEventListener(type, event => { rows.push({ type, trusted: event.isTrusted, focused: document.hasFocus(), visibility: document.visibilityState }); if (rows.length > 50) rows.shift(); });
    }
  });
  try {
    // Native default context with Playwright noDefaults: no focus emulation,
    // synthetic blur/focus/visibility events or overridden document getters.
    await page.goto(f.base + '/workspace'); await page.bringToFront();
    const initialRead = page.waitForResponse(response => response.url().endsWith('/read') && response.request().method() === 'POST' && response.status() === 200);
    await page.getByRole('button', { name: 'workspace-peer', exact: false }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).click(); await initialRead;
    await other.goto('about:blank'); await other.bringToFront();
    // Playwright opens separate native windows here. An unfocused window can
    // remain visible; requiring "hidden" would test a false browser premise.
    await page.waitForFunction(() => !document.hasFocus());
    const unfocused = await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }));
    await f.send('Synthetic unread while a real other window is active'); await page.waitForTimeout(1100);
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(1);
    const resumedRead = page.waitForResponse(response => response.url().endsWith('/read') && response.request().method() === 'POST' && response.status() === 200);
    await page.bringToFront(); await page.getByRole('textbox', { name: 'Message', exact: true }).click();
    await page.waitForFunction(() => document.visibilityState === 'visible' && document.hasFocus()); await resumedRead;
    const visible = await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }));
    expect((await f.call('GET', `/api/messaging/conversations/${f.conversation.id}`, undefined, f.admin.accessToken)).unreadCount).toBe(0);
    expect(unfocused.focused).toBe(false); expect(visible).toEqual({ visibility: 'visible', focused: true }); expect(faults).toEqual([]);
    await Bun.write(join(evidence, 'headed-window-lifecycle.json'), JSON.stringify({ platform: process.platform, arch: process.arch, headless: false,
      syntheticLifecycleEvents: false, overriddenDocumentApis: false, unfocused, visible, unreadWhileUnfocused: 1, unreadAfterVisibleDwell: 0 }, null, 2));
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const viewport = document.querySelector('.zero-messaging-transcript'), end = document.querySelector('.zero-messaging-workspace-end');
      const rect = (element: Element | null) => { const r = element?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, height: r.height } : null; };
      return { focused: document.hasFocus(), visibility: document.visibilityState, events: (window as unknown as { __nativeReadFocus: unknown[] }).__nativeReadFocus,
        viewport: rect(viewport), end: rect(end), innerHeight, scrollTop: viewport?.scrollTop, scrollHeight: viewport?.scrollHeight, clientHeight: viewport?.clientHeight,
        readError: document.body.textContent?.includes('Read position was not confirmed.') ?? false };
    });
    console.error('Synthetic native read diagnostics', JSON.stringify(diagnostics));
    throw error;
  } finally { await native.close(); await f.close(); }
}, 90000);
