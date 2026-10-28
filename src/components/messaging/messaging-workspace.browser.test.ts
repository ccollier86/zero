/** Native browser acceptance: actual Guardian, public SDK, AppProvider, Fabric, private bytes and live streams. No external provider or app data. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../../frontend/server/app-factory';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform', evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing/messaging-workspace-browser';
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = await mkdtemp(join(scratch, 'messaging-workspace-build-'));
  const styles = await buildPlatformStyles(root, join(root, 'absent-app')); css = await Bun.file(styles.cssPath).text();
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'messaging-workspace.browser-fixture.tsx')], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  script = await build.outputs.find(file => file.path.endsWith('.js'))!.text();
  for (const output of build.outputs.filter(file => file.path.endsWith('.css'))) css += '\n' + await output.text();
  await mkdir(evidence, { recursive: true }); lease = await acquirePlaywrightTestBrowser();
}, 90000);
afterAll(() => lease?.release());
async function fixture(support = false) {
  const root = await mkdtemp(join(scratch, 'messaging-workspace-native-')); await mkdir(join(root, 'app'));
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('Synthetic port reservation') });
  const port = reservation.port!; await reservation.stop(true); const base = 'http://127.0.0.1:' + port;
  const app = await createApp({ projectRoot: root, appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    app: { publicUrl: base },
    db: { mode: 'file', path: join(root, 'app.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') }, tables: {},
    auth: { bootstrap: 'public', presence: { enabled: true } }, messaging: { support: support ? {} : false }, logging: false,
    ai: false, email: false, workflows: false, vector: false, pdf: false, kv: false, stateSync: false, observability: false,
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false });
  app.get('/fixture.js', () => new Response(script, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }));
  app.get('/workspace', () => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nhtml,body,#root{margin:0;height:100dvh}#root{box-sizing:border-box;padding:12px}</style><div id="root"></div><script>window.__PLATFORM_CONFIG__={auth:true,presence:true,logging:false,stateSync:false,routeAuth:'protected-by-default',publicPaths:['/workspace']}</script><script src="/fixture.js"></script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
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
  for (let i = 1; i <= 55; i++) await send('Synthetic native history ' + i, 'history-' + i);
  return { base, app, call, admin, peer, other, conversation, send, close: () => app.stop(true) };
}
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
