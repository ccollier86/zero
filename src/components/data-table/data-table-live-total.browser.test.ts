/** Styled public DataTable qualification: real source invalidation, accepted totals, odometers and transform-only progress. Synthetic receipts only. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', styles = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const scratchRoot = process.env.ZERO_TEST_SCRATCH_ROOT ?? '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(join(scratchRoot, 'table-live-total-'));
  try {
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'data-table-live-total.browser-fixture.tsx')], target: 'browser', format: 'iife' });
    if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
    bundle = await build.outputs.find(output => output.path.endsWith('.js'))!.text();
    styles = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
    styles += '\n' + (await Promise.all(build.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()))).join('\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
const row = (id: string, rank = 1, name = `Alpha ${id}`) => ({ id, rank, name });
async function mount(reduced = false) {
  const page = await lease!.browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(8_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body style="margin:0;padding:12px"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: styles }); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => window.__liveTotal.reads().length === 1);
  return { page, errors };
}
async function settled(page: Page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="data-table-skeleton-body"]')
    && !document.querySelector('[data-slot="data-table-skeleton-crossfade"]') && !document.querySelector('[data-table-leaving]')
    && [...document.querySelectorAll('[data-row-id]')].every(row => row.getAnimations().length === 0));
}
async function accept(page: Page, index: number, rows: ReturnType<typeof row>[], total?: number) {
  await page.evaluate(({ index, rows, total }) => window.__liveTotal.accept(index, rows, total), { index, rows, total });
}
async function progress(page: Page) {
  return page.locator('[data-slot="data-table-page-progress"]').evaluate(element => ({
    transform: (element as HTMLElement).style.transform, duration: getComputedStyle(element).transitionDuration,
    property: getComputedStyle(element).transitionProperty,
    ratio: Number((element as HTMLElement).style.transform.match(/scaleX\(([^)]+)\)/)?.[1]),
  }));
}
async function pending(page: Page, start: number, offset: number) {
  await page.waitForFunction(({ start, offset }) => window.__liveTotal.reads().some((read, index) =>
    index >= start && !read.aborted && read.includeTotal === 'true' && read.offset === offset), { start, offset });
  return page.evaluate(({ start, offset }) => window.__liveTotal.reads().findIndex((read, index) =>
    index >= start && !read.aborted && read.includeTotal === 'true' && read.offset === offset), { start, offset });
}
async function proveLeading(page: Page, start: number, id: string) {
  const matches = (read: { aborted: boolean; includeTotal: string | null; offset: number; limit: number; filters: string[] }) =>
    !read.aborted && read.includeTotal === null && read.offset === 0 && read.limit === 1
      && !read.filters.some(filter => filter.startsWith('id:in:'));
  await page.waitForFunction(start => window.__liveTotal.reads().some((read, index) => index >= start
    && !read.aborted && read.includeTotal === null && read.offset === 0 && read.limit === 1
    && !read.filters.some(filter => filter.startsWith('id:in:'))), start);
  const proof = (await page.evaluate(() => window.__liveTotal.reads())).findIndex((read, index) => index >= start && matches(read));
  await accept(page, proof, [row(id, 5)]);
}

browserTest('built-in live totals add and remove pages while held insertions stay separate from count and progress', async () => {
  const { page, errors } = await mount();
  try {
    expect((await page.evaluate(() => window.__liveTotal.reads()))[0]!.includeTotal).toBe('true');
    await accept(page, 0, [row('r1', 4), row('r2', 3)], 4);
    await page.getByRole('group', { name: 'Page 1 of 2', exact: true }).waitFor(); await settled(page);
    expect((await progress(page)).transform).toBe('scaleX(0.5)');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    const second = await pending(page, 1, 2);
    await accept(page, second, [row('r3', 2), row('r4', 1)], 4);
    await page.getByRole('group', { name: 'Page 2 of 2', exact: true }).waitFor();
    await page.locator('tr[data-row-id="r3"]').waitFor(); await settled(page);
    expect((await progress(page)).transform).toBe('scaleX(1)');
    await page.evaluate(() => { window.__liveTotal.save('r3'); window.__liveTotal.emit({ op: 'INSERT', rowId: 'new' }); });
    const inserted = await pending(page, second + 1, 2);
    await page.waitForFunction(() => window.__liveTotal.reads().some(read => read.includeTotal === null && read.filters.includes('id:in:new')));
    const member = await page.evaluate(() => window.__liveTotal.reads().findIndex(read => read.includeTotal === null && read.filters.includes('id:in:new')));
    await accept(page, member, [row('new', 5)]);
    await page.getByRole('status', { name: '1 new records', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).count()).toBe(0);
    await proveLeading(page, second + 1, 'new');
    await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).waitFor();
    // Membership alone cannot inflate the total or invent another page.
    expect((await progress(page)).transform).toBe('scaleX(1)');
    expect(await page.getByRole('group', { name: 'Page 2 of 2', exact: true }).count()).toBe(1);
    await accept(page, inserted, [row('r3', 2), row('r4', 1)], 5);
    await page.getByRole('group', { name: 'Page 2 of 3', exact: true }).waitFor();
    expect(await page.getByRole('status', { name: 'Showing 3-4 of 5', exact: true }).count()).toBe(1);
    expect((await progress(page)).ratio).toBeCloseTo(2 / 3, 5);
    expect(await page.evaluate(() => window.__liveTotal.same('r3'))).toBe(true);
    expect(await page.locator('[data-row-id="new"]').count()).toBe(0);
    const digit = await page.locator('[data-slot="data-table-page-count"] [data-slot="data-table-digit"]').evaluate(element =>
      [...element.children].flatMap(child => child.getAnimations().map(animation => ({
        duration: animation.effect?.getTiming().duration,
        frames: (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.transform),
      }))));
    expect(digit.some(animation => animation.duration === 525 && animation.frames[0] === 'translateY(75%)')).toBe(true);
    expect((await progress(page)).property).toBe('transform');
    expect((await progress(page)).duration).toBe('0.7s');
    const beforeUpdate = (await page.evaluate(() => window.__liveTotal.reads())).length;
    await page.evaluate(() => window.__liveTotal.emit({ op: 'UPDATE', rowId: 'r4' }));
    const update = await pending(page, beforeUpdate, 2);
    await accept(page, update, [row('r3', 2), row('r4', 1, 'Alpha updated')], 6);
    await proveLeading(page, beforeUpdate, 'new');
    await page.getByRole('status', { name: 'Showing 3-4 of 6', exact: true }).waitFor();
    expect((await progress(page)).ratio).toBeCloseTo(2 / 3, 5);
    expect(await page.getByRole('button', { name: 'Reveal 1 new records', exact: true }).count()).toBe(1);
    const beforeDelete = (await page.evaluate(() => window.__liveTotal.reads())).length;
    await page.evaluate(() => window.__liveTotal.emit({ op: 'DELETE', rowId: 'new' }));
    const removed = await pending(page, beforeDelete, 2);
    await accept(page, removed, [row('r3', 2), row('r4', 1)], 4);
    await page.getByRole('group', { name: 'Page 2 of 2', exact: true }).waitFor();
    expect((await progress(page)).transform).toBe('scaleX(1)');
    expect(await page.locator('[data-slot="data-table-new-records"]').count()).toBe(0);
    const beforeSize = (await page.evaluate(() => window.__liveTotal.reads())).length;
    await page.getByRole('combobox', { name: 'Rows per page', exact: true }).click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    const resized = await pending(page, beforeSize, 0);
    expect((await page.evaluate(() => window.__liveTotal.reads()))[resized]!.limit).toBe(10);
    await accept(page, resized, [row('r1', 4), row('r2', 3), row('r3', 2), row('r4', 1)], 4);
    await page.getByRole('group', { name: 'Page 1 of 1', exact: true }).waitFor();
    expect((await progress(page)).transform).toBe('scaleX(1)'); expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);

browserTest('filtered totals accept only the current query, shrink-clamp safely, and count opt-out retires known totals', async () => {
  const { page, errors } = await mount(true);
  try {
    await accept(page, 0, [row('r1', 6), row('r2', 5)], 6); await settled(page);
    await page.getByRole('button', { name: 'Last page', exact: true }).click();
    const last = await pending(page, 1, 4);
    await accept(page, last, [row('r5', 2), row('r6', 1)], 6);
    await page.getByRole('group', { name: 'Page 3 of 3', exact: true }).waitFor();
    const beforeDelete = (await page.evaluate(() => window.__liveTotal.reads())).length;
    await page.evaluate(() => window.__liveTotal.emit({ op: 'DELETE', rowId: 'r6' }));
    const shrinking = await pending(page, beforeDelete, 4);
    await accept(page, shrinking, [], 3);
    const clamped = await pending(page, shrinking + 1, 2);
    await accept(page, clamped, [row('r3', 1)], 3);
    await page.getByRole('group', { name: 'Page 2 of 2', exact: true }).waitFor();
    expect((await progress(page)).transform).toBe('scaleX(1)');
    expect(await page.getByRole('status', { name: 'Showing 3-3 of 3', exact: true }).count()).toBe(1);
    await page.getByRole('searchbox', { name: 'Search total records', exact: true }).fill('Alpha');
    await page.waitForFunction(() => window.__liveTotal.reads().some(read => read.search === 'Alpha'));
    const alpha = await page.evaluate(() => window.__liveTotal.reads().findIndex(read => read.search === 'Alpha'));
    await page.getByRole('searchbox', { name: 'Search total records', exact: true }).fill('Beta');
    await page.waitForFunction(() => window.__liveTotal.reads().some(read => read.search === 'Beta'));
    const beta = await page.evaluate(() => window.__liveTotal.reads().findIndex(read => read.search === 'Beta'));
    expect((await page.evaluate(() => window.__liveTotal.reads()))[alpha]!.aborted).toBe(true);
    await accept(page, beta, [row('b1', 1, 'Beta result')], 1);
    await page.getByRole('status', { name: 'Showing 1-1 of 1', exact: true }).waitFor();
    await accept(page, alpha, [row('late', 9, 'Alpha stale')], 999);
    expect(await page.getByRole('group', { name: 'Page 1 of 1', exact: true }).count()).toBe(1);
    expect(await page.locator('[data-row-id="late"]').count()).toBe(0);
    const beforeFilter = (await page.evaluate(() => window.__liveTotal.reads())).length;
    await page.evaluate(() => window.__liveTotal.change({ globalFilter: '', columnFilters: [{ id: 'rank', value: { op: 'gt', value: 3 } }] }));
    const filtered = await pending(page, beforeFilter, 0);
    expect((await page.evaluate(() => window.__liveTotal.reads()))[filtered]!.filters).toEqual(['rank:gt:3']);
    await accept(page, filtered, [row('r1', 6), row('r2', 5)], 5);
    await page.getByRole('group', { name: 'Page 1 of 3', exact: true }).waitFor();
    expect((await progress(page)).ratio).toBeCloseTo(1 / 3, 5);
    const beforeOptOut = (await page.evaluate(() => window.__liveTotal.reads())).length;
    await page.evaluate(() => window.__liveTotal.includeTotal(false));
    await page.waitForFunction(start => window.__liveTotal.reads().some((read, index) => index >= start && read.includeTotal === null), beforeOptOut);
    const legacy = await page.evaluate(start => window.__liveTotal.reads().findIndex((read, index) => index >= start && read.includeTotal === null), beforeOptOut);
    expect(await page.locator('[data-slot="data-table-page-track"]').count()).toBe(0);
    await accept(page, legacy, [row('r1', 6), row('r2', 5)]);
    await page.getByRole('group', { name: 'Page 1', exact: true }).waitFor();
    expect(await page.locator('[data-slot="data-table-page-track"]').count()).toBe(0);
    expect(await page.getByRole('status', { name: 'Showing 1-2', exact: true }).count()).toBe(1);
    expect(await page.evaluate(() => window.__liveTotal.events())).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 30_000);
