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
    .replace(/\/auth\/me\/properties\/[^/]+/g, '/auth/me/properties/:key')
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
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.name));
  report.nativeResponses = responses;
  report.browserErrorKinds = pageErrors;
  let documents = 0, acknowledgments = 0, flashes = 0, blocked = false;
  const propertyCommands: string[] = [];
  const navigationSent: { id: string; page: string }[] = [];
  const navigationAcknowledged = new Set<string>();
  const submittedNavigation = (request: import('playwright').Request) => {
    if (new URL(request.url()).pathname !== '/api/_zero/logging/observations' || request.method() !== 'POST') return [];
    const body = request.postDataJSON() as { observations?: { action?: string; id?: string; page?: string }[] } | null;
    return (body?.observations ?? []).filter((row): row is { action: string; id: string; page: string } =>
      row.action === 'navigation.changed' && typeof row.id === 'string' && typeof row.page === 'string');
  };
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT' && path.startsWith('/auth/me/properties/')) {
      const key = path.slice('/auth/me/properties/'.length);
      propertyCommands.push(['professional_credentials', 'professional_region', 'optional'].includes(key) ? key : 'unexpected-field');
    }
    for (const row of submittedNavigation(request)) if (!navigationSent.some(previous => previous.id === row.id)) navigationSent.push({ id: row.id, page: row.page });
  });
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
      if (route === '/api/_zero/logging/observations' && response.status() === 200) {
        acknowledgments++;
        for (const row of submittedNavigation(response.request())) navigationAcknowledged.add(row.id);
      }
      if (!route.startsWith('/auth/profile') && !route.startsWith('/storage/upload-grants/') && !route.startsWith('/auth/me/properties/')) return;
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
    const earlyNavigation = (await api('/api/_zero/logging/events', navigationQuery)).events.length;
    if (!baseline) await until(async () => {
      const initial = navigationSent.find(row => row.page === '/workspace');
      if (!initial || !navigationAcknowledged.has(initial.id)) return false;
      return (await api('/api/_zero/logging/events', navigationQuery)).events.some((row: any) => row.event.id === initial.id);
    });
    const initialNavigation = (await api('/api/_zero/logging/events', navigationQuery)).events.length;
    const initialNavigationSent = navigationSent.length;
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
      // DOM rendering is not a delivery barrier. Bind the exact ten completed
      // transitions to their real browser submissions, acknowledgments and
      // retained IDs, including the separately acknowledged initial page.
      await until(() => navigationSent.length >= initialNavigationSent + 10);
      expect(navigationSent.slice(initialNavigationSent).map(row => row.page)).toEqual([
        '/account', '/audit', '/workspace', '/account', '/workspace', '/account',
        '/workspace', '/account', '/workspace', '/account',
      ]);
      await until(async () => {
        const retained = new Set((await api('/api/_zero/logging/events', navigationQuery)).events.map((row: any) => row.event.id));
        return navigationSent.every(row => navigationAcknowledged.has(row.id) && retained.has(row.id));
      });
      report.navigationEvidence = { earlyRetained: earlyNavigation, initialRetained: initialNavigation,
        completedTransitions: 10, exactSubmittedSequence: true, retainedAcknowledgedIds: true };
    }
    const revisedName = 'Synthetic revised name ' + Date.now().toString(36);
    await page.getByLabel('First name', { exact: true }).fill(revisedName);
    if (!baseline) {
      const prior = await api('/api/_zero/logging/events', navigationQuery);
      const sentBeforeCancel = navigationSent.length;
      await page.locator('[data-sidebar="content"]').getByRole('link', { name: 'Audit', exact: true }).click();
      const stay = page.getByRole('button', { name: 'Stay', exact: true });
      const closingDialog = await stay.evaluateHandle(button => button.closest('[role="dialog"], [role="alertdialog"]'));
      expect(await closingDialog.evaluate(dialog => dialog !== null)).toBe(true);
      await stay.click();
      // Role queries stop matching as soon as the exiting dialog is aria-hidden,
      // before its real animation/focus scope retires. Wait for actual DOM exit
      // so a following fill cannot target the page while focus is still trapped.
      try { await page.waitForFunction(dialog => !dialog?.isConnected, closingDialog); }
      finally { await closingDialog.dispose(); }
      expect(new URL(page.url()).pathname).toBe('/account');
      // Allow the normal 250ms collector dispatch timer to expose any erroneous
      // canceled-route observation; do not infer absence from an immediate read.
      await page.waitForTimeout(350);
      const after = await api('/api/_zero/logging/events', navigationQuery);
      expect(navigationSent.length).toBe(sentBeforeCancel);
      expect(after.events.map((row: any) => row.event.id).sort()).toEqual(prior.events.map((row: any) => row.event.id).sort());
      report.canceledNavigation = true;
    }
    if (!baseline) {
      const professional = page.locator('[data-slot="user-properties-form"]');
      const save = professional.getByRole('button', { name: 'Save settings', exact: true });
      expect(await save.isDisabled()).toBe(true);
      await professional.evaluate(node => (node as HTMLFormElement).requestSubmit());
      expect(propertyCommands).toEqual([]);
      // The modal scene keeps the application surface inert while its safe
      // exit paint finishes, after the live dialog node has already retired.
      // Native fill() does not wait for ancestor inertness before editing.
      await page.waitForFunction(() => {
        const input = document.querySelector<HTMLInputElement>('[data-slot="user-properties-form"] input');
        return Boolean(input && !input.disabled && !input.closest('[inert]'));
      });
      const credential = 'Synthetic credential ' + Date.now().toString(36);
      await professional.getByLabel('Professional credentials', { exact: true }).fill(credential);
      expect(await professional.getByLabel('Professional credentials', { exact: true }).inputValue()).toBe(credential);
      expect(await save.isEnabled()).toBe(true);
      await save.click(); await professional.getByRole('status').waitFor();
      expect(propertyCommands).toEqual(['professional_credentials']);
      expect(responses.filter(row => row.method === 'PUT' && row.route === '/auth/me/properties/:key').map(row => row.status)).toEqual([200]);
      expect(await page.getByLabel('First name', { exact: true }).inputValue()).toBe(revisedName);
      expect(flashes).toBe(beforeFlashes);
      await professional.getByLabel('Professional region', { exact: true }).fill('Unsaved synthetic region');
      report.professionalSettings = { unchangedWrites: 0, firstChangedFieldAccepted: true, personalDraftPreserved: true };
    }
    const avatar = page.locator('[data-slot="avatar-editor"]'); await avatar.waitFor();
    if (!baseline) await avatar.getByRole('button', { name: /^(Upload|Change) photo$/ }).waitFor();
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
    if (!baseline) await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('.reactEasyCrop_Image');
      return Boolean(image?.complete && image.naturalWidth > 0 && !image.closest('[inert]'));
    });
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
      if (!baseline) {
        const professional = page.locator('[data-slot="user-properties-form"]');
        expect(await professional.getByLabel('Professional region', { exact: true }).inputValue()).toBe('Unsaved synthetic region');
        await professional.getByRole('button', { name: 'Save settings', exact: true }).click();
        await professional.getByRole('status').waitFor();
        expect(propertyCommands).toEqual(['professional_credentials', 'professional_region']);
        expect(responses.filter(row => row.method === 'PUT' && row.route === '/auth/me/properties/:key').map(row => row.status)).toEqual([200, 200]);
        expect(flashes).toBe(beforeFlashes);
        expect(Object.hasOwn((await api('/auth/me/properties')).properties, 'optional')).toBe(false);
        const query = (action: string) => ({ stream: 'audit', query: { action, actorId: registered.user.userId, limit: 100 } });
        await until(async () => (await api('/api/_zero/logging/events', query('account.property-updated'))).events.length >= 2);
        const properties = await api('/api/_zero/logging/events', query('account.property-updated'));
        const profiles = await api('/api/_zero/logging/events', query('account.profile-updated'));
        expect(profiles.events.length).toBeGreaterThan(0);
        for (const row of [...properties.events, ...profiles.events]) expect(row.event).toMatchObject({
          outcome: 'succeeded', evidence: 'server-confirmed', target: { type: 'user', id: registered.user.userId }, actor: { id: registered.user.userId } });
        expect(JSON.stringify([...properties.events, ...profiles.events])).not.toContain('Unsaved synthetic region');
        report.professionalSettings = { ...(report.professionalSettings as object), professionalDraftPreserved: true,
          changedOnly: true, healthyAdmission: true, canonicalAuditRetained: true, noPrivateValues: true };
      }
      const snapshot = await api('/auth/profile/avatar');
      expect(snapshot.asset.mimeType).toBe('image/webp'); expect(snapshot.asset.width).toBe(512);
      expect(responses.some(row => row.route === '/auth/profile/avatar/assets/:assetId' && row.status === 200)).toBe(true);
      await page.reload(); await page.getByTestId('protected-account').waitFor();
      expect(await page.getByLabel('First name', { exact: true }).inputValue()).toBe(revisedName);
      await page.locator('[data-slot="avatar-editor"]').getByRole('button', { name: 'Change photo', exact: true }).waitFor();
      await until(() => page.locator('[data-slot="avatar-editor"] img').evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0));
      report.avatarRefresh = true;
      await page.screenshot({ path: join(artifacts, 'integration-repair-' + run + '-avatar-ready.png') });
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
        await page.locator('[data-slot="avatar-editor"]').getByRole('button', { name: 'Change photo', exact: true }).waitFor();
        await until(() => page.locator('[data-slot="avatar-editor"] img').evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0));
        // The host inspection client has a different legitimate session from
        // the browser. Restart correctly retires its old admission too; acquire
        // its own fresh empty handshake, not a fabricated browser receipt.
        const renewedPolicy = await api('/api/_zero/logging/policy');
        await api('/api/_zero/logging/observations', { observations: [], policyVersion: renewedPolicy.delivery.policyVersion });
        const restored = await api('/auth/profile/avatar'); expect(restored.asset.id).toBe(snapshot.asset.id);
        const delivered = await fetch(base + restored.asset.deliveryPath, { headers: { Authorization: 'Bearer ' + registered.accessToken } });
        expect(delivered.status).toBe(200);
        expect(new Bun.CryptoHasher('sha256').update(new Uint8Array(await delivered.arrayBuffer())).digest('hex')).toBe(hash);
        report.nativeRestart = true;
      }
    }
    if (!baseline) {
      const currentUrl = page.url();
      const [tab] = await Promise.all([context.waitForEvent('page'),
        page.locator('[data-sidebar="content"]').getByRole('link', { name: 'Audit', exact: true }).click({ modifiers: ['ControlOrMeta'] })]);
      try {
        await tab.getByTestId('protected-audit').waitFor();
        expect(await tab.getByRole('alert', { name: 'Audit delivery required', exact: true }).count()).toBe(0);
        expect(page.url()).toBe(currentUrl); report.newTabAdmission = true; report.modifiedLink = true;
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
    let operational = await api('/api/_zero/logging/events', { stream: 'operational', query: { action: 'app_biopsych_workflow_registered' } });
    // Diagnostic emission is intentionally best effort/async, not a false
    // synchronous provider receipt. Wait for actual retained evidence.
    if (!baseline) await until(async () => {
      operational = await api('/api/_zero/logging/events', { stream: 'operational', query: { action: 'app_biopsych_workflow_registered' } });
      return operational.events.length === beforeOperational.events.length + 1;
    });
    const health = await api('/api/_zero/logging/health');
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
      expect(pageErrors).toEqual([]);
    }
  } finally {
    report.lastUiState = await page.evaluate(() => {
      const image = document.querySelector<HTMLImageElement>('.reactEasyCrop_Image');
      const surface = document.querySelector('[data-slot="avatar-crop-surface"]')?.getBoundingClientRect();
      return { activeModalLayers: document.querySelectorAll('.zero-modal-layer:not([inert])').length,
        closingModalLayers: document.querySelectorAll('.zero-modal-layer[inert]').length,
        inertApplicationSurfaces: document.querySelectorAll('[data-zero-modal-surface][inert]').length,
        cropSurface: Boolean(surface), cropWidth: surface?.width ?? 0, cropHeight: surface?.height ?? 0,
        cropImage: Boolean(image), cropImageDecoded: Boolean(image?.complete && image.naturalWidth),
        savePictureInDom: [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Save picture'),
        avatarFailureShown: document.body.textContent?.includes('Your profile picture could not be loaded or saved. Please try again.') ?? false,
        profilePolicyRefreshing: document.body.textContent?.includes('Refreshing profile policy') ?? false,
      };
    }).catch(() => ({ browserUnavailable: true }));
    await page.screenshot({ path: join(artifacts, 'integration-repair-' + run + '-last-state.png'), timeout: 5000 }).catch(() => {});
    await Bun.write(join(artifacts, 'integration-repair-' + run + '.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ run, navigation: report.navigation, visiblePhotoAction: report.visiblePhotoAction, avatar: report.avatar, retained: report.retained }));
    await context.close(); lease.release();
  }
}, 240000);
