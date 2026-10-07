/** Actual packaged workspace interactions against a synthetic controller and production styles. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease, directory: string, script: string, css: string;
let builderRunning = false;
const evidence = '/Volumes/code-bank/tmp/scratch/zero-platform/data-studio-ui-evidence';
beforeAll(async () => {
  const deadline = performance.now() + 60_000;
  if (!playwrightTestBrowserAvailable) return;
  lease = await acquirePlaywrightTestBrowser();
  await mkdir(evidence, { recursive: true });
  directory = await mkdtemp(join(evidence, 'build-'));
  const builder = join(directory, 'build.ts');
  await Bun.write(builder, `const result = await Bun.build({
    entrypoints: [${JSON.stringify(join(import.meta.dir, 'data-studio-workspace.browser-fixture.tsx'))}],
    outdir: ${JSON.stringify(directory)}, naming: 'bundle.js', target: 'browser', format: 'iife',
  });
  if (!result.success) { await Bun.write(Bun.stderr, result.logs.map(log => log.message).join('\\n')); process.exit(1); }`);
  await runWorkspaceBuilder(builder, deadline);
  script = await Bun.file(join(directory, 'bundle.js')).text();
  css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'missing-app'))).cssPath).text();
}, 60_000);
afterAll(async () => { try { if (directory && !builderRunning) await rm(directory, { recursive: true, force: true }); } finally { lease?.release(); } });

/** One owned build, including pipe cancellation/reap, fits the existing setup budget. */
async function runWorkspaceBuilder(builder: string, deadline: number): Promise<void> {
  const remaining = Math.floor(deadline - performance.now()) - 1_500;
  if (remaining <= 0) throw new Error('Workspace fixture setup has no remaining build budget.');
  const child = Bun.spawn({ cmd: [process.execPath, '--no-env-file', builder], cwd: process.cwd(),
    stdout: 'pipe', stderr: 'pipe', timeout: remaining, killSignal: 'SIGKILL' });
  builderRunning = true;
  void child.exited.then(() => { builderRunning = false; });
  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  const output = readers.map(async reader => {
    const decoder = new TextDecoder(); let text = '';
    while (true) {
      const item = await reader.read();
      if (item.done) return text + decoder.decode();
      text += decoder.decode(item.value, { stream: true });
    }
  });
  let failed = false, failure: unknown;
  try {
    const [stdout, stderr, status] = await withinFixtureBudget(
      Promise.all([output[0]!, output[1]!, child.exited]), deadline - 500,
    );
    if (status !== 0) throw new Error(`Workspace fixture build exited with ${status}.\n${stdout}\n${stderr}`);
  } catch (error) { failed = true; failure = error; throw error; }
  finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    try {
      const errors: unknown[] = [];
      try {
        const settled = await withinFixtureBudget(Promise.allSettled([
          child.exited, ...readers.map(reader => Promise.resolve().then(() => reader.cancel())), ...output,
        ]), deadline);
        for (const result of settled) if (result.status === 'rejected') errors.push(result.reason);
      } catch (error) { errors.push(error); }
      for (const reader of readers) try { reader.releaseLock(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Owned workspace fixture cleanup failed.');
    } catch (error) {
      if (failed) throw new AggregateError([failure, error], 'Workspace fixture build failed and owned cleanup did not finish.');
      throw error;
    }
  }
}

async function withinFixtureBudget<T>(operation: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Workspace fixture setup exceeded its remaining budget.')),
        Math.max(0, deadline - performance.now()));
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function open(width = 1280, dark = false, controlledFrames = false): Promise<Page> {
  const page = await lease.browser.newPage({ viewport: { width, height: 800 } });
  await page.setContent(`<!doctype html><html${dark ? ' class="dark"' : ''}><head></head><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css });
  if (controlledFrames) await page.evaluate(() => {
    // Motion captures this scheduler at bundle load.
    const requestFrame = window.requestAnimationFrame.bind(window);
    const cancelFrame = window.cancelAnimationFrame.bind(window);
    let held = false;
    const frames = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      const id = requestFrame((timestamp) => {
        if (held) frames.set(id, callback);
        else callback(timestamp);
      });
      return id;
    };
    window.cancelAnimationFrame = (id) => { frames.delete(id); cancelFrame(id); };
    window.__studioWorkspaceFrames = {
      hold() { held = true; },
      pending() { return frames.size; },
      release() {
        held = false;
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) requestFrame(callback);
      },
    };
  });
  await page.addScriptTag({ content: script });
  await page.locator('[data-slot="data-studio-grid"]').waitFor(); return page;
}

browserTest('schema-first workspace fills the width, keeps zero-row headers, and exposes operations without page controls', async () => {
  const page = await open();
  try {
    expect(await page.getByRole('button', { name: 'Show details', exact: true }).getAttribute('aria-expanded')).toBe('false');
    expect(await page.getByRole('button', { name: /next page|previous page/i }).count()).toBe(0);
    await page.evaluate(() => window.__studioWorkspace.empty());
    await page.getByText('No matching records').waitFor();
    expect(await page.getByRole('button', { name: 'Edit Name column', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Add record', exact: true }).isEnabled()).toBe(true);
    await page.getByRole('button', { name: 'Add column', exact: true }).first().click();
    await page.getByRole('dialog').waitFor();
    expect(await page.getByRole('tab', { name: 'Visual', exact: true }).getAttribute('data-state')).toBe('active');
    expect(await page.getByRole('textbox', { name: 'Column name', exact: true }).inputValue()).toBe('Field 15');
    await page.waitForFunction(() => {
      const content = document.querySelector('[role="dialog"]');
      return content && Number(getComputedStyle(content).opacity) >= .999
        && ['none', 'blur(0px)'].includes(getComputedStyle(content).filter);
    });
    await page.screenshot({ path: join(evidence, 'schema-dialog-light.png') });
  } finally { await page.close(); }
}, 60_000);

browserTest('optional inspector has compact table metadata, full record values and independent bounded scrolling', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Show details', exact: true }).click();
    await page.getByRole('tab', { name: 'Table', exact: true }).waitFor();
    expect(await page.locator('[aria-label="Table columns"]').count()).toBe(0);
    await page.locator('[data-row-id="row-0"] td').first().click();
    await page.waitForFunction(() => document.querySelector('[data-slot="data-studio-inspector"] [data-state="active"]')?.textContent?.includes('Record'));
    expect(await page.getByRole('tab', { name: 'Record', exact: true }).getAttribute('aria-selected')).toBe('true');
    await page.getByRole('tab', { name: 'Record', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Table'));
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Record'));
    const inspector = page.locator('[data-slot="data-studio-inspector"]');
    expect(await inspector.getByText('one note 0:', { exact: false }).count()).toBe(1);
    const viewport = inspector.locator('[data-radix-scroll-area-viewport]').first();
    expect(await viewport.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await viewport.evaluate(element => { element.scrollTop = 500; });
    expect(await page.locator('[data-slot="data-studio-grid"]').evaluate(element => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    const action = page.getByRole('button', { name: 'Add record', exact: true });
    expect((await action.boundingBox())!.y).toBeLessThan(800);
    await page.waitForFunction(() => {
      const pane = document.querySelector('[data-slot="list-detail-detail-scroll"]');
      const tab = document.querySelector('[data-slot="tabs-content"][data-state="active"]');
      return pane && tab && Number(getComputedStyle(pane).opacity) >= .999 && Number(getComputedStyle(tab).opacity) >= .999;
    });
    await page.screenshot({ path: join(evidence, 'workspace-inspector-light.png') });
    await page.getByRole('button', { name: 'Hide details', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-slot="list-detail-detail"]')?.clientWidth === 0);
  } finally { await page.close(); }
}, 60_000);

browserTest('record and lifecycle confirmations preserve opening revisions and retire on organization replacement', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__studioWorkspace.select('row-0'));
    await page.getByRole('button', { name: 'Delete record', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => { window.__studioWorkspace.select('row-1'); window.__studioWorkspace.revision(); });
    await page.getByRole('dialog').getByRole('button', { name: 'Delete record', exact: true }).click();
    await page.waitForFunction(() => window.__studioWorkspace.operations().some(operation => operation.type === 'row.delete'));
    const deletion = (await page.evaluate(() => window.__studioWorkspace.operations())).find(operation => operation.type === 'row.delete')!;
    expect(deletion.row?.rowId).toBe('row-0'); expect(deletion.row?.revision).toBe(1);
    await page.getByRole('button', { name: 'Archive table', exact: true }).first().click();
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => window.__studioWorkspace.revision());
    await page.getByRole('dialog').getByRole('button', { name: 'Archive table', exact: true }).click();
    await page.waitForFunction(() => window.__studioWorkspace.operations().some(operation => operation.type === 'table.status'));
    expect((await page.evaluate(() => window.__studioWorkspace.operations())).find(operation => operation.type === 'table.status')!.revision).toBe(4);
    await page.getByRole('button', { name: 'Restore table', exact: true }).first().click();
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => window.__studioWorkspace.scope('two'));
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    expect(await page.getByText('one Person 1', { exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 60_000);

browserTest('read-only and refresh boundaries disable writes while narrow mobile inspection offers a clear return', async () => {
  const page = await open(390, true);
  try {
    await page.evaluate(() => window.__studioWorkspace.permissions(false, false));
    expect(await page.getByRole('button', { name: 'Add record', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'New table', exact: true }).count()).toBe(0);
    await page.locator('[data-row-id="row-0"] td').first().click();
    await page.getByRole('button', { name: 'Back to records', exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Back to records', exact: true }).click();
    await page.locator('[data-slot="data-studio-grid"]').waitFor({ state: 'visible' });
    await page.evaluate(() => { window.__studioWorkspace.permissions(true, true); window.__studioWorkspace.refresh(true); });
    await page.getByRole('button', { name: 'Add record', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Add record', exact: true }).isDisabled()).toBe(true);
    await page.screenshot({ path: join(evidence, 'workspace-mobile-dark.png') });
  } finally { await page.close(); }
}, 60_000);

browserTest('query replacement preserves column widths but retires edits and the grid never widens the page', async () => {
  const page = await open(1080, true);
  try {
    const resize = page.getByRole('separator', { name: 'Resize Name', exact: true });
    await resize.focus(); await resize.press('ArrowRight');
    const width = await resize.getAttribute('aria-valuenow');
    await page.locator('[data-row-id="row-0"]').getByRole('button', { name: 'Edit Name, current value one Person 0', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit Name', exact: true }).fill('Unsaved cell');
    await page.getByRole('searchbox', { name: 'Search records', exact: true }).fill('Find another');
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Edit Name"]'));
    expect(await resize.getAttribute('aria-valuenow')).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: join(evidence, 'workspace-grid-dark.png') });
  } finally { await page.close(); }
}, 60_000);

browserTest('mobile inline editing stays in the grid; explicit inspection opens the details transition', async () => {
  const page = await open(390);
  try {
    await page.locator('[data-row-id="row-0"]').getByRole('button', { name: 'Edit Name, current value one Person 0', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Edit Name', exact: true });
    await input.waitFor({ state: 'visible' });
    expect(await page.getByRole('button', { name: 'Back to records', exact: true }).count()).toBe(0);
    await input.fill('Mobile update'); await input.press('Enter');
    await page.getByRole('button', { name: 'Edit Name, current value Mobile update', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Inspect record', exact: true }).click();
    await page.getByRole('button', { name: 'Back to records', exact: true }).waitFor({ state: 'visible' });
    // The return control is outside the crossfade: wait for the actual record pane.
    await page.waitForFunction(() => (
      document.querySelector('[data-slot="data-studio-inspector"] [role="tab"][aria-selected="true"]')
        ?.textContent?.includes('Record')
    ));
    expect(await page.getByRole('tab', { name: 'Record', exact: true }).getAttribute('aria-selected')).toBe('true');
    await page.getByRole('button', { name: 'Back to records', exact: true }).click();
    await page.locator('[data-slot="data-studio-grid"]').waitFor({ state: 'visible' });
  } finally { await page.close(); }
}, 60_000);

browserTest('mobile return visibility precedes the selected-record pane while a detail exit is held', async () => {
  const page = await open(390, false, true);
  try {
    await page.evaluate(() => window.__studioWorkspaceFrames.hold());
    await page.locator('[data-row-id="row-0"]').getByRole('button', {
      name: 'Edit Name, current value one Person 0', exact: true,
    }).evaluate((button) => (button as HTMLButtonElement).click());
    const input = page.getByRole('textbox', { name: 'Edit Name', exact: true });
    await input.fill('Deferred mobile update');
    await input.press('Enter');
    // Timer polling remains active while the test holds the real frame driver.
    await page.waitForFunction(() => (
      !!document.querySelector('button[aria-label="Edit Name, current value Deferred mobile update"]')
      && window.__studioWorkspaceFrames.pending() > 0
    ), undefined, { polling: 10 });
    expect(await page.getByRole('button', { name: 'Back to records', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Inspect record', exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await page.waitForFunction(() => {
      const back = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.trim() === 'Back to records');
      return !!back && back.getBoundingClientRect().height > 0;
    }, undefined, { polling: 10 });
    expect(await page.getByRole('button', { name: 'Back to records', exact: true }).isVisible()).toBe(true);
    // The outgoing table-only inspector still has its disabled Record tab.
    expect(await page.getByRole('tab', { name: 'Record', exact: true }).getAttribute('aria-selected')).toBe('false');
    expect(await page.getByRole('tab', { name: 'Record', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('tab', { name: 'Table', exact: true }).getAttribute('aria-selected')).toBe('true');
    await page.evaluate(() => window.__studioWorkspaceFrames.release());
    await page.waitForFunction(() => (
      document.querySelector('[data-slot="data-studio-inspector"] [role="tab"][aria-selected="true"]')
        ?.textContent?.includes('Record')
    ));
    expect(await page.getByRole('tab', { name: 'Record', exact: true }).getAttribute('aria-selected')).toBe('true');
    expect(await page.getByRole('tab', { name: 'Record', exact: true }).isEnabled()).toBe(true);
    expect(await page.locator('[data-slot="data-studio-inspector"]')
      .getByText('Deferred mobile update', { exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'Back to records', exact: true }).click();
    await page.locator('[data-slot="data-studio-grid"]').waitFor({ state: 'visible' });
  } finally { await page.close(); }
}, 60_000);

declare global {
  interface Window {
    __studioWorkspaceFrames: { hold(): void; pending(): number; release(): void };
  }
}
