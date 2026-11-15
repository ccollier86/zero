/** Native UI + real JobsClient parser/stream checks against synthetic transport. Not a managed runtime/deployment qualification. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let child: ReturnType<typeof Bun.spawn> | undefined, lease: PlaywrightTestBrowserLease | undefined, origin = '';
let diagnostic = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  child = Bun.spawn([process.execPath, '--no-env-file', join(import.meta.dir, '../../../scripts/preview-jobs-workspace.ts')], {
    env: { TMPDIR: tmpdir(), PATH: process.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  });
  void (async () => { for await (const chunk of child!.stderr as ReadableStream<Uint8Array>) diagnostic = (diagnostic + new TextDecoder().decode(chunk)).slice(-4000); })();
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const timeout = setTimeout(() => child?.kill('SIGTERM'), 60_000);
  try {
    let output = '';
    for (;;) {
      const part = await reader.read();
      if (part.done) throw new Error('Synthetic jobs preview stopped before readiness: ' + diagnostic);
      output += new TextDecoder().decode(part.value);
      if (output.length > 4000) throw new Error('Synthetic jobs preview readiness exceeded its bound.');
      const line = output.split('\n').find(line => line.startsWith('{'));
      if (!line || !output.endsWith('\n')) continue;
      const value = JSON.parse(line);
      if (value.purpose !== 'synthetic-jobs-ui-only' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.url)) throw new Error('Invalid synthetic jobs preview readiness.');
      origin = value.url; break;
    }
    lease = await acquirePlaywrightTestBrowser();
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}, 65_000);
afterAll(async () => {
  try { await lease?.releaseAndWait(); }
  finally {
    if (child) {
      child.kill('SIGTERM');
      const force = setTimeout(() => child?.kill('SIGKILL'), 10_000);
      try { expect(await child.exited).toBe(0); }
      finally { clearTimeout(force); }
    }
  }
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) browserTest(`native jobs controls, receipts, paging and denied content (${reducedMotion})`, async () => {
  const page = await lease!.browser.newPage({ reducedMotion, viewport: { width: 1440, height: 1000 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(7000);
  try {
    await page.goto(origin);
    await page.getByText('Daily reports', { exact: true }).waitFor();
    expect(await page.getByRole('combobox', { name: 'Rows per page', exact: true }).textContent()).toBe('20');
    await page.waitForFunction(() => document.querySelectorAll('[data-row-id]').length === 20);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-row-id]').length === 7);
    await page.getByRole('button', { name: 'First page', exact: true }).click();
    await page.getByText('Daily reports', { exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-row-id]').length === 7);
    await page.getByRole('button', { name: 'Change hidden selected job', exact: true }).click();
    await page.getByText('2 / 1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'First page', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const pause = page.getByRole('alertdialog', { name: 'Pause job?', exact: true });
    await pause.getByRole('button', { name: 'Pause job', exact: true }).click();
    await pause.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Toggle uncertain acceptance', exact: true }).click();
    await page.getByRole('button', { name: 'Run now', exact: true }).click();
    const run = page.getByRole('alertdialog', { name: 'Run separately now?', exact: true });
    await run.getByRole('button', { name: 'Run separately now', exact: true }).click();
    await run.getByRole('button', { name: 'Check outcome', exact: true }).waitFor();
    expect(await run.getByRole('button', { name: 'Keep unchanged', exact: true }).isDisabled()).toBe(true);
    await page.keyboard.press('Escape'); expect(await run.count()).toBe(1);
    await run.getByRole('button', { name: 'Check outcome', exact: true }).click();
    await run.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Toggle denied reads', exact: true }).click();
    await page.getByRole('button', { name: 'Retry authorized read', exact: true }).waitFor();
    // No denied content or actions may survive even as exit animation.
    expect(await page.locator('[data-row-id]').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Resume', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Create job', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByText('Synthetic application editor requested.', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('status', { name: 'Synthetic write count', exact: true }).textContent()).toContain('Writes: 2');
    await page.getByRole('button', { name: 'Toggle denied reads', exact: true }).click();
    await page.getByRole('button', { name: 'Retry authorized read', exact: true }).click();
    await page.getByRole('heading', { name: 'Daily reports', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Replace synthetic scope', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-row-id]').length === 3);
    expect(await page.getByText('north-job-0', { exact: true }).count()).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText('Daily reports', { exact: true }).click();
    await page.getByRole('button', { name: 'Back to list', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);
