/** Isolated real-browser acceptance for upstream formatting, native form contracts and Zero form integration. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const pageErrors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform/phone-input';
  const styles = await buildPlatformStyles(root, `${root}/absent-app`);
  css = await Bun.file(styles.cssPath).text();
  const build = await Bun.build({ entrypoints: [`${import.meta.dir}/phone-input.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  bundle = await build.outputs[0]!.text(); lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());
async function open(dark = false): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>'); await page.addStyleTag({ content: css });
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
  await page.addScriptTag({ content: bundle }); await page.getByLabel('Phone number', { exact: true }).waitFor();
  expect(errors).toEqual([]); return page;
}
async function close(page: Page) { expect(pageErrors.get(page)).toEqual([]); await page.close(); }
async function data(page: Page) {
  return page.locator('#native').evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)));
}
browserTest('national editing emits canonical E164, forwards ref/label, supports country search and clear', async () => {
  const page = await open();
  try {
    const input = page.getByLabel('Phone number', { exact: true });
    await page.evaluate(() => window.__phoneInput.focus());
    expect(await input.evaluate(element => document.activeElement === element)).toBe(true);
    await input.fill('2025550123');
    await page.waitForFunction(() => window.__phoneInput.changes.at(-1) === '+12025550123');
    expect((await data(page)).phone).toBe('+12025550123');
    expect(await input.getAttribute('name')).toBeNull();
    await page.locator('[data-slot="phone-input"]:has(#controlled)').getByRole('button', { name: 'Phone number country: United States (+1)', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search countries', exact: true }).fill('France');
    await page.getByRole('option', { name: 'France', exact: false }).click();
    await page.waitForFunction(() => window.__phoneInput.countryChanges.includes('FR'));
    await input.fill('0612345678');
    await page.waitForFunction(() => window.__phoneInput.changes.at(-1) === '+33612345678');
    expect((await data(page)).phone).toBe('+33612345678');
    await input.fill(''); expect((await data(page)).phone).toBe('');
    expect(await page.evaluate(() => window.__phoneInput.changes.at(-1))).toBe('');
  } finally { await close(page); }
}, 30_000);
browserTest('read-only locks an already-open selector and keeps copy/focus/submission; disabled is omitted', async () => {
  const page = await open();
  try {
    const input = page.getByLabel('Phone number', { exact: true });
    await input.fill('2025550123');
    await page.locator('[data-slot="phone-input"]:has(#controlled)').getByRole('button', { name: 'Phone number country: United States (+1)', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search countries', exact: true }).waitFor();
    const before = await page.evaluate(() => ({ changes: window.__phoneInput.changes.length, country: window.__phoneInput.countryChanges.length }));
    await page.evaluate(() => window.__phoneInput.setReadOnly(true));
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#controlled')?.readOnly);
    expect(await page.getByRole('combobox', { name: 'Search countries', exact: true }).count()).toBe(0);
    expect(await page.locator('[data-slot="phone-input"]:has(#controlled)').getByRole('button').count()).toBe(0);
    await input.focus(); await input.press('ControlOrMeta+A'); await input.press('Backspace');
    expect((await data(page)).phone).toBe('+12025550123');
    expect(await input.evaluate(element => document.activeElement === element)).toBe(true);
    expect(await page.evaluate(() => ({ changes: window.__phoneInput.changes.length, country: window.__phoneInput.countryChanges.length }))).toEqual(before);
    const form = await data(page); expect(form.readonly).toBe('+12025550123'); expect(form.disabled).toBeUndefined();
    expect(form.associated).toBe('+442079460018'); expect(form.ordinary).toBe('Synthetic read-only text');
  } finally { await close(page); }
}, 30_000);
browserTest('controlled undefined/null clears remain controlled; incomplete nonempty drafts remain invalid', async () => {
  const page = await open();
  try {
    const input = page.getByLabel('Phone number', { exact: true });
    await input.fill('+'); expect((await data(page)).phone).toBe('+');
    expect(await input.evaluate(element => (element as HTMLInputElement).checkValidity())).toBe(false);
    await input.blur(); expect(await input.getAttribute('aria-invalid')).toBe('true');
    await page.evaluate(() => window.__phoneInput.reset(undefined)); await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#controlled')?.value === '');
    expect((await data(page)).phone).toBe(''); await input.fill('2025550123');
    await page.evaluate(() => window.__phoneInput.reset(null)); await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#controlled')?.value === '');
    expect((await data(page)).phone).toBe('');
    await page.getByLabel('Uncontrolled phone', { exact: true }).fill('0612345679'); expect((await data(page)).uncontrolled).toBe('+33612345679');
    await page.locator('#native').evaluate(form => (form as HTMLFormElement).reset());
    await page.waitForFunction(() => new FormData(document.querySelector<HTMLFormElement>('#native')!).get('uncontrolled') === '+33612345678');
    expect((await data(page)).uncontrolled).toBe('+33612345678');
  } finally { await close(page); }
}, 30_000);
browserTest('AutoForm preserves invalid optional drafts, explicit nullable clears, and required errors', async () => {
  const page = await open();
  try {
    const optional = page.locator('[data-case="optional"] form'), required = page.locator('[data-case="required"] form');
    const optionalInput = optional.locator('input[type="tel"]');
    expect(await optional.getByRole('button', { name: 'Phone number country: France (+33)', exact: true }).count()).toBe(1);
    await optionalInput.fill('+');
    await optional.evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(await page.evaluate(() => window.__phoneInput.optionalSubmissions)).toEqual([]);
    expect(await optional.locator('[data-slot="form-message"]').count()).toBeGreaterThan(0);
    await optionalInput.fill(''); await optional.getByRole('button', { name: 'Save optional', exact: true }).click();
    await page.waitForFunction(() => window.__phoneInput.optionalSubmissions.length === 1);
    expect(await page.evaluate(() => window.__phoneInput.optionalSubmissions)).toEqual([{ phone: null }]);
    await required.evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(await page.evaluate(() => window.__phoneInput.requiredSubmissions)).toEqual([]);
    expect(await required.locator('[data-slot="form-message"]').count()).toBeGreaterThan(0);
  } finally { await close(page); }
}, 30_000);
browserTest('country search works by keyboard and stays bounded in a short narrow RTL viewport', async () => {
  const page = await open();
  try {
    await page.setViewportSize({ width: 320, height: 360 });
    await page.evaluate(() => document.documentElement.dir = 'rtl');
    const control = page.locator('[data-slot="phone-input"]:has(#controlled)');
    const trigger = control.getByRole('button', { name: 'Phone number country: United States (+1)', exact: true });
    await trigger.focus(); await trigger.press('Enter');
    const search = page.getByRole('combobox', { name: 'Search countries', exact: true });
    await search.fill('France');
    const popup = page.locator('[data-slot="popover-content"]');
    await page.waitForFunction(() => {
      const popup = document.querySelector('[data-slot="popover-content"]');
      return popup && getComputedStyle(popup).opacity === '1'
        && !popup.getAnimations({ subtree: true }).some(animation => animation.playState === 'running');
    });
    const bounds = await popup.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(361);
    await search.press('ArrowDown'); await search.press('Enter');
    await page.waitForFunction(() => window.__phoneInput.countryChanges.includes('FR'));
    expect(await control.getByRole('button', { name: 'Phone number country: France (+33)', exact: true }).count()).toBe(1);
    expect(await page.getByLabel('Phone number', { exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
  } finally { await close(page); }
}, 30_000);
for (const dark of [false, true]) browserTest(`sizes and country popup use Zero semantic tokens in ${dark ? 'dark' : 'light'}`, async () => {
  const page = await open(dark);
  try {
    await page.evaluate(() => document.documentElement.style.setProperty('--popover', 'rgb(31, 47, 63)'));
    await page.locator('[data-slot="phone-input"]:has(input[aria-label="Small phone"])').getByRole('button').click();
    const popup = page.locator('[data-slot="popover-content"]');
    await popup.waitFor(); expect(await popup.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(31, 47, 63)');
    expect(await page.getByRole('option', { name: 'France', exact: false }).count()).toBe(1);
    expect(await page.getByLabel('Small phone', { exact: true }).evaluate(element => element.getBoundingClientRect().height))
      .toBeLessThan(await page.getByLabel('Large phone', { exact: true }).evaluate(element => element.getBoundingClientRect().height));
    await page.evaluate(() => document.documentElement.style.removeProperty('--popover'));
    await page.waitForFunction(() => {
      const popup = document.querySelector('[data-slot="popover-content"]');
      return popup && getComputedStyle(popup).opacity === '1'
        && !popup.getAnimations({ subtree: true }).some(animation => animation.playState === 'running');
    });
    expect(await popup.evaluate(popup => {
      const right = popup.getBoundingClientRect().right;
      return [...popup.querySelectorAll('[data-slot="phone-input-calling-code"]')]
        .every(code => code.getBoundingClientRect().right <= right);
    })).toBe(true);
    await page.screenshot({ path: `/Volumes/code-bank/artifacts/zero-platform/diagnostics/phone-input-${dark ? 'dark' : 'light'}.png` });
  } finally { await close(page); }
}, 30_000);
