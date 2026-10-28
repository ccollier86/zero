/** Generated file-router hydration + native sign-in + real Guardian/compliance workers. Synthetic state only. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../server/app-factory';
import { defineEndpoint, defineRouter, defineZeroPlugin } from '../server/server-extensions';
import type { ServerRouteServices } from '../server/server-services';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics';
const appDir = join(import.meta.dir, 'test-fixtures/session-audit-app/app');
let build: string | undefined, entry: string | undefined;

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  await mkdir(scratch, { recursive: true }); await mkdir(artifacts, { recursive: true });
  build = await mkdtemp(join(scratch, 'session-audit-build-'));
  // Build in the same clean process shape as the CLI, not within the server
  // test process's installed TSX module hooks.
  const compiler = Bun.spawn([process.execPath, '--no-env-file', '-e',
    `import { buildClientBundle } from ${JSON.stringify(join(import.meta.dir, '../server/client-bundle.ts'))};
     const result = await buildClientBundle(${JSON.stringify(join(build, 'assets'))}, ${JSON.stringify(appDir)},
       ${JSON.stringify({ generatedDir: join(build, 'generated'), appImportAlias: appDir, hydrationRuntimeImport: join(import.meta.dir, 'hydrate-runtime.tsx') })});
     console.log(JSON.stringify({publicPath:result.publicPath}));`], { stdout: 'pipe', stderr: 'pipe' });
  const [code, output, error] = await Promise.all([compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text()]);
  if (code !== 0) throw new Error('Generated browser fixture build failed: ' + error);
  entry = (JSON.parse(output) as { publicPath: string }).publicPath;
}, 60000);
afterAll(async () => { if (build) await rm(build, { recursive: true, force: true }); });

for (const scenario of ['fresh', 'blocked', 'retry-session'] as const) browserTest(
  `generated native first login ${scenario === 'blocked' ? 'after blocked audit delivery and native retry' : scenario === 'retry-session' ? 'after a retryable refresh failure and native session retry' : 'with unblocked audit delivery'} reaches its protected workspace`, async () => {
    if (!build || !entry) throw new Error('Generated browser fixture was not built.');
    const root = await mkdtemp(join(scratch, 'session-audit-runtime-'));
    const lease = await acquirePlaywrightTestBrowser(), context = await lease.browser.newContext();
    let app: Awaited<ReturnType<typeof createApp>> | undefined, services: ServerRouteServices | undefined;
    let blocked = scenario === 'blocked', failRefresh = scenario === 'retry-session', acknowledgments = 0, documents = 0, proof = 0;
    const responses: { path: string; status: number }[] = [], errors: string[] = [];
    try {
      app = await createApp({ projectRoot: root, appDir, outDir: join(build, 'assets'), generatedDir: join(build, 'generated'), storageDir: join(root, 'storage'),
        db: { mode: 'file', path: join(root, 'application.db'), synchronous: 'FULL' },
        systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {},
        auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
        loginPath: '/login', postLoginPath: '/workspace', publicPaths: ['/login'],
        logging: { preset: 'compliance', rootDirectory: join(root, 'logging') },
        workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false,
        themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', clientEntry: entry, plugins: {} }, pluginIdentities: {} },
        migrate: false, serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
        serverRoutesDir: false, resourceRoutes: false, observability: { console: false }, serverExtensions: [
          defineZeroPlugin({ name: 'session-audit-inspection', setup({ zero }) { services = zero; } }),
          defineRouter({ name: 'session-audit-proof', prefix: '/proof', auth: { user: 'required', credentials: ['session'] }, routes: [
            defineEndpoint({ method: 'POST', path: '/record', handler: async ({ zero }) => {
              zero.access.requirePlatformAdmin();
              const id = 'proof.' + ++proof;
              await zero.logging!.record({ id, family: 'records', action: 'fixture.audit.prepared', outcome: 'succeeded', evidence: 'server-confirmed',
                occurredAt: Date.now(), target: { type: 'report', id } }); return { id };
            } }),
          ] }),
        ] });
      app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = 'http://127.0.0.1:' + app.server!.port;
      const registered = await fetch(origin + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'session-audit-owner', email: 'owner@example.test', password: 'Fixture-password-123!' }) });
      expect(registered.status).toBe(200);
      const account = await registered.json() as { user: { userId: string } };
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (response.request().resourceType() === 'document') documents++;
        if (path === '/api/_zero/logging/observations' && response.status() === 200) acknowledgments++;
        if (path.startsWith('/auth/') || path.startsWith('/api/_zero/logging/')) { responses.push({ path, status: response.status() }); if (responses.length > 40) responses.shift(); }
      });
      await page.route('**/api/_zero/logging/observations', route => blocked
        ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"SYNTHETIC_UNAVAILABLE"}' }) : route.continue());
      await page.route('**/auth/refresh', route => failRefresh
        ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"AUTH_UNAVAILABLE"}' }) : route.continue());
      const initial = await page.goto(origin + '/login?redirect=%2Fworkspace');
      expect((await initial!.text()).includes('__ROUTE_DATA__')).toBe(true);
      await page.getByLabel('Username or email', { exact: true }).fill('session-audit-owner');
      await page.getByLabel('Password', { exact: true }).fill('Fixture-password-123!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      if (blocked) {
        await page.getByRole('alert', { name: 'Audit delivery required', exact: true }).waitFor();
        expect(await page.getByTestId('session-audit-workspace').count()).toBe(0); expect(acknowledgments).toBe(0);
        blocked = false; await page.getByRole('button', { name: 'Retry audit delivery', exact: true }).click();
      }
      if (scenario === 'retry-session') {
        await page.getByRole('heading', { name: 'Session refresh required', exact: true }).waitFor();
        expect(await page.getByTestId('session-audit-workspace').count()).toBe(0);
        failRefresh = false; await page.getByRole('button', { name: 'Retry session', exact: true }).click();
      }
      await page.getByTestId('session-audit-workspace').waitFor().catch(async cause => {
        await page.screenshot({ path: join(artifacts, 'session-audit-recovery-' + scenario + '.png') });
        throw new Error(JSON.stringify({ documents, acknowledgments, responses, errors, visible: await page.locator('body').innerText() }), { cause });
      });
      expect(new URL(page.url()).pathname).toBe('/workspace'); expect(acknowledgments).toBeGreaterThan(0);
      expect(await page.getByRole('heading', { name: 'Session refresh required', exact: true }).count()).toBe(0);
      expect(await page.getByTestId('session-audit-workspace').getAttribute('data-browser-viewer')).toBe(account.user.userId);
      expect(documents).toBeLessThanOrEqual(4);
      expect(errors).toEqual([]);
      if (scenario === 'fresh') {
        // Real append notifications after hydration, not a mock table source.
        await page.getByText('No retained events match these filters.', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Record synthetic activity', exact: true }).click();
        // Inspect controls retain an exact event identity while visible cells
        // use readable resource/person labels. Do not restore raw-ID columns.
        const inspect = (id: string) => page.getByRole('button', { name: `Inspect event ${id}`, exact: true });
        const first = inspect('proof.1'); await first.waitFor();
        const retained = await first.evaluateHandle(element => element.closest('[data-row-id]'));
        await page.getByRole('button', { name: 'Record synthetic activity', exact: true }).click();
        await inspect('proof.2').waitFor();
        expect(await retained.evaluate(element => element?.isConnected)).toBe(true);
        expect(await page.locator('[data-slot="data-table-skeleton-body"]').count()).toBe(0);
        await page.getByRole('button', { name: 'Record synthetic burst', exact: true }).click();
        await inspect('proof.32').waitFor();
        await page.getByRole('button', { name: 'Next page', exact: true }).click(); await first.waitFor();
        await page.getByRole('button', { name: 'Record synthetic activity', exact: true }).click();
        // The preceding concurrent burst can still have buffered visual
        // arrivals; use the standard control's current count, not an assumed 1.
        const incoming = page.getByRole('button', { name: /^Reveal \d+ new records$/ });
        await incoming.waitFor().catch(async cause => { throw new Error(JSON.stringify({ proof, visible: await page.locator('body').innerText() }), { cause }); });
        expect(await inspect('proof.33').count()).toBe(0);
        await incoming.click();
        const newest = inspect('proof.33'); await newest.waitFor();
        const filter = async (actor: string, resource = '') => {
          await page.getByRole('button', { name: /^More filters/ }).click();
          await page.getByLabel('User ID', { exact: true }).fill(actor);
          await page.getByLabel('Record ID', { exact: true }).fill(resource);
          await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
        };
        await filter('absent-fixture-user'); await page.getByText('No retained events match these filters.', { exact: true }).waitFor();
        await filter(account.user.userId, 'proof.33'); await newest.waitFor();
        expect(await inspect('proof.32').count()).toBe(0);
        await newest.click(); await page.getByRole('dialog', { name: 'Event evidence', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Close', exact: true }).click();

        // Expired/retired server delivery admission exercises the real
        // cookie-only recovery document before protected SSR is released.
        services!.logging!.admission.invalidate(); const beforeReload = documents;
        await page.reload(); await page.getByTestId('session-audit-workspace').waitFor();
        expect(await page.title()).toBe('Synthetic audit workspace');
        expect(await page.getByTestId('session-audit-workspace').getAttribute('data-server-viewer')).toBe(account.user.userId);
        expect(documents - beforeReload).toBeLessThanOrEqual(3);
        // A real new tab shares the browser profile's existing session proof.
        // Copying only a page cookie into an unrelated empty profile instead
        // exercises the intentionally rejected server-only identity case.
        const tab = await context.newPage();
        try {
          tab.setDefaultTimeout(12000);
          await tab.goto(origin + '/workspace'); await tab.getByTestId('session-audit-workspace').waitFor();
          expect(await tab.getByTestId('session-audit-workspace').getAttribute('data-server-viewer')).toBe(account.user.userId);
          expect(await tab.getByRole('button', { name: 'Retry session', exact: true }).count()).toBe(0);
        } finally { await tab.close(); }
        await inspect('proof.33').waitFor();
        await inspect('proof.33').click();
        await page.getByRole('dialog', { name: 'Event evidence', exact: true }).waitFor();
        await page.screenshot({ path: join(artifacts, 'session-audit-recovery-live-evidence.png') });
        services!.auth.store!.updateUser(account.user.userId, { role: 'user' });
        await page.getByRole('dialog', { name: 'Event evidence', exact: true }).waitFor({ state: 'detached' });
        await page.getByTestId('session-audit-workspace').waitFor({ state: 'detached' });
        expect(await inspect('proof.33').count()).toBe(0);
      }
      expect(errors).toEqual([]);
      await page.screenshot({ path: join(artifacts, 'session-audit-recovery-' + scenario + (scenario === 'fresh' ? '-revoked.png' : '-ready.png')) });
      expect(services!.logging!.diagnostics().coverage.complianceReady).toBe(true);
    } finally { await context.close(); lease.release(); await app?.stop(true); await rm(root, { recursive: true, force: true }); }
  }, 60000,
);
