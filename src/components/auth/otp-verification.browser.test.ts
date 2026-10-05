/** Admission and cleanup for the public asynchronous OTP primitive. */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let bundle = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/otp-verification.browser-fixture.tsx`],
    target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') },
  });
  if (!build.success) throw new Error(build.logs.map((log) => log.message).join('\n'));
  bundle = await build.outputs[0]!.text();
}, 60_000);
afterAll(() => lease?.release());

async function open(): Promise<Page> {
  const page = await browser!.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Resend code', exact: true }).waitFor();
  return page;
}

browserTest('a pending resend admits one callback and cooldown starts after acceptance', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Resend code', exact: true }).evaluate(element => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(await page.evaluate(() => (window as any).otpTest.snapshot().resent)).toBe(1);
    expect(await page.getByRole('button', { name: 'Resending code', exact: true }).isDisabled()).toBe(true);
    expect(await page.locator('input').isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).otpTest.resolve());
    await page.getByText('Resend code in', { exact: false }).waitFor();
    expect(await page.locator('input').isDisabled()).toBe(false);
  } finally { await page.close(); }
}, 30_000);

browserTest('pending verification blocks another completed code; rejection permits retry', async () => {
  const page = await open();
  try {
    const input = page.locator('input');
    await input.fill('123456');
    await page.getByRole('status').waitFor();
    if (!(await input.isDisabled())) {
      await input.fill('');
      await input.fill('654321');
    }
    expect(await page.evaluate(() => (window as any).otpTest.snapshot().verified.length)).toBe(1);
    expect(await input.isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Resend code', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).otpTest.reject());
    await page.getByRole('alert').waitFor();
    expect(await input.inputValue()).toBe('');
    await input.fill('111111');
    expect(await page.evaluate(() => (window as any).otpTest.snapshot().verified.length)).toBe(2);
    await page.evaluate(() => (window as any).otpTest.resolve());
    await page.waitForFunction(() => !document.querySelector('[role="status"]'));
  } finally { await page.close(); }
}, 30_000);

browserTest('late rejection after unmount is observed without recreating OTP UI', async () => {
  const page = await open();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.locator('input').fill('123456');
    await page.getByRole('status').waitFor();
    await page.evaluate(() => {
      (window as any).otpTest.unmount();
      (window as any).otpTest.reject();
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
    expect(await page.locator('#root').innerHTML()).toBe('');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
