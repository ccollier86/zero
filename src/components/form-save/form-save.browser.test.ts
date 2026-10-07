/** Styled Save/Discard/Stay and accepted-baseline browser receipts; uses isolated synthetic form only. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import type { Browser, Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let browser: Browser, lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const failures = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform/form-save-browser';
  const styles = await buildPlatformStyles(root, `${root}/absent-app`); css = await Bun.file(styles.cssPath).text();
  const script = `const result=await Bun.build({entrypoints:[${JSON.stringify(`${import.meta.dir}/form-save.browser-fixture.tsx`)}],target:'browser',format:'iife',define:{'process.env.NODE_ENV':JSON.stringify('test')}});if(!result.success){for(const log of result.logs)await Bun.write(Bun.stderr,log.message+'\\n');process.exit(1);}await Bun.write(Bun.stdout,await result.outputs[0].text());`;
  const build = Bun.spawn({ cmd: [process.execPath, '--no-env-file', '-e', script], cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' });
  const [output, diagnostics, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  if (code !== 0) throw new Error(diagnostics || 'Isolated form-save build failed.');
  bundle = output; lease = await acquirePlaywrightTestBrowser(); browser = lease.browser;
}, 60_000);
afterAll(() => lease?.release());
async function open(dark = false) {
  const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
  const errors: string[] = []; failures.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  await page.route('http://form-save.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('http://form-save.test/settings'); await page.addStyleTag({ content: css });
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
  await page.addScriptTag({ content: bundle }); await page.getByRole('textbox', { name: 'Display name', exact: true }).waitFor(); return page;
}
async function close(page: Page) { expect(failures.get(page)).toEqual([]); await page.close(); }

browserTest('floating save keeps newer edits, adopts canonical accepted baseline, and Discard uses it', async () => {
  const page = await open();
  try {
    expect(await page.locator('[data-slot="form-save-bar"]').count()).toBe(0);
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Submitted');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.__formSave.calls.length === 1);
    expect(await page.evaluate(() => window.__formSave.calls[0]!.expectedRevision)).toBe(1);
    await page.getByRole('textbox', { name: 'Biography', exact: true }).fill('Newer biography');
    await page.evaluate(() => window.__formSave.resolve(0, 'Canonical'));
    await page.waitForFunction(() => document.querySelector('[data-slot="form-state"]')?.textContent === 'Dirty · revision 2');
    expect(await page.getByRole('textbox', { name: 'Display name', exact: true }).inputValue()).toBe('Canonical');
    expect(await page.getByRole('textbox', { name: 'Biography', exact: true }).inputValue()).toBe('Newer biography');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Biography', exact: true }).inputValue()).toBe('Saved biography');
    expect(await page.getByRole('textbox', { name: 'Display name', exact: true }).inputValue()).toBe('Canonical');
    expect(await page.locator('[data-slot="form-save-bar"]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('actual router push/replace waits for Stay or accepted Save-and-leave without losing its guard', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    await page.evaluate(() => window.__formSave.push('/next'));
    const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
    expect(new URL(page.url()).pathname).toBe('/settings');
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
    await page.evaluate(() => window.__formSave.replace('/next'));
    await dialog.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.waitForFunction(() => window.__formSave.calls.length === 1); await page.evaluate(() => window.__formSave.resolve(0));
    await page.waitForFunction(() => window.location.pathname === '/next');
    expect(await page.locator('[data-slot="router-path"]').textContent()).toBe('/next');
  } finally { await close(page); }
}, 30_000);

browserTest('real browser Back/Forward rolls back before prompt and replays only after admission', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__formSave.push('/previous')); await page.waitForFunction(() => window.location.pathname === '/previous');
    await page.evaluate(() => window.__formSave.push('/settings')); await page.waitForFunction(() => window.location.pathname === '/settings');
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    await page.goBack(); const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
    expect(new URL(page.url()).pathname).toBe('/settings');
    expect(await page.locator('[data-slot="router-path"]').textContent()).toBe('/settings');
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
    await dialog.waitFor({state:'hidden'});
    await page.goBack(); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.waitForFunction(() => window.location.pathname === '/previous');
    expect(await page.locator('[data-slot="router-path"]').textContent()).toBe('/previous');
    await page.goForward(); await page.waitForFunction(() => window.location.pathname === '/settings');
    expect(await page.locator('[data-slot="router-path"]').textContent()).toBe('/settings');
  } finally { await close(page); }
}, 30_000);

browserTest('rapid duplicate navigation cannot replace the destination of an already-open decision', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    await page.evaluate(() => { window.__formSave.push('/first'); window.__formSave.push('/second'); });
    const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.waitForFunction(() => window.location.pathname === '/first', undefined, { timeout: 2000 });
    expect(await page.locator('[data-slot="router-path"]').textContent()).toBe('/first');
  } finally { await close(page); }
}, 30_000);

browserTest('authoritative bypass wins over a pending user decision and stale completion cannot redirect', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    await page.evaluate(() => window.__formSave.push('/old-target'));
    const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
    await page.evaluate(() => window.__formSave.push('/signed-out', true));
    await page.waitForFunction(() => window.location.pathname === '/signed-out');
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    expect(new URL(page.url()).pathname).toBe('/signed-out');
  } finally { await close(page); }
}, 30_000);

browserTest('rapid native Back traversals restore the mounted history entry before deciding', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__formSave.push('/previous')); await page.waitForFunction(() => window.location.pathname === '/previous');
    await page.evaluate(() => window.__formSave.push('/settings')); await page.waitForFunction(() => window.location.pathname === '/settings');
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    await page.evaluate(() => { window.history.back(); window.history.back(); });
    const dialog = page.getByRole('alertdialog'); await dialog.waitFor({ timeout: 2500 });
    expect(new URL(page.url()).pathname).toBe('/settings');
    expect(await page.evaluate(() => window.history.state.__zero_router_index)).toBe(2);
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
    expect(await page.locator('input[aria-label="Display name"]').inputValue()).toBe('Changed');
  } finally { await close(page); }
}, 30_000);

browserTest('native Back during a pending push decision cannot cancel/retarget that owned decision', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__formSave.push('/previous')); await page.waitForFunction(() => window.location.pathname === '/previous');
    await page.evaluate(() => window.__formSave.push('/settings')); await page.waitForFunction(() => window.location.pathname === '/settings');
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    await page.evaluate(() => window.__formSave.push('/owned-target'));
    const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
    await page.goBack(); await page.waitForFunction(() => window.location.pathname === '/settings', undefined, { timeout: 2500 });
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.waitForFunction(() => window.location.pathname === '/owned-target', undefined, { timeout: 2500 });
  } finally { await close(page); }
}, 30_000);

browserTest('native Back between duplicate URL entries still guards the exact tagged history entry', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__formSave.push('/settings'));
    await page.waitForFunction(() => window.history.state.__zero_router_index === 1);
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    await page.goBack(); const dialog = page.getByRole('alertdialog'); await dialog.waitFor({ timeout: 2500 });
    expect(await page.evaluate(() => window.history.state.__zero_router_index)).toBe(1);
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.waitForFunction(() => window.history.state.__zero_router_index === 0);
    expect(new URL(page.url()).pathname).toBe('/settings');
  } finally { await close(page); }
}, 30_000);

browserTest('managed modal X/Escape waits for Stay/Discard and accepted field save before dismissal', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__formSave.openModal());
    const modal = page.getByRole('dialog', { name: 'Edit modal settings', exact: true }); await modal.waitFor();
    await modal.getByRole('textbox', { name: 'Modal display name', exact: true }).fill('Changed modal');
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    const confirmation = page.getByRole('alertdialog'); await confirmation.waitFor();
    expect(await page.evaluate(() => window.__formSave.modalClosed())).toBe(0);
    await confirmation.getByRole('button', { name: 'Stay', exact: true }).click(); await confirmation.waitFor({state:'hidden'});
    expect(await modal.getByRole('textbox', { name: 'Modal display name', exact: true }).inputValue()).toBe('Changed modal');
    await modal.getByRole('textbox', { name: 'Modal display name', exact: true }).press('Escape'); await confirmation.waitFor();
    await confirmation.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.waitForFunction(() => window.__formSave.calls.length === 1);
    expect(await page.evaluate(() => window.__formSave.modalClosed())).toBe(0);
    await page.evaluate(() => window.__formSave.resolve(0)); await modal.waitFor({state:'hidden'});
    expect(await page.evaluate(() => window.__formSave.modalClosed())).toBe(1);
  } finally { await close(page); }
}, 30_000);

browserTest('managed modal security discard cannot be vetoed by Stay or notify an old close callback', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__formSave.openModal());
    const modal = page.getByRole('dialog', { name: 'Edit modal settings', exact: true }); await modal.waitFor();
    await modal.getByRole('textbox', { name: 'Modal display name', exact: true }).fill('Changed modal');
    await page.evaluate(() => window.__formSave.closeModal());
    await page.getByRole('alertdialog').waitFor();
    await page.evaluate(() => window.__formSave.discardModals());
    await modal.waitFor({state:'hidden'}); expect(await page.getByRole('alertdialog').count()).toBe(0);
    expect(await page.evaluate(() => window.__formSave.modalClosed())).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('Stay retains edits, failed save stays open, and acknowledged retry leaves once', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    await page.getByRole('button', { name: 'Leave settings', exact: true }).click();
    const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
    expect(await page.locator('input[aria-label="Display name"]').inputValue()).toBe('Changed');
    await page.getByRole('button', { name: 'Leave settings', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.waitForFunction(() => window.__formSave.calls.length === 1); await page.evaluate(() => window.__formSave.reject(0));
    await dialog.getByRole('alert').waitFor(); expect(await page.evaluate(() => window.__formSave.continued())).toBe(0);
    expect(await page.locator('input[aria-label="Display name"]').inputValue()).toBe('Changed');
    await dialog.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.waitForFunction(() => window.__formSave.calls.length === 2); await page.evaluate(() => window.__formSave.resolve(1));
    await page.waitForFunction(() => window.__formSave.continued() === 1);
    expect(await page.locator('[data-slot="form-save-bar"]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);

browserTest('save-and-leave does not discard a newer draft while accepting the submitted snapshot', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Submitted');
    await page.getByRole('button', { name: 'Leave settings', exact: true }).click();
    const dialog = page.getByRole('alertdialog'); await dialog.getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.waitForFunction(() => window.__formSave.calls.length === 1);
    await page.evaluate(() => window.__formSave.editDuringSave('Newer'));
    await page.evaluate(() => window.__formSave.resolve(0));
    await dialog.getByRole('alert').waitFor(); expect(await page.evaluate(() => window.__formSave.continued())).toBe(0);
    expect(await page.locator('input[aria-label="Biography"]').inputValue()).toBe('Newer');
    await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  } finally { await close(page); }
}, 30_000);

browserTest('scope retirement aborts pending writes/prompts and disables native unload veto', async () => {
  const page = await open();
  try {
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    const before = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    expect(before).toBe(true);
    await page.getByRole('button', { name: 'Leave settings', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save and leave', exact: true }).click();
    await page.waitForFunction(() => window.__formSave.calls.length === 1); await page.evaluate(() => window.__formSave.retire());
    await page.waitForFunction(() => window.__formSave.calls[0]!.signal.aborted);
    await page.evaluate(() => window.__formSave.reject(0));
    expect(await page.evaluate(() => window.__formSave.continued())).toBe(0);
    expect(await page.locator('[data-slot="form-save-bar"]').count()).toBe(0);
    expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
  } finally { await close(page); }
}, 30_000);

for (const dark of [false, true]) browserTest(`floating controls fit320px, reserve their real height and follow ${dark ? 'dark' : 'light'} tokens`, async () => {
  const page = await open(dark);
  try {
    await page.setViewportSize({ width: 320, height: 420 });
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Changed');
    const bar = page.locator('[data-slot="form-save-bar"]'); await bar.waitFor();
    await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.form-save-bar__spacer')!).minHeight) >= document.querySelector('[data-slot="form-save-bar"]')!.getBoundingClientRect().height);
    const bounds = (await bar.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(420); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.evaluate(() => document.documentElement.style.setProperty('--card', 'rgb(31, 47, 63)'));
    expect(await bar.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(31, 47, 63)');
    await page.evaluate(() => document.documentElement.style.removeProperty('--card'));
    await page.screenshot({ path: `/Volumes/code-bank/artifacts/zero-platform/diagnostics/form-save-${dark ? 'dark' : 'light'}.png` });
  } finally { await close(page); }
}, 30_000);
