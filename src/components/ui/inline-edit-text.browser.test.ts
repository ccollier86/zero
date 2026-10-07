/** Actual editor input lifecycle with synthetic deferred operations only. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import {
  acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

interface Fixture {
  snapshot(): { commits: string[]; navigated: number; reloaded: number };
  resolve(): void; reject(): void; failNavigation(): void; disable(): void; unmount(): void;
  explicit(): void; replaceValue(): void; replaceScope(): void;
  saveContext(): { revision: string | number | undefined; aborted: boolean | undefined };
}
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, bundle = '', stylesheet = '';
let lease: PlaywrightTestBrowserLease | undefined;
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
  const script = `const result = await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/inline-edit-text.browser-fixture.tsx`)}],target:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('test')}});if(!result.success){for(const log of result.logs)await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', script], cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' });
  const [output, diagnostics, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (code !== 0) throw new Error(diagnostics || 'Isolated inline-edit fixture build failed.');
  bundle = output;
  const styleRoot = '/Volumes/code-bank/tmp/scratch/zero-platform/inline-edit-text-browser';
  stylesheet = await Bun.file((await buildPlatformStyles(styleRoot, `${styleRoot}/absent-app`)).cssPath).text();
}, 60_000);
afterAll(() => lease?.release());
async function open(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: bundle });
  const trigger = page.getByRole('button', { name: 'Edit Name, current value Original', exact: true });
  await trigger.waitFor(); await trigger.click();
  await page.getByRole('textbox', { name: 'Edit Name', exact: true }).fill('Changed');
  return page;
}
async function settleFrame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
browserTest('pending legacy indicator stays visible without spinning under reduced motion', async () => {
  const page = await open();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('textbox', { name: 'Edit Name', exact: true }).press('Enter');
    const indicator = page.getByRole('status'); await indicator.waitFor();
    expect(await indicator.isVisible()).toBe(true);
    expect(await indicator.locator('svg').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await indicator.locator('svg').evaluate(element => getComputedStyle(element).animationName)).toBe('spin');
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.resolve());
  } finally { await page.close(); }
}, 30_000);
browserTest('same-tick commit events admit one external operation', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Edit Name', exact: true }).evaluate(element => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot().commits))
      .toEqual(['Changed']);
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.resolve());
  } finally { await page.close(); }
}, 30_000);

browserTest('a disabled editor cannot admit a queued blur save', async () => {
  const page = await open();
  try {
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.disable());
    await page.locator('input:disabled').waitFor();
    await page.getByRole('textbox', { name: 'Edit Name', exact: true }).evaluate(element => {
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot().commits))
      .toEqual([]);
  } finally { await page.close(); }
}, 30_000);

for (const outcome of ['resolve', 'reject'] as const) {
  browserTest(`late ${outcome} after unmount cannot navigate or reload another editor`, async () => {
    const page = await open();
    try {
      await page.getByRole('textbox', { name: 'Edit Name', exact: true }).press('Tab');
      await page.getByRole('status').waitFor();
      await page.evaluate(kind => {
        const api = (window as unknown as { inlineTextTest: Fixture }).inlineTextTest;
        api.unmount(); api[kind]();
      }, outcome);
      await settleFrame(page);
      const observed = await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot());
      expect(observed.navigated).toBe(0);
      expect(observed.reloaded).toBe(0);
      expect(await page.locator('#root').innerHTML()).toBe('');
    } finally { await page.close(); }
  }, 30_000);
}

browserTest('a failed post-acceptance navigation notification does not become a failed edit', async () => {
  const page = await open(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.failNavigation());
    await page.getByRole('textbox', { name: 'Edit Name', exact: true }).press('Tab');
    await page.getByRole('status').waitFor();
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.resolve());
    await settleFrame(page);
    expect(await page.locator('[data-save-state="saved"]').count()).toBe(1);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

browserTest('explicit Cancel never saves on pointer blur, and Tab only moves focus', async () => {
  const page = await open();
  try {
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.explicit());
    const input = page.getByRole('textbox', { name: 'Edit Name', exact: true });
    await page.getByRole('button', { name: 'Save Name', exact: true }).waitFor();
    await input.press('Tab');
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot().commits)).toEqual([]);
    await page.getByRole('button', { name: 'Cancel Name', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Name, current value Original', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot().commits)).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

browserTest('explicit save carries captured revision, single-flights, and preserves failed/conflicted draft', async () => {
  const page = await open();
  try {
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.explicit());
    await page.getByRole('button', { name: 'Save Name', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.saveContext().revision)).toBe(1);
    await page.getByRole('button', { name: 'Save Name', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot().commits)).toEqual(['Changed']);
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.reject());
    const input = page.getByRole('textbox', { name: 'Edit Name', exact: true });
    await page.getByRole('alert').waitFor(); expect(await input.inputValue()).toBe('Changed');
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.replaceValue());
    await page.getByRole('button', { name: 'Reload Name', exact: true }).waitFor();
    expect(await input.inputValue()).toBe('Changed');
    await page.getByRole('button', { name: 'Reload Name', exact: true }).click();
    expect(await input.inputValue()).toBe('Latest');
  } finally { await page.close(); }
}, 30_000);

browserTest('explicit IME Enter does not dispatch, and target retirement aborts a pending save', async () => {
  const page = await open();
  try {
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.explicit());
    const input = page.getByRole('textbox', { name: 'Edit Name', exact: true });
    await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', isComposing:true, bubbles:true})));
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.snapshot().commits)).toEqual([]);
    await input.press('Enter');
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.replaceScope());
    await page.getByRole('button', { name: 'Edit Name, current value Original', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.saveContext().aborted)).toBe(true);
    await page.evaluate(() => (window as unknown as { inlineTextTest: Fixture }).inlineTextTest.resolve());
    await settleFrame(page); expect(await page.getByRole('alert').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);
