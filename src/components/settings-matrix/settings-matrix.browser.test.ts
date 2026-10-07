/** Styled real-browser acceptance for controlled matrix interaction and existing Guardian UI lifetimes. */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
import { OBS_CODES } from '../../observability/codes';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform/settings-matrix-browser';
  const styles = await buildPlatformStyles(root, `${root}/absent-app`);
  css = await Bun.file(styles.cssPath).text();
  // Like the MFA fixture, build SDK-bound hooks in a fresh Bun process to
  // avoid Bun 1.3 test-runner resolution conflicts with the full SDK graph.
  const script = `const result = await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/settings-matrix.browser-fixture.tsx`)}],target:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('test')}});
    if(!result.success){for(const log of result.logs) await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}
    await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', script], cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' });
  const [output, diagnostics, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (code !== 0) throw new Error(diagnostics || 'Isolated settings browser fixture build failed.');
  bundle = output; lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());
async function open(dark = false) {
  const page = await browser.newPage({ viewport: { width: 760, height: 740 } });
  const failures: string[] = []; errors.set(page, failures); page.on('pageerror', (error) => failures.push(error.message));
  await page.setContent('<div id="root"></div>'); await page.addStyleTag({ content: css });
  await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
  await page.addScriptTag({ content: bundle }); await page.getByRole('checkbox', { name: 'Comments and mentions: Email', exact: true }).waitFor();
  return page;
}
async function close(page: Page) { expect(errors.get(page)).toEqual([]); await page.close(); }
async function painted(page: Page) {
  await page.waitForFunction(() => {
    const path = document.querySelector('[aria-label="Comments and mentions: In app"] [data-slot="checkbox-indicator"] path');
    return path && Number(getComputedStyle(path).opacity) > 0.95;
  }, undefined, { timeout: 3_000 });
}

browserTest('controlled save stays pending, rejects duplicate input and tolerates fresh descriptor objects', async () => {
  const page = await open();
  try {
    const checkbox = page.getByRole('checkbox', { name: 'Comments and mentions: Email', exact: true });
    await checkbox.click(); await page.waitForFunction(() => window.__settingsMatrix.calls.length === 1);
    expect(await checkbox.isDisabled()).toBe(true); expect(await checkbox.getAttribute('aria-checked')).toBe('false');
    await checkbox.evaluate((element) => (element as HTMLButtonElement).click());
    expect(await page.evaluate(() => window.__settingsMatrix.calls.length)).toBe(1);
    await page.evaluate(() => window.__settingsMatrix.rerender());
    expect(await page.evaluate(() => window.__settingsMatrix.calls[0]!.signal.aborted)).toBe(false);
    await page.evaluate(() => window.__settingsMatrix.resolve(0));
    await page.waitForFunction(() => document.querySelector('[aria-label="Comments and mentions: Email"]')?.getAttribute('aria-checked') === 'true');
    expect(await checkbox.isEnabled()).toBe(true);
  } finally { await close(page); }
}, 30_000);

browserTest('initial checked controls paint their existing Zero checkmark indicators', async () => {
  const page = await open();
  try {
    await painted(page);
    expect(await page.locator('[aria-label="Comments and mentions: In app"] [data-slot="checkbox-indicator"] path').evaluate((element) => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.95);
  } finally { await close(page); }
}, 30_000);

browserTest('current failure is safe, observable and retryable without committing the value', async () => {
  const page = await open();
  try {
    const checkbox = page.getByRole('checkbox', { name: 'Comments and mentions: Email', exact: true });
    await checkbox.click(); await page.waitForFunction(() => window.__settingsMatrix.calls.length === 1);
    await page.evaluate(() => window.__settingsMatrix.reject(0));
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toBe('This setting could not be saved. Please try again.');
    expect(await checkbox.getAttribute('aria-checked')).toBe('false'); expect(await checkbox.getAttribute('aria-invalid')).toBe('true');
    const events = await page.evaluate(() => window.__settingsMatrix.events);
    expect(events).toHaveLength(1); expect(events[0]!.code).toBe(OBS_CODES.FRONTEND_MUTATION_FAILED.code);
    expect(events[0]!.metadata).toEqual({ surface: 'settings-matrix', kind: 'cell', stage: 'mutation' });
    expect(JSON.stringify(events)).not.toContain('PRIVATE_MATRIX_PAYLOAD');
    await checkbox.click(); await page.waitForFunction(() => window.__settingsMatrix.calls.length === 2);
    await page.evaluate(() => window.__settingsMatrix.resolve(1));
    await page.waitForFunction(() => document.querySelector('[aria-label="Comments and mentions: Email"]')?.getAttribute('aria-checked') === 'true');
    expect(await page.getByRole('alert').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('omitted and protected choices remain understandable and never editable', async () => {
  const page = await open();
  try {
    expect(await page.getByRole('checkbox', { name: 'Security alerts: Push', exact: true }).count()).toBe(0);
    expect(await page.getByRole('checkbox', { name: 'Security alerts: Email', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('checkbox', { name: 'Account updates: Email', exact: true }).getAttribute('aria-readonly')).toBe('true');
    const reason = page.locator('[data-slot="tooltip-trigger"][aria-label="Security alerts: Email: Required security alerts cannot be changed."]');
    await reason.focus(); await page.getByRole('tooltip', { name: 'Required security alerts cannot be changed.', exact: true }).waitFor();
    expect(await page.evaluate(() => window.__settingsMatrix.calls.length)).toBe(0);
    expect(await page.locator('[data-slot="settings-matrix"] footer').textContent()).toContain('6 enabled · 7 editable');
  } finally { await close(page); }
}, 30_000);

for (const target of ['application', 'organization', 'capability'] as const) browserTest(`${target} replacement cancels a pending callback and suppresses its stale failure`, async () => {
  const page = await open();
  try {
    await page.getByRole('checkbox', { name: 'Comments and mentions: Email', exact: true }).click();
    await page.waitForFunction(() => window.__settingsMatrix.calls.length === 1);
    await page.evaluate((target) => {
      if (target === 'application') window.__settingsMatrix.changeTarget();
      else if (target === 'organization') window.__settingsMatrix.changeOrganization();
      else window.__settingsMatrix.setReadOnly(true);
    }, target);
    await page.waitForFunction(() => window.__settingsMatrix.calls[0]!.signal.aborted);
    await page.evaluate(() => window.__settingsMatrix.reject(0));
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.evaluate(() => window.__settingsMatrix.events.length)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('unreadable Guardian data masks the matrix and aborts current changes', async () => {
  const page = await open();
  try {
    await page.getByRole('checkbox', { name: 'Comments and mentions: Email', exact: true }).click();
    await page.waitForFunction(() => window.__settingsMatrix.calls.length === 1);
    await page.evaluate(() => window.__settingsMatrix.setUnavailable());
    await page.getByRole('status').filter({ hasText: 'Refreshing settings…' }).waitFor();
    expect(await page.getByRole('checkbox').count()).toBe(0);
    expect(await page.evaluate(() => window.__settingsMatrix.calls[0]!.signal.aborted)).toBe(true);
    await page.evaluate(() => window.__settingsMatrix.reject(0));
    await page.evaluate(() => window.__settingsMatrix.setReady());
    await page.getByRole('checkbox', { name: 'Comments and mentions: Email', exact: true }).waitFor();
    expect(await page.getByRole('alert').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('the live SDK boundary rejects stale admission and result before React receives a notification', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      window.__settingsMatrix.changeOrganizationWithoutRender();
      (document.querySelector('[aria-label="Comments and mentions: Email"]') as HTMLButtonElement).click();
    });
    expect(await page.evaluate(() => window.__settingsMatrix.calls.length)).toBe(0);
    await page.evaluate(() => window.__settingsMatrix.notifyBoundary());
    await page.getByRole('checkbox', { name: 'Comments and mentions: Email', exact: true }).click();
    await page.waitForFunction(() => window.__settingsMatrix.calls.length === 1);
    await page.evaluate(() => {
      window.__settingsMatrix.changeOrganizationWithoutRender('organization-c');
      window.__settingsMatrix.reject(0);
    });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.evaluate(() => window.__settingsMatrix.events.length)).toBe(0);
    expect(await page.evaluate(() => window.__settingsMatrix.calls[0]!.signal.aborted)).toBe(true);
  } finally { await close(page); }
}, 30_000);

browserTest('keyboard three-column interaction fits a short 320px viewport without widening the page', async () => {
  const page = await open();
  try {
    await page.setViewportSize({ width: 320, height: 360 });
    const checkbox = page.getByRole('checkbox', { name: 'Comments and mentions: Email', exact: true });
    await checkbox.focus(); await checkbox.press('Space');
    await page.waitForFunction(() => window.__settingsMatrix.calls.length === 1);
    await page.evaluate(() => window.__settingsMatrix.resolve(0));
    await page.waitForFunction(() => document.querySelector('[aria-label="Comments and mentions: Email"]')?.getAttribute('aria-checked') === 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const bounds = await page.locator('[data-slot="settings-matrix"]').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: 'About these settings', exact: true }).focus();
    expect(await page.getByRole('button', { name: 'About these settings', exact: true }).evaluate((element) => document.activeElement === element)).toBe(true);
    await painted(page);
    await page.screenshot({ path: '/Volumes/code-bank/artifacts/zero-platform/diagnostics/settings-matrix-mobile.png' });
  } finally { await close(page); }
}, 30_000);

for (const dark of [false, true]) browserTest(`checkbox and switch variants use Zero tokens in ${dark ? 'dark' : 'light'} mode`, async () => {
  const page = await open(dark);
  try {
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--card', 'rgb(31, 47, 63)');
      document.documentElement.style.setProperty('--border', 'rgb(87, 99, 111)');
    });
    expect(await page.locator('[data-slot="settings-matrix"]').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(31, 47, 63)');
    expect(await page.locator('[data-slot="settings-matrix"]').evaluate((element) => getComputedStyle(element).borderTopColor)).toBe('rgb(87, 99, 111)');
    await page.evaluate(() => { document.documentElement.style.removeProperty('--card'); document.documentElement.style.removeProperty('--border'); });
    await painted(page);
    await page.screenshot({ path: `/Volumes/code-bank/artifacts/zero-platform/diagnostics/settings-matrix-${dark ? 'dark' : 'light'}.png` });
    await page.evaluate(() => window.__settingsMatrix.setControl('switch'));
    const control = page.getByRole('switch', { name: 'Comments and mentions: Email', exact: true });
    await control.click(); await page.waitForFunction(() => window.__settingsMatrix.calls.length === 1);
    await page.evaluate(() => window.__settingsMatrix.resolve(0));
    await page.waitForFunction(() => document.querySelector('[aria-label="Comments and mentions: Email"]')?.getAttribute('aria-checked') === 'true');
    expect(await control.getAttribute('aria-checked')).toBe('true');
  } finally { await close(page); }
}, 30_000);
