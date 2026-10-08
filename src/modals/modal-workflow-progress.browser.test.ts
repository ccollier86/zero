/** Actual progress-component interaction over deferred synthetic SDK receipts. */
import { beforeAll, afterAll, test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { acquirePlaywrightTestBrowser, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';
import { OBS_CODES } from '../observability/codes';

let lease: PlaywrightTestBrowserLease | undefined, bundle = '';
beforeAll(async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/modal-workflow-browser-');
  try {
    const output = `${directory}/fixture.js`;
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', `${import.meta.dir}/modal-workflow-progress.browser-fixture.tsx`,
      '--target=browser', '--format=iife', '--outfile', output], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code) throw new Error(`Workflow fixture build failed: ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
interface FixtureControl {
  select(id: string): void; rename(name: string): void; close(): void; reopen(): void; enable(enabled: boolean): void;
  calls(): Array<{ action: string; id: string }>; resolve(index: number): void; reject(index: number): void; diagnostics(): string[];
}
declare global { interface Window { workflowFixture: FixtureControl } }
async function open() {
  const page = await lease!.browser.newPage({ reducedMotion: 'reduce' }); page.setDefaultTimeout(5000);
  await page.setContent('<!doctype html><div id="root"></div>'); await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor(); return page;
}

test('A -> B -> A isolates late receipts from the current pending action and suppresses old progress errors', async () => {
  const page = await open();
  try {
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await pause.click(); expect(await pause.isDisabled()).toBe(true);
    await page.evaluate(() => window.workflowFixture.select('B')); await pause.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button')!.disabled);
    await page.evaluate(() => window.workflowFixture.select('A'));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button')!.disabled);
    await pause.click(); expect(await pause.isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.workflowFixture.calls())).toEqual([{ action: 'pause', id: 'A' }, { action: 'pause', id: 'A' }]);
    await page.evaluate(() => window.workflowFixture.reject(0));
    await page.waitForTimeout(40);
    expect(await pause.isDisabled()).toBe(true); expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.evaluate(code => window.workflowFixture.diagnostics().includes(code), OBS_CODES.FRONTEND_WORKFLOW_PROGRESS_ACTION_FAILED.code)).toBe(false);
    await page.evaluate(() => window.workflowFixture.resolve(1));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button')!.disabled);
    expect(await pause.isDisabled()).toBe(false);
  } finally { await page.close(); }
}, 30_000);

test('closing and reopening observes without starting or cancelling; an old receipt cannot unlock the reopened action', async () => {
  const page = await open();
  try {
    expect(await page.evaluate(() => window.workflowFixture.calls())).toEqual([]);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.evaluate(() => window.workflowFixture.close());
    await page.locator('[data-slot="modal-workflow-progress"]').waitFor({ state: 'detached' });
    expect(await page.evaluate(() => window.workflowFixture.calls())).toEqual([{ action: 'pause', id: 'A' }]);
    await page.evaluate(() => window.workflowFixture.reopen());
    const pause = page.getByRole('button', { name: 'Pause', exact: true }); await pause.click();
    await page.evaluate(() => window.workflowFixture.resolve(0)); await page.waitForTimeout(40);
    expect(await pause.isDisabled()).toBe(true); expect(await page.getByRole('button', { name: 'Cancel run' }).isDisabled()).toBe(true);
    await page.evaluate(() => window.workflowFixture.resolve(1));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button')!.disabled);
    await page.evaluate(() => window.workflowFixture.enable(false));
    await pause.waitFor({ state: 'detached' }); expect(await page.getByRole('button', { name: 'Cancel run' }).count()).toBe(0);
    expect(await page.evaluate(() => window.workflowFixture.calls())).toEqual([{ action: 'pause', id: 'A' }, { action: 'pause', id: 'A' }]);
  } finally { await page.close(); }
}, 30_000);

test('workflow-name ownership changes hide and fence a previous action even with the same run ID', async () => {
  const page = await open();
  try {
    const pause = page.getByRole('button', { name: 'Pause', exact: true }); await pause.click();
    await page.evaluate(() => window.workflowFixture.rename('second-workflow'));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button')!.disabled);
    await pause.click(); await page.evaluate(() => window.workflowFixture.resolve(0)); await page.waitForTimeout(40);
    expect(await pause.isDisabled()).toBe(true);
    await page.evaluate(() => window.workflowFixture.resolve(1));
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button')!.disabled);
    expect(await page.getByRole('alert').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);
