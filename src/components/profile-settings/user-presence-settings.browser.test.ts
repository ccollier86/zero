/** Browser qualification of real presence ownership and existing controlled UI. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { Browser } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform/presence-settings-browser';
  const styles = await buildPlatformStyles(root, `${root}/absent-app`); css = await Bun.file(styles.cssPath).text();
  const script = `const result=await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/user-presence-settings.browser-fixture.tsx`)}],target:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('test')}});if(!result.success){for(const log of result.logs)await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', script], cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' });
  const [output, diagnostics, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (code !== 0) throw new Error(diagnostics); bundle = output; lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());
async function open(query = '') {
  const server = Bun.serve({ port: 0, fetch(request) { return new URL(request.url).pathname === '/fixture.js'
    ? new Response(bundle, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } })
    : new Response(`<!doctype html><meta charset="utf-8"><style>${css}</style><main style="max-width:640px;padding:16px;margin:auto"><div id="root"></div></main><script src="/fixture.js"></script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); } });
  const page = await browser.newPage({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce' }), errors: string[] = [];
  page.setDefaultTimeout(5000); page.on('pageerror', cause => errors.push(cause.message));
  const close = async () => { try { await page.evaluate(() => window.__presenceSettings?.dispose()); } finally {
    try { await page.close(); } finally { await server.stop(true); } } expect(errors).toEqual([]); };
  try { await page.goto(`http://localhost:${server.port}/${query}`); await page.waitForFunction(() => Boolean(window.__presenceSettings)); }
  catch (cause) { await close(); throw cause; }
  return { page, close };
}
browserTest('initial global readOnly still loads actual availability, without starting extra per-component trackers', async () => {
  const h = await open('?readonly');
  try {
    await h.page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[aria-label="Status"]')?.value === 'Available');
    expect(await h.page.getByRole('textbox', { name: 'Status', exact: true }).getAttribute('readonly')).not.toBeNull();
    expect(await h.page.evaluate(() => window.__presenceSettings.readSignals.some(signal => signal.aborted))).toBe(false);
    expect(await h.page.evaluate(() => window.__presenceSettings.starts())).toBe(1);
    expect(await h.page.evaluate(() => window.__presenceSettings.calls.length)).toBe(0);
  } finally { await h.close(); }
}, 15_000);
browserTest('disabled server catalog omits controls; native read ceiling renders the real non-mutable status', async () => {
  const disabled = await open('?disabled');
  try { await disabled.page.getByTestId('owner-status').filter({ hasText: 'disabled' }).waitFor();
    expect(await disabled.page.locator('[data-slot="user-presence-settings"]').count()).toBe(0);
    expect(await disabled.page.evaluate(() => window.__presenceSettings.starts())).toBe(0);
  } finally { await disabled.close(); }
  const native = await open('?native');
  try { await native.page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[aria-label="Status"]')?.value === 'Available');
    expect(await native.page.getByRole('combobox', { name: 'Status' }).count()).toBe(0);
    expect(await native.page.evaluate(() => window.__presenceSettings.starts())).toBe(0);
  } finally { await native.close(); }
}, 15_000);
browserTest('actual catalog excludes derived choices, pending locks duplicates, errors are safe, explicit retry reloads before changing', async () => {
  const h = await open();
  try {
    const status = h.page.getByRole('combobox', { name: 'Status' }); await status.filter({ hasText: 'Available' }).waitFor();
    await status.click(); expect(await h.page.getByRole('option', { name: 'Idle', exact: true }).count()).toBe(0);
    await h.page.getByRole('option', { name: 'Busy', exact: true }).click(); await h.page.getByText('Saving availability…', { exact: true }).waitFor();
    expect(await status.isDisabled()).toBe(true); expect(await h.page.evaluate(() => window.__presenceSettings.calls.length)).toBe(1);
    await h.page.evaluate(() => window.__presenceSettings.reject(0)); await h.page.getByRole('alert').first().waitFor();
    expect(await h.page.locator('body').innerText()).not.toContain('NEVER_RENDER_OR_LOG');
    const reads = await h.page.evaluate(() => window.__presenceSettings.reads());
    await h.page.getByRole('button', { name: 'Retry availability' }).click();
    await h.page.waitForFunction(reads => window.__presenceSettings.reads() > reads && window.__presenceSettings.state().error === null, reads);
    await status.click(); await h.page.getByRole('option', { name: 'On call', exact: true }).click();
    await h.page.evaluate(() => window.__presenceSettings.resolve(1)); await status.filter({ hasText: 'On call' }).waitFor();
    expect(await h.page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally { await h.close(); }
}, 15_000);
browserTest('readOnly retirement cancels pending writes, not the stable controlled status; replacement before notifications drops late errors', async () => {
  const h = await open();
  try {
    const status = h.page.getByRole('combobox', { name: 'Status' }); await status.filter({ hasText: 'Available' }).waitFor();
    await status.click(); await h.page.getByRole('option', { name: 'Busy', exact: true }).click();
    await h.page.waitForFunction(() => window.__presenceSettings.calls.length === 1);
    await h.page.evaluate(() => window.__presenceSettings.setReadOnly(true));
    await h.page.waitForFunction(() => window.__presenceSettings.calls[0]!.signal?.aborted === true);
    await h.page.evaluate(() => window.__presenceSettings.reject(0));
    await h.page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[aria-label="Status"]')?.value === 'Available');
    expect(await h.page.getByRole('alert').count()).toBe(0);
    await h.page.evaluate(() => window.__presenceSettings.setReadOnly(false)); await status.click(); await h.page.getByRole('option', { name: 'Away', exact: true }).click();
    await h.page.waitForFunction(() => window.__presenceSettings.calls.length === 2);
    await h.page.evaluate(() => { window.__presenceSettings.replace(false); window.__presenceSettings.reject(1); });
    await h.page.waitForTimeout(40); expect(await h.page.getByRole('alert').count()).toBe(0);
    expect(await h.page.evaluate(() => window.__presenceSettings.failures.length)).toBe(0);
    await h.page.evaluate(() => window.__presenceSettings.notify()); await status.filter({ hasText: 'Available' }).waitFor();
    expect(await h.page.evaluate(() => window.__presenceSettings.state().self?.intent.revision)).toBe(10);
  } finally { await h.close(); }
}, 15_000);
browserTest('square avatar rings observe freshness and disappear immediately on stale or disconnected feeds', async () => {
  const h = await open();
  try {
    const ring = h.page.locator('[data-slot="avatar-presence-indicator"]'); await ring.waitFor();
    expect(await h.page.locator('[data-slot="avatar-group"][data-shape]').getAttribute('data-shape')).toBe('square');
    expect(await ring.getAttribute('data-variant')).toBe('ring');
    expect(await h.page.getByRole('img', { name: 'Synthetic user — Available' }).count()).toBe(1);
    await h.page.evaluate(() => window.__presenceSettings.disconnect()); await ring.waitFor({ state: 'detached' });
    await h.page.evaluate(() => window.__presenceSettings.reconnect()); await ring.waitFor();
    await h.page.evaluate(() => window.__presenceSettings.expireSoon()); await ring.waitFor({ state: 'detached' });
  } finally { await h.close(); }
}, 15_000);
browserTest('actual default browser activity environment disconnects, restarts and disposes without native binding errors', async () => {
  const h = await open('?default-env');
  try {
    const ring = h.page.locator('[data-slot="avatar-presence-indicator"]'); await ring.waitFor();
    expect(await h.page.evaluate(() => window.__presenceSettings.reports.length)).toBe(1);
    await h.page.evaluate(() => window.__presenceSettings.disconnect()); await ring.waitFor({ state: 'detached' });
    await h.page.evaluate(() => window.__presenceSettings.reconnect()); await ring.waitFor();
    expect(await h.page.evaluate(() => window.__presenceSettings.reports.length)).toBe(2);
    await h.page.evaluate(() => window.__presenceSettings.dispose()); await ring.waitFor({ state: 'detached' });
  } finally { await h.close(); }
}, 15_000);
for (const dark of [false, true]) browserTest(`public standalone narrow ${dark ? 'dark' : 'light'} availability and square rings inherit semantic and public metric tokens`, async () => {
  const h = await open('?standalone');
  try {
    await h.page.evaluate(dark => { document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.setProperty('--zero-avatar-presence-ring-width', '4px'); }, dark);
    const ring = h.page.locator('[data-slot="avatar-presence-indicator"]'); await ring.waitFor();
    const style = await ring.evaluate(element => { const style = getComputedStyle(element); return { width: style.borderTopWidth, radius: style.borderRadius,
      color: style.borderTopColor, expected: getComputedStyle(document.documentElement).getPropertyValue('--success').trim() }; });
    expect(style.width).toBe('4px'); expect(style.radius).toBe('0px'); expect(style.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.expected.length).toBeGreaterThan(0); expect(await h.page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const status = h.page.getByRole('combobox', { name: 'Status' }); await status.filter({ hasText: 'Available' }).waitFor();
    expect(await h.page.locator('.profile-settings').count()).toBe(0);
    expect(await h.page.locator('[data-slot="user-presence-settings"]').evaluate(element => getComputedStyle(element).paddingTop)).toBe('20px');
    expect(await status.isDisabled()).toBe(false);
    // Theme changes animate the existing Select's color; sample its settled
    // value, not an interpolated light-to-dark frame.
    await h.page.waitForFunction(() => { const element = document.querySelector('[data-slot="select-trigger"]');
      return element && getComputedStyle(element).color === getComputedStyle(element.parentElement!).color; });
    const color = await status.evaluate(element => ({ control: getComputedStyle(element).color, parent: getComputedStyle(element.parentElement!).color }));
    expect(color.control).toBe(color.parent);
    await h.page.evaluate(() => { const style = document.documentElement.style;
      style.setProperty('--profile-settings-padding', '18px'); style.setProperty('--profile-settings-unit', '6px'); style.setProperty('--profile-settings-gap', '24px'); });
    expect(await h.page.locator('[data-slot="user-presence-settings"]').evaluate(element => getComputedStyle(element).paddingTop)).toBe('18px');
    expect(await h.page.locator('.profile-settings__field').evaluate(element => getComputedStyle(element).rowGap)).toBe('6px');
    await h.page.setViewportSize({ width: 640, height: 640 });
    expect(await h.page.locator('.profile-settings__field').evaluate(element => getComputedStyle(element).columnGap)).toBe('24px');
    await h.page.setViewportSize({ width: 320, height: 640 });
    expect(await h.page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await h.page.screenshot({ path: `/Volumes/code-bank/tmp/scratch/zero-platform/presence-settings-browser/presence-${dark ? 'dark' : 'light'}.png`, fullPage: true });
  } finally { await h.close(); }
}, 15_000);
