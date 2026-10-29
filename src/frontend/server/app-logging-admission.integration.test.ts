/** Real Guardian, HTTP, Fabric and cookie recovery. The public strict preset stays guarded during qualification. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuthPlugin } from '../../auth/auth.plugin';
import type { AuthRuntime } from '../../auth/auth-runtime';
import { createReactiveDB } from '../../sync/reactive-db';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_AUTH_TOKEN_SERVICE, ZERO_LOGGING_RUNTIME, ZERO_SYNC_DB, ZERO_OBSERVABILITY_RUNTIME } from '../../runtime/service-keys';
import { LoggingRuntime } from '../../logging/logging-runtime';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from '../../logging/logging-managed-config';
import { resolveLoggingConfig } from '../../logging/logging-config';
import { MemoryEventStore } from '../../observability/memory-event-store';
import { createLoggingRouter } from '../../logging/logging-router';
import { installManagedLoggingAdmission } from './app-logging-admission';
import { loggingPageRecovery } from './app-logging-page-recovery';
import { createServerExtensionApp, defineEndpoint, defineRouter } from './server-extensions';
import { createRouterPlugin } from './router-plugin';
import { fileURLToPath } from 'node:url';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'logging-admission-http-'));
  const runtime = new ZeroAppRuntime(), db = createReactiveDB({ mode: 'file', path: join(root, 'system.db') });
  try {
  const base = resolveManagedLoggingConfig({ preset: 'activity', rootDirectory: join(root, 'logs'), custody: { kind: 'local' } }, root) as ResolvedManagedLoggingConfig;
  // This internal qualification fixture composes the real owners directly. It
  // does not remove or add a public bypass around the managed configuration gate.
  const config = { ...base, policy: resolveLoggingConfig({ preset: 'compliance' }) };
  const store = new MemoryEventStore(), observability = { sink: store, store, config: { console: false } };
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, observability);
  const logging = await LoggingRuntime.open(config, observability);
  runtime.set(ZERO_LOGGING_RUNTIME, logging); runtime.set(ZERO_SYNC_DB, db);
  runtime.addCleanup(() => logging.close());
  let auth: AuthRuntime | undefined;
  const plugin = createAuthPlugin({ db, runtime, bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false }, onRuntimeCreated(value) { auth = value; } });
  await auth!.start();
  const app = new Elysia(); installManagedLoggingAdmission(app, runtime); app.use(plugin);
  let calls = 0;
  let releaseStream = () => {};
  app.get('/protected', () => { calls++; return { protected: 'synthetic-protected-value' }; });
  app.post('/expired-write', () => { calls++; logging.admission.invalidate(); return { mustNotRelease: 'synthetic-protected-value' }; });
  app.get('/protected-stream', () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('allowed-start'));
    releaseStream = () => { controller.enqueue(new TextEncoder().encode('must-not-release-after-expiry')); controller.close(); };
  } }), { headers: { 'Content-Type': 'application/octet-stream' } }));
  app.get('/api/health', () => ({ healthy: true }));
  app.get('/private-art.svg', () => { calls++; return new Response('PRIVATE_ART'); });
  app.get('/_build/private-art.svg', () => { calls++; return new Response('PRIVATE_BUILD_ART'); });
  app.use(await createServerExtensionApp({ name: 'audit-public-art', runtime, extensions: [
    defineEndpoint({ name: 'public-art', method: 'GET', path: '/public-art.svg', auth: false,
      handler: () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
        { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' } }) }),
    defineRouter({ name: 'protected-art', prefix: '/required-art', auth: 'required', endpoints: [
      defineEndpoint({ name: 'inherited-private-art', method: 'GET', path: '/image.svg', auth: false,
        handler: () => { calls++; return new Response('PRIVATE_INHERITED_ART'); } }),
    ] }),
  ] }));
  app.use(await createServerExtensionApp({ runtime, extensions: [createLoggingRouter({ pageRecovery: loggingPageRecovery(runtime) })] }));
  app.use(createRouterPlugin({
    appDir: fileURLToPath(new URL('./test-fixtures/logging-public-files', import.meta.url)),
    assetFiles: { '/_build/public-art.svg': new URL('./test-fixtures/logging-public-art.svg', import.meta.url) },
  }));
  app.listen({ hostname: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${app.server!.port}`;
  const call = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { app, logging, runtime, origin, call, calls: () => calls, releaseStream: () => releaseStream(),
    async close() { await app.stop(true); await runtime.dispose(); db.dispose(); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { try { await runtime.dispose(); } finally { db.dispose(); await rm(root, { recursive: true, force: true }); } throw error; }
}

test('HTTP admission blocks protected execution until an authenticated durable acknowledgment and recovers after invalidation', async () => {
  const f = await fixture();
  try {
    const registered = await f.call('/auth/register', { username: 'audit-owner', email: 'audit-owner@example.test', password: 'Fixture-password-123!' });
    expect(registered.status, await registered.clone().text()).toBe(200);
    const user = await registered.json() as { accessToken: string }, headers = { Authorization: 'Bearer ' + user.accessToken };
    expect((await f.call('/api/health', undefined, headers)).status).toBe(200);
    const blocked = await f.call('/protected', undefined, headers);
    expect(blocked.status).toBe(428); expect(f.calls()).toBe(0);
    expect(await blocked.text()).not.toContain('synthetic-protected-value');
    const acknowledge = () => f.call('/api/_zero/logging/observations', { observations: [], policyVersion: f.logging.config.policyVersion }, headers);
    const first = await acknowledge(); expect(first.status, await first.clone().text()).toBe(200);
    expect((await first.json() as { admission: { expiresAt: number } }).admission.expiresAt).toBeGreaterThan(Date.now());
    const allowed = await f.call('/protected', undefined, headers);
    expect(allowed.status, await allowed.clone().text()).toBe(200); expect(f.calls()).toBe(1);
    f.logging.admission.invalidate();
    expect((await f.call('/protected', undefined, headers)).status).toBe(428); expect(f.calls()).toBe(1);
    expect((await acknowledge()).status).toBe(200);
    expect((await f.call('/protected', undefined, headers)).status).toBe(200); expect(f.calls()).toBe(2);
    const page = await f.logging.page('audit', { kind: 'platform' });
    expect(page.events.some(e => e.event.action === 'logging.delivery.acknowledged')).toBe(true);
    expect(page.events.filter(e => e.event.action.startsWith('access.http.'))).toHaveLength(0);
    expect(JSON.stringify(page)).not.toMatch(/synthetic-protected-value|Fixture-password|audit-owner@example/);
  } finally { await f.close(); }
}, 45000);

test('strict release fences interrupt streaming after grant loss and never imply a committed write can be blindly retried', async () => {
  const f = await fixture();
  try {
    const registered = await f.call('/auth/register', { username: 'stream-owner', email: 'stream-owner@example.test', password: 'Fixture-password-123!' });
    const user = await registered.json() as { accessToken: string }, headers = { Authorization: 'Bearer ' + user.accessToken };
    const acknowledge = () => f.call('/api/_zero/logging/observations', { observations: [], policyVersion: f.logging.config.policyVersion }, headers);
    expect((await acknowledge()).status).toBe(200);
    const response = await f.call('/protected-stream', undefined, headers);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('allowed-start');
    f.logging.admission.invalidate(); f.releaseStream();
    // Bun may report interrupted HTTP streams as an error or an early EOF.
    // Neither outcome may deliver the bytes obtained after admission expired.
    const tail = await reader.read().catch(() => ({ done: true, value: undefined }));
    expect(tail.done).toBe(true); expect(tail.value).toBeUndefined();
    await f.logging.flush();
    expect((await f.logging.page('audit', { kind: 'platform' })).events.filter(e => e.event.action.startsWith('access.http.'))).toHaveLength(0);
    expect(f.runtime.require(ZERO_OBSERVABILITY_RUNTIME).store!.query({ code: 'access.http.incomplete' }).count).toBe(1);
    expect((await acknowledge()).status).toBe(200);
    const write = await f.call('/expired-write', {}, headers);
    expect(write.status).toBe(503); expect(await write.json()).toMatchObject({ code: 'LOGGING_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(f.calls()).toBe(1);
  } finally { await f.close(); }
}, 45000);

test('cookie-only SSR recovery is content-free, same-origin and empty-batch-only without weakening API authentication', async () => {
  const f = await fixture();
  try {
    const registered = await f.call('/auth/register', { username: 'page-owner', email: 'page-owner@example.test', password: 'Fixture-password-123!' });
    const user = await registered.json() as { refreshToken: string };
    const tokens = f.runtime.require(ZERO_AUTH_TOKEN_SERVICE), page = await tokens.issuePageSessionToken(user.refreshToken);
    expect(page).not.toBeNull();
    const Cookie = tokens.pageSessionCookieName + '=' + encodeURIComponent(page!.token);
    const blocked = await f.call('/protected', undefined, { Cookie, Accept: 'text/html' });
    expect(blocked.status).toBe(428); expect(blocked.headers.get('content-type')).toContain('text/html');
    expect(blocked.headers.get('referrer-policy')).toBe('same-origin');
    expect(await blocked.text()).not.toContain('synthetic-protected-value'); expect(f.calls()).toBe(0);
    const body = { observations: [], policyVersion: f.logging.config.policyVersion };
    for (const Origin of ['null', 'https://hostile.example']) {
      expect((await f.call('/api/_zero/logging/observations', body, { Cookie, Origin, 'X-Zero-Logging-Recovery': '1' })).status).toBe(401);
    }
    expect((await f.call('/api/_zero/logging/observations', body, { Cookie, Origin: f.origin, 'X-Zero-Logging-Recovery': '1' })).status).toBe(200);
    expect((await f.call('/protected', undefined, { Cookie })).status).toBe(200); expect(f.calls()).toBe(1);
    expect((await f.call('/api/_zero/logging/events', { stream: 'audit', query: {} }, { Cookie })).status).toBe(401);
    f.logging.admission.invalidate();
    const nonempty = { observations: [{ id: 'not-a-recovery', collectorId: 'c', action: 'print.requested', occurredAt: Date.now() }], policyVersion: f.logging.config.policyVersion };
    expect((await f.call('/api/_zero/logging/observations', nonempty, { Cookie, Origin: f.origin, 'X-Zero-Logging-Recovery': '1' })).status).toBe(401);
    expect((await f.call('/protected', undefined, { Cookie })).status).toBe(428);
  } finally { await f.close(); }
}, 45000);

test('explicit public art ignores an ambient staff audit grant while protected images never receive recovery HTML', async () => {
  const f = await fixture();
  try {
    const registered = await f.call('/auth/register', { username: 'art-owner', email: 'art-owner@example.test', password: 'Fixture-password-123!' });
    expect(registered.status).toBe(200);
    const user = await registered.json() as { refreshToken: string };
    const tokens = f.runtime.require(ZERO_AUTH_TOKEN_SERVICE), page = await tokens.issuePageSessionToken(user.refreshToken);
    const Cookie = tokens.pageSessionCookieName + '=' + encodeURIComponent(page!.token);
    const headers = { Cookie, Accept: 'image/svg+xml,image/*;q=0.8', 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors' };
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const path of ['/public-art.svg', '/public-art', '/_build/public-art.svg']) {
        const art = await f.call(path, undefined, headers);
        expect(art.status).toBe(200); expect(art.headers.get('content-type')).toContain('image/svg+xml');
        expect(art.headers.get('cache-control')).toContain('public, max-age=');
        expect(await art.text()).toStartWith('<svg');
      }
      f.logging.admission.invalidate();
    }
    for (const path of ['/private-art.svg', '/required-art/image.svg', '/_build/private-art.svg', '/private/image']) {
      const rejected = await f.call(path, undefined, { ...headers, 'X-Zero-Public': 'true' });
      expect(rejected.status).toBe(428); expect(rejected.headers.get('content-type')).toContain('application/json');
      expect(await rejected.json()).toMatchObject({ code: 'LOGGING_ADMISSION_REQUIRED' });
    }
    expect(f.calls()).toBe(0);
    await f.logging.close();
    const publicDuringOutage = await f.call('/public-art.svg', undefined, headers);
    expect(publicDuringOutage.status).toBe(200); expect(await publicDuringOutage.text()).toStartWith('<svg');
  } finally { await f.close(); }
}, 45000);

(playwrightTestBrowserAvailable ? test : test.skip)('Chromium decodes native, file-route and build artwork with a staff cookie before admission and during a logging outage', async () => {
  const f = await fixture(), lease = await acquirePlaywrightTestBrowser();
  const context = await lease.browser.newContext();
  try {
    const registered = await f.call('/auth/register', { username: 'image-browser-owner', email: 'image-browser@example.test', password: 'Fixture-password-123!' });
    expect(registered.status).toBe(200);
    const { refreshToken } = await registered.json() as { refreshToken: string }, tokens = f.runtime.require(ZERO_AUTH_TOKEN_SERVICE);
    const session = await tokens.issuePageSessionToken(refreshToken);
    await context.addCookies([{ name: tokens.pageSessionCookieName, value: encodeURIComponent(session!.token), url: f.origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); await page.goto(f.origin + '/api/health');
    for (let phase = 0; phase < 3; phase++) {
      if (phase === 1) f.logging.admission.invalidate();
      if (phase === 2) await f.logging.close();
      for (const path of ['/public-art.svg', '/public-art', '/_build/public-art.svg']) {
        const decoded = await page.evaluate(async src => {
          const image = new Image(); image.src = src; document.body.append(image);
          try { await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; }
          catch { return { width: 0, height: 0 }; }
          finally { image.remove(); }
        }, f.origin + path + '?synthetic-phase=' + phase);
        expect(decoded).toEqual({ width: 8, height: 8 });
      }
      const rejected = await page.request.get(f.origin + '/private-art.svg', { headers: { Accept: 'image/*', 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors' } });
      expect(rejected.status()).toBe(428); expect(rejected.headers()['content-type']).toContain('application/json');
    }
    expect(f.calls()).toBe(0);
  } finally { await context.close(); lease.release(); await f.close(); }
}, 60000);
