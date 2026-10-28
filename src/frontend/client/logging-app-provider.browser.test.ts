/** Real Chromium, managed Guardian/HTTP and strict audit workers. No live app identities or data. */
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app-factory';
import { defineZeroPlugin } from '../server/server-extensions';
import type { ServerRouteServices } from '../server/server-services';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';
import sharp from 'sharp';
import { buildBrowserFixture } from '../../test-support/build-browser-fixture';
import { buildPlatformStyles } from '../server/style-bundle';
import type { LoggingHealth } from '../../logging/logging-api-contracts';

(playwrightTestBrowserAvailable ? test : test.skip)('AppProvider masks protected UI when delivery is blocked, retries, and recovers cookie-only SSR without a reload loop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-provider-browser-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined, services: ServerRouteServices | undefined;
  let blocked = true, acknowledgments = 0, documents = 0;
  const lease = await acquirePlaywrightTestBrowser(), context = await lease.browser.newContext();
  try {
    await mkdir(join(root, 'app'));
    // Other managed-app tests can install server TSX hooks in this process.
    // Compile in the normal CLI's clean process shape, not through those hooks.
    const built = await buildBrowserFixture(join(import.meta.dir, 'test-fixtures/logging-app-provider.tsx'), 'esm'), bundle = built.script;
    const css = await Bun.file((await buildPlatformStyles(root, join(root, 'app'), [], { themeFoundation: 'legacy' })).cssPath).text() + '\n' + built.css;
    const html = () => '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div>'
      + '<script>window.__PLATFORM_CONFIG__=' + JSON.stringify({ auth: true, logging: true, loggingRequired: true,
        loggingPolicyVersion: services!.logging!.config.policyVersion, stateSync: false, presence: false })
      + ';</script><script type="module" src="/fixture.js"></script></body></html>';
    app = await createApp({ projectRoot: root,
      db: { mode: 'file', path: join(root, 'app.db'), synchronous: 'FULL' }, systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {},
      auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false }, userProfile: { avatars: { enabled: true, outputSize: 64 } } },
      logging: { preset: 'compliance', rootDirectory: 'logs' }, workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false,
      appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
      migrate: true, serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
      serverRoutesDir: false, resourceRoutes: false, observability: { console: false }, serverExtensions: [defineZeroPlugin({ name: 'logging-browser', setup({ app, zero }) {
        services = zero;
        app.get('/logging-ui', () => { documents++; return new Response(html(), { headers: { 'Content-Type': 'text/html' } }); });
        app.get('/fixture.js', () => new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } }));
        app.get('/fixture.css', () => new Response(css, { headers: { 'Content-Type': 'text/css' } }));
      } })] });
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${app.server!.port}`;
    const registration = await fetch(origin + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'logging-browser-owner', email: 'logging-browser-owner@example.test', password: 'Fixture-password-123!' }) });
    expect(registration.status).toBe(200);
    const page = await context.newPage(), errors: string[] = [], responses: { path: string; status: number }[] = [];
    await page.route('**/api/_zero/logging/observations', async route => {
      if (blocked) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"SYNTHETIC_UNAVAILABLE"}' });
      else await route.continue();
    });
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (path === '/api/_zero/logging/observations' && response.status() === 200) acknowledgments++;
      const admittedPaths = new Set(['/auth/login', '/auth/refresh', '/auth/me', '/auth/authorization', '/auth/config', '/auth/profile', '/auth/profile/avatar',
        '/api/_zero/logging/observations', '/api/_zero/logging/events', '/api/_zero/logging/health', '/fixture.js', '/logging-ui']);
      responses.push({ path: admittedPaths.has(path) ? path : '/other', status: response.status() }); if (responses.length > 30) responses.shift();
    });
    await page.goto(origin + '/logging-ui'); await page.getByRole('button', { name: 'Sign in fixture', exact: true }).click();
    await page.getByRole('alert', { name: 'Audit delivery required', exact: true }).waitFor();
    expect(await page.getByTestId('logging-protected').count()).toBe(0); expect(acknowledgments).toBe(0);
    blocked = false; await page.getByRole('button', { name: 'Retry audit delivery', exact: true }).click();
    await page.getByTestId('logging-protected').waitFor().catch(async error => {
      const state = await page.evaluate(() => (window as unknown as { __loggingBrowserStatus(): unknown }).__loggingBrowserStatus());
      throw new Error(JSON.stringify({ state, acknowledgments, documents, responses, text: await page.locator('body').innerText(), errors }) + '\n' + error);
    }); expect(acknowledgments).toBeGreaterThan(0);
    services!.logging!.admission.invalidate();
    const before = documents; await page.reload(); await page.getByTestId('logging-protected').waitFor();
    expect(documents - before).toBe(1);
    expect(await page.getByRole('alert', { name: 'Audit delivery required', exact: true }).count()).toBe(0);
    // Qualify the current logging people's private photos through the native
    // profile UI, Storage stage/grant/upload/finalize and authorized delivery.
    // No directory/photo adapter or directly minted session is substituted.
    await page.getByRole('button', { name: 'Show profile', exact: true }).click();
    await page.getByRole('button', { name: 'Upload photo', exact: true }).click().catch(async error => {
      const readiness = await page.evaluate(() => (window as unknown as { __loggingNativeReadiness(): Promise<unknown> }).__loggingNativeReadiness());
      throw new Error(JSON.stringify({ stage: 'native-profile-readiness', readiness, responses, errors }) + '\n' + error);
    });
    const image = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#557766' } }).png().toBuffer();
    await page.getByLabel('Profile picture file', { exact: true }).setInputFiles({ name: 'synthetic-audit-person.png', mimeType: 'image/png', buffer: image });
    const crop = page.getByRole('dialog'); await crop.waitFor();
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.reactEasyCrop_Image')?.naturalWidth === 160);
    await crop.getByRole('button', { name: 'Save picture', exact: true }).click(); await crop.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-slot="avatar-editor"] img')?.naturalWidth === 64);
    await page.getByRole('button', { name: 'Show audit', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-slot="logging-workspace"] img')].some(image => image.currentSrc.startsWith('blob:') && image.naturalWidth === 64));
    expect(await page.locator('[data-slot="logging-workspace"]').textContent()).toContain('logging-browser-owner');
    const health = await page.evaluate(() => (window as unknown as { __loggingNativeHealth(): Promise<LoggingHealth> }).__loggingNativeHealth());
    expect(health).toMatchObject({ state: 'ready', preset: 'compliance', failedEvents: 0, sourceDeliveryFailures: 0, maintenanceFailures: 0 });
    expect(health.operationalBridge?.failed).toBe(0);
    expect(JSON.stringify(health)).not.toMatch(/Fixture-password|logging-browser-owner@example/);
    expect(errors).toEqual([]);
    const events = await services!.logging!.page('audit', { kind: 'platform' });
    expect(JSON.stringify(events)).not.toMatch(/Fixture-password|logging-browser-owner@example/);
  } finally { await context.close(); lease.release(); await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
