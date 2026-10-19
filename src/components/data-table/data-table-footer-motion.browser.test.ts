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
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'data-table-footer-motion.browser-fixture.tsx')], target: 'browser', format: 'iife' });
    if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
    bundle = await build.outputs.find(output => output.path.endsWith('.js'))!.text();
    css += '\n' + (await Promise.all(build.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()))).join('\n');
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
browserTest('incoming counts are passive without an eligible reveal and keep per-digit motion when they become actionable', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.__tableFooterMotion.incoming(11, false));
    const status = page.getByRole('status', { name: '11 new records', exact: true }); await status.waitFor();
    expect(await status.getAttribute('data-actionable')).toBe('false');
    expect(await status.getAttribute('tabindex')).toBeNull();
    expect(await status.locator('svg').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Reveal 11 new records', exact: true }).count()).toBe(0);
    expect(await status.evaluate(element => ({ tag: element.tagName, tabIndex: (element as HTMLElement).tabIndex })))
      .toEqual({ tag: 'DIV', tabIndex: -1 });
    const centered = await status.evaluate(element => {
      const pill = element.getBoundingClientRect(), footer = element.parentElement!.getBoundingClientRect();
      return Math.abs(pill.left + pill.width / 2 - (footer.left + footer.width / 2));
    });
    expect(centered).toBeLessThan(1);
    await status.click(); expect(await page.evaluate(() => window.__tableFooterMotion.page())).toBe(0);
    expect(await status.isVisible()).toBe(true);
    await page.evaluate(() => { window.__tableFooterMotion.clear(); window.__tableFooterMotion.incoming(12, false); });
    await page.getByRole('status', { name: '12 new records', exact: true }).waitFor();
    await page.waitForFunction(() => window.__tableFooterMotion.animations().some(record => record.value === '12' && record.options.duration === 525));
    const changed = await page.evaluate(() => window.__tableFooterMotion.animations().filter(record => record.value === '12'));
    expect(changed).toHaveLength(2);
    expect(changed.filter(record => record.options.duration === 525).map(record => record.frames[0]?.transform)).toEqual(['translateY(75%)']);
    expect(changed.filter(record => record.options.duration === 350).map(record => record.frames[1]?.transform)).toEqual(['translateY(-75%)']);
    await page.evaluate(() => window.__tableFooterMotion.incoming(12, true));
    const action = page.getByRole('button', { name: 'Reveal 12 new records', exact: true }); await action.waitFor();
    expect(await action.getAttribute('data-actionable')).toBe('true'); expect(await action.locator('svg').count()).toBe(1);
    expect(await page.getByRole('status', { name: '12 new records', exact: true }).count()).toBe(0);
    await action.click(); expect(await page.locator('[data-slot="data-table-new-records"]').count()).toBe(0);
  } finally { await close(page); }
}, 30_000);
browserTest('passive incoming counts keep the mobile footer row and disappear for zero without leaving a fake control', async () => {
  const page = await open(320, false, true);
  try {
    await page.evaluate(() => window.__tableFooterMotion.incoming(3, false));
    const status = page.getByRole('status', { name: '3 new records', exact: true }); await status.waitFor();
    const geometry = await status.evaluate(element => ({ top: element.getBoundingClientRect().top,
      controlsBottom: document.querySelector('[data-slot="data-table-page-controls"]')!.getBoundingClientRect().bottom,
      width: document.documentElement.scrollWidth }));
    expect(geometry.width).toBeLessThanOrEqual(320); expect(geometry.top).toBeGreaterThanOrEqual(geometry.controlsBottom);
    await page.evaluate(() => window.__tableFooterMotion.incoming(0, false));
    expect(await page.locator('[data-slot="data-table-new-records"]').count()).toBe(0);
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
    expect(await progress.isVisible()).toBe(true);
    expect(await progress.evaluate(element => (element as HTMLElement).style.transform)).toMatch(/^scaleX\([0-9.]+\)$/);
    expect(await progress.evaluate(element => Number((element as HTMLElement).style.transform.slice(7, -1)))).toBeCloseTo(1 / 3, 6);
    expect(await progress.evaluate(element => getComputedStyle(element).transitionProperty)).toBe('transform');
    expect(await progress.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0.7s');
    const geometry = await page.evaluate(() => {
      const footer = document.querySelector('[data-slot="data-table-pagination"]')!.getBoundingClientRect();
      const track = document.querySelector('[data-slot="data-table-page-track"]')!.getBoundingClientRect();
      const pill = document.querySelector('[data-slot="data-table-new-records"]')!.getBoundingClientRect();
      const controls = document.querySelector('[data-slot="data-table-page-controls"]')!.getBoundingClientRect();
      const fill = document.querySelector('[data-slot="data-table-page-progress"]')!.getBoundingClientRect();
      return { footerBottom: footer.bottom, trackBottom: track.bottom, trackWidth: track.width, trackHeight: track.height,
        fillWidth: fill.width, pillTop: pill.top, controlsBottom: controls.bottom };
    });
    expect(geometry.trackBottom).toBe(geometry.footerBottom); expect(geometry.pillTop).toBeGreaterThanOrEqual(geometry.controlsBottom);
    expect(geometry.trackHeight).toBe(2); expect(geometry.trackWidth).toBeGreaterThan(0);
    expect(geometry.fillWidth / geometry.trackWidth).toBeCloseTo(1 / 3, 6);
    await page.getByLabel('Next page', { exact: true }).click();
    await page.waitForFunction(() => window.__tableFooterMotion.page() === 1);
    expect(await progress.evaluate(element => Number((element as HTMLElement).style.transform.slice(7, -1)))).toBeCloseTo(2 / 3, 6);
    await page.getByLabel('Last page', { exact: true }).click();
    await page.waitForFunction(() => window.__tableFooterMotion.page() === 2);
    expect(await progress.evaluate(element => (element as HTMLElement).style.transform)).toBe('scaleX(1)');
  } finally { await close(page); }
}, 30_000);
for (const dark of [false, true]) browserTest(`progress track paints in ${dark ? 'dark' : 'light'} theme and scoped tokens control its height and colors`, async () => {
  const page = await open(1100, dark, true);
  try {
    const track = page.locator('[data-slot="data-table-page-track"]'), progress = page.locator('[data-slot="data-table-page-progress"]');
    const background = await track.evaluate(element => getComputedStyle(element).backgroundColor);
    const foreground = await progress.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)'); expect(foreground).not.toBe('rgba(0, 0, 0, 0)');
    expect(background).not.toBe(foreground);
    await page.locator('[data-slot="data-table-pagination"]').evaluate(element => {
      const footer = element as HTMLElement;
      footer.style.setProperty('--zero-data-table-progress-height', '4px');
      footer.style.setProperty('--zero-data-table-progress-background', 'rgb(30, 40, 50)');
      footer.style.setProperty('--zero-data-table-progress-foreground', 'rgb(60, 70, 80)');
    });
    expect((await track.boundingBox())!.height).toBe(4);
    expect(await track.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(30, 40, 50)');
    expect(await progress.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(60, 70, 80)');
    expect(await progress.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
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
