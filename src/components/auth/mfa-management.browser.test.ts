/** Real-browser fail-closed MFA settings acceptance using synthetic policy/method receipts. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  // Bun 1.3's test-runner resolver conflicts with full SDK browser bundles.
  // Build the same source in a fresh Bun process, retaining all actual hooks.
  const script = `const result = await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/mfa-management.browser-fixture.tsx`)}],target:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('test')}});
    if(!result.success){for(const log of result.logs) await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}
    await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', script], cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' });
  const [output, diagnostics, exit] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (exit !== 0) throw new Error(diagnostics || 'Isolated MFA browser fixture build failed.');
  bundle = output;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform/mfa-management';
  const styles = await buildPlatformStyles(scratch, `${scratch}/absent-app`);
  css = await Bun.file(styles.cssPath).text();
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());
async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 720, height: 760 } });
  const messages: string[] = []; errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await page.setContent('<div id="root"></div>'); await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => window.__mfaManagement?.counts().config === 1);
  return page;
}
async function close(page: Page): Promise<void> { expect(errors.get(page)).toEqual([]); await page.close(); }
/** Flush promise continuations and React presentation before checking retired receipts. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function ready(page: Page, overrides: Parameters<Window['__mfaManagement']['resolveConfig']>[1] = {}): Promise<void> {
  await page.evaluate(overrides => window.__mfaManagement.resolveConfig(0, overrides), overrides);
  await page.waitForFunction(() => window.__mfaManagement.counts().list === 1);
}
async function emptyList(page: Page, index = 0): Promise<void> {
  await page.evaluate(index => window.__mfaManagement.resolveList(index), index);
  await page.getByRole('button', { name: 'Set up two-factor', exact: true }).waitFor();
}

browserTest('unknown/loading policy is explicit; disabled policy hides the panel without requesting methods', async () => {
  const page = await open();
  try {
    expect(await page.getByRole('status').textContent()).toBe('Loading MFA policy…');
    expect(await page.evaluate(() => window.__mfaManagement.counts().list)).toBe(0);
    await page.evaluate(() => window.__mfaManagement.invalidatePolicy());
    expect(await page.getByRole('status').textContent()).toBe('Loading MFA policy…');
    await page.evaluate(() => window.__mfaManagement.refreshPolicy());
    await page.waitForFunction(() => window.__mfaManagement.counts().config === 2);
    await page.evaluate(() => window.__mfaManagement.resolveConfig(1, { enabled: false, ready: false, availableMethods: [] }));
    await page.waitForFunction(() => document.querySelector('main')?.textContent === '');
    expect(await page.evaluate(() => window.__mfaManagement.counts().list)).toBe(0);
    expect(await page.getByRole('button', { name: 'Set up two-factor', exact: true }).count()).toBe(0);
    await page.evaluate(() => window.__mfaManagement.resolveConfig(0));
    await settle(page);
    expect(await page.evaluate(() => window.__mfaManagement.counts().list)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('policy failures and absent MFA capability show an actionable retry without guessing setup methods', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__mfaManagement.rejectConfig(0));
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('MFA policy could not be loaded.');
    expect(await page.evaluate(() => window.__mfaManagement.counts().list)).toBe(0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => window.__mfaManagement.counts().config === 2);
    await page.evaluate(() => window.__mfaManagement.resolveMissingMfa(1));
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('button', { name: 'Set up two-factor', exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => window.__mfaManagement.counts().list)).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('method loading/errors gate enrollment; successful retry renders the actual active methods', async () => {
  const page = await open();
  try {
    await ready(page);
    expect(await page.getByRole('status').textContent()).toContain('Loading MFA settings');
    expect(await page.getByRole('button', { name: 'Set up two-factor', exact: true }).count()).toBe(0);
    await page.evaluate(() => window.__mfaManagement.rejectList(0));
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('Synthetic method load failure');
    expect(await page.getByRole('button', { name: 'Set up two-factor', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => window.__mfaManagement.counts().list === 2);
    await page.evaluate(() => window.__mfaManagement.resolveList(1, ['totp'], true));
    await page.getByText('Authenticator app', { exact: true }).waitFor();
    expect(await page.getByText('Required', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Set up two-factor', exact: true }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('setup only offers ready configured and available methods, never a guessed fallback', async () => {
  const page = await open();
  try {
    await ready(page, { methods: ['email', 'totp'], availableMethods: ['email'] }); await emptyList(page);
    await page.getByRole('button', { name: 'Set up two-factor', exact: true }).click();
    expect(await page.getByRole('radiogroup').count()).toBe(0);
    expect(await page.getByText('Send a one-time code to your account email.', { exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'Send email code', exact: true }).click();
    await page.waitForFunction(() => window.__mfaManagement.counts().start === 1);
    expect(await page.evaluate(() => window.__mfaManagement.calls.filter(call => call.action === 'start').map(call => call.method))).toEqual(['email']);
    await page.evaluate(() => window.__mfaManagement.refreshPolicy());
    await page.waitForFunction(() => window.__mfaManagement.counts().config === 2);
    await page.evaluate(() => window.__mfaManagement.resolveConfig(1, { ready: false }));
    await page.waitForFunction(() => window.__mfaManagement.counts().list === 2);
    await page.evaluate(() => window.__mfaManagement.resolveList(1));
    await page.getByRole('status').waitFor();
    expect(await page.getByRole('status').textContent()).toContain('Two-factor setup is currently unavailable.');
    expect(await page.getByRole('button', { name: 'Set up two-factor', exact: true }).count()).toBe(0);
    await page.evaluate(() => window.__mfaManagement.resolveSetup(0, 'email'));
    await settle(page);
    expect(await page.getByText('Verify email code', { exact: true }).count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('policy refresh retires enrollment immediately and disabled policy ignores old method/setup completions', async () => {
  const page = await open();
  try {
    await ready(page); await emptyList(page);
    await page.getByRole('button', { name: 'Set up two-factor', exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Two-factor authentication method' }).waitFor();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => window.__mfaManagement.counts().start === 1);
    await page.evaluate(() => window.__mfaManagement.refreshPolicy());
    await page.getByText('Loading MFA policy…', { exact: true }).waitFor();
    expect(await page.getByRole('radiogroup').count()).toBe(0);
    await page.evaluate(() => window.__mfaManagement.resolveSetup(0, 'totp'));
    await settle(page);
    expect(await page.getByLabel('Manual setup key', { exact: true }).count()).toBe(0);
    await page.evaluate(() => window.__mfaManagement.resolveConfig(1));
    await page.waitForFunction(() => window.__mfaManagement.counts().list === 2);
    await page.evaluate(() => window.__mfaManagement.refreshPolicy());
    await page.waitForFunction(() => window.__mfaManagement.counts().config === 3);
    await page.evaluate(() => window.__mfaManagement.resolveConfig(2, { enabled: false }));
    await page.waitForFunction(() => document.querySelector('main')?.textContent === '');
    await page.evaluate(() => window.__mfaManagement.resolveList(1, ['totp']));
    await settle(page);
    expect(await page.getByText('Authenticator app', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => window.__mfaManagement.counts().list)).toBe(2);
  } finally { await close(page); }
}, 30_000);

browserTest('authorization replacement retires the old list and enrollment, including late setup results and logout', async () => {
  const page = await open();
  page.setDefaultTimeout(5_000);
  try {
    await ready(page);
    await page.evaluate(() => window.__mfaManagement.switchScope());
    await page.waitForFunction(() => window.__mfaManagement.counts().list === 2);
    await page.evaluate(() => window.__mfaManagement.resolveList(0, ['totp']));
    await settle(page);
    expect(await page.getByText('Authenticator app', { exact: true }).count()).toBe(0);
    await emptyList(page, 1);
    await page.getByRole('button', { name: 'Set up two-factor', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => window.__mfaManagement.counts().start === 1);
    expect(await page.evaluate(() => window.__mfaManagement.calls.filter(call => call.action === 'start').map(call => call.scope))).toEqual(['scope-b']);
    await page.evaluate(() => window.__mfaManagement.signOut());
    await page.waitForFunction(() => document.querySelector('main')?.textContent === '');
    await page.evaluate(() => window.__mfaManagement.resolveSetup(0, 'totp'));
    await settle(page);
    expect(await page.getByLabel('Manual setup key', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Set up two-factor', exact: true }).count()).toBe(0);
  } catch (cause) {
    const state = await page.evaluate(() => ({ counts: window.__mfaManagement.counts(), calls: window.__mfaManagement.calls,
      content: document.querySelector('main')?.textContent }));
    throw new Error(`${cause instanceof Error ? cause.message : String(cause)}\nMFA fixture state: ${JSON.stringify(state)}`);
  } finally { await close(page); }
}, 30_000);
