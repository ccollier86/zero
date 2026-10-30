/** Generated file-router hydration + native sign-in + real Guardian/compliance workers. Synthetic state only. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../server/app-factory';
import { defineEndpoint, defineRouter, defineZeroPlugin } from '../server/server-extensions';
import type { ServerRouteServices } from '../server/server-services';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';
import { defineResource, authenticatedOnly } from '../../resources';
import { buildPlatformStyles } from '../server/style-bundle';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics';
const appDir = join(import.meta.dir, 'test-fixtures/session-audit-app/app');
let build: string | undefined, entry: string | undefined, stylesheet: string | undefined;

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
  stylesheet = (await buildPlatformStyles(join(build, 'assets'), appDir, [], { themeFoundation: 'next' })).publicPath;
}, 60000);
afterAll(async () => { if (build) await rm(build, { recursive: true, force: true }); }, 60000);

for (const scenario of ['fresh', 'blocked', 'retry-session', 'native-activity', 'native-live'] as const) browserTest(
  `generated native first login ${scenario === 'native-live' ? 'through reactive list and detail activity' : scenario === 'native-activity' ? 'through native record activity' : scenario === 'blocked' ? 'after blocked audit delivery and native retry' : scenario === 'retry-session' ? 'after a retryable refresh failure and native session retry' : 'with unblocked audit delivery'} reaches its protected workspace`, async () => {
    if (!build || !entry) throw new Error('Generated browser fixture was not built.');
    const root = await mkdtemp(join(scratch, 'session-audit-runtime-'));
    const lease = await acquirePlaywrightTestBrowser(), context = await lease.browser.newContext();
    let app: Awaited<ReturnType<typeof createApp>> | undefined, services: ServerRouteServices | undefined;
    let blocked = scenario === 'blocked', failRefresh = scenario === 'retry-session', acknowledgments = 0, documents = 0, proof = 0;
    const responses: { path: string; status: number }[] = [], errors: string[] = [];
    try {
      app = await createApp({ projectRoot: root, appDir, outDir: join(build, 'assets'), generatedDir: join(build, 'generated'), storageDir: join(root, 'storage'),
        db: { mode: 'file', path: join(root, 'application.db'), synchronous: 'FULL' },
        systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: { audit_items: { id: 'text primary key', state: 'text not null', title: 'text not null' } },
        resources: [defineResource({ table: 'audit_items', exposure: 'all', policy: authenticatedOnly() })],
        auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
        loginPath: '/login', postLoginPath: '/workspace', publicPaths: ['/login'],
        logging: { preset: 'compliance', rootDirectory: join(root, 'logging'), pages: { '/records': 'Records fixture', '/records/[id]': 'Record details', '/audit': 'Activity investigation' }, resources: { audit_items: { fields: { state: { values: ['draft', 'approved'] } } } } },
        workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false,
        themeFoundation: 'next', frontendBuild: { version: 1, frontend: { themeFoundation: 'next', clientEntry: entry, cssPath: stylesheet, plugins: {} }, pluginIdentities: {} },
        migrate: false, serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
        serverRoutesDir: false, observability: { console: false }, serverExtensions: [
          defineZeroPlugin({ name: 'session-audit-inspection', setup({ zero }) { services = zero; } }),
          defineRouter({ name: 'session-audit-proof', prefix: '/proof', auth: { user: 'required', credentials: ['session'] }, routes: [
            defineEndpoint({ method: 'POST', path: '/record-state', handler: async ({ zero }) => { zero.access.requirePlatformAdmin(); await zero.logging!.run(() => zero.db.update('audit_items', 'item-two', { state: 'draft' })); return { ok: true }; } }),
            defineEndpoint({ method: 'POST', path: '/record', handler: async ({ zero }) => {
              zero.access.requirePlatformAdmin();
              const id = 'proof.' + ++proof;
              await zero.logging!.record({ id, family: 'records', action: 'fixture.audit.prepared', outcome: 'succeeded', evidence: 'server-confirmed',
                occurredAt: Date.now(), target: { type: 'report', id } }); return { id };
            } }),
          ] }),
        ] });
      app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = 'http://127.0.0.1:' + app.server!.port;
      if (scenario === 'native-activity' || scenario === 'native-live') {
        services!.db.insert('audit_items', { id: 'item-one', state: 'draft', title: 'Synthetic first note' });
        services!.db.insert('audit_items', { id: 'item-two', state: 'approved', title: 'Synthetic completed note' });
      }
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
      if (scenario === 'native-live') {
        const before = documents;
        await page.getByRole('link', { name: 'Live fixture', exact: true }).click();
        await page.getByRole('cell', { name: 'Synthetic first note', exact: true }).waitFor();
        await page.getByRole('cell', { name: 'Synthetic completed note', exact: true }).waitFor();
        await page.getByRole('cell', { name: 'Synthetic completed note', exact: true }).click();
        await page.getByTestId('native-live-record-detail').waitFor();
        await page.getByRole('button', { name: 'Show completed reactive records', exact: true }).click();
        await page.getByRole('cell', { name: 'Synthetic first note', exact: true }).waitFor({ state: 'hidden' });
        const updateResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/proof/record-state');
        await page.getByRole('button', { name: 'Make second record draft', exact: true }).click();
        const updated = await updateResponse; expect({ status: updated.status(), body: await updated.text() }).toEqual({ status: 200, body: '{"ok":true}' });
        await page.getByRole('cell', { name: 'Synthetic completed note', exact: true }).waitFor({ state: 'hidden' });
        await page.getByRole('link', { name: 'Audit fixture', exact: true }).click();
        await page.getByText('Viewed a record', { exact: true }).waitFor();
        await page.waitForTimeout(750);
        expect(documents - before).toBe(0); expect(errors).toEqual([]);
        const records = await services!.logging!.page('audit', { kind: 'platform' }, { projection: 'activities', action: 'record.viewed' });
        expect(records.events.some(row => row.event.target?.id === 'item-two')).toBe(true);
        const lists = await services!.logging!.page('audit', { kind: 'platform' }, { projection: 'activities', action: 'record.list.viewed' });
        const history = await Promise.all(lists.events.map(row => services!.logging!.resultVersions({ kind: 'platform' }, row.activity!.id)));
        const all = await Promise.all(history.flatMap(page => page.items.map(item => services!.logging!.result({ kind: 'platform' }, item.receipt.id))));
        expect(all.some(manifest => manifest?.records.map(row => row.id).join(',') === 'item-one,item-two')).toBe(true);
        expect(all.some(manifest => manifest?.records.map(row => row.id).join(',') === 'item-two')).toBe(true);
        expect(all.some(manifest => manifest?.records.length === 0)).toBe(true);
        expect(all.flatMap(manifest => manifest?.records ?? []).every(row => row.revision.startsWith('sync:'))).toBe(true);
        const edits = await services!.logging!.page('audit', { kind: 'platform' }, { projection: 'activities', changedField: 'state', userId: account.user.userId });
        expect(edits.events.some(row => row.event.target?.id === 'item-two' && row.event.detail?.kind === 'record-change'
          && row.event.detail.changes.some(field => field.field === 'state' && field.kind === 'value' && field.before === 'approved' && field.after === 'draft'))).toBe(true);
      }
      if (scenario === 'native-activity') {
        const before = documents, retained = await page.getByTestId('persistent-audit-navigation').evaluateHandle(element => element);
        await page.getByRole('link', { name: 'Records fixture', exact: true }).click();
        await page.getByRole('cell', { name: 'Synthetic first note', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Show completed records', exact: true }).click();
        await page.getByRole('cell', { name: 'Synthetic first note', exact: true }).waitFor({ state: 'hidden' });
        await page.getByRole('cell', { name: 'Synthetic completed note', exact: true }).click();
        await page.getByRole('heading', { name: 'Synthetic completed note', exact: true }).waitFor();
        await page.getByRole('link', { name: 'Close record', exact: true }).click();
        await page.getByRole('cell', { name: 'Synthetic first note', exact: true }).waitFor();
        await page.getByRole('link', { name: 'Audit fixture', exact: true }).click();
        await page.getByTestId('native-audit-workspace').waitFor();
        await page.getByText('Viewed a record', { exact: true }).waitFor();
        expect(documents - before).toBe(0); expect(await retained.evaluate(element => element.isConnected)).toBe(true);
        expect(await page.getByRole('alert', { name: 'Audit delivery required', exact: true }).count()).toBe(0);
        const records = await services!.logging!.page('audit', { kind: 'platform' }, { projection: 'activities', action: 'record.viewed' });
        expect(records.events).toHaveLength(1); expect(records.events[0]!.event.target?.id).toBe('item-two');
        expect(records.events[0]!.activity!.view).toMatchObject({ complete: true }); expect(records.events[0]!.activity!.view!.closedAt).not.toBeNull();
        const lists = await services!.logging!.page('audit', { kind: 'platform' }, { projection: 'activities', action: 'record.list.viewed' });
        expect(lists.events.length).toBeGreaterThanOrEqual(2);
        const filtered = lists.events.find(row => row.event.metadata.resultCount === 1)!;
        expect(filtered.activity!.view!.closedAt).not.toBeNull();
        const versions = await services!.logging!.resultVersions({ kind: 'platform' }, filtered.activity!.id);
        expect(versions.items).toHaveLength(2);
        expect((await services!.logging!.result({ kind: 'platform' }, versions.items[0]!.receipt.id))!.records.map(record => record.id)).toEqual(['item-two']);
        expect((await services!.logging!.result({ kind: 'platform' }, versions.items[1]!.receipt.id))!.records.map(record => record.id)).toEqual(['item-one', 'item-two']);
        await page.getByRole('button', { name: `Inspect event ${filtered.event.id}`, exact: true }).click();
        const detail = page.getByRole('dialog', { name: 'Activity details', exact: true });
        await detail.getByRole('heading', { name: 'Observed viewing time', exact: true }).waitFor();
        await detail.getByRole('cell', { name: 'item-two', exact: true }).waitFor();
        expect(await detail.getByRole('cell', { name: 'item-one', exact: true }).count()).toBe(0);
        await detail.getByRole('combobox', { name: 'Displayed result version', exact: true }).click();
        await page.getByRole('option', { name: /2 records$/ }).click();
        await detail.getByRole('cell', { name: 'item-one', exact: true }).waitFor();
        await detail.getByRole('cell', { name: 'item-two', exact: true }).waitFor();
        expect(await detail.getByText('Synthetic first note', { exact: true }).count()).toBe(0); // No fresh record contents substituted as history.
        await detail.getByRole('button', { name: /^Supporting evidence · \d+ stages$/ }).click();
        await detail.getByText('Returned a list of records', { exact: true }).first().waitFor();
        expect(await detail.locator('[data-slot="logging-event-detail"]').evaluate(element => {
          const root = element.closest('[role="dialog"]')!.getBoundingClientRect(), content = element.getBoundingClientRect();
          return content.right <= root.right && content.width <= root.width;
        })).toBe(true);
        const directory = process.env.LOGGING_SCREENSHOTS;
        if (directory) {
          await mkdir(directory, { recursive: true });
          await detail.locator('[data-radix-scroll-area-viewport]').first().evaluate(element => { element.scrollTop = 0; });
          await page.screenshot({ path: join(directory, 'native-historical-result.png'), fullPage: true });
        }
        await detail.getByRole('button', { name: 'Close', exact: true }).click(); await detail.waitFor({ state: 'detached' });
        const navigation = await services!.logging!.page('audit', { kind: 'platform' }, { action: 'navigation.changed' });
        expect(navigation.events.some(row => row.event.metadata.pageName === 'Record details')).toBe(true);
        expect(JSON.stringify(navigation.events)).not.toContain('item-two');
        await page.waitForTimeout(1000); const head = (await services!.logging!.page('audit', { kind: 'platform' }, { includeTotal: false })).highWaterOrdinal;
        await page.waitForTimeout(31000);
        expect((await services!.logging!.page('audit', { kind: 'platform' }, { includeTotal: false })).highWaterOrdinal).toBe(head);
        if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, 'native-activity-workspace.png'), fullPage: true }); }
      }
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
        await newest.click(); await page.getByRole('dialog', { name: 'Activity details', exact: true }).waitFor();
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
        await page.getByRole('dialog', { name: 'Activity details', exact: true }).waitFor();
        await page.screenshot({ path: join(artifacts, 'session-audit-recovery-live-evidence.png') });
        services!.auth.store!.updateUser(account.user.userId, { role: 'user' });
        await page.getByRole('dialog', { name: 'Activity details', exact: true }).waitFor({ state: 'detached' });
        await page.getByTestId('session-audit-workspace').waitFor({ state: 'detached' });
        expect(await inspect('proof.33').count()).toBe(0);
      }
      expect(errors).toEqual([]);
      await page.screenshot({ path: join(artifacts, 'session-audit-recovery-' + scenario + (scenario === 'fresh' ? '-revoked.png' : '-ready.png')) });
      expect(services!.logging!.diagnostics().coverage.complianceReady).toBe(true);
    } finally { await context.close(); lease.release(); await app?.stop(true); await rm(root, { recursive: true, force: true }); }
  }, scenario === 'native-activity' ? 120000 : 60000,
);
