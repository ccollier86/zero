/** Actual installed/bundled Linux consumer plus Chromium. No production URL, identity or state is admitted. */
import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable } from '../../test-support/playwright-test-browser';

const origin = process.env.ZERO_REPAIR_FIXTURE_ORIGIN;
const baseline = process.env.ZERO_REPAIR_BASELINE === '1';
const artifacts = '/Volumes/code-bank/artifacts/zero-platform/diagnostics';
const run = baseline ? 'baseline-be266f5' : 'candidate';
const browserTest = origin && playwrightTestBrowserAvailable ? test : test.skip;

function fixtureOrigin() {
  if (!origin || new URL(origin).hostname !== '127.0.0.1' || new URL(origin).protocol !== 'http:') {
    throw new Error('This qualification accepts only an isolated loopback synthetic fixture.');
  }
  return origin;
}
function safePath(url: string) {
  return new URL(url).pathname.replace(/\/storage\/upload-grants\/[^/]+/g, '/storage/upload-grants/:token')
    .replace(/\/stages\/[^/]+/g, '/stages/:stageId').replace(/\/assets\/[^/]+/g, '/assets/:assetId');
}
async function until(check: () => boolean | Promise<boolean>, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error('Synthetic condition timed out.'); await Bun.sleep(100); }
}

browserTest('installed Linux app: real navigation, audit retention, diagnostics and native avatar lifecycle', async () => {
  const base = fixtureOrigin(); await mkdir(artifacts, { recursive: true });
  const lease = await acquirePlaywrightTestBrowser(), context = await lease.browser.newContext();
  const report: Record<string, unknown> = { run, nativeServer: 'linux/amd64', archiveConsumer: true };
  const responses: { route: string; method: string; status: number; code?: string }[] = [];
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  let documents = 0, acknowledgments = 0, flashes = 0, blocked = false;
  try {
    await until(async () => { try { return (await fetch(base + '/api/health')).status === 200; } catch { return false; } }, 60000);
    const registration = await fetch(base + (process.env.ZERO_REPAIR_REUSE_IDENTITY === '1' ? '/auth/login' : '/auth/register'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'integration-repair-owner', email: 'repair@example.test', password: 'Fixture-password-123!' }) });
    expect(registration.status).toBe(200);
    const registered = await registration.json() as { accessToken: string; user: { userId: string } };
    const api = async (path: string, body?: unknown) => {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + registered.accessToken, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error('Synthetic API failed: ' + safePath(base + path) + ' ' + response.status);
      return response.json() as Promise<any>;
    };
    const policy = await api('/api/_zero/logging/policy');
    await api('/api/_zero/logging/observations', { observations: [], policyVersion: policy.delivery.policyVersion });
    if (process.env.ZERO_REPAIR_REQUIRE_SOURCE_PREPARED === '1') {
      const prepared = await api('/api/_zero/logging/events', { stream: 'audit', query: { action: 'fixture.source.prepared' } });
      expect(prepared.events).toHaveLength(1); report.sourcePreparedMigrations = true;
    }
    await page.exposeFunction('__reportAuditFailurePanel', () => { flashes++; });
    await page.route('**/api/_zero/logging/observations', route => blocked
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"SYNTHETIC_UNAVAILABLE"}' }) : route.continue());
    await page.addInitScript(() => {
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('[aria-label="Audit delivery required"]') || node.querySelector('[aria-label="Audit delivery required"]'))) {
            void (window as unknown as { __reportAuditFailurePanel(): Promise<void> }).__reportAuditFailurePanel();
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    page.on('request', request => { if (request.resourceType() === 'document') documents++; });
    page.on('response', async response => {
      const route = safePath(response.url());
      if (route === '/api/_zero/logging/observations' && response.status() === 200) acknowledgments++;
      if (!route.startsWith('/auth/profile') && !route.startsWith('/storage/upload-grants/')) return;
      const entry = { route, method: response.request().method(), status: response.status() } as typeof responses[number];
      responses.push(entry);
      if (response.status() >= 400) {
        const data = await response.json().catch(() => null);
        if (typeof data?.code === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(data.code)) entry.code = data.code;
      }
    });
    await page.goto(base + '/login');
    await page.getByLabel('Username or email', { exact: true }).fill('integration-repair-owner');
    await page.getByLabel('Password', { exact: true }).fill('Fixture-password-123!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByTestId('protected-overview').waitFor();
    const initialShell = await page.getByTestId('persistent-shell').getAttribute('data-identity');
    expect(initialShell).toBeTruthy();
    const navigationQuery = { stream: 'audit', query: { action: 'navigation.changed', actorId: registered.user.userId, limit: 100 } };
    const initialNavigation = (await api('/api/_zero/logging/events', navigationQuery)).events.length;
    const before = documents, beforeFlashes = flashes, beforeAck = acknowledgments;
    for (const label of ['Account', 'Audit', 'Overview', 'Account']) {
      await page.locator('[data-sidebar="content"]').getByRole('link', { name: label, exact: true }).click();
      await page.getByTestId(label === 'Account' ? 'protected-account' : label === 'Audit' ? 'protected-audit' : 'protected-overview').waitFor();
    }
    report.navigation = { documentRequests: documents - before, failurePanelFlashes: flashes - beforeFlashes,
      acknowledgments: acknowledgments - beforeAck, shellPreserved: await page.getByTestId('persistent-shell').getAttribute('data-identity') === initialShell };
    if (!baseline) {
      await page.goBack(); await page.getByTestId('protected-overview').waitFor();
      await page.goForward(); await page.getByTestId('protected-account').waitFor();
      await page.getByRole('link', { name: 'Home', exact: true }).click(); await page.getByTestId('protected-overview').waitFor();
      await page.getByRole('link', { name: 'Open profile with Zero Link', exact: true }).click(); await page.getByTestId('protected-account').waitFor();
      await page.locator('[data-sidebar="header"] a[href="/workspace"]').click(); await page.getByTestId('protected-overview').waitFor();
      await page.locator('[data-sidebar="footer"]').getByRole('button', { name: /Synthetic owner/ }).click();
      await page.getByRole('menuitem', { name: 'Account', exact: true }).click(); await page.getByTestId('protected-account').waitFor();
      await page.getByRole('menu').waitFor({ state: 'detached' });
      expect(documents).toBe(before); expect(flashes).toBe(beforeFlashes);
      expect(await page.getByTestId('persistent-shell').getAttribute('data-identity')).toBe(initialShell);
      report.extendedNavigation = { documentRequests: documents - before, failurePanelFlashes: flashes - beforeFlashes, shellPreserved: true };
      // Route rendering may finish before the asynchronous audit append. Wait
      // for all ten completed transitions before testing the canceled one.
      await until(async () => (await api('/api/_zero/logging/events', navigationQuery)).events.length >= initialNavigation + 10);
    }
    const revisedName = 'Synthetic revised name ' + Date.now().toString(36);
    await page.getByLabel('First name', { exact: true }).fill(revisedName);
    if (!baseline) {
      const prior = await api('/api/_zero/logging/events', navigationQuery);
      await page.locator('[data-sidebar="content"]').getByRole('link', { name: 'Audit', exact: true }).click();
      await page.getByRole('button', { name: 'Stay', exact: true }).click();
      expect(new URL(page.url()).pathname).toBe('/account');
      const after = await api('/api/_zero/logging/events', navigationQuery);
      expect(after.events.length).toBe(prior.events.length); report.canceledNavigation = true;
    }
    const avatar = page.locator('[data-slot="avatar-editor"]'); await avatar.waitFor();
    await page.screenshot({ path: join(artifacts, 'integration-repair-' + run + '-profile.png') });
    const visiblePhotoAction = await avatar.getByRole('button', { name: /^(Upload|Change) photo$/ }).count();
    report.visiblePhotoAction = visiblePhotoAction;
    if (visiblePhotoAction) await avatar.getByRole('button', { name: /^(Upload|Change) photo$/ }).click();
    else {
      expect(await avatar.locator('button').count()).toBe(1);
      await avatar.locator('button').click();
    }
    const image = await sharp({ create: { width: 120, height: 100, channels: 3, background: '#345678' } }).png().toBuffer();
    await page.getByLabel('Profile picture file', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image });
    const savePicture = page.getByRole('button', { name: 'Save picture', exact: true }); await savePicture.waitFor();
    await until(() => savePicture.isEnabled()); await savePicture.click();
    await until(async () => responses.some(row => row.method === 'POST' && row.route.endsWith('/finalize'))
      || await page.getByRole('dialog').getByText('Your profile picture could not be loaded or saved. Please try again.', { exact: true }).count() > 0
      || responses.some(row => row.status >= 400));
    const finalize = responses.find(row => row.method === 'POST' && row.route.endsWith('/finalize'));
    report.avatar = { responses, finalized: finalize?.status === 200 };
    if (finalize?.status === 200) {
      await page.getByRole('dialog', { name: 'Choose your crop', exact: true }).waitFor({ state: 'detached' });
      expect(await page.getByLabel('First name', { exact: true }).inputValue()).toBe(revisedName);
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await until(() => responses.some(row => row.method === 'PATCH' && row.route === '/auth/profile' && row.status === 200));
      const snapshot = await api('/auth/profile/avatar');
      expect(snapshot.asset.mimeType).toBe('image/webp'); expect(snapshot.asset.width).toBe(512);
      expect(responses.some(row => row.route === '/auth/profile/avatar/assets/:assetId' && row.status === 200)).toBe(true);
      await page.reload(); await page.getByTestId('protected-account').waitFor();
      expect(await page.getByLabel('First name', { exact: true }).inputValue()).toBe(revisedName);
      report.avatarRefresh = true;
      const privateBytes = await fetch(base + snapshot.asset.deliveryPath, { headers: { Authorization: 'Bearer ' + registered.accessToken } });
      expect(privateBytes.status).toBe(200);
      const hash = new Bun.CryptoHasher('sha256').update(new Uint8Array(await privateBytes.arrayBuffer())).digest('hex');
      expect((await fetch(base + snapshot.asset.deliveryPath)).status).toBe(401);
      report.privateAvatarHash = hash;
      const container = process.env.ZERO_REPAIR_FIXTURE_CONTAINER;
      if (container) {
        if (!/^zero-integration-repair-(?:qualified|preflight)[a-z0-9-]*$/.test(container)) throw new Error('Only an owned synthetic qualification container may restart.');
        const checked = Bun.spawn(['docker', 'inspect', '--format', '{{index .Config.Labels "zero.qualification"}}', container], { stdout: 'pipe', stderr: 'pipe' });
        expect((await new Response(checked.stdout).text()).trim()).toBe('practiceiq-repair'); expect(await checked.exited).toBe(0);
        const restart = Bun.spawn(['docker', 'restart', '-t', '30', container], { stdout: 'pipe', stderr: 'pipe' });
        expect(await restart.exited).toBe(0);
        await until(async () => { try { return (await fetch(base + '/api/health')).status === 200; } catch { return false; } }, 60000);
        await page.reload(); await page.getByTestId('protected-account').waitFor();
        expect(await page.getByLabel('First name', { exact: true }).inputValue()).toBe(revisedName);
        const restored = await api('/auth/profile/avatar'); expect(restored.asset.id).toBe(snapshot.asset.id);
        const delivered = await fetch(base + restored.asset.deliveryPath, { headers: { Authorization: 'Bearer ' + registered.accessToken } });
        expect(delivered.status).toBe(200);
        expect(new Bun.CryptoHasher('sha256').update(new Uint8Array(await delivered.arrayBuffer())).digest('hex')).toBe(hash);
        report.nativeRestart = true;
      }
    }
    if (!baseline) {
      const tab = await context.newPage();
      try {
        await tab.goto(base + '/audit'); await tab.getByTestId('protected-audit').waitFor();
        expect(await tab.getByRole('alert', { name: 'Audit delivery required', exact: true }).count()).toBe(0);
        report.newTabAdmission = true;
      } finally { await tab.close(); }
      blocked = true;
      await page.locator('[data-sidebar="content"]').getByRole('link', { name: 'Audit', exact: true }).click();
      await page.getByRole('alert', { name: 'Audit delivery required', exact: true }).waitFor();
      expect(await page.getByTestId('protected-audit').count()).toBe(0);
      blocked = false; await page.getByRole('button', { name: 'Retry audit delivery', exact: true }).click();
      await page.getByTestId('protected-audit').waitFor(); report.blockedRecovery = true;
    }
    const beforeOperational = await api('/api/_zero/logging/events', { stream: 'operational', query: { action: 'app_biopsych_workflow_registered' } });
    await api('/proof/diagnostics', {});
    const health = await api('/api/_zero/logging/health');
    const operational = await api('/api/_zero/logging/events', { stream: 'operational', query: { action: 'app_biopsych_workflow_registered' } });
    const navigation = await api('/api/_zero/logging/events', { stream: 'audit', query: { action: 'navigation.changed', actorId: registered.user.userId } });
    report.retained = { operational: operational.events.length, navigation: navigation.events.length };
    report.health = health;
    await page.screenshot({ path: join(artifacts, 'integration-repair-' + run + '-result.png') });
    if (!baseline) {
      expect(report.navigation).toMatchObject({ documentRequests: 0, failurePanelFlashes: 0, shellPreserved: true });
      expect(visiblePhotoAction).toBe(1); expect(finalize?.status).toBe(200);
      expect(operational.events).toHaveLength(beforeOperational.events.length + 1); expect(navigation.events.length).toBeGreaterThanOrEqual(4);
      expect(health.coverage.complianceReady).toBe(true);
      expect(health.operationalBridge).toMatchObject({ attached: true, failed: 0 });
    }
  } finally {
    await Bun.write(join(artifacts, 'integration-repair-' + run + '.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ run, navigation: report.navigation, visiblePhotoAction: report.visiblePhotoAction, avatar: report.avatar, retained: report.retained }));
    await context.close(); lease.release();
  }
}, 240000);
