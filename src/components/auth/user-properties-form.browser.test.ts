/** Chromium lifecycle/interaction tests for the actual UserPropertiesForm, not a button-only renderer. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const result = await Bun.build({ entrypoints: [import.meta.dir + '/user-properties-form.browser-fixture.tsx'],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!result.success) throw new Error('Synthetic property form bundle failed.');
  bundle = await result.outputs[0]!.text(); lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60000);
afterAll(() => lease?.release());
async function open() {
  const page = await browser.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(5000);
  await page.route('http://properties.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  try {
    await page.goto('http://properties.test/account'); await page.addScriptTag({ content: bundle });
    await page.getByLabel('Professional credentials', { exact: true }).waitFor();
  } catch (cause) { await page.close(); throw new Error('Synthetic property form did not mount: ' + errors.join('; '), { cause }); }
  return { page, async close() { await page.close(); expect(errors).toEqual([]); } };
}
const form = (page: Page) => page.locator('[data-slot="user-properties-form"]');
const save = (page: Page) => form(page).getByRole('button', { name: 'Save settings', exact: true });
async function count(page: Page, number: number) { await page.waitForFunction(number => window.__propertiesForm.calls.length === number, number); }

browserTest('initial/reverted settings are disabled and Enter/requestSubmit/visual opt-out never create unchanged writes', async () => {
  const h = await open(), p = h.page;
  try {
    expect(await save(p).isDisabled()).toBe(true); expect(await p.getByLabel('Restricted', { exact: true }).count()).toBe(0);
    await form(p).evaluate(node => (node as HTMLFormElement).requestSubmit());
    await p.getByLabel('Professional credentials', { exact: true }).press('Enter');
    await p.getByLabel('Professional credentials', { exact: true }).fill('Changed'); expect(await save(p).isEnabled()).toBe(true);
    await p.getByLabel('Professional credentials', { exact: true }).fill(''); expect(await save(p).isDisabled()).toBe(true);
    await p.evaluate(() => window.__propertiesForm.allowUnchangedButton()); await save(p).waitFor();
    await p.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled);
    await save(p).click(); await form(p).evaluate(node => (node as HTMLFormElement).requestSubmit());
    expect(await p.evaluate(() => window.__propertiesForm.snapshot())).toEqual({ successes: 0, reads: 0, properties: {} });
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(0);
  } finally { await h.close(); }
});

browserTest('only changed fields are submitted sequentially; rapid submissions cannot duplicate accepted writes', async () => {
  const h = await open(), p = h.page;
  try {
    await p.getByLabel('Professional credentials', { exact: true }).fill('Credential'); await p.getByLabel('Professional region', { exact: true }).fill('Region');
    await form(p).evaluate(node => { (node as HTMLFormElement).requestSubmit(); (node as HTMLFormElement).requestSubmit(); }); await count(p, 1);
    expect(await p.evaluate(() => window.__propertiesForm.calls.map(call => call.key))).toEqual(['professional_credentials']);
    await p.evaluate(() => window.__propertiesForm.resolve(0)); await count(p, 2);
    await p.evaluate(() => window.__propertiesForm.resolve(1)); await p.getByRole('status').waitFor();
    expect(await save(p).isDisabled()).toBe(true);
    expect(await p.evaluate(() => window.__propertiesForm.snapshot())).toEqual({ successes: 1, reads: 0,
      properties: { professional_credentials: 'Credential', professional_region: 'Region' } });
  } finally { await h.close(); }
});

browserTest('personal/config snapshots and newer typing survive a pending professional acknowledgment', async () => {
  const h = await open(), p = h.page;
  try {
    const field = p.getByLabel('Professional credentials', { exact: true }); await field.fill('Submitted'); await save(p).click(); await count(p, 1);
    expect(await field.isEnabled()).toBe(true); await field.fill('Newer draft'); await p.evaluate(() => window.__propertiesForm.personalUpdate());
    expect(await field.inputValue()).toBe('Newer draft'); await p.evaluate(() => window.__propertiesForm.resolve(0));
    await p.getByRole('status').waitFor(); expect(await field.inputValue()).toBe('Newer draft'); expect(await save(p).isEnabled()).toBe(true);
    await save(p).click(); await count(p, 2); expect(await p.evaluate(() => window.__propertiesForm.calls[1]!.value)).toBe('Newer draft');
  } finally { await h.close(); }
});

browserTest('known partial acceptance preserves remaining fields and never resends the accepted field', async () => {
  const h = await open(), p = h.page;
  try {
    await p.getByLabel('Professional credentials', { exact: true }).fill('Accepted'); await p.getByLabel('Professional region', { exact: true }).fill('Rejected');
    await save(p).click(); await count(p, 1); await p.evaluate(() => window.__propertiesForm.resolve(0)); await count(p, 2);
    await p.evaluate(() => window.__propertiesForm.reject(1)); await p.getByRole('alert').waitFor();
    expect(await p.getByRole('alert').innerText()).toContain('1 setting saved.');
    expect(await p.evaluate(() => window.__propertiesForm.snapshot().successes)).toBe(0);
    await save(p).click(); await count(p, 3);
    expect(await p.evaluate(() => window.__propertiesForm.calls.map(call => call.key))).toEqual(['professional_credentials', 'professional_region', 'professional_region']);
  } finally { await h.close(); }
});

browserTest('unknown committed response blocks replay; explicit read reconciles state without inventing acceptance', async () => {
  const h = await open(), p = h.page;
  try {
    await p.getByLabel('Professional credentials', { exact: true }).fill('Unknown'); await save(p).click(); await count(p, 1);
    await p.evaluate(() => window.__propertiesForm.reject(0, true, true)); await p.getByRole('button', { name: 'Check saved settings', exact: true }).waitFor();
    expect(await save(p).isDisabled()).toBe(true); await form(p).evaluate(node => (node as HTMLFormElement).requestSubmit());
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(1);
    await p.getByRole('button', { name: 'Check saved settings', exact: true }).click();
    await p.getByRole('button', { name: 'Check saved settings', exact: true }).waitFor({ state: 'detached' });
    expect(await p.getByRole('alert').innerText()).toContain('outcome is still unknown'); expect(await save(p).isDisabled()).toBe(true);
    expect(await p.evaluate(() => window.__propertiesForm.snapshot())).toEqual({ successes: 0, reads: 1, properties: { professional_credentials: 'Unknown' } });
  } finally { await h.close(); }
});

for (const replacement of ['account', 'client', 'authorization', 'unmount'] as const) for (const accepted of [false, true]) browserTest(`late ${accepted ? 'accepted' : 'rejected'} response retires on ${replacement} replacement without callbacks or another field dispatch`, async () => {
  const h = await open(), p = h.page;
  try {
    await p.getByLabel('Professional credentials', { exact: true }).fill('Old'); await p.getByLabel('Professional region', { exact: true }).fill('Never dispatch');
    await save(p).click(); await count(p, 1);
    await p.evaluate(replacement => {
      if (replacement === 'account') window.__propertiesForm.replaceAccount();
      if (replacement === 'client') window.__propertiesForm.replaceClient();
      if (replacement === 'authorization') window.__propertiesForm.retire();
      if (replacement === 'unmount') window.__propertiesForm.hide();
    }, replacement);
    await p.evaluate(accepted => accepted ? window.__propertiesForm.resolve(0) : window.__propertiesForm.reject(0), accepted);
    await p.waitForTimeout(40);
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(1);
    expect(await p.evaluate(() => window.__propertiesForm.snapshot().successes)).toBe(0); expect(await p.getByRole('alert').count()).toBe(0);
    if (replacement === 'account') expect(await p.getByLabel('Professional credentials', { exact: true }).inputValue()).toBe('');
    if (replacement === 'authorization') expect(await p.getByLabel('Professional credentials', { exact: true }).count()).toBe(0);
  } finally { await h.close(); }
});

browserTest('a notification callback failure does not undo or repeat accepted settings', async () => {
  const h = await open(), p = h.page;
  try {
    await p.evaluate(() => window.__propertiesForm.failCallback()); await p.getByLabel('Professional credentials', { exact: true }).fill('Accepted');
    await save(p).click(); await count(p, 1); await p.evaluate(() => window.__propertiesForm.resolve(0)); await p.getByRole('status').waitFor();
    expect(await p.getByRole('alert').count()).toBe(0); expect(await save(p).isDisabled()).toBe(true);
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(1);
    expect(await p.evaluate(() => window.__propertiesForm.observations)).toContain('frontend.auth.action_failed');
  } finally { await h.close(); }
});

browserTest('new field policy retires the remaining queued fields without erasing an unrelated draft', async () => {
  const h = await open(), p = h.page;
  try {
    await p.getByLabel('Professional credentials', { exact: true }).fill('Submitted');
    await p.getByLabel('Professional region', { exact: true }).fill('Now restricted');
    await save(p).click(); await count(p, 1);
    await p.evaluate(() => window.__propertiesForm.restrict());
    await p.getByLabel('Professional region', { exact: true }).waitFor({ state: 'detached' });
    await p.evaluate(() => window.__propertiesForm.resolve(0));
    await p.waitForFunction(() => !document.querySelector('form[aria-busy="true"]'));
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(1);
    expect(await p.evaluate(() => window.__propertiesForm.snapshot().successes)).toBe(0);
  } finally { await h.close(); }
});

browserTest('policy refresh cannot forget an unknown committed result or allow blind replay of a still-editable field', async () => {
  const h = await open(), p = h.page;
  try {
    await p.getByLabel('Professional credentials', { exact: true }).fill('Unknown under refreshed policy');
    await p.getByLabel('Professional region', { exact: true }).fill('Never dispatch');
    await save(p).click(); await count(p, 1);
    await p.evaluate(() => window.__propertiesForm.restrict());
    await p.getByLabel('Professional region', { exact: true }).waitFor({ state: 'detached' });
    await p.evaluate(() => window.__propertiesForm.reject(0, true, true));
    await p.getByRole('button', { name: 'Check saved settings', exact: true }).waitFor();
    expect(await save(p).isDisabled()).toBe(true);
    await form(p).evaluate(node => (node as HTMLFormElement).requestSubmit());
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(1);
    expect(await p.evaluate(() => window.__propertiesForm.snapshot().successes)).toBe(0);
    await p.getByRole('button', { name: 'Check saved settings', exact: true }).click();
    await p.getByRole('button', { name: 'Check saved settings', exact: true }).waitFor({ state: 'detached' });
    expect(await save(p).isDisabled()).toBe(true);
    expect(await p.getByRole('alert').innerText()).toContain('outcome is still unknown');
    expect(await p.evaluate(() => window.__propertiesForm.snapshot().reads)).toBe(1);
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(1);
  } finally { await h.close(); }
});

browserTest('failed policy refresh fails closed but a successful explicit retry restores the same professional draft', async () => {
  const h = await open(), p = h.page;
  try {
    await p.getByLabel('Professional credentials', { exact: true }).fill('Retained professional draft');
    await p.evaluate(() => window.__propertiesForm.failConfiguration());
    await p.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    expect(await form(p).count()).toBe(0); expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(0);
    await p.evaluate(() => window.__propertiesForm.recoverConfiguration());
    await p.getByRole('button', { name: 'Retry', exact: true }).click();
    await p.getByLabel('Professional credentials', { exact: true }).waitFor();
    expect(await p.getByLabel('Professional credentials', { exact: true }).inputValue()).toBe('Retained professional draft');
    expect(await save(p).isEnabled()).toBe(true);
  } finally { await h.close(); }
});

browserTest('an unavailable configuration cannot erase an in-flight unknown outcome when the same form recovers', async () => {
  const h = await open(), p = h.page;
  try {
    await p.getByLabel('Professional credentials', { exact: true }).fill('Unknown during configuration outage');
    await save(p).click(); await count(p, 1);
    await p.evaluate(() => window.__propertiesForm.failConfiguration());
    await p.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    await p.evaluate(() => window.__propertiesForm.reject(0, true, true));
    await p.evaluate(() => window.__propertiesForm.recoverConfiguration());
    await p.getByRole('button', { name: 'Retry', exact: true }).click();
    await p.getByRole('button', { name: 'Check saved settings', exact: true }).waitFor();
    expect(await save(p).isDisabled()).toBe(true);
    expect(await p.getByLabel('Professional credentials', { exact: true }).inputValue()).toBe('Unknown during configuration outage');
    await form(p).evaluate(node => (node as HTMLFormElement).requestSubmit());
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(1);
    expect(await p.evaluate(() => window.__propertiesForm.snapshot().successes)).toBe(0);
    await p.getByRole('button', { name: 'Check saved settings', exact: true }).click();
    await p.getByRole('button', { name: 'Check saved settings', exact: true }).waitFor({ state: 'detached' });
    expect(await save(p).isDisabled()).toBe(true);
    expect(await p.getByRole('alert').innerText()).toContain('outcome is still unknown');
    expect(await p.evaluate(() => window.__propertiesForm.calls.length)).toBe(1);
  } finally { await h.close(); }
});
