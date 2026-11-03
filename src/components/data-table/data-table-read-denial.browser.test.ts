/** Actual SDK client.fetch, native DataTableView, real styles and both motion modes. Intercepted fictional auth/data only. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Route } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-read-denial-build-'));
  try {
    const styles = await buildPlatformStyles(directory, join(directory, 'absent-app')); css = await Bun.file(styles.cssPath).text();
    const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'data-table-read-denial.browser-fixture.tsx')], target: 'browser', format: 'esm', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error('Read-denial native fixture build failed.');
    bundle = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 120_000);
afterAll(() => lease?.release());
const origin = 'http://zero-read-denial.test';
const rows = (prefix = 'Synthetic patient', identity = 'clinician') => Array.from({ length: 25 }, (_, i) => ({ id: identity + '-' + (i + 1), name: prefix + ' ' + String(i + 1).padStart(3, '0') }));
async function open(reducedMotion: 'reduce' | 'no-preference', masterDetail = false) {
  const context = await lease!.browser.newContext({ reducedMotion, viewport: { width: 1100, height: 900 } }), page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors: string[] = [], unexpected: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  let status = 200, requests = 0, writes = 0, currentIdentity = 'clinician', held: Route | null = null, hold = false, fresh = false;
  const json = (route: Route, body: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { unexpected.push('foreign origin'); return route.abort(); }
    if (url.pathname === '/fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    const user = () => ({ userId: 'synthetic-' + currentIdentity, username: 'synthetic-' + currentIdentity, email: 'synthetic@example.test', firstName: 'Synthetic', lastName: 'User',
      role: 'user', status: 'active', passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false, mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null });
    if (url.pathname === '/auth/login') { currentIdentity = route.request().postDataJSON().username === 'synthetic-other' ? 'other' : 'clinician'; return json(route, { user: user(),
      accessToken: 'header.' + btoa(JSON.stringify({ sub: user().userId, sid: 'application', role: 'user', exp: Math.floor(Date.now() / 1000) + 3600 })) + '.signature', refreshToken: 'synthetic-refresh' }); }
    if (url.pathname === '/auth/authorization') return json(route, { version: 1, identity: { userId: user().userId, platformRole: 'user' },
      profile: { tenancy: 'single', authorization: 'simple' }, scope: { kind: 'application', scopeId: 'application', roles: [], permissions: [], allPermissions: false, revision: currentIdentity + ':1' }, revision: currentIdentity + ':1' });
    if (url.pathname === '/auth/me') return json(route, user());
    if (url.pathname === '/synthetic-write') { writes++; return json(route, { accepted: true }); }
    if (url.pathname === '/synthetic-roster') {
      requests++; expect(route.request().headers().authorization?.startsWith('Bearer header.')).toBe(true);
      if (hold) { held = route; return; }
      if (status !== 200) return json(route, { error: 'Synthetic source read failed.', code: status === 403 ? 'SYNTHETIC_ACCESS_DENIED' : 'SYNTHETIC_TEMPORARY_FAILURE' }, status);
      const index = Number(url.searchParams.get('page'));
      return json(route, { rows: rows(fresh ? 'Newly authorized patient' : 'Synthetic patient', currentIdentity), page: { mode: 'offset', offset: index * 25, total: 75, hasMore: index < 2 } });
    }
    unexpected.push(url.pathname); return route.abort();
  });
  try {
    await page.goto(origin + '/fixture' + (masterDetail ? '?master=1' : '')); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle, type: 'module' });
    await page.waitForFunction(() => { const first = document.querySelector('tbody [data-row-id]'); return first?.textContent?.includes('Synthetic patient 001') && getComputedStyle(first).opacity === '1'; });
  } catch (error) { await context.close(); throw error; }
  return { page, context, requests: () => requests, writes: () => writes, reject(code: number) { status = code; },
    holdRetry() { status = 200; hold = true; }, allow() { status = 200; fresh = true; },
    async release() { hold = false; expect(held).not.toBeNull(); await json(held!, { rows: rows('Newly authorized patient', currentIdentity), page: { mode: 'offset', offset: 0, total: 25, hasMore: false } }); held = null; },
    async close() { await context.close(); expect(errors).toEqual([]); expect(unexpected).toEqual([]); } };
}
async function noRejectedPresentation(page: any) {
  expect(await page.locator('tbody [data-row-id]').count()).toBe(0);
  expect(await page.getByText('Synthetic patient 001', { exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Open row actions', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Act on selected records', exact: true }).count()).toBe(0);
  expect(await page.getByTestId('selected-ids').textContent()).toBe('[]');
}
for (const motion of ['reduce', 'no-preference'] as const) {
  browserTest(motion + ': authenticated 403 immediately removes rows/actions/selection; only a fresh accepted Retry restores content', async () => {
    const h = await open(motion);
    try {
      const before = await h.page.getByTestId('source-authority').textContent();
      await h.page.getByRole('checkbox', { name: 'Select row', exact: true }).first().click();
      await h.page.getByRole('button', { name: 'Act on selected records', exact: true }).waitFor();
      h.reject(403); await h.page.getByRole('button', { name: 'Refresh synthetic roster', exact: true }).click();
      await h.page.getByTestId('source-read-failure').waitFor(); await noRejectedPresentation(h.page);
      expect(await h.page.evaluate(() => window.__readDenial.snapshots)).not.toContain(25);
      expect(await h.page.evaluate(() => window.__readDenial.snapshots.every(count => count === 0))).toBe(true);
      expect(await h.page.getByTestId('source-authority').textContent()).toBe(before);
      h.holdRetry(); const requested = h.page.waitForRequest(request => new URL(request.url()).pathname === '/synthetic-roster');
      await h.page.getByRole('button', { name: 'Retry protected read', exact: true }).click(); await requested; await noRejectedPresentation(h.page);
      await h.release(); await h.page.getByText('Newly authorized patient 001', { exact: true }).waitFor();
      expect(h.requests()).toBe(3); expect(await h.page.getByRole('checkbox', { name: 'Select row', exact: true }).first().isChecked()).toBe(false);
      expect(await h.page.getByTestId('selected-ids').textContent()).toBe('[]');
    } finally { await h.close(); }
  }, 60_000);
  browserTest(motion + ': same-scope 503 retains the accepted page and surviving selection', async () => {
    const h = await open(motion);
    try {
      await h.page.getByRole('checkbox', { name: 'Select row', exact: true }).first().click(); h.reject(503);
      await h.page.getByRole('button', { name: 'Refresh synthetic roster', exact: true }).click(); await h.page.getByTestId('source-read-failure').waitFor();
      expect(await h.page.locator('tbody [data-row-id]').count()).toBe(25);
      expect(await h.page.getByText('Synthetic patient 001', { exact: true }).isVisible()).toBe(true);
      expect(await h.page.getByRole('checkbox', { name: 'Select row', exact: true }).first().isChecked()).toBe(true);
    } finally { await h.close(); }
  }, 60_000);
  for (const change of ['query', 'page'] as const) browserTest(motion + ': rejected ' + change + ' immediately withdraws prior query rows without waiting for exit motion', async () => {
    const h = await open(motion);
    try {
      h.reject(403); await h.page.evaluate(change => change === 'page' ? window.__readDenial.page(1) : window.__readDenial.search('denied'), change);
      await h.page.getByTestId('source-read-failure').waitFor(); await noRejectedPresentation(h.page);
      expect(await h.page.evaluate(() => window.__readDenial.snapshots.every(count => count === 0))).toBe(true);
      expect(h.requests()).toBe(2);
    } finally { await h.close(); }
  }, 60_000);
}
browserTest('actual SDK account replacement withdraws old rows before the replacement response and accepts only new-account content', async () => {
  const h = await open('no-preference');
  try {
    h.holdRetry(); const requested = h.page.waitForRequest(request => new URL(request.url()).pathname === '/synthetic-roster');
    await h.page.evaluate(() => window.__readDenial.replaceIdentity()); await requested; await noRejectedPresentation(h.page);
    await h.release(); await h.page.getByText('Newly authorized patient 001', { exact: true }).waitFor();
    expect(await h.page.locator('[data-row-id="clinician-1"]').count()).toBe(0);
    expect(await h.page.locator('[data-row-id="other-1"]').count()).toBe(1);
  } finally { await h.close(); }
}, 60_000);

browserTest('denial withdraws an unsent editor draft without turning it into a write', async () => {
  const h = await open('no-preference');
  try {
    await h.page.evaluate(() => window.__readDenial.edit(true));
    await h.page.locator('[data-row-id="clinician-1"]').getByRole('button', { name: 'Synthetic patient 001', exact: true }).click();
    const editor = h.page.locator('[data-slot="editable-cell-editor"] input'); await editor.fill('Private unsent synthetic draft');
    h.reject(403);
    // Call the ordinary refresh control without blurring/submitting the editor.
    await h.page.getByRole('button', { name: 'Refresh synthetic roster', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
    await h.page.getByTestId('source-read-failure').waitFor(); await noRejectedPresentation(h.page);
    expect(await editor.count()).toBe(0); expect(h.writes()).toBe(0);
    expect(await h.page.getByText('Private unsent synthetic draft', { exact: true }).count()).toBe(0);
  } finally { await h.close(); }
}, 60_000);

browserTest('an accepted inline write followed by denied refresh stays accepted and a read Retry never repeats the write', async () => {
  const h = await open('reduce');
  try {
    await h.page.evaluate(() => window.__readDenial.edit(true));
    await h.page.locator('[data-row-id="clinician-1"]').getByRole('button', { name: 'Synthetic patient 001', exact: true }).click();
    const editor = h.page.locator('[data-slot="editable-cell-editor"] input'); await editor.fill('Accepted synthetic edit');
    h.reject(403); await editor.press('Enter');
    await h.page.getByTestId('source-read-failure').waitFor(); await noRejectedPresentation(h.page);
    expect(h.writes()).toBe(1); expect(await h.page.evaluate(() => window.__readDenial.actions().acceptedWrites)).toBe(1);
    h.allow(); await h.page.getByRole('button', { name: 'Retry protected read', exact: true }).click();
    await h.page.getByRole('button', { name: 'Newly authorized patient 001', exact: true }).waitFor();
    expect(h.writes()).toBe(1); expect(await h.page.evaluate(() => window.__readDenial.actions().acceptedWrites)).toBe(1);
  } finally { await h.close(); }
}, 60_000);

for (const motion of ['reduce', 'no-preference'] as const) browserTest(motion + ': native MasterDetail does not retain a rejected record in its outgoing detail crossfade', async () => {
  const h = await open(motion, true);
  try {
    await h.page.getByTestId('private-detail').waitFor();
    h.reject(403); await h.page.getByRole('button', { name: 'Refresh synthetic roster', exact: true }).click();
    await h.page.getByTestId('source-read-failure').waitFor();
    expect(await h.page.locator('tbody [data-row-id]').count()).toBe(0);
    expect(await h.page.getByTestId('private-detail').count()).toBe(0);
    expect(await h.page.getByText('Synthetic patient 001', { exact: true }).count()).toBe(0);
  } finally { await h.close(); }
}, 60_000);
