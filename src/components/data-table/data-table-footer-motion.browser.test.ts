/** Styled footer, native interruptible WAAPI, and sort acceptance through the existing isolated browser lease. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'; // Bun has no equivalent temporary-directory/removal API.
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const screenshots = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/data-table-footer-motion';
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
const errors = new WeakMap<Page, string[]>();
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true }); await mkdir(screenshots, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'table-footer-motion-'));
  try {
    css = await Bun.file((await buildPlatformStyles(directory, `${directory}/absent-app`)).cssPath).text();
    const output = join(directory, 'fixture.js');
    const build = Bun.spawn([process.execPath, 'build', `${import.meta.dir}/data-table-footer-motion.browser-fixture.tsx`,
      '--target=browser', '--format=iife', '--outfile', output], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', timeout: 40_000, killSignal: 'SIGKILL' });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Footer fixture build failed (${code}): ${stderr || stdout}`);
    bundle = await Bun.file(output).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function open(width = 1100, dark = false, reduced = false) {
  const page = await lease!.browser.newPage({ viewport: { width, height: 720 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.setContent(`<!doctype html><html${dark ? ' class="dark"' : ''}><body><div id="root"></div></body></html>`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('status', { name: 'Showing 1-10 of 25', exact: true }).waitFor(); return page;
}
async function close(page: Page) { try { expect(errors.get(page)).toEqual([]); } finally { await page.close(); } }
browserTest('only changed digits roll 75%, with exact durations and rightmost-first carry; first render is still', async () => {
  const page = await open();
  try {
    expect(await page.evaluate(() => window.__tableFooterMotion.animations())).toEqual([]);
    await page.evaluate(() => window.__tableFooterMotion.value(100));
    await page.waitForFunction(() => window.__tableFooterMotion.animations().filter(record => record.value === '100').length === 5);
    const records = await page.evaluate(() => window.__tableFooterMotion.animations().filter(record => record.value === '100'));
    expect(records.map(record => record.options.duration).sort()).toEqual([350, 350, 525, 525, 525]);
    expect(records.filter(record => record.options.duration === 525).map(record => record.options.delay)).toEqual([60, 30, 0]);
    expect(records.every(record => record.options.easing === 'cubic-bezier(.2, 0, 0, 1)')).toBe(true);
    expect(records.filter(record => record.options.duration === 525).every(record => record.frames[0]?.transform === 'translateY(75%)')).toBe(true);
    expect(records.filter(record => record.options.duration === 350).every(record => record.frames[1]?.transform === 'translateY(-75%)')).toBe(true);
  } finally { await close(page); }
}, 30_000);
browserTest('an interrupted down-roll captures the current pose and retires old animation callbacks without extra digits', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__tableFooterMotion.value(100));
    await page.waitForFunction(() => window.__tableFooterMotion.animations().some(record => record.value === '100'));
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="roller"] [data-slot="data-table-digit"] > span').forEach(element => {
        for (const animation of element.getAnimations()) animation.currentTime = 160;
      });
      window.__tableFooterMotion.clear(); window.__tableFooterMotion.value(98);
    });
    await page.waitForFunction(() => window.__tableFooterMotion.animations().some(record => record.value === '98'));
    const records = await page.evaluate(() => window.__tableFooterMotion.animations());
    expect(records.filter(record => record.options.duration === 525).every(record => record.frames[0]?.transform === 'translateY(-75%)')).toBe(true);
    expect(records.some(record => record.options.duration === 350 && String(record.frames[0]?.transform).startsWith('matrix'))).toBe(true);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="roller"] [data-slot="data-table-digit"]')]
      .every(slot => slot.children.length === 1));
    expect(await page.getByTestId('roller').textContent()).toBe('98');
  } finally { await close(page); }
}, 30_000);
for (const reduced of [false, true]) browserTest(`${reduced ? 'reduced motion' : 'motion disabled'} leaves final digits visible without animation`, async () => {
  const page = await open(1100, false, reduced);
  try {
    if (!reduced) await page.evaluate(() => window.__tableFooterMotion.motion(false));
    await page.evaluate(() => window.__tableFooterMotion.value(1234));
    await page.waitForFunction(() => document.querySelector('[data-testid="roller"] [data-value="1234"]'));
    expect(await page.evaluate(() => window.__tableFooterMotion.animations())).toEqual([]);
    expect(await page.getByTestId('roller').textContent()).toBe('1,234');
    expect(await page.locator('[data-slot="data-table-sort-indicator"]').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  } finally { await close(page); }
}, 30_000);
browserTest('footer keyboard navigation is focus-scoped, prefetch is intent-only, and loading does not lock current controls', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__tableFooterMotion.loading(true));
    const next = page.getByLabel('Next page', { exact: true }); expect(await next.isEnabled()).toBe(true);
    expect(await page.getByRole('combobox', { name: 'Rows per page' }).isEnabled()).toBe(true);
    await next.focus(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__tableFooterMotion.page() === 1);
    expect(await page.evaluate(() => window.__tableFooterMotion.navigation().at(-1))).toEqual({ page: 1, origin: 'keyboard' });
    expect(await page.evaluate(() => window.__tableFooterMotion.prefetch())).toContain(1);
    const pageDigits = await page.evaluate(() => window.__tableFooterMotion.animations().filter(record => record.value === '2'));
    expect(pageDigits.some(record => record.options.duration === 367.5)).toBe(true);
    await page.getByLabel('Outside editor').focus(); await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => window.__tableFooterMotion.page())).toBe(1);
    await page.getByRole('combobox', { name: 'Rows per page' }).focus(); await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => window.__tableFooterMotion.page())).toBe(1);
    await page.getByLabel('Reveal 12 new records').click(); expect(await page.locator('[data-slot="data-table-new-records"]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('sort arrows keep the original asc/desc/clear keyboard cycle, rotate180deg over350ms, and show inactive hover0.4', async () => {
  const page = await open();
  try {
    const header = page.getByRole('button', { name: 'Name', exact: true }), arrow = page.locator('[data-slot="data-table-sort-indicator"]');
    expect(await arrow.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
    await header.hover(); await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-slot="data-table-sort-indicator"]')!).opacity === '0.4');
    expect(await arrow.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0.35s, 0.12s');
    await header.click(); await page.getByRole('button', { name: 'Name, sorted ascending', exact: true }).waitFor();
    expect(await arrow.evaluate(element => (element as SVGElement).style.transform)).toBe('rotate(180deg)');
    await page.keyboard.press('Enter'); await page.getByRole('button', { name: 'Name, sorted descending', exact: true }).waitFor();
    expect(await arrow.evaluate(element => (element as SVGElement).style.transform)).toBe('rotate(0deg)');
    await page.keyboard.press('Enter'); await page.getByRole('button', { name: 'Name', exact: true }).waitFor();
  } finally { await close(page); }
}, 30_000);
for (const dark of [false, true]) browserTest(`footer stays inside320px ${dark ? 'dark' : 'light'} with the new-record pill on its own row`, async () => {
  const page = await open(320, dark, true);
  try {
    const boxes = await page.evaluate(() => {
      const footer = document.querySelector('[data-slot="data-table-pagination"]')!, count = document.querySelector('[data-slot="data-table-page-count"]')!,
        pill = document.querySelector('[data-slot="data-table-new-records"]')!, controls = document.querySelector('[data-slot="data-table-page-controls"]')!;
      return { footer: footer.getBoundingClientRect().toJSON(), count: count.getBoundingClientRect().toJSON(),
        pill: pill.getBoundingClientRect().toJSON(), controls: controls.getBoundingClientRect().toJSON(), width: document.documentElement.scrollWidth };
    });
    expect(boxes.width).toBeLessThanOrEqual(320); expect(boxes.pill.y).toBeGreaterThanOrEqual(Math.max(boxes.count.bottom, boxes.controls.bottom));
    expect(boxes.controls.right).toBeLessThanOrEqual(320);
    await page.screenshot({ path: join(screenshots, dark ? 'footer-dark-320.png' : 'footer-light-320.png'), animations: 'disabled' });
    await page.evaluate(() => window.__tableFooterMotion.mode('cursor'));
    await page.getByRole('status', { name: '7 records on this page', exact: true }).waitFor();
    expect(await page.locator('[data-slot="data-table-page-track"]').count()).toBe(0);
    expect(await page.getByRole('group', { name: 'Page 1', exact: true }).isVisible()).toBe(true);
    await page.evaluate(() => window.__tableFooterMotion.mode('offset'));
    await page.getByRole('status', { name: 'Showing 41-47', exact: true }).waitFor();
    expect(await page.locator('[data-slot="data-table-page-track"]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('known-page progress grows along the footer bottom with transform-only motion; at520px the pill still owns its row', async () => {
  const page = await open(520);
  try {
    const progress = page.locator('[data-slot="data-table-page-progress"]');
    expect(await progress.evaluate(element => (element as HTMLElement).style.transform)).toMatch(/^scaleX\([0-9.]+\)$/);
    expect(await progress.evaluate(element => Number((element as HTMLElement).style.transform.slice(7, -1)))).toBeCloseTo(1 / 3, 6);
    expect(await progress.evaluate(element => getComputedStyle(element).transitionProperty)).toBe('transform');
    expect(await progress.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0.7s');
    const geometry = await page.evaluate(() => {
      const footer = document.querySelector('[data-slot="data-table-pagination"]')!.getBoundingClientRect();
      const track = document.querySelector('[data-slot="data-table-page-track"]')!.getBoundingClientRect();
      const pill = document.querySelector('[data-slot="data-table-new-records"]')!.getBoundingClientRect();
      const controls = document.querySelector('[data-slot="data-table-page-controls"]')!.getBoundingClientRect();
      return { footerBottom: footer.bottom, trackBottom: track.bottom, pillTop: pill.top, controlsBottom: controls.bottom };
    });
    expect(geometry.trackBottom).toBe(geometry.footerBottom); expect(geometry.pillTop).toBeGreaterThanOrEqual(geometry.controlsBottom);
    await page.getByLabel('Next page', { exact: true }).click();
    await page.waitForFunction(() => window.__tableFooterMotion.page() === 1);
    expect(await progress.evaluate(element => Number((element as HTMLElement).style.transform.slice(7, -1)))).toBeCloseTo(2 / 3, 6);
    await page.getByLabel('Last page', { exact: true }).click();
    await page.waitForFunction(() => window.__tableFooterMotion.page() === 2);
    expect(await progress.evaluate(element => (element as HTMLElement).style.transform)).toBe('scaleX(1)');
  } finally { await close(page); }
}, 30_000);
browserTest('same-frame relative clicks retain TanStack functional pagination instead of collapsing to a captured target', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const next = document.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!;
      next.click(); next.click();
    });
    await page.waitForFunction(() => window.__tableFooterMotion.page() === 2);
    await page.getByRole('status', { name: 'Showing 21-25 of 25', exact: true }).waitFor();
    expect(await page.getByLabel('Next page', { exact: true }).isDisabled()).toBe(true);
  } finally { await close(page); }
}, 30_000);
browserTest('retired prefetch callbacks do not report late failures; current failures emit only a safe code and stage', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__tableFooterMotion.holdPrefetch());
    await page.getByLabel('Next page', { exact: true }).focus();
    await page.evaluate(() => window.__tableFooterMotion.value(100));
    await page.waitForFunction(() => document.querySelector('[data-testid="roller"] [data-value="100"]'));
    await page.evaluate(async () => { window.__tableFooterMotion.rejectPrefetch(); await Promise.resolve(); await Promise.resolve(); });
    expect(await page.evaluate(() => window.__tableFooterMotion.observed())).toEqual([]);
    await page.getByLabel('Outside editor').focus(); await page.getByLabel('Next page', { exact: true }).focus();
    await page.evaluate(() => window.__tableFooterMotion.rejectPrefetch());
    await page.waitForFunction(() => window.__tableFooterMotion.observed().length === 1);
    const observed = await page.evaluate(() => window.__tableFooterMotion.observed());
    expect(observed[0]?.metadata).toEqual({ component: 'DataTablePagination', stage: 'prefetch' });
    expect(JSON.stringify(observed)).not.toContain('PRIVATE_PREFETCH_CAUSE');
  } finally { await close(page); }
}, 30_000);
