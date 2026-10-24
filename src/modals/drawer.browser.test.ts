/** Styled real-browser contracts for contained/nonmodal and viewport/modal drawer ownership. */
import { beforeAll, afterAll, test, expect } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';

let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  const directory = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/drawer-browser-');
  try {
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', import.meta.dir + '/drawer.browser-fixture.tsx',
      '--target=browser', '--format=iife', '--outdir=' + directory, '--entry-naming=fixture.[ext]'], { stdout: 'pipe', stderr: 'pipe', timeout: 40000 });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code) throw new Error('Drawer fixture build failed: ' + stdout + stderr);
    bundle = await Bun.file(directory + '/fixture.js').text();
    css = await Bun.file((await buildPlatformStyles(directory, directory + '/absent-app')).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60000);
afterAll(() => lease?.release());

async function pageAt(width = 1100) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 780 }, reducedMotion: 'reduce' });
  await page.setContent('<div id="root"></div>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('heading', { name: 'Workflow drawer fixture' }).waitFor();
  return page;
}
async function settled(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Node inspector', exact: true }); await dialog.waitFor();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(a => a.finished.catch(() => {}))); });
  return dialog;
}

test('contained inspector reserves width, keeps canvas usable and shares owned picker/decision focus', async () => {
  const page = await pageAt();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
    const dialog = await settled(page), frame = (await dialog.boundingBox())!;
    const workspace = (await page.locator('[data-slot="drawer-workspace"]').boundingBox())!;
    expect(Math.round(frame.x + frame.width)).toBe(Math.round(workspace.x + workspace.width));
    expect(Math.round(frame.y)).toBe(Math.round(workspace.y)); expect(Math.round(frame.width)).toBe(340);
    expect(await page.locator('[data-slot="drawer-workspace-content"]').evaluate(el => getComputedStyle(el).paddingRight)).toBe('340px');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await page.getByRole('button', { name: 'Canvas action', exact: true }).click();
    expect(await page.getByTestId('canvas-count').textContent()).toContain('1');
    await dialog.getByRole('button', { name: 'Inspector options' }).click();
    await page.getByText('Owned picker content').waitFor(); await page.keyboard.press('Escape');
    expect(await dialog.isVisible()).toBe(true);
    await dialog.getByRole('button', { name: 'Open decision' }).click();
    const child = page.getByRole('dialog', { name: 'Nested decision', exact: true }); await child.waitFor();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await child.getByRole('button', { name: 'Done', exact: true }).click(); await child.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.body.style.overflow === '');
    expect(await dialog.isVisible()).toBe(true);
    const body = dialog.locator('.zero-modal__body');
    expect(await dialog.locator('[data-zero-scroll-treatment="arc"]').count()).toBe(1);
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const footer = (await dialog.locator('.zero-modal__foot').boundingBox())!;
    await body.evaluate(element => { element.scrollTop = 200; });
    expect(await body.evaluate(element => element.scrollTop)).toBe(200);
    expect((await dialog.locator('.zero-modal__foot').boundingBox())!.y).toBe(footer.y);
    await mkdir('/Volumes/code-bank/artifacts/zero-platform/diagnostics/workflow-contracts/screenshots', { recursive: true });
    await page.screenshot({ path: '/Volumes/code-bank/artifacts/zero-platform/diagnostics/workflow-contracts/screenshots/desktop-inspector.png' });
    expect(errors).toEqual([]);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.textContent === 'Inspect node');
  } finally { await page.close(); }
}, 30000);

test('narrow opening is a bounded modal bottom sheet and closing restores page scrolling', async () => {
  const page = await pageAt(390);
  try {
    await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
    const dialog = await settled(page), frame = (await dialog.boundingBox())!;
    expect(frame.x).toBeGreaterThanOrEqual(0); expect(frame.x + frame.width).toBeLessThanOrEqual(390.5);
    expect(frame.y).toBeGreaterThanOrEqual(0); expect(frame.y + frame.height).toBeLessThanOrEqual(780.5);
    expect(await dialog.locator('..').getAttribute('data-placement')).toBe('bottom');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.screenshot({ path: '/Volumes/code-bank/artifacts/zero-platform/diagnostics/workflow-contracts/screenshots/mobile-sheet.png' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.body.style.overflow === '');
  } finally { await page.close(); }
}, 30000);

test('resize preserves the admitted editor and workspace unmount retires its owned descendants', async () => {
  const page = await pageAt();
  try {
    await page.getByRole('button', { name: 'Inspect node', exact: true }).click();
    const dialog = await settled(page);
    await dialog.getByRole('textbox', { name: 'Node name' }).fill('Unsaved draft survives resize');
    await page.setViewportSize({ width: 600, height: 780 });
    expect(await dialog.getByRole('textbox', { name: 'Node name' }).inputValue()).toBe('Unsaved draft survives resize');
    expect(await page.locator('[data-slot="drawer-workspace-content"]').evaluate(el => getComputedStyle(el).paddingRight)).toBe('340px');
    await page.getByRole('button', { name: 'Toggle workspace', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    expect(await page.locator('.zero-modal-layer').count()).toBe(0);
  } finally { await page.close(); }
}, 30000);

test('a node replacement awaits its nested decision and Keep editing preserves the original draft', async () => {
  const page = await pageAt();
  try {
    await page.getByRole('button', { name: 'Guarded inspector', exact: true }).click();
    const dialog = await settled(page);
    await dialog.getByRole('textbox', { name: 'Node name' }).fill('Unsaved node input');
    await dialog.getByRole('button', { name: 'Replace node', exact: true }).click();
    const decision = page.getByRole('alertdialog', { name: 'Replace inspector?', exact: true }); await decision.waitFor();
    await decision.getByRole('button', { name: 'Keep editing', exact: true }).click(); await decision.waitFor({ state: 'detached' });
    expect(await dialog.getByRole('textbox', { name: 'Node name' }).inputValue()).toBe('Unsaved node input');
    await dialog.getByRole('button', { name: 'Replace node', exact: true }).click(); await decision.waitFor();
    await decision.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.getByRole('dialog', { name: 'Replacement inspector', exact: true }).waitFor();
    expect(await dialog.count()).toBe(0);
  } finally { await page.close(); }
}, 30000);
