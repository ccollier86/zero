/** Styled isolated browser qualification; never a real application, provider, or database. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import type { Locator, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const TIMEOUT = 45_000;
const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const ARTIFACTS = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/integration-settings-list';
let lease: PlaywrightTestBrowserLease | undefined, directory: string | undefined, evidence: string | undefined;
let app: ReturnType<typeof serveFixture> | undefined, baseUrl = '';
function serveFixture(scriptPath: string, cssPath: string) {
  return new Elysia()
    .get('/fixture.js', () => new Response(Bun.file(scriptPath), { headers: { 'Content-Type': 'text/javascript' } }))
    .get('/fixture.css', () => new Response(Bun.file(cssPath), { headers: { 'Content-Type': 'text/css' } }))
    .get('/component.css', () => new Response(Bun.file(join(import.meta.dir, 'integration-settings-list.css')), { headers: { 'Content-Type': 'text/css' } }))
    .get('/', ({ query }) => new Response(`<!doctype html><html${query.dark === '1' ? ' class="dark"' : ''}><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Isolated integration settings</title><link rel="stylesheet" href="/fixture.css"><link rel="stylesheet" href="/component.css">
      </head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html' } }))
    .listen({ hostname: '127.0.0.1', port: 0 });
}
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) throw new Error('Integration settings require the installed isolated Chromium fixture browser.');
  lease = await acquirePlaywrightTestBrowser();
  await mkdir(SCRATCH, { recursive: true }); await mkdir(ARTIFACTS, { recursive: true });
  directory = await mkdtemp(join(SCRATCH, 'integration-settings-')); evidence = await mkdtemp(join(ARTIFACTS, 'acceptance-'));
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', 'build',
    join(import.meta.dir, 'integration-settings-list.browser-fixture.tsx'), '--target=browser', '--format=iife',
    `--outfile=${join(directory, 'fixture.js')}`], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (status !== 0) throw new Error(`Integration settings fixture compilation failed.\n${stdout}\n${stderr}`);
  const css = await buildPlatformStyles(directory, join(directory, 'missing-app'));
  app = serveFixture(join(directory, 'fixture.js'), css.cssPath); baseUrl = `http://127.0.0.1:${app.server!.port}`;
}, TIMEOUT);
afterAll(async () => {
  try { await app?.stop(true); if (directory) await rm(directory, { recursive: true, force: true }); }
  finally { lease?.release(); }
}, TIMEOUT);
async function open(width = 1100, dark = false, reducedMotion: 'reduce' | 'no-preference' = 'no-preference', longCopy = false, collision = false): Promise<Page> {
  if (!lease) throw new Error('The isolated integration settings fixture was not initialized.');
  const page = await lease.browser.newPage({ viewport: { width, height: 1050 }, reducedMotion });
  page.setDefaultTimeout(4_000);
  await page.goto(`${baseUrl}/?dark=${dark ? '1' : '0'}${longCopy ? '&long=1' : ''}${collision ? '&collision=1' : ''}`); await page.getByTestId('fixture-ready').waitFor();
  return page;
}
function trigger(page: Page) { return page.getByRole('button', { name: 'Actions for Slack', exact: true }); }
async function waitFocused(target: Locator) {
  await target.evaluate(element => new Promise<void>((resolve, reject) => {
    let frames = 0;
    const check = () => {
      if (document.activeElement === element) resolve();
      else if (++frames > 120) reject(new Error('Menu/dialog focus did not return to its initiating control.'));
      else requestAnimationFrame(check);
    }; check();
  }));
}
async function choose(page: Page, label: string) {
  await trigger(page).click(); await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function waitCalls(page: Page, count: number) { await page.waitForFunction(expected => window.__integrationSettings.calls.length === expected, count); }
async function waitMenuSettled(target: Locator) {
  await target.evaluate(element => new Promise<void>((resolve, reject) => {
    let frames = 0;
    const check = () => {
      if (Number(getComputedStyle(element).opacity) >= .999) resolve();
      else if (++frames > 120) reject(new Error('The integration menu opening animation did not settle.'));
      else requestAnimationFrame(check);
    }; check();
  }));
}
async function snapshot(page: Page) {
  return page.evaluate(() => ({ calls: window.__integrationSettings.calls.map(call => ({ action: call.action,
    aborted: call.signal.aborted, itemId: call.itemId, groupId: call.groupId })),
    errors: window.__integrationSettings.errors, events: window.__integrationSettings.events }));
}

describe('IntegrationSettingsList browser qualification', () => {
  test('menu -> confirmation stays open until completion/cancel and restores focus', async () => {
    const page = await open(); try {
      await choose(page, 'Remove connection');
      const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
      expect((await snapshot(page)).calls).toHaveLength(0);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' }); await waitFocused(trigger(page));
      expect((await snapshot(page)).calls).toHaveLength(0);
      await choose(page, 'Remove connection'); await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Remove connection', exact: true }).click(); await waitCalls(page, 1);
      expect(await dialog.isVisible()).toBe(true); expect(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled()).toBe(true);
      expect(await dialog.getByRole('button', { name: 'Working…', exact: true }).isDisabled()).toBe(true);
      await page.keyboard.press('Escape'); expect(await dialog.isVisible()).toBe(true);
      expect((await snapshot(page)).calls).toEqual([{ action: 'remove', aborted: false, itemId: 'slack', groupId: 'communication' }]);
      await page.evaluate(() => window.__integrationSettings.resolve(0));
      await dialog.waitFor({ state: 'detached' }); await waitFocused(trigger(page));
      expect(await page.getByTestId('grouped-list').getByText('Connected', { exact: true }).count()).toBe(2);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('context menu keyboard route confirms and returns focus; reasons disable dispatch', async () => {
    const page = await open(); try {
      const row = page.getByRole('listitem', { name: 'Slack', exact: true });
      await row.focus(); await page.keyboard.press('Shift+F10');
      const blocked = page.getByRole('menuitem', { name: /Managed setting/ }); await blocked.waitFor();
      expect(await blocked.getAttribute('aria-disabled')).toBe('true');
      expect(await blocked.getByText('Managed by your organization').isVisible()).toBe(true);
      await page.getByRole('menuitem', { name: 'Remove connection', exact: true }).click();
      const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' }); await waitFocused(row);
      expect((await snapshot(page)).calls).toHaveLength(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('async current errors are safe, retryable, code-only and single-flight', async () => {
    const page = await open(); try {
      await choose(page, 'Reconnect'); await waitCalls(page, 1);
      expect(await trigger(page).isDisabled()).toBe(true);
      await page.evaluate(() => window.__integrationSettings.reject(0));
      const alert = page.getByRole('alert'); await alert.waitFor();
      expect(await alert.innerText()).toBe('Unable to complete this action. Please try again.');
      const failed = await snapshot(page);
      expect(failed.errors).toHaveLength(1); expect(failed.events).toHaveLength(1);
      expect(failed.events[0]?.metadata).toEqual({ surface: 'integration-settings-list', stage: 'action' });
      expect(JSON.stringify(failed.events)).not.toContain('PRIVATE_INTEGRATION_FAILURE');
      await page.getByRole('menu').waitFor({ state: 'detached' });
      await choose(page, 'Reconnect'); await waitCalls(page, 2); expect(await alert.count()).toBe(0);
      await page.evaluate(() => window.__integrationSettings.resolve(1));
      await page.waitForFunction(() => !document.querySelector('button[aria-label="Actions for Slack"]')?.hasAttribute('disabled'));
      expect((await snapshot(page)).calls).toHaveLength(2);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('live provider scope fences retained dispatch and late errors even before React notification', async () => {
    const page = await open(); try {
      await trigger(page).click();
      const action = page.getByRole('menuitem', { name: 'Reconnect', exact: true }); await action.waitFor();
      await page.evaluate(() => window.__integrationSettings.changeOrganization(false));
      await action.click();
      expect((await snapshot(page)).calls).toHaveLength(0);
    } finally { await page.close(); }
    const late = await open(); try {
      await choose(late, 'Reconnect'); await waitCalls(late, 1);
      await late.evaluate(() => { window.__integrationSettings.changeOrganization(false); window.__integrationSettings.reject(0); });
      await late.waitForFunction(() => window.__integrationSettings.calls[0]?.signal.aborted);
      expect((await snapshot(late)).errors).toHaveLength(0); expect((await snapshot(late)).events).toHaveLength(0);
      expect(await late.getByRole('alert').count()).toBe(0);
    } finally { await late.close(); }
  }, TIMEOUT);

  test('fresh controlled descriptors preserve work, while scope/revision/capability retirement aborts late errors', async () => {
    for (const change of ['scope', 'revision', 'capability', 'target', 'removed', 'readonly'] as const) {
      const page = await open(); try {
        await choose(page, 'Reconnect'); await waitCalls(page, 1);
        await page.evaluate(() => window.__integrationSettings.rerender());
        await page.waitForFunction(() => document.querySelector('[data-testid="fixture-ready"]')?.getAttribute('data-render') === '1');
        expect((await snapshot(page)).calls[0]?.aborted).toBe(false);
        await page.evaluate(kind => {
          const h = window.__integrationSettings;
          if (kind === 'scope') h.changeOrganization();
          else if (kind === 'revision') h.setRevision(1);
          else if (kind === 'capability') h.setCapability(false);
          else if (kind === 'target') h.changeTarget();
          else if (kind === 'removed') h.removeItem();
          else h.setReadOnly(true);
        }, change);
        await page.waitForFunction(() => window.__integrationSettings.calls[0]?.signal.aborted);
        await page.evaluate(() => window.__integrationSettings.reject(0));
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(await page.getByRole('alert').count()).toBe(0);
        expect((await snapshot(page)).errors).toHaveLength(0); expect((await snapshot(page)).events).toHaveLength(0);
      } finally { await page.close(); }
    }
  }, TIMEOUT);

  test('revoked confirmation closes without dispatch; primary capability retirement and read-only remain visible', async () => {
    const page = await open(); try {
      await choose(page, 'Remove connection'); await page.getByRole('alertdialog').waitFor();
      await page.evaluate(() => window.__integrationSettings.setCapability(false));
      await page.getByRole('alertdialog').waitFor({ state: 'detached' });
      expect((await snapshot(page)).calls).toHaveLength(0);
      await page.getByRole('button', { name: 'New Connection', exact: true }).click(); await waitCalls(page, 1);
      await page.evaluate(() => window.__integrationSettings.setPrimaryDisabled(true));
      await page.waitForFunction(() => window.__integrationSettings.calls[0]?.signal.aborted);
      await page.evaluate(() => window.__integrationSettings.reject(0));
      expect((await snapshot(page)).errors).toHaveLength(0);
      await page.evaluate(() => window.__integrationSettings.setReadOnly(true));
      await page.getByText('Read-only connections', { exact: true }).waitFor();
      expect(await trigger(page).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'New Connection', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByTestId('grouped-list').getByText('Connected', { exact: true }).count()).toBe(2);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('flat/named group routing changes retire rows even when the named ID is flat', async () => {
    const page = await open(1100, false, 'reduce', false, true); try {
      await choose(page, 'Reconnect'); await waitCalls(page, 1);
      await page.evaluate(() => window.__integrationSettings.setFlat(true));
      await page.waitForFunction(() => window.__integrationSettings.calls[0]?.signal.aborted);
      await page.evaluate(() => window.__integrationSettings.reject(0));
      expect((await snapshot(page)).errors).toHaveLength(0);
      expect(await page.getByTestId('grouped-list').locator('.integration-settings-list__group').count()).toBe(0);
      await choose(page, 'Reconnect'); await waitCalls(page, 2);
      expect((await snapshot(page)).calls[1]?.groupId).toBeNull();
      await page.evaluate(() => window.__integrationSettings.setFlat(false));
      await page.waitForFunction(() => window.__integrationSettings.calls[1]?.signal.aborted);
      await page.evaluate(() => window.__integrationSettings.reject(1));
      expect((await snapshot(page)).errors).toHaveLength(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('unreadable provider projection masks all old rows/actions until explicitly ready', async () => {
    const page = await open(); try {
      await choose(page, 'Reconnect'); await waitCalls(page, 1);
      await page.evaluate(() => window.__integrationSettings.setUnavailable());
      await page.getByRole('status', { name: '' }).filter({ hasText: 'Updating secure access…' }).waitFor();
      expect(await trigger(page).count()).toBe(0); expect(await page.getByText('Workplace messaging', { exact: true }).count()).toBe(0);
      await page.waitForFunction(() => window.__integrationSettings.calls[0]?.signal.aborted);
      await page.evaluate(() => { window.__integrationSettings.reject(0); window.__integrationSettings.setReady(); });
      await trigger(page).waitFor(); expect((await snapshot(page)).errors).toHaveLength(0);
    } finally { await page.close(); }
  }, TIMEOUT);

  test('styled light/dark 320px and reduced-motion layouts are compact, readable, token-overridable', async () => {
    for (const dark of [false, true]) {
      const page = await open(320, dark, 'reduce'); try {
        const geometry = await page.getByTestId('grouped-list').evaluate(element => {
          const identity = element.querySelector('.integration-settings-list__identity')!.getBoundingClientRect();
          const tools = element.querySelector('.integration-settings-list__tools')!.getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth > innerWidth, identityBottom: identity.bottom, toolsTop: tools.top,
            background: getComputedStyle(element).backgroundColor,
            dots: [...element.querySelectorAll('.integration-settings-list__dot')].map(dot => getComputedStyle(dot).backgroundColor) };
        });
        expect(geometry.overflow).toBe(false); expect(geometry.toolsTop).toBeGreaterThanOrEqual(geometry.identityBottom);
        expect(geometry.dots[0]).not.toBe(geometry.dots[1]); expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)');
        expect(await page.getByTestId('flat-list').locator('.integration-settings-list__group').count()).toBe(0);
        await page.screenshot({ path: join(evidence!, dark ? 'narrow-dark.png' : 'narrow-light.png'), fullPage: true });
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--integration-settings-gap', '24px');
          document.documentElement.style.setProperty('--integration-settings-padding', '28px');
          document.documentElement.style.setProperty('--integration-settings-logo-size', '48px');
        });
        const tokens = await page.getByTestId('grouped-list').evaluate(element => ({
          gap: getComputedStyle(element).gap, padding: getComputedStyle(element).padding,
          logo: getComputedStyle(element.querySelector('.integration-settings-list__logo')!).width,
        }));
        expect(tokens).toEqual({ gap: '24px', padding: '28px', logo: '48px' });
      } finally { await page.close(); }
    }
    const desktop = await open(1100, true); try {
      await desktop.screenshot({ path: join(evidence!, 'desktop-dark.png'), fullPage: true });
      await trigger(desktop).click(); await desktop.getByRole('menuitem', { name: 'Reconnect', exact: true }).waitFor();
      await waitMenuSettled(desktop.getByRole('menu'));
      await desktop.screenshot({ path: join(evidence!, 'desktop-dark-menu.png'), fullPage: true });
    } finally { await desktop.close(); }
    const long = await open(320, false, 'reduce', true); try {
      expect(await long.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(await long.getByRole('button', { name: 'Connect another organization integration account', exact: true }).isVisible()).toBe(true);
      expect(await long.getByText('A very long configured connection status with important details', { exact: true }).isVisible()).toBe(true);
      await long.screenshot({ path: join(evidence!, 'narrow-long-copy.png'), fullPage: true });
      await long.evaluate(() => { document.documentElement.dir = 'rtl'; });
      expect(await long.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await trigger(long).click(); await long.getByRole('menuitem', { name: 'Remove connection', exact: true }).click();
      await long.getByRole('alertdialog').waitFor();
      await long.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await long.getByRole('alertdialog').waitFor({ state: 'detached' }); await waitFocused(trigger(long));
    } finally { await long.close(); }
  }, TIMEOUT);
});
