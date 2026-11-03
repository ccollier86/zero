/** Native Chromium reset-request countdown; public policy is identical for every address. Backend deduplication is tested separately. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Route } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const built = await Bun.build({ entrypoints: [import.meta.dir + '/password-action-form.browser-fixture.tsx'],
    target: 'browser', format: 'esm', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!built.success) throw new Error('Reset-request fixture build failed.');
  bundle = await built.outputs[0]!.text(); lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
async function open(cooldownMs = 120_000, failure = false) {
  const page = await lease!.browser.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.name));
  let requests = 0;
  await page.route('http://reset-request.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/config') return json(route, { registration: { mode: 'public', bootstrapRequired: false, publicRegistrationEnabled: true },
      accountEmails: { adminCreatedUser: false, passwordReset: true, passwordChangedNotice: false, passwordResetRequestCooldownMs: cooldownMs } });
    if (path === '/auth/forgot-password') { requests++; return json(route, failure ? { code: 'AUTH_NOT_READY' } : { ok: true }, failure ? 503 : 200); }
    if (path.startsWith('/auth/')) return json(route, {});
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reset request</title><div id="root"></div>' });
  });
  try {
    await page.goto('http://reset-request.test/forgot-password'); await page.addScriptTag({ content: bundle, type: 'module' });
    await page.getByLabel('Email', { exact: true }).waitFor();
    await page.clock.install();
    await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
  } catch { await page.close(); throw new Error('Native request fixture did not mount [' + errors.join(',') + ']'); }
  return { page, count: () => requests, async close() { await page.close(); expect(errors).toEqual([]); } };
}
browserTest('resend is blocked until the public countdown expires; explicit resend restarts the countdown without automatic requests', async () => {
  const h = await open();
  try {
    await h.page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await h.page.getByText('For security, wait another 2 minutes before requesting a new link.', { exact: true }).waitFor();
    const resend = h.page.getByRole('button', { name: 'Request another link', exact: true });
    expect(await resend.isDisabled()).toBe(true); expect(h.count()).toBe(1);
    await resend.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    expect(h.count()).toBe(1);
    await h.page.clock.fastForward(60_001);
    await h.page.getByText('For security, wait another 60 seconds before requesting a new link.', { exact: true }).waitFor();
    await h.page.clock.fastForward(60_001);
    await h.page.getByText('You can request another link now. Other security checks still apply.', { exact: true }).waitFor();
    expect(await resend.isDisabled()).toBe(false); expect(h.count()).toBe(1);
    await resend.click();
    await h.page.getByText('For security, wait another 2 minutes before requesting a new link.', { exact: true }).waitFor();
    expect(h.count()).toBe(2); expect(await resend.isDisabled()).toBe(true);
  } finally { await h.close(); }
});
browserTest('rapid form submit produces one request and no later automatic mail', async () => {
  const h = await open();
  try {
    await h.page.locator('form').evaluate(node => { (node as HTMLFormElement).requestSubmit(); (node as HTMLFormElement).requestSubmit(); });
    await h.page.getByRole('heading', { name: 'Request received', exact: true }).waitFor();
    expect(h.count()).toBe(1); await h.page.clock.fastForward(600_000); expect(h.count()).toBe(1);
  } finally { await h.close(); }
});
browserTest('a failed request does not claim receipt or start a successful-request cooldown', async () => {
  const h = await open(120_000, true);
  try {
    await h.page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await h.page.getByRole('alert').waitFor();
    expect(await h.page.getByRole('heading', { name: 'Request received', exact: true }).count()).toBe(0);
    expect(await h.page.getByRole('button', { name: 'Send reset link', exact: true }).isDisabled()).toBe(false);
    expect(h.count()).toBe(1);
  } finally { await h.close(); }
});
