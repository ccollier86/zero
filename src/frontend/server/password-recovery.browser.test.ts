/** Managed createApp + compliance + native mail outbox + actual Chromium form/SDK journey. Synthetic private state only. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { MemoryEmailProvider } from '../../email';
import { getAuthEmailOutbox } from '../../auth/auth-runtime';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import { createApp } from './app-factory';
import { defineEndpoint, defineRouter, defineZeroPlugin } from './server-extensions';
import type { ServerRouteServices } from './server-services';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, app: Awaited<ReturnType<typeof createApp>> | undefined;
let root: string | undefined, origin = '', bundle = '', services: ServerRouteServices;
const provider = new MemoryEmailProvider();
const oldPassword = 'Original-password-123!', nextPassword = 'Replacement-password-123!';
let sequence = 0, administrator: { accessToken: string; user: { userId: string } };

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  root = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-reset-browser-'));
  await mkdir(join(root, 'app'));
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, '../../components/auth/password-action-form.browser-fixture.tsx')],
    target: 'browser', format: 'esm', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!build.success) throw new Error('Managed password fixture build failed.');
  bundle = await build.outputs[0]!.text();
  const reserved = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reserved.port; await reserved.stop(true); origin = 'http://127.0.0.1:' + port;
  const html = () => new Response('<!doctype html><title>Native password recovery</title><div id="root"></div>'
    + '<script>window.__passwordNativeProvider=true;window.__PLATFORM_CONFIG__='
    + JSON.stringify({ auth: true, logging: true, loggingRequired: true, loggingPolicyVersion: services.logging!.config.policyVersion })
    + ';</script><script type="module" src="/password-fixture.js"></script>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  app = await createApp({ projectRoot: root, app: { name: 'Synthetic password recovery', publicUrl: origin },
    db: { mode: 'file', path: join(root, 'application.db'), synchronous: 'FULL' },
    systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {},
    auth: { bootstrap: 'public', registration: { mode: 'public' } },
    // No cooldown override: the real five-minute anti-abuse policy must survive the UI repair.
    email: { provider, from: 'Synthetic recovery <noreply@example.test>' },
    logging: { preset: 'compliance', rootDirectory: 'logging' },
    ai: false, vector: false, pdf: false, kv: false, workflows: false, stateSync: false,
    observability: { console: false }, themeFoundation: 'legacy',
    frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
    serverRoutesDir: false, resourceRoutes: false,
    serverExtensions: [defineZeroPlugin({ name: 'capture-reset-browser', setup({ zero }) { services = zero; } }),
      defineRouter({ name: 'reset-browser-ui', auth: false, routes: [
        ...['/reset-password', '/setup-password', '/forgot-password', '/login'].map(path => defineEndpoint({ method: 'GET', path, handler: html })),
        defineEndpoint({ method: 'GET', path: '/password-fixture.js', handler: () => new Response(bundle,
          { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' } }) }),
      ] })],
  });
  app.listen({ hostname: '127.0.0.1', port });
  administrator = (await register()).data;
  const acknowledgment = await post('/api/_zero/logging/observations',
    { observations: [], policyVersion: services.logging!.config.policyVersion }, administrator.accessToken);
  expect(acknowledgment.status).toBe(200);
  lease = await acquirePlaywrightTestBrowser();
}, 60000);

afterAll(async () => {
  await lease?.release();
  try { await app?.stop(true); } finally { if (root) await rm(root, { recursive: true, force: true }); }
});

async function post(path: string, body: object, token?: string) {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() as any };
}
async function register() {
  const username = 'reset-browser-' + ++sequence, email = username + '@example.test';
  const result = await post('/auth/register', { username, email, password: oldPassword });
  expect(result.status).toBe(200); return { ...result, username, email };
}
async function browser() {
  const context = await lease!.browser.newContext(), page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.name + ': ' + error.message.split('\n')[0]!.replace(/https?:\/\/\S+/g, '[test-route]'))); page.setDefaultTimeout(10000);
  return { context, page, async close() { await context.close(); expect(errors).toEqual([]); } };
}
async function requestFromForm(page: Page, email: string) {
  await page.goto(origin + '/forgot-password'); await page.getByLabel('Email', { exact: true }).fill(email);
  const requested = page.waitForResponse(response => response.url() === origin + '/auth/forgot-password' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  expect((await requested).status()).toBe(200);
  await page.getByRole('heading', { name: 'Request received', exact: true }).waitFor();
  await page.getByText('Repeated requests may be delayed for security.', { exact: false }).waitFor();
  await page.getByText('For security, wait another 5 minutes before requesting a new link.', { exact: true }).waitFor();
  expect(await page.getByRole('button', { name: 'Request another link', exact: true }).isDisabled()).toBe(true);
}
function messages(email: string) {
  return provider.messages.filter(row => [row.message.to].flat().includes(email));
}
async function emailLink(email: string, count = 1) {
  const deadline = Date.now() + 5000;
  while (messages(email).length < count) {
    if (Date.now() >= deadline) throw new Error('Synthetic native reset email was not delivered.');
    await Bun.sleep(10);
  }
  const text = messages(email).at(-1)!.message.text;
  const link = text.match(/https?:\/\/[^\s]+/g)?.find(candidate => new URL(candidate).searchParams.has('token'));
  if (!link || new URL(link).origin !== origin) throw new Error('Synthetic reset mail did not contain its native link.');
  return link;
}
async function savePassword(page: Page, password = nextPassword) {
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  const saved = page.waitForResponse(response => response.url() === origin + '/auth/reset-password' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor();
}
async function noTokenPrompt(page: Page) {
  expect(await page.getByLabel('Email token', { exact: true }).count()).toBe(0);
  expect(await page.getByPlaceholder('Paste token').count()).toBe(0);
  expect(await page.getByText('Confirm audit delivery', { exact: true }).count()).toBe(0);
}

browserTest('native reset succeeds once; reopening its email explains consumption; repeated public requests retain the real cooldown', async () => {
  const user = await register(), h = await browser();
  try {
    await requestFromForm(h.page, user.email); const link = await emailLink(user.email);
    await h.page.goto(link); await noTokenPrompt(h.page); await savePassword(h.page);
    expect((await post('/auth/login', { username: user.username, password: oldPassword })).status).toBe(401);
    expect((await post('/auth/login', { username: user.username, password: nextPassword })).status).toBe(200);
    await h.page.goto(link); await h.page.getByRole('heading', { name: 'This password link has already been used', exact: true }).waitFor();
    await noTokenPrompt(h.page);
    const token = new URL(link).searchParams.get('token')!;
    const replay = await post('/auth/reset-password', { token, newPassword: 'Replay-password-123!' });
    expect(replay.status).toBe(400); expect(replay.data.code).toBe('ACTION_TOKEN_CONSUMED');
    await requestFromForm(h.page, user.email); await requestFromForm(h.page, user.email);
    expect(messages(user.email)).toHaveLength(1); expect(getAuthEmailOutbox()!.count('pending')).toBe(0);
    expect((await post('/auth/login', { username: user.username, password: nextPassword })).status).toBe(200);
    // A permitted administrator can still send a distinct fresh recovery proof.
    const fresh = await post('/auth/admin/users/' + user.data.user.userId + '/send-password-reset', {}, administrator.accessToken);
    expect(fresh.status).toBe(200); const newLink = await emailLink(user.email, 2);
    expect(newLink === link).toBe(false); await h.page.goto(newLink); await noTokenPrompt(h.page);
    await savePassword(h.page, 'Another-password-456!');
    expect((await post('/auth/login', { username: user.username, password: 'Another-password-456!' })).status).toBe(200);
  } finally { await h.close(); }
}, 60000);

browserTest('temporary native inspection interruption is recoverable by read-only Retry; email scanners/readers do not consume the proof', async () => {
  const user = await register(), h = await browser();
  try {
    expect((await post('/auth/forgot-password', { email: user.email })).status).toBe(200); const link = await emailLink(user.email);
    const token = new URL(link).searchParams.get('token')!;
    for (let i = 0; i < 2; i++) expect((await fetch(origin + '/auth/action-token/' + token)).status).toBe(200);
    let inspections = 0;
    await h.page.route(origin + '/auth/action-token/**', route => ++inspections === 1 ? route.abort('failed') : route.continue());
    await h.page.goto(link); await h.page.getByRole('button', { name: 'Retry link check', exact: true }).waitFor(); await noTokenPrompt(h.page);
    await h.page.getByRole('button', { name: 'Retry link check', exact: true }).click();
    await h.page.getByLabel('New password', { exact: true }).waitFor(); expect(inspections).toBe(2);
    await savePassword(h.page); expect(messages(user.email)).toHaveLength(1);
  } finally { await h.close(); }
}, 60000);

browserTest('an already signed-in browser can complete an emailed reset through AppProvider scope retirement without returning to token entry', async () => {
  const user = await register(), h = await browser();
  try {
    expect((await post('/auth/forgot-password', { email: user.email })).status).toBe(200); const link = await emailLink(user.email);
    await h.page.goto(link); await h.page.getByLabel('New password', { exact: true }).waitFor();
    await h.page.evaluate(async input => { await window.__passwordForm.signIn(input.username, input.password); }, { username: user.username, password: oldPassword });
    await h.page.getByLabel('New password', { exact: true }).waitFor();
    await savePassword(h.page); await noTokenPrompt(h.page);
    expect((await post('/auth/login', { username: user.username, password: nextPassword })).status).toBe(200);
  } finally { await h.close(); }
}, 60000);

browserTest('lost browser response after a real committed reset stays unknown and is never automatically resubmitted', async () => {
  const user = await register(), h = await browser();
  try {
    expect((await post('/auth/forgot-password', { email: user.email })).status).toBe(200); const link = await emailLink(user.email);
    let writes = 0;
    await h.page.route(origin + '/auth/reset-password', async route => {
      writes++; const accepted = await route.fetch(); expect(accepted.status()).toBe(200); await route.abort('failed');
    });
    await h.page.goto(link); await h.page.getByLabel('New password', { exact: true }).fill(nextPassword);
    await h.page.getByLabel('Confirm password', { exact: true }).fill(nextPassword);
    await h.page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await h.page.getByRole('heading', { name: 'We couldn’t confirm the password update', exact: true }).waitFor();
    await noTokenPrompt(h.page); expect(writes).toBe(1); expect(await h.page.evaluate(() => window.__passwordForm.successes)).toBe(0);
    expect(await h.page.locator('[data-slot="password-action-form"]').count()).toBe(0);
    expect((await post('/auth/login', { username: user.username, password: nextPassword })).status).toBe(200);
    expect((await post('/auth/login', { username: user.username, password: oldPassword })).status).toBe(401);
  } finally { await h.close(); }
}, 60000);
