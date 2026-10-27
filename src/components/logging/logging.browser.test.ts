/** Production CSS and shared controls exercised in isolated local Chromium. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const faults: string[] = [];
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'zero-logging-ui-'));
  try {
    const styles = await buildPlatformStyles(directory, join(directory, 'absent-app')); css = await Bun.file(styles.cssPath).text();
    const compile = Bun.spawn([process.execPath, '--no-env-file', 'build', `${import.meta.dir}/logging.browser-fixture.tsx`, '--target=browser', '--format=iife', '--define', 'process.env.NODE_ENV="test"', '--outdir', directory], { stdout: 'pipe', stderr: 'pipe' });
    const [exit, stderr] = await Promise.all([compile.exited, new Response(compile.stderr).text()]); if (exit) throw new Error(stderr);
    bundle = await Bun.file(join(directory, 'logging.browser-fixture.js')).text();
    const componentCss = Bun.file(join(directory, 'logging.browser-fixture.css')); if (await componentCss.exists()) css += '\n' + await componentCss.text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60000);
afterAll(() => { lease?.release(); expect(faults).toEqual([]); });

browserTest('native live inserts preserve rows and pagination, use the existing incoming-record control and mask old-scope evidence', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(7000); page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('https://zero-logging.invalid/') ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' }) : route.abort());
  try {
    await page.goto('https://zero-logging.invalid/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    await page.getByRole('cell', { name: 'record · record-65', exact: true }).waitFor();
    await page.getByRole('cell', { name: 'record · record-65', exact: true }).evaluate(e => { (window as any).__loggingRow = e; });
    await page.getByRole('button', { name: 'Add synthetic activity', exact: true }).click();
    await page.getByRole('cell', { name: 'record · record-66', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).__loggingRow.isConnected)).toBe(true);
    expect(await page.getByRole('button', { name: 'New activity available · show latest', exact: true }).count()).toBe(0);
    expect(await page.locator('[data-slot="data-table-skeleton-body"]').count()).toBe(0);
    expect(await page.locator('[data-row-id=\'["fixture-source","event-66"]\']').getAttribute('data-table-fresh')).toBe('');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByRole('cell', { name: 'record · record-41', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add synthetic activity', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    expect(await page.getByRole('cell', { name: 'record · record-41', exact: true }).count()).toBe(1);
    expect(await page.getByRole('cell', { name: 'record · record-67', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).click();
    await page.getByRole('cell', { name: 'record · record-67', exact: true }).waitFor();
    const directory = process.env.LOGGING_SCREENSHOTS;
    if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, 'logging-workspace-desktop.png'), fullPage: true }); }
    await page.getByRole('button', { name: 'Inspect event event-67', exact: true }).click();
    await page.getByRole('dialog', { name: 'Event evidence', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Trace and provenance', exact: true }).waitFor();
    await page.getByText('This is one retained event, not proof that an entire workflow completed.', { exact: false }).waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, 'logging-evidence-desktop.png'), fullPage: true }); }
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Change synthetic scope', exact: true }).click();
    await page.getByRole('cell', { name: 'record · record-67', exact: true }).waitFor();
    expect(await page.getByRole('cell', { name: 'tenant-a-user', exact: true }).count()).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    const columns = await page.locator('[data-slot="table"]').evaluate(table => {
      const headers = [...table.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect());
      const cells = [...table.querySelector('[data-row-id]')!.querySelectorAll('td')].map(cell => cell.getBoundingClientRect());
      return headers.map((header, i) => ({ width: header.width, delta: Math.abs(header.x - cells[i]!.x) }));
    });
    expect(columns.every(column => column.width > 40 && column.delta < 1)).toBe(true);
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    if (directory) await page.screenshot({ path: join(directory, 'logging-mobile-dark.png'), fullPage: true });
  } finally { await page.close(); }
}, 30000);

browserTest('native row keyboard inspection restores focus and masks an already-open dialog on scope retirement', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000); page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('https://zero-logging.invalid/') ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }) : route.abort());
  try {
    await page.goto('https://zero-logging.invalid/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    const row = page.locator('[data-row-id]').first(); await row.waitFor(); await row.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Event evidence', exact: true }); await dialog.waitFor();
    await page.getByRole('heading', { name: 'Actor and resource', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    // Logical dismissal precedes scene cleanup and its owned focus return.
    await page.waitForFunction(() => document.activeElement?.matches('[data-row-id]'));
    expect(await row.evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('Enter'); await dialog.waitFor();
    // An external authority update is not a UI click through the modal backdrop.
    await page.evaluate(() => (window as any).__loggingChangeScope());
    await dialog.getByRole('status').waitFor();
    expect(await dialog.getByText('tenant-a-user', { exact: true }).count()).toBe(0);
    expect(await dialog.locator('[data-slot="logging-event-detail"]').count()).toBe(0);
  } finally { await page.close(); }
}, 30000);

browserTest('disconnected evidence masks, reconnects and uses real filter grammar with removable criteria', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(7000); page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('https://zero-logging.invalid/') ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }) : route.abort());
  try {
    await page.goto('https://zero-logging.invalid/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    await page.getByRole('cell', { name: 'record · record-65', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Toggle live connection', exact: true }).click();
    await page.getByText('Protected evidence is hidden while the connection is revalidated.', { exact: true }).waitFor();
    expect(await page.getByRole('cell', { name: 'record · record-65', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Toggle live connection', exact: true }).click();
    await page.getByRole('cell', { name: 'record · record-65', exact: true }).waitFor();
    await page.getByRole('button', { name: 'More filters', exact: true }).click();
    await page.getByLabel('Exact action', { exact: true }).fill('Record.READ');
    await page.keyboard.press('Escape');
    const before = await page.evaluate(() => (window as any).__loggingQueries.length);
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.getByText('Exact action must be an exact lowercase code, such as record.read.', { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).__loggingQueries.length)).toBe(before);
    await page.getByRole('button', { name: 'More filters', exact: true }).click();
    await page.getByLabel('Exact action', { exact: true }).fill('record.read');
    await page.getByLabel('Resource type', { exact: true }).fill('record');
    await page.getByLabel('Session ID', { exact: true }).fill('fixture-session');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Session ID filter', exact: true }).waitFor();
    await page.getByRole('cell', { name: 'record · record-65', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).__loggingQueries.some((q: any) => q.targetType === 'record' && q.sessionId === 'fixture-session' && q.action === 'record.read'))).toBe(true);
    await page.getByRole('button', { name: 'Remove Session ID filter', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Remove Session ID filter', exact: true }).count()).toBe(0);
    await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
    await page.getByRole('tabpanel').getByRole('cell', { name: 'record · record-65', exact: true }).waitFor();
  } finally { await page.close(); }
}, 30000);

browserTest('a committed burst refreshes one native page without blanking retained rows or adding a custom reveal button', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(7000); page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('https://zero-logging.invalid/') ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }) : route.abort());
  try {
    await page.goto('https://zero-logging.invalid/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    const retained = page.getByRole('cell', { name: 'record · record-65', exact: true });
    await retained.waitFor(); await retained.evaluate(element => { (window as any).__retainedLoggingCell = element; });
    const count = () => page.evaluate(() => (window as any).__loggingQueries.filter((query: any) => query.limit === 25 && !query.eventIds).length);
    const before = await count();
    await page.getByRole('button', { name: 'Add synthetic burst', exact: true }).click();
    await page.getByRole('cell', { name: 'record · record-68', exact: true }).waitFor();
    expect(await count()).toBe(before + 1);
    expect(await page.evaluate(() => (window as any).__retainedLoggingCell.isConnected)).toBe(true);
    expect(await page.locator('[data-slot="data-table-skeleton-body"]').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'New activity available · show latest', exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 30000);

browserTest('individual-user filters apply to live arrivals without exposing the previous authorization scope', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(7000); page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('https://zero-logging.invalid/') ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }) : route.abort());
  try {
    await page.goto('https://zero-logging.invalid/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    await page.getByRole('cell', { name: 'record · record-65', exact: true }).waitFor();
    const filter = async (actor: string) => {
      await page.getByRole('button', { name: /^More filters/ }).click();
      await page.getByLabel('Actor ID', { exact: true }).fill(actor);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    };
    await filter('tenant-a-user');
    await page.getByRole('cell', { name: 'record · record-65', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add synthetic activity', exact: true }).click();
    await page.getByRole('cell', { name: 'record · record-66', exact: true }).waitFor();
    await filter('tenant-b-user');
    await page.getByText('No retained events match these filters.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add synthetic activity', exact: true }).click();
    expect(await page.getByRole('cell', { name: 'record · record-67', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Change synthetic scope', exact: true }).click();
    await page.getByRole('cell', { name: 'record · record-67', exact: true }).waitFor();
    expect(await page.getByRole('cell', { name: 'tenant-a-user', exact: true }).count()).toBe(0);
    expect(await page.getByRole('cell', { name: 'tenant-b-user', exact: true }).count()).toBeGreaterThan(0);
  } finally { await page.close(); }
}, 30000);
